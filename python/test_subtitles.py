"""Testes da segmentação de legenda — lógica pura, sem I/O nem Whisper."""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from subtitles import (
    de_segmentos,
    redistribuir_palavras,
    ESTILOS,
    MAX_CHARS,
    MAX_LINES,
    Bloco,
    ENTRADAS,
    de_srt,
    hex_para_ass,
    ass_para_hex,
    para_ass,
    para_srt,
    para_vtt,
    segmentar,
    segmentar_por_ritmo,
)


def palavras(*pares, inicio=0.0, passo=0.4):
    """Gera [{start,end,word}] a partir de texto, com tempo sintético."""
    saida, t = [], inicio
    for texto in pares:
        for w in texto.split():
            saida.append({"start": round(t, 2), "end": round(t + passo, 2), "word": w})
            t += passo
    return saida


class TestSegmentar:
    def test_vazio(self):
        assert segmentar([]) == []
        assert segmentar([{"start": 0, "end": 1, "word": "   "}]) == []

    def test_frase_curta_nao_quebra(self):
        b = segmentar(palavras("Bom dia."))
        assert len(b) == 1
        assert b[0].linhas == ["Bom dia."]

    def test_corta_no_fim_de_frase(self):
        b = segmentar(palavras("Primeira frase. Segunda frase."))
        assert len(b) == 2
        assert b[0].texto.endswith("frase.")
        assert b[1].texto.startswith("Segunda")

    def test_respeita_limite_de_caracteres(self):
        # Sem pontuação: o corte tem que vir do limite mecânico.
        texto = " ".join(["palavra"] * 40)
        for bloco in segmentar(palavras(texto)):
            assert len(bloco.linhas) <= MAX_LINES
            for linha in bloco.linhas:
                assert len(linha) <= MAX_CHARS, linha

    def test_silencio_longo_corta(self):
        p = palavras("antes do silencio")
        p += [{"start": 30.0, "end": 30.4, "word": "depois"}]
        b = segmentar(p)
        assert len(b) == 2
        assert b[1].linhas == ["depois"]

    def test_duracao_maxima_corta(self):
        # Palavras lentas: estoura o tempo antes de estourar o caractere.
        p = palavras("uma duas tres quatro cinco", passo=2.0)
        b = segmentar(p)
        assert len(b) > 1
        for bloco in b:
            assert bloco.end - bloco.start <= 7.5

    def test_duracao_minima_aplicada(self):
        p = [{"start": 0.0, "end": 0.1, "word": "oi."}]
        b = segmentar(p)
        assert b[0].end - b[0].start >= 0.8

    def test_blocos_nao_se_sobrepoem(self):
        # O alongamento pelo min_dur pode invadir o bloco seguinte.
        p = [
            {"start": 0.0, "end": 0.1, "word": "a."},
            {"start": 0.5, "end": 0.6, "word": "b."},
            {"start": 1.0, "end": 1.1, "word": "c."},
        ]
        b = segmentar(p)
        for x, y in zip(b, b[1:]):
            assert x.end <= y.start, f"{x.texto} invade {y.texto}"

    def test_palavra_maior_que_a_linha_nao_e_partida(self):
        gigante = "https://exemplo.com/um/caminho/absurdamente/longo/que/nao/cabe"
        b = segmentar(palavras(f"veja {gigante} ok"))
        inteiro = " ".join(l for bloco in b for l in bloco.linhas)
        assert gigante in inteiro, "a URL foi partida no meio"

    def test_tempos_sempre_crescentes(self):
        b = segmentar(palavras("Uma frase. Outra frase. E mais uma aqui."))
        for bloco in b:
            assert bloco.start < bloco.end

    def test_nenhuma_palavra_se_perde(self):
        texto = "O rato roeu a roupa do rei de Roma. Depois fugiu correndo pela sala."
        b = segmentar(palavras(texto))
        saida = " ".join(l for bloco in b for l in bloco.linhas).split()
        assert saida == texto.split()

    def test_regressao_ultima_palavra_descartada(self):
        """Frase real que perdeu a última palavra no primeiro teste ponta a ponta.

        Cabia no bloco (78 < 84 caracteres) mas não em duas linhas de 42, e a
        recursão devolvia só a primeira linha, jogando "internet." fora.
        """
        texto = ("A transcrição roda inteiramente no computador, "
                 "sem enviar nada para a internet.")
        b = segmentar(palavras(texto))
        saida = " ".join(l for bloco in b for l in bloco.linhas).split()
        assert saida == texto.split()
        assert "internet." in saida[-1]

    def test_estoura_a_linha_em_vez_de_perder_palavra(self):
        # Última linha disponível pode passar de MAX_CHARS. É o mal menor.
        texto = " ".join(["palavrinha"] * 12)
        b = segmentar(palavras(texto))
        saida = " ".join(l for bloco in b for l in bloco.linhas).split()
        assert len(saida) == 12

    def test_linhas_equilibradas(self):
        # Duas linhas médias leem melhor que uma cheia + uma palavra solta.
        p = palavras("um dois tres quatro cinco seis sete oito nove dez onze doze")
        b = segmentar(p)
        for bloco in b:
            if len(bloco.linhas) == 2:
                a, c = (len(x) for x in bloco.linhas)
                assert abs(a - c) <= MAX_CHARS * 0.6


class TestFormatos:
    def test_srt(self):
        srt = para_srt([Bloco(0.0, 1.5, ["Olá mundo"])])
        assert "1\n" in srt
        assert "00:00:00,000 --> 00:00:01,500" in srt
        assert "Olá mundo" in srt

    def test_srt_numera_em_sequencia(self):
        srt = para_srt([Bloco(0, 1, ["a"]), Bloco(1, 2, ["b"]), Bloco(2, 3, ["c"])])
        assert srt.startswith("1\n")
        assert "\n2\n" in srt and "\n3\n" in srt

    def test_srt_hora_cheia(self):
        srt = para_srt([Bloco(3661.5, 3662.0, ["tarde"])])
        assert "01:01:01,500" in srt

    def test_vtt_tem_cabecalho_e_ponto(self):
        vtt = para_vtt([Bloco(0.0, 1.5, ["Olá"])])
        assert vtt.startswith("WEBVTT")
        assert "00:00:00.000 --> 00:00:01.500" in vtt

    def test_duas_linhas_viram_duas_linhas(self):
        srt = para_srt([Bloco(0, 2, ["linha um", "linha dois"])])
        assert "linha um\nlinha dois" in srt


def _campo_do_estilo(ass: str, campo: str) -> str:
    """Lê um campo do `Style:` casando pelo cabeçalho `Format:`.

    Índice fixo aqui é armadilha: a ordem do Format tem 23 colunas e errar por
    uma dá um teste que passa medindo a coluna errada.
    """
    linhas = ass.splitlines()
    fmt = next(l for l in linhas if l.startswith("Format:") and "Fontname" in l)
    nomes = [c.strip() for c in fmt.removeprefix("Format:").split(",")]
    estilo = next(l for l in linhas if l.startswith("Style:"))
    valores = [c.strip() for c in estilo.removeprefix("Style:").split(",")]
    return valores[nomes.index(campo)]


class TestEdicao:
    """`de_segmentos` + `redistribuir_palavras` — o caminho do editor."""

    def test_texto_intocado_preserva_tempo_do_whisper(self):
        palavras = [
            {"start": 0.0, "end": 0.5, "word": "bom"},
            {"start": 0.5, "end": 1.0, "word": "dia"},
        ]
        b = de_segmentos([{"start": 0.0, "end": 1.0, "text": "bom dia", "words": palavras}])[0]
        assert [p["start"] for p in b.palavras] == [0.0, 0.5]

    def test_texto_editado_recalcula(self):
        # Palavra a mais: os tempos antigos não valem mais e têm de ser refeitos.
        palavras = [{"start": 0.0, "end": 1.0, "word": "transclica"}]
        b = de_segmentos([
            {"start": 0.0, "end": 1.0, "text": "a transcrição roda", "words": palavras}
        ])[0]
        assert len(b.palavras) == 3
        assert [p["word"] for p in b.palavras] == ["a", "transcrição", "roda"]

    def test_recalculo_cobre_o_bloco_inteiro(self):
        b = Bloco(2.0, 6.0, ["uma frase de teste"])
        redistribuir_palavras(b)
        assert b.palavras[0]["start"] == 2.0
        assert b.palavras[-1]["end"] == 6.0

    def test_palavra_longa_ganha_mais_tempo(self):
        b = Bloco(0.0, 10.0, ["de extraordinariamente"])
        redistribuir_palavras(b)
        curta, longa = b.palavras
        assert (longa["end"] - longa["start"]) > (curta["end"] - curta["start"])

    def test_tempos_invertidos_sao_normalizados(self):
        # O editor deixa digitar fim antes do início; não pode virar bloco negativo.
        b = de_segmentos([{"start": 5.0, "end": 2.0, "text": "oi"}])[0]
        assert b.start == 2.0 and b.end == 5.0

    def test_bloco_sem_palavras_nao_quebra(self):
        b = Bloco(0.0, 1.0, [])
        redistribuir_palavras(b)
        assert b.palavras == []

    def test_karaoke_cobre_exatamente_a_duracao_do_bloco(self):
        """Soma dos `\\k` == duração do bloco, em centésimos.

        Se sobrar, a última palavra acende antes do fim e o destaque some com o
        texto ainda na tela; se faltar, ele atrasa e vai dessincronizando ao
        longo do bloco. É a conta que mantém o karaokê honesto.
        """
        blocos = de_segmentos([
            {"start": 0.0, "end": 2.0, "text": "A transcrição roda localmente"},
            {"start": 2.5, "end": 4.0, "text": "sem enviar nada"},
        ])
        ass = para_ass(blocos, "karaoke", karaoke=True)

        dialogos = [l for l in ass.splitlines() if l.startswith("Dialogue:")]
        assert len(dialogos) == 2

        for linha, bloco in zip(dialogos, blocos):
            soma = sum(int(k) for k in re.findall(r"\\k(\d+)", linha))
            esperado = round((bloco.end - bloco.start) * 100)
            assert abs(soma - esperado) <= 1, f"{soma} != {esperado} em {linha[:60]}"

    def test_karaoke_apos_edicao_usa_o_texto_novo(self):
        blocos = de_segmentos([
            {"start": 0.0, "end": 2.0, "text": "texto corrigido",
             "words": [{"start": 0.0, "end": 2.0, "word": "errado"}]}
        ])
        ass = para_ass(blocos, "karaoke", karaoke=True)
        assert "errado" not in ass
        assert "corrigido" in ass
        assert ass.count(r"\k") == 2


class TestAss:
    def test_estrutura_minima(self):
        ass = para_ass([Bloco(0.0, 2.0, ["Olá"])])
        for secao in ("[Script Info]", "[V4+ Styles]", "[Events]"):
            assert secao in ass
        assert "Style: Padrao," in ass
        assert ass.rstrip().count("Dialogue:") == 1

    def test_tempo_em_centesimos(self):
        # O ASS usa H:MM:SS.cc — errar isso desloca a legenda inteira.
        ass = para_ass([Bloco(3661.5, 3662.25, ["x"])])
        assert "1:01:01.50" in ass
        assert "1:01:02.25" in ass

    def test_quebra_de_linha_vira_N_literal(self):
        # No ASS a quebra é a sequência "\N", não um newline de verdade —
        # newline ali corta o registro Dialogue e o libass ignora o resto.
        ass = para_ass([Bloco(0, 2, ["linha um", "linha dois"])])
        dialogo = [l for l in ass.splitlines() if l.startswith("Dialogue:")][0]
        assert r"linha um\Nlinha dois" in dialogo
        assert "linha dois" in dialogo  # tudo num registro só

    def test_todos_os_estilos_geram_ass_valido(self):
        for nome in ESTILOS:
            ass = para_ass([Bloco(0, 1, ["teste"])], nome)
            assert "Dialogue:" in ass, nome
            assert f"PlayResX: 1920" in ass, nome

    def test_estilo_desconhecido_cai_no_padrao(self):
        assert para_ass([Bloco(0, 1, ["a"])], "nao-existe") == para_ass(
            [Bloco(0, 1, ["a"])], "classico"
        )

    def test_karaoke_tem_animacao_de_escala(self):
        ass = para_ass([Bloco(0, 1, ["a"])], "karaoke")
        assert r"\fscx62\fscy62" in ass, "o pop precisa começar bem menor"
        assert r"\t(120,210,\fscx100\fscy100)" in ass, "e terminar no repouso"

    def test_youtube_usa_caixa_opaca(self):
        # BorderStyle 4 = caixa atrás do texto; sem isso o preset perde a graça.
        assert _campo_do_estilo(para_ass([Bloco(0, 1, ["a"])], "youtube"), "BorderStyle") == "4"

    def test_estilos_respeitam_a_propria_fonte(self):
        for nome, e in ESTILOS.items():
            ass = para_ass([Bloco(0, 1, ["a"])], nome)
            assert _campo_do_estilo(ass, "Fontname") == e.fonte, nome
            assert _campo_do_estilo(ass, "Fontsize") == str(e.tamanho), nome

    def test_um_dialogue_por_bloco(self):
        blocos = [Bloco(i, i + 1, [f"b{i}"]) for i in range(5)]
        ass = para_ass(blocos)
        assert ass.count("Dialogue:") == 5


class TestRitmos:
    """Ritmo é o que resolve o 'texto enorme parado na tela'."""

    FALA = "hoje eu vou mostrar como converter um arquivo de video em legenda automatica"

    def test_classica_mantem_o_padrao_de_hoje(self):
        blocos = segmentar_por_ritmo(palavras(self.FALA), "classica")
        for b in blocos:
            assert len(b.linhas) <= MAX_LINES
            for linha in b.linhas:
                assert len(linha) <= MAX_CHARS or len(linha.split()) == 1

    def test_curta_usa_uma_linha_so(self):
        for b in segmentar_por_ritmo(palavras(self.FALA), "curta"):
            assert len(b.linhas) == 1

    def test_tiktok_nunca_passa_de_tres_palavras(self):
        for b in segmentar_por_ritmo(palavras(self.FALA), "tiktok"):
            assert len(b.texto.split()) <= 3, b.texto

    def test_tiktok_produz_mais_blocos_que_classica(self):
        curtos = segmentar_por_ritmo(palavras(self.FALA), "tiktok")
        longos = segmentar_por_ritmo(palavras(self.FALA), "classica")
        assert len(curtos) > len(longos)

    def test_nenhum_ritmo_perde_palavra(self):
        # A regressão histórica: "…nada para a internet." virava "…nada para a".
        esperado = self.FALA.split()
        for ritmo in ("classica", "curta", "tiktok"):
            saiu = " ".join(b.texto.replace("\n", " ") for b in
                            segmentar_por_ritmo(palavras(self.FALA), ritmo)).split()
            assert saiu == esperado, ritmo

    def test_ritmo_desconhecido_cai_no_padrao(self):
        assert segmentar_por_ritmo(palavras(self.FALA), "nao-existe") == \
               segmentar_por_ritmo(palavras(self.FALA), "classica")


class TestKaraoke:
    def test_cores_primaria_e_secundaria_diferem(self):
        # Com \k o texto começa em Secondary e vira Primary. Iguais = sem efeito.
        ass = para_ass([Bloco(0, 1, ["a"], [{"start": 0, "end": 1, "word": "a"}])],
                       karaoke=True)
        assert _campo_do_estilo(ass, "PrimaryColour") != _campo_do_estilo(ass, "SecondaryColour")

    def test_sem_karaoke_as_cores_seguem_iguais(self):
        ass = para_ass([Bloco(0, 1, ["a"])])
        assert _campo_do_estilo(ass, "PrimaryColour") == _campo_do_estilo(ass, "SecondaryColour")

    def test_uma_tag_k_por_palavra(self):
        b = segmentar_por_ritmo(palavras("uma duas tres"), "tiktok")[0]
        ass = para_ass([b], karaoke=True)
        dialogo = [l for l in ass.splitlines() if l.startswith("Dialogue:")][0]
        assert dialogo.count(r"\k") == len(b.texto.split())

    def test_soma_dos_k_cobre_a_duracao_do_bloco(self):
        # Em centésimos. Se a soma não fechar, o destaque dessincroniza ao longo
        # do bloco — é o erro clássico de usar (end-start) por palavra e ignorar
        # o silêncio entre elas.
        b = segmentar_por_ritmo(palavras("uma duas tres", passo=0.5), "tiktok")[0]
        ass = para_ass([b], karaoke=True)
        dialogo = [l for l in ass.splitlines() if l.startswith("Dialogue:")][0]
        soma = sum(int(m) for m in re.findall(r"\\k(\d+)", dialogo))
        esperado = int(round((b.end - b.start) * 100))
        assert abs(soma - esperado) <= 2, (soma, esperado)

    def test_karaoke_preserva_a_quebra_de_linha(self):
        b = Bloco(0, 2, ["linha um", "linha dois"],
                  [{"start": i * 0.5, "end": i * 0.5 + 0.5, "word": w}
                   for i, w in enumerate("linha um linha dois".split())])
        dialogo = [l for l in para_ass([b], karaoke=True).splitlines()
                   if l.startswith("Dialogue:")][0]
        assert r"\N" in dialogo


class TestEstiloConfiguravel:
    def test_fonte_tamanho_alinhamento_e_margem_da_interface(self):
        ass = para_ass([Bloco(0, 1, ["a"])], "classico",
                       fonte="Bebas Neue", tamanho=90, alinhamento=8, margem_v=200)
        assert _campo_do_estilo(ass, "Fontname") == "Bebas Neue"
        assert _campo_do_estilo(ass, "Fontsize") == "90"
        assert _campo_do_estilo(ass, "Alignment") == "8"
        assert _campo_do_estilo(ass, "MarginV") == "200"

    def test_sem_sobreposicao_usa_o_preset(self):
        e = ESTILOS["neon"]
        ass = para_ass([Bloco(0, 1, ["a"])], "neon")
        assert _campo_do_estilo(ass, "Fontname") == e.fonte
        assert _campo_do_estilo(ass, "Fontsize") == str(e.tamanho)

    def test_margem_zero_e_respeitada(self):
        # `margem_v=0` é legítimo (legenda colada na borda) e um `or` no lugar
        # do `is None` cairia no padrão sem avisar.
        assert _campo_do_estilo(para_ass([Bloco(0, 1, ["a"])], margem_v=0), "MarginV") == "0"


class TestDeSrt:
    """Ler .srt de volta é o que permite estilizar legenda revisada à mão."""

    SRT = (
        "1\n00:00:01,000 --> 00:00:02,500\nprimeira linha\n\n"
        "2\n00:00:03,000 --> 00:00:04,000\nduas\nlinhas\n"
    )

    def test_le_tempos_e_texto(self):
        b = de_srt(self.SRT)
        assert len(b) == 2
        assert b[0].start == 1.0 and b[0].end == 2.5
        assert b[0].texto == "primeira linha"
        assert b[1].linhas == ["duas", "linhas"]

    def test_aceita_vtt(self):
        vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nolá\n"
        assert de_srt(vtt)[0].texto == "olá"

    def test_milissegundos_curtos_nao_viram_unidades(self):
        # ",5" é 500 ms, não 5 ms. Sem normalizar, a legenda dessincroniza.
        assert de_srt("1\n00:00:00,5 --> 00:00:01,0\nx\n")[0].start == 0.5

    def test_ida_e_volta_preserva_o_texto(self):
        blocos = segmentar_por_ritmo(palavras("uma frase de teste aqui"), "curta")
        assert [b.texto for b in de_srt(para_srt(blocos))] == [b.texto for b in blocos]

    def test_arquivo_sem_legenda_nao_explode(self):
        assert de_srt("lixo\nsem tempo nenhum\n") == []


def _rgb(cor_ass: str) -> tuple[int, int, int]:
    """`&HAABBGGRR` → (r, g, b). O ASS inverte a ordem e leva alfa na frente."""
    h = cor_ass.removeprefix("&H").rjust(8, "0")
    return int(h[6:8], 16), int(h[4:6], 16), int(h[2:4], 16)


def _distancia(a: str, b: str) -> float:
    ra, ga, ba = _rgb(a)
    rb, gb, bb = _rgb(b)
    return ((ra - rb) ** 2 + (ga - gb) ** 2 + (ba - bb) ** 2) ** 0.5


class TestLegibilidadeKaraoke:
    """A palavra acesa sumia dentro do próprio contorno."""

    def test_destaque_nao_se_confunde_com_o_contorno(self):
        # Era exatamente o bug: presets de contorno roxo usavam o roxo da marca
        # como destaque, e a palavra acesa virava roxo sobre roxo.
        for nome, e in ESTILOS.items():
            d = _distancia(e.cor_karaoke, e.cor_contorno)
            assert d > 120, f"{nome}: destaque perto demais do contorno (distância {d:.0f})"

    def test_destaque_difere_da_cor_de_repouso(self):
        # Iguais = o karaokê não aparece.
        for nome, e in ESTILOS.items():
            assert _distancia(e.cor_karaoke, e.cor) > 60, nome

    def test_no_ass_a_primaria_e_o_destaque(self):
        for nome, e in ESTILOS.items():
            ass = para_ass(
                [Bloco(0, 1, ["a"], [{"start": 0, "end": 1, "word": "a"}])],
                nome,
                karaoke=True,
            )
            assert _campo_do_estilo(ass, "PrimaryColour") == e.cor_karaoke, nome
            assert _campo_do_estilo(ass, "SecondaryColour") == e.cor, nome


class TestAnimacoes:
    """O relato foi "sem animação de popup nem nada"."""

    def test_todo_estilo_tem_animacao_de_entrada(self):
        for nome, e in ESTILOS.items():
            assert e.entrada.startswith("{") and e.entrada.endswith("}"), nome
            # Raw string obrigatório: "\f" sem o r é form feed, e o teste
            # passaria a procurar um caractere de controle.
            assert r"\fad" in e.entrada, nome

    def test_estilos_com_escala_usam_overshoot(self):
        # Dois `\t` encadeados: passa do alvo e volta. Um só dá crescimento
        # linear, que é o que fazia a animação anterior parecer dura.
        for chave in ("assenta", "cresce", "pop", "brilha"):
            assert ENTRADAS[chave].count(r"\t(") == 2, chave

    def test_animacao_termina_no_repouso(self):
        # Se o libass cortar a linha antes do fim, o texto tem de parar legível
        # — não congelado encolhido nem borrado.
        for chave, tags in ENTRADAS.items():
            if r"\fscx" in tags:
                assert tags.rstrip("}").endswith(r"\fscx100\fscy100)"), chave
        assert r"\blur0)" in ENTRADAS["desfoca"]

    def test_pop_e_o_mais_forte(self):
        def escala_inicial(tags):
            return int(re.search(r"\\fscx(\d+)", tags).group(1))

        assert escala_inicial(ENTRADAS["pop"]) < escala_inicial(ENTRADAS["assenta"])

    def test_entrada_chega_no_dialogue(self):
        ass = para_ass([Bloco(0, 1, ["a"])], "karaoke")
        dialogo = [l for l in ass.splitlines() if l.startswith("Dialogue:")][0]
        assert ENTRADAS["pop"] in dialogo

    def test_karaoke_convive_com_a_animacao(self):
        # As tags de entrada vêm antes dos \k; as duas coisas têm de coexistir
        # na mesma linha, senão ou a animação ou o destaque some.
        b = segmentar_por_ritmo(palavras("uma duas"), "tiktok")[0]
        dialogo = [l for l in para_ass([b], "karaoke", karaoke=True).splitlines()
                   if l.startswith("Dialogue:")][0]
        assert r"\t(" in dialogo and r"\k" in dialogo


class TestCores:
    """A conversão #RRGGBB → &HAABBGGRR erra em silêncio: a cor sai trocada."""

    def test_hex_vira_bgr_e_nao_rgb(self):
        # Vermelho puro: se sair &H000000FF está certo; &H00FF0000 seria azul.
        assert hex_para_ass("#FF0000") == "&H000000FF"
        assert hex_para_ass("#0000FF") == "&H00FF0000"
        assert hex_para_ass("#A855F7") == "&H00F755A8"

    def test_alfa_zero_e_opaco(self):
        # No ASS o primeiro byte é transparência invertida: 00 = opaco.
        assert hex_para_ass("#FFFFFF").startswith("&H00")

    def test_aceita_forma_curta_e_sem_cerquilha(self):
        assert hex_para_ass("#fff") == hex_para_ass("FFFFFF") == "&H00FFFFFF"

    def test_entrada_invalida_devolve_none(self):
        # None faz o preset prevalecer, em vez de gerar um .ass corrompido.
        for ruim in ("", None, "azul", "#12", "#GGGGGG"):
            assert hex_para_ass(ruim) is None

    def test_ida_e_volta(self):
        for cor in ("#FF0000", "#A855F7", "#123456"):
            assert ass_para_hex(hex_para_ass(cor)) == cor.upper()

    def test_caixa_preserva_a_transparencia_do_preset(self):
        # O preset YouTube tem caixa a ~50%; trocar a cor não pode deixá-la opaca.
        alfa_do_preset = ESTILOS["youtube"].cor_fundo[2:4]
        saida = hex_para_ass("#112233", alfa_de=ESTILOS["youtube"].cor_fundo)
        assert saida[2:4] == alfa_do_preset

    def test_cores_da_interface_chegam_no_ass(self):
        ass = para_ass(
            [Bloco(0, 1, ["a"], [{"start": 0, "end": 1, "word": "a"}])],
            "classico",
            karaoke=True,
            cor="#FF0000",
            cor_contorno="#00FF00",
            cor_karaoke="#0000FF",
        )
        assert _campo_do_estilo(ass, "SecondaryColour") == "&H000000FF"  # texto
        assert _campo_do_estilo(ass, "OutlineColour") == "&H0000FF00"
        assert _campo_do_estilo(ass, "PrimaryColour") == "&H00FF0000"  # aceso

    def test_sem_cor_informada_usa_o_preset(self):
        e = ESTILOS["neon"]
        ass = para_ass([Bloco(0, 1, ["a"])], "neon")
        assert _campo_do_estilo(ass, "OutlineColour") == e.cor_contorno


class TestSaltoDaPalavra:
    """A palavra acesa cresce e volta, além de mudar de cor."""

    def _dialogo(self, karaoke=True, estilo="karaoke"):
        p = [
            {"start": 0.0, "end": 0.5, "word": "uma"},
            {"start": 0.5, "end": 1.0, "word": "duas"},
            {"start": 1.0, "end": 1.6, "word": "tres"},
        ]
        b = segmentar_por_ritmo(p, "tiktok")[0]
        ass = para_ass([b], estilo, karaoke=karaoke)
        return [l for l in ass.splitlines() if l.startswith("Dialogue:")][0]

    def test_cada_palavra_tem_seu_salto(self):
        d = self._dialogo()
        # Dois `\t` por palavra: sobe e volta.
        assert d.count(r"\fscx118\fscy118") == 3
        assert d.count(r"\fscx100\fscy100") == 6  # reset + volta, por palavra

    def test_salto_comeca_quando_a_palavra_e_dita(self):
        # ⚠️ `\k` é em centésimos e `\t` em milésimos. Sem o ×10 o salto dispara
        # 10x mais cedo e a palavra pula antes de ser falada.
        d = self._dialogo()
        assert r"\t(0,90," in d      # 1ª palavra em 0.0 s
        assert r"\t(500,590," in d   # 2ª em 0.5 s
        assert r"\t(1000,1090," in d # 3ª em 1.0 s

    def test_cada_palavra_repoe_a_escala_antes_de_saltar(self):
        # Sem o reset, a palavra herdaria o estado final da anterior.
        d = self._dialogo()
        for trecho in d.split(r"{\k")[1:]:
            assert trecho.startswith(("50", "60"))
            assert r"\fscx100\fscy100\t(" in trecho

    def test_entrada_do_bloco_nao_disputa_a_escala(self):
        # As duas animações mexem em \fscx. A entrada anima de 0 a ~210 ms e a
        # 1ª palavra repõe 100 no instante 0 — o pop de entrada morria pela
        # metade. Com karaokê a entrada fica só com o fade.
        d = self._dialogo(karaoke=True)
        entrada = d.split("0,0,0,,", 1)[1].split("}", 1)[0] + "}"
        assert r"\fad" in entrada
        assert r"\fscx" not in entrada, entrada

    def test_sem_karaoke_a_entrada_segue_completa(self):
        d = self._dialogo(karaoke=False)
        entrada = d.split("0,0,0,,", 1)[1].split("}", 1)[0] + "}"
        assert r"\fscx62" in entrada

    def test_escala_do_salto_vem_do_preset(self):
        from dataclasses import replace
        import subtitles

        original = subtitles.ESTILOS["classico"]
        subtitles.ESTILOS["classico"] = replace(original, karaoke_escala=140)
        try:
            assert r"\fscx140\fscy140" in self._dialogo(estilo="classico")
        finally:
            subtitles.ESTILOS["classico"] = original
