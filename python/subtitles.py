"""Transforma a saída do Whisper em blocos de legenda legíveis.

Lógica pura, sem I/O: entra estrutura, sai estrutura. É aqui que mora a
qualidade do recurso — o Whisper devolve segmentos longos demais e jogá-los
crus num .srt produz paredão de texto que ninguém consegue ler no tempo em que
fica na tela.

As regras seguem a prática de legendagem profissional (Netflix, BBC):
no máximo 2 linhas, ~42 caracteres por linha, e tempo mínimo em tela para dar
conta de ler.
"""

import re
from dataclasses import dataclass, field

# Padrões de legendagem. Não são números mágicos: 42 caracteres é o limite
# clássico para caber em tela 16:9 sem invadir a margem segura, e 2 linhas é o
# máximo antes de a legenda cobrir a imagem.
MAX_CHARS = 42
MAX_LINES = 2
MAX_DUR = 7.0
MIN_DUR = 0.8
# Lacuna a partir da qual se assume troca de assunto e corta o bloco.
MAX_GAP = 0.8

FIM_DE_FRASE = ".!?…"
PAUSA = ",;:"


# Ritmos de legenda. O padrão profissional (42×2) é certo para filme e errado
# para vídeo curto: vira paredão de texto parado na tela. Os ritmos menores
# existem para o uso em redes sociais.
RITMOS: dict[str, dict] = {
    "classica": {"max_chars": 42, "max_linhas": 2, "max_palavras": 0},
    "curta": {"max_chars": 24, "max_linhas": 1, "max_palavras": 0},
    "tiktok": {"max_chars": 18, "max_linhas": 1, "max_palavras": 3},
}
RITMO_PADRAO = "classica"


@dataclass
class Bloco:
    start: float
    end: float
    linhas: list[str] = field(default_factory=list)
    # Palavras com tempo, preservadas para o karaokê do ASS. O .srt/.vtt só
    # usa `texto`; quem precisa de tempo por palavra é o `\k`.
    palavras: list[dict] = field(default_factory=list)

    @property
    def texto(self) -> str:
        return "\n".join(self.linhas)


def _quebrar_em_linhas(palavras: list[str], max_chars: int, max_linhas: int) -> list[str]:
    """Distribui palavras em linhas equilibradas.

    Equilibrar importa: "uma linha cheia + uma palavra solta embaixo" lê pior
    que duas linhas médias, mesmo respeitando o limite.

    **Nunca descarta palavra.** Na última linha disponível, devolve todo o resto
    mesmo estourando `max_chars` — uma linha comprida é um defeito visual; uma
    palavra sumida é a legenda mentindo sobre o que foi dito. Isso já aconteceu:
    "…sem enviar nada para a internet." virava "…sem enviar nada para a".
    """
    if not palavras:
        return []

    texto = " ".join(palavras)
    if len(texto) <= max_chars or max_linhas <= 1:
        return [texto]

    # Alvo = divisão equilibrada; procura o ponto de corte mais próximo dele.
    alvo = len(texto) / min(max_linhas, 2)
    melhor_corte = None
    melhor_dist = None
    acumulado = 0

    for i, p in enumerate(palavras[:-1]):
        acumulado += len(p) + (1 if i else 0)
        dist = abs(acumulado - alvo)
        if acumulado <= max_chars and (melhor_dist is None or dist < melhor_dist):
            melhor_dist = dist
            melhor_corte = i + 1

    if melhor_corte is None:
        # Palavra única maior que o limite (URL, termo técnico). Não parte no
        # meio: uma linha estourada é melhor que uma palavra ilegível.
        melhor_corte = 1

    primeira = " ".join(palavras[:melhor_corte])
    resto = palavras[melhor_corte:]
    return [primeira] + _quebrar_em_linhas(resto, max_chars, max_linhas - 1)


def segmentar(
    palavras: list[dict],
    max_chars: int = MAX_CHARS,
    max_linhas: int = MAX_LINES,
    max_dur: float = MAX_DUR,
    min_dur: float = MIN_DUR,
    max_gap: float = MAX_GAP,
    max_palavras: int = 0,
) -> list[Bloco]:
    """Agrupa palavras com tempo em blocos de legenda.

    `palavras`: [{"start": float, "end": float, "word": str}, ...]

    Corta quando: fim de frase, silêncio longo, estouro de caracteres, de
    duração ou de contagem de palavras. A ordem importa — pontuação primeiro,
    porque cortar numa fronteira de frase é sempre melhor que cortar por limite
    mecânico.

    `max_palavras` (0 = sem limite) é o que produz a legenda de 1-3 palavras
    por vez: sem ele, um bloco curto em caracteres ainda junta muita palavra
    pequena.
    """
    limpas = [p for p in palavras if str(p.get("word", "")).strip()]
    if not limpas:
        return []

    blocos: list[Bloco] = []
    atual: list[dict] = []
    limite_bloco = max_chars * max_linhas

    def fechar() -> None:
        if not atual:
            return
        textos = [str(p["word"]).strip() for p in atual]
        bloco = Bloco(
            start=float(atual[0]["start"]),
            end=float(atual[-1]["end"]),
            linhas=_quebrar_em_linhas(textos, max_chars, max_linhas),
            palavras=[
                {"start": float(w["start"]), "end": float(w["end"]), "word": str(w["word"]).strip()}
                for w in atual
            ],
        )
        # Legenda relâmpago é ilegível; estica até o mínimo. A correção de
        # sobreposição acontece depois, quando todos os blocos existem.
        if bloco.end - bloco.start < min_dur:
            bloco.end = bloco.start + min_dur
        blocos.append(bloco)
        atual.clear()

    for p in limpas:
        if atual:
            gap = float(p["start"]) - float(atual[-1]["end"])
            largura = sum(len(str(w["word"]).strip()) + 1 for w in atual) + len(str(p["word"]).strip())
            duracao = float(p["end"]) - float(atual[0]["start"])
            estourou_palavras = max_palavras > 0 and len(atual) >= max_palavras
            if gap >= max_gap or largura > limite_bloco or duracao > max_dur or estourou_palavras:
                fechar()

        atual.append(p)

        if str(p["word"]).strip().endswith(tuple(FIM_DE_FRASE)):
            fechar()

    fechar()

    # O alongamento pelo min_dur pode ter feito um bloco invadir o próximo.
    for a, b in zip(blocos, blocos[1:]):
        if a.end > b.start:
            a.end = b.start

    return blocos


_TEMPO_LEGENDA = re.compile(
    r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})"
)


def de_srt(texto: str) -> list[Bloco]:
    """Lê .srt ou .vtt de volta para blocos.

    Existe para o caminho "já tenho a legenda e quero gravá-la no vídeo": sem
    isto, um arquivo revisado à mão só poderia ser queimado sem estilo nenhum,
    porque estilo mora no .ass.

    Perde o tempo por palavra — o .srt não guarda. Karaokê fica indisponível
    para legenda importada, e é por isso que a interface o desabilita nesse caso.
    """
    blocos: list[Bloco] = []
    linhas = texto.replace("\r\n", "\n").split("\n")
    i = 0
    while i < len(linhas):
        m = _TEMPO_LEGENDA.search(linhas[i])
        if not m:
            i += 1
            continue

        def seg(h: str, mi: str, s: str, ms: str) -> float:
            # O VTT usa milissegundos com 3 dígitos; alguns arquivos trazem
            # menos. Normalizar evita ler ".5" como 5 ms em vez de 500.
            return int(h) * 3600 + int(mi) * 60 + int(s) + int(ms.ljust(3, "0")) / 1000

        inicio = seg(*m.group(1, 2, 3, 4))
        fim = seg(*m.group(5, 6, 7, 8))

        i += 1
        corpo: list[str] = []
        while i < len(linhas) and linhas[i].strip():
            corpo.append(linhas[i].strip())
            i += 1
        if corpo:
            blocos.append(Bloco(start=inicio, end=fim, linhas=corpo))
    return blocos


def segmentar_por_ritmo(palavras: list[dict], ritmo: str = RITMO_PADRAO) -> list[Bloco]:
    """`segmentar` com os limites de um ritmo nomeado."""
    return segmentar(palavras, **RITMOS.get(ritmo, RITMOS[RITMO_PADRAO]))


def redistribuir_palavras(bloco: Bloco) -> Bloco:
    """Recalcula o tempo de cada palavra a partir do texto e da duração.

    Necessário depois que o usuário edita o texto: os tempos vindos do Whisper
    valiam para as palavras ANTIGAS. Corrigir "transclica" para "transcrição" já
    invalida o alinhamento, e emendar o `\\k` com dados velhos põe o destaque na
    palavra errada — pior que não ter karaokê.

    O peso é o comprimento da palavra: "extraordinariamente" leva mais tempo que
    "de". É aproximação, não alinhamento forçado, e por isso só entra quando o
    texto mudou — o tempo original do Whisper é sempre melhor quando ainda vale.
    """
    texto = " ".join(l.strip() for l in bloco.linhas).split()
    if not texto:
        bloco.palavras = []
        return bloco

    duracao = max(0.0, bloco.end - bloco.start)
    total = sum(len(p) for p in texto) or len(texto)

    palavras: list[dict] = []
    t = bloco.start
    for p in texto:
        fatia = duracao * (len(p) / total)
        palavras.append({"start": t, "end": t + fatia, "word": p})
        t += fatia
    # A última encosta no fim exato do bloco: acumular float deixa sobra.
    if palavras:
        palavras[-1]["end"] = bloco.end

    bloco.palavras = palavras
    return bloco


def de_segmentos(segmentos: list[dict]) -> list[Bloco]:
    """Blocos a partir do que a interface devolve depois da edição.

    Aceita `palavras` quando vierem (texto intocado, tempo do Whisper preservado)
    e recalcula quando não vierem ou não casarem mais com o texto — é o que
    mantém o karaokê honesto depois de uma correção.
    """
    blocos: list[Bloco] = []
    for s in segmentos:
        texto = str(s.get("text", ""))
        b = Bloco(
            start=float(s.get("start", 0.0)),
            end=float(s.get("end", 0.0)),
            linhas=[l for l in texto.split("\n") if l.strip()],
        )
        if b.end < b.start:
            b.start, b.end = b.end, b.start

        cruas = s.get("words") or []
        n_texto = len(" ".join(b.linhas).split())
        if cruas and len(cruas) == n_texto:
            b.palavras = [
                {"start": float(w["start"]), "end": float(w["end"]), "word": str(w["word"])}
                for w in cruas
            ]
        else:
            redistribuir_palavras(b)
        blocos.append(b)
    return blocos


def _tempo_srt(s: float) -> str:
    ms = int(round(s * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    seg, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{seg:02d},{ms:03d}"


def _tempo_vtt(s: float) -> str:
    return _tempo_srt(s).replace(",", ".")


def para_srt(blocos: list[Bloco]) -> str:
    partes = []
    for i, b in enumerate(blocos, 1):
        partes.append(f"{i}\n{_tempo_srt(b.start)} --> {_tempo_srt(b.end)}\n{b.texto}\n")
    return "\n".join(partes)


def para_vtt(blocos: list[Bloco]) -> str:
    partes = ["WEBVTT\n"]
    for b in blocos:
        partes.append(f"{_tempo_vtt(b.start)} --> {_tempo_vtt(b.end)}\n{b.texto}\n")
    return "\n".join(partes)


# ─── ASS (legenda com estilo) ────────────────────────────────────────────────
# O .srt só guarda texto e tempo. O ASS carrega fonte, cor, contorno, posição e
# animação — e o ffmpeg empacotado já tem libass, então estilizar não custa
# dependência nova. É o formato que permite a legenda "de TikTok".

# Resolução de referência do canvas do ASS. O libass escala para o vídeo real,
# então as medidas abaixo valem para qualquer resolução.
ASS_LARGURA = 1920
ASS_ALTURA = 1080


@dataclass(frozen=True)
class Estilo:
    id: str
    nome: str
    descricao: str
    fonte: str = "Arial"
    tamanho: int = 64
    # Cores no formato do ASS: &HAABBGGRR — alfa e BGR invertido, não RGB.
    cor: str = "&H00FFFFFF"
    cor_contorno: str = "&H00000000"
    cor_fundo: str = "&H00000000"
    negrito: int = -1  # -1 = ligado no ASS, 0 = desligado
    contorno: float = 3.0
    sombra: float = 1.0
    # 1 = caixa opaca atrás do texto; 3 = só contorno
    borda_estilo: int = 1
    # Numpad: 2 = base centro, 5 = meio da tela
    alinhamento: int = 2
    margem_v: int = 60
    # Efeitos aplicados por bloco, em tags ASS inline.
    entrada: str = ""
    # Cor da palavra ACESA no karaokê. Vira PrimaryColour quando o karaokê está
    # ligado — ver a nota de semântica do `\k` em `para_ass`.
    #
    # ⚠️ Nunca pode ser igual (nem próxima) de `cor_contorno`: a palavra acesa
    # some dentro do próprio contorno. Foi o que aconteceu com os presets de
    # contorno roxo usando o roxo da marca como destaque. Há teste travando isso.
    # Âmbar é o padrão porque contrasta tanto com preto quanto com roxo.
    cor_karaoke: str = "&H004AD2FF"  # #FFD24A em BGR
    # Pico do salto da palavra acesa, em % da escala normal. 100 = sem salto.
    karaoke_escala: int = 118


# ─── Animações de entrada ────────────────────────────────────────────────────
# Tags ASS aplicadas no início de cada bloco.
#
# O "pop" de verdade vem de DOIS `\t` encadeados: o primeiro passa do alvo
# (overshoot) e o segundo volta. Um `\t` só produz crescimento linear, que é o
# que fazia a animação anterior parecer dura. Os tempos são em milissegundos
# contados do início da linha.
#
# `\blur` é extensão do VSFilter e o libass implementa — dá o brilho abrindo
# sem custo de filtro no ffmpeg.
#
# ⚠️ Toda animação termina no estado de repouso (escala 100, blur 0). Se o
# libass cortar a linha antes do fim, o texto para legível em vez de congelar
# encolhido.
ENTRADAS: dict[str, str] = {
    # Cresce um triz e assenta. Para legenda de leitura contínua.
    "assenta": r"{\fad(90,110)\fscx94\fscy94\t(0,90,\fscx102\fscy102)\t(90,180,\fscx100\fscy100)}",
    # A caixa abre do centro.
    "cresce": r"{\fad(80,100)\fscx92\fscy92\t(0,100,\fscx101\fscy101)\t(100,180,\fscx100\fscy100)}",
    # Pop forte: sai de 62% e passa de 108% antes de assentar.
    "pop": r"{\fad(60,80)\fscx62\fscy62\t(0,120,\fscx108\fscy108)\t(120,210,\fscx100\fscy100)}",
    # Sem escala: entra desfocado e ganha foco. Discreto de propósito.
    "desfoca": r"{\fad(180,180)\blur3\t(0,220,\blur0)}",
    # Brilho abrindo junto com o pop.
    "brilha": r"{\fad(100,120)\blur8\fscx90\fscy90\t(0,150,\blur1.4\fscx104\fscy104)\t(150,250,\fscx100\fscy100)}",
}


ESTILOS: dict[str, Estilo] = {
    "classico": Estilo(
        id="classico",
        nome="Clássico",
        descricao="Branco com contorno preto, no rodapé. Legenda de filme.",
        entrada=ENTRADAS["assenta"],
    ),
    "youtube": Estilo(
        id="youtube",
        nome="YouTube",
        descricao="Caixa escura atrás do texto. Legível sobre qualquer imagem.",
        fonte="Verdana",
        tamanho=58,
        cor_fundo="&H80000000",  # preto a ~50% de opacidade
        borda_estilo=4,  # caixa opaca
        contorno=0.0,
        sombra=0.0,
        entrada=ENTRADAS["cresce"],
    ),
    "karaoke": Estilo(
        id="karaoke",
        nome="Karaokê",
        descricao="Roxo da marca, centralizado, com um leve salto ao aparecer.",
        fonte="Impact",
        tamanho=76,
        cor="&H00FFFFFF",
        cor_contorno="&H00F755A8",  # #A855F7 em BGR
        contorno=5.0,
        sombra=2.0,
        alinhamento=2,
        margem_v=120,
        # Cresce de 85% para 100% em 150 ms: é o "pop" das legendas de redes.
        entrada=ENTRADAS["pop"],
    ),
    "minimalista": Estilo(
        id="minimalista",
        nome="Minimalista",
        descricao="Fino, sem contorno, sombra suave. Discreto.",
        fonte="Segoe UI",
        tamanho=52,
        negrito=0,
        contorno=0.0,
        sombra=2.0,
        borda_estilo=1,
        entrada=ENTRADAS["desfoca"],
    ),
    "neon": Estilo(
        id="neon",
        nome="Neon",
        descricao="Contorno roxo brilhando, a cara do aplicativo.",
        fonte="Impact",
        tamanho=68,
        cor="&H00FFFFFF",
        cor_contorno="&H00FF0083",  # #8300FF em BGR
        contorno=4.0,
        sombra=4.0,
        entrada=ENTRADAS["brilha"],
    ),
}

ESTILO_PADRAO = "classico"


def hex_para_ass(cor: str | None, alfa_de: str | None = None) -> str | None:
    """`#RRGGBB` (o que a interface manda) → `&HAABBGGRR` (o que o ASS usa).

    Duas armadilhas, ambas silenciosas — a cor sai errada em vez de dar erro:

    1. O ASS guarda **BGR**, não RGB. Trocar vermelho por azul é o bug clássico.
    2. O primeiro byte é **alfa invertido**: `00` é opaco e `FF` é invisível.

    `alfa_de` copia o alfa de uma cor existente, para trocar a cor de uma caixa
    sem perder a transparência que o preset definiu.
    """
    if not cor:
        return None
    h = cor.strip().lstrip("#")
    if len(h) == 3:  # #abc → #aabbcc
        h = "".join(c * 2 for c in h)
    if len(h) != 6:
        return None
    try:
        r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return None

    alfa = "00"
    if alfa_de:
        base = alfa_de.removeprefix("&H").rjust(8, "0")
        alfa = base[0:2]
    return f"&H{alfa}{b:02X}{g:02X}{r:02X}"


def ass_para_hex(cor: str) -> str:
    """Volta de `&HAABBGGRR` para `#RRGGBB` — a interface precisa do valor."""
    h = cor.removeprefix("&H").rjust(8, "0")
    return f"#{h[6:8]}{h[4:6]}{h[2:4]}".upper()


def _tempo_ass(s: float) -> str:
    """H:MM:SS.cc — o ASS usa centésimos, não milésimos."""
    cs = int(round(s * 100))
    h, cs = divmod(cs, 360_000)
    m, cs = divmod(cs, 6_000)
    seg, cs = divmod(cs, 100)
    return f"{h}:{m:02d}:{seg:02d}.{cs:02d}"


def _texto_karaoke(b: Bloco, escala: int = 118) -> str:
    """Texto do bloco com uma tag `\\k` por palavra.

    A duração do `\\k` é em **centésimos** de segundo (todo o ASS é), e vale do
    início desta palavra até o início da próxima — não `end - start`: o silêncio
    entre palavras tem de ser absorvido, senão o destaque adianta e dessincroniza
    ao longo do bloco.
    """
    if not b.palavras:
        return b.texto.replace("\n", r"\N")

    # Mapa palavra→duração, para reconstruir respeitando as quebras de linha já
    # calculadas em `linhas` (não dá para só juntar tudo: perderia o \N).
    duracoes: list[int] = []
    for i, p in enumerate(b.palavras):
        fim = b.palavras[i + 1]["start"] if i + 1 < len(b.palavras) else b.end
        duracoes.append(max(1, int(round((fim - p["start"]) * 100))))

    partes: list[str] = []
    idx = 0
    # Instante da palavra atual dentro do bloco, em MILISSEGUNDOS.
    #
    # ⚠️ As duas unidades convivem na mesma tag e é fácil trocar: `\k` conta em
    # CENTÉSIMOS de segundo, `\t` em MILÉSIMOS. Daí o ×10 — sem ele o salto
    # dispara 10× mais cedo e a palavra pula antes de ser dita.
    inicio_ms = 0
    for n_linha, linha in enumerate(b.linhas):
        if n_linha:
            partes.append(r"\N")
        for palavra in linha.split(" "):
            dur = duracoes[idx] if idx < len(duracoes) else 1
            partes.append(
                rf"{{\k{dur}{_salto(inicio_ms, escala)}}}{palavra} "
            )
            inicio_ms += dur * 10
            idx += 1
    return "".join(partes).rstrip()


_FAD = re.compile(r"\\fad\(\d+,\d+\)")


def _entrada_para_karaoke(entrada: str) -> str:
    """Entrada do bloco reduzida ao fade, para o karaokê.

    As duas animações disputam a mesma propriedade: a entrada anima a escala do
    bloco de 0 a ~210 ms, e a primeira palavra repõe `\\fscx100` no instante 0
    para o próprio salto. O reset ganha, e o pop de entrada morre pela metade.

    Com karaokê, então, a entrada fica só com o `\\fad` — o movimento passa a
    vir dos saltos por palavra, que é o que se quer nesse modo.
    """
    fad = _FAD.search(entrada)
    return f"{{{fad.group(0)}}}" if fad else ""


def _salto(inicio_ms: int, escala: int) -> str:
    """Tags que fazem a palavra crescer e voltar, no instante em que é dita.

    O `\\k` sozinho só troca a cor. O salto vem de dois `\\t` encadeados — sobe
    rápido e volta devagar, que é o que dá a sensação de "batida".

    Os tempos do `\\t` são relativos ao início da LINHA, não da palavra: por
    isso `inicio_ms` é acumulado. E a escala é reposta a 100 antes de animar,
    senão a palavra herdaria o estado final da anterior.

    Efeito colateral aceito: escalar muda a largura de avanço da letra, então as
    palavras vizinhas se deslocam um pouco durante o salto. É justamente o
    balanço das legendas de rede social — e some quase todo no ritmo Dinâmica,
    que põe poucas palavras por bloco.
    """
    sobe, desce = 90, 190
    return (
        rf"\fscx100\fscy100"
        rf"\t({inicio_ms},{inicio_ms + sobe},\fscx{escala}\fscy{escala})"
        rf"\t({inicio_ms + sobe},{inicio_ms + desce},\fscx100\fscy100)"
    )


def para_ass(
    blocos: list[Bloco],
    estilo: str = ESTILO_PADRAO,
    *,
    fonte: str | None = None,
    tamanho: int | None = None,
    alinhamento: int | None = None,
    margem_v: int | None = None,
    karaoke: bool = False,
    cor: str | None = None,
    cor_contorno: str | None = None,
    cor_karaoke: str | None = None,
    cor_fundo: str | None = None,
) -> str:
    """Gera um .ass estilizado. O ffmpeg queima com `-vf ass=arquivo`.

    O preset é o ponto de partida; tudo que a interface informar (fonte,
    tamanho, alinhamento, margem e as quatro cores) sobrepõe. As cores chegam
    como `#RRGGBB` e são convertidas aqui — ver `hex_para_ass`.
    """
    e = ESTILOS.get(estilo) or ESTILOS[ESTILO_PADRAO]

    fonte_f = fonte or e.fonte
    tamanho_f = tamanho or e.tamanho
    alinhamento_f = alinhamento or e.alinhamento
    margem_f = e.margem_v if margem_v is None else margem_v

    cor_f = hex_para_ass(cor) or e.cor
    contorno_f = hex_para_ass(cor_contorno) or e.cor_contorno
    karaoke_f = hex_para_ass(cor_karaoke) or e.cor_karaoke
    # A caixa herda o alfa do preset: trocar a cor não pode tornar opaca uma
    # caixa que era semitransparente (é o caso do preset YouTube).
    fundo_f = hex_para_ass(cor_fundo, alfa_de=e.cor_fundo) or e.cor_fundo

    # ⚠️ Semântica do `\k`: o texto começa em SecondaryColour e vira
    # PrimaryColour conforme é "cantado". Ou seja, com karaokê a Primary é a cor
    # ACESA e a Secondary é a cor de repouso — o inverso da intuição. Sem essa
    # troca as duas ficam iguais e o destaque não aparece.
    if karaoke:
        primaria, secundaria = karaoke_f, cor_f
    else:
        primaria, secundaria = cor_f, cor_f

    cabecalho = f"""[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: {ASS_LARGURA}
PlayResY: {ASS_ALTURA}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Padrao,{fonte_f},{tamanho_f},{primaria},{secundaria},{contorno_f},{fundo_f},{e.negrito},0,0,0,100,100,0,0,{e.borda_estilo},{e.contorno},{e.sombra},{alinhamento_f},60,60,{margem_f},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    # Com karaokê o salto por palavra assume o movimento; a entrada do bloco
    # fica só com o fade para não disputar a escala. Ver `_entrada_para_karaoke`.
    entrada = _entrada_para_karaoke(e.entrada) if karaoke else e.entrada

    linhas = []
    for b in blocos:
        # No ASS a quebra de linha é \N literal (barra + N), não newline.
        texto = (
            _texto_karaoke(b, e.karaoke_escala)
            if karaoke
            else b.texto.replace("\n", r"\N")
        )
        linhas.append(
            f"Dialogue: 0,{_tempo_ass(b.start)},{_tempo_ass(b.end)},Padrao,,0,0,0,,{entrada}{texto}"
        )

    return cabecalho + "\n".join(linhas) + "\n"
