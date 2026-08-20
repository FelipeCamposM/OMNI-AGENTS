"""Estimativa monocular de profundidade (Depth Anything V2) via ONNX Runtime.

Lógica pura e testável: não imprime nada em stdout, não conhece o protocolo JSON
do `converter.py`. Quem orquestra é `converter.py::depth_map`.

**Por que ONNX e não torch/transformers.** O caminho canônico seria
`transformers.pipeline("depth-estimation", ...)`, mas torch (492 MB) +
transformers (90 MB) na .venv viram um sidecar PyInstaller do tamanho do módulo
Docling — para uma única ferramenta de imagem. O ONNX Runtime já é dependência
provada aqui (o Docling usa via RapidOCR) e o mesmo modelo, mesmos pesos, está
exportado em `onnx-community/depth-anything-v2-small`. Medido:
onnxruntime + numpy + Pillow = 86 MB crus contra 582 MB.

**Liberação de memória.** O sidecar é um processo separado e curto: ele morre
depois de cada geração, então RAM e VRAM voltam ao sistema de forma
incondicional — mais forte que qualquer `gc.collect()`. A limpeza explícita em
`gerar_profundidade` existe mesmo assim porque custa pouco e continua correta se
um dia o processo virar residente.
"""

from __future__ import annotations

import gc
import os
import urllib.request
from pathlib import Path
from typing import Callable

import numpy as np
from PIL import Image

# ─── Modelos ────────────────────────────────────────────────────────────────
# Só o `small` é exposto na interface hoje. Base e Large já estão aqui para que
# adicionar um seletor no futuro seja mudar uma string, não reescrever a tool.
MODELOS: dict[str, dict[str, str]] = {
    "small": {
        "repo": "onnx-community/depth-anything-v2-small",
        "arquivo": "onnx/model.onnx",
        "local": "depth-anything-v2-small.onnx",
    },
    "base": {
        "repo": "onnx-community/depth-anything-v2-base",
        "arquivo": "onnx/model.onnx",
        "local": "depth-anything-v2-base.onnx",
    },
    "large": {
        "repo": "onnx-community/depth-anything-v2-large",
        "arquivo": "onnx/model.onnx",
        "local": "depth-anything-v2-large.onnx",
    },
}
MODELO_PADRAO = "small"

# Pré-processamento do DPTImageProcessor — copiado do `preprocessor_config.json`
# do próprio repositório. Mexer aqui sem mexer lá degrada o resultado em
# silêncio: o mapa continua saindo, só que pior.
LADO = 518
MULTIPLO = 14
MEDIA = np.array([0.485, 0.456, 0.406], dtype=np.float32)
DESVIO = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# Teto do lado maior na inferência. Sem ele um panorama 10000×500 explode: o
# `keep_aspect_ratio` prende o lado MENOR em 518 e deixa o outro crescer, e a
# atenção do ViT é O(patches²).
#
# 1554 = 3×518, ou seja, tudo até 3:1 passa intacto — cobre foto, print e tela
# ultrawide. Medido nesta máquina (CPU, ViT-S): 518×518 = 1,1 s · 1036×518 =
# 3,4 s · 1554×518 = 6,0 s · 2072×518 = 8,8 s. Baixar para 1036 economizaria
# 2,5 s num 16:7, mas ao custo de reduzir o lado menor para 448 e perder
# detalhe — o modelo foi treinado com 518.
MAX_LADO = 1554

# Teto do lado maior na SAÍDA. Independente do teto de inferência: o mapa volta
# ao tamanho da imagem original, e um `float32` de 20000×20000 são 1,6 GB só no
# array intermediário. Acima disso o mapa sai reduzido — sem perda real, já que
# o modelo enxergou 518 px de lado menor de qualquer forma.
MAX_SAIDA = 8192

# Abaixo disso o pixel é considerado fundo e não entra na normalização.
ALFA_OPACO = 128

# Arena de memória do ONNX Runtime em CPU. Medido (3840×2160, esta máquina):
# ligada = 2,5 s / pico 640 MB · desligada = 3,1 s / pico 479 MB. Ligada porque
# velocidade vem antes de memória na ordem de prioridade desta ferramenta, e o
# processo morre logo depois devolvendo tudo. Vire para False se alguém rodar em
# máquina apertada — é a única linha que muda.
ARENA_CPU = True


def dir_modelos() -> Path:
    """Cache dos pesos no disco. Sobrevive a atualizações do app."""
    return Path(os.path.expanduser("~")) / ".cache" / "camps-utils" / "models"


def caminho_modelo(tamanho: str = MODELO_PADRAO) -> Path:
    return dir_modelos() / MODELOS[tamanho]["local"]


def modelo_em_cache(tamanho: str = MODELO_PADRAO) -> bool:
    p = caminho_modelo(tamanho)
    return p.exists() and p.stat().st_size > 0


def baixar_modelo(
    tamanho: str = MODELO_PADRAO,
    progresso: Callable[[int], None] | None = None,
) -> Path:
    """Baixa os pesos ONNX uma única vez. Idempotente.

    Grava num `.part` e só renomeia no fim — um download interrompido não deixa
    um .onnx truncado que falharia na carga com um erro incompreensível.
    """
    destino = caminho_modelo(tamanho)
    if modelo_em_cache(tamanho):
        return destino

    spec = MODELOS[tamanho]
    url = f"https://huggingface.co/{spec['repo']}/resolve/main/{spec['arquivo']}"
    destino.parent.mkdir(parents=True, exist_ok=True)
    parcial = destino.with_suffix(".part")

    with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310 — URL fixa
        total = int(resp.headers.get("Content-Length") or 0)
        baixado = 0
        ultimo = -1
        with open(parcial, "wb") as f:
            while True:
                pedaco = resp.read(1 << 20)
                if not pedaco:
                    break
                f.write(pedaco)
                baixado += len(pedaco)
                if progresso and total:
                    pct = int(baixado * 100 / total)
                    if pct != ultimo:
                        ultimo = pct
                        progresso(pct)

    parcial.replace(destino)
    return destino


# ─── Pré/pós-processamento ──────────────────────────────────────────────────
def tamanho_inferencia(w: int, h: int) -> tuple[int, int]:
    """Réplica do `keep_aspect_ratio` + `ensure_multiple_of` do DPT.

    Prende o lado MENOR em `LADO` e arredonda os dois para múltiplos de 14 (o
    patch do ViT). Devolve `(largura, altura)`.
    """
    if w <= 0 or h <= 0:
        raise ValueError("imagem sem dimensão")

    esc_h, esc_w = LADO / h, LADO / w
    # O DPT escolhe a escala que menos distorce e aplica nos dois eixos.
    esc = esc_w if abs(1 - esc_w) < abs(1 - esc_h) else esc_h

    def prender(valor: float) -> int:
        return max(MULTIPLO, int(round(valor / MULTIPLO)) * MULTIPLO)

    nw, nh = prender(esc * w), prender(esc * h)

    if max(nw, nh) > MAX_LADO:
        fator = MAX_LADO / max(nw, nh)
        nw, nh = prender(nw * fator), prender(nh * fator)
    return nw, nh


def preprocessar(rgb: Image.Image) -> np.ndarray:
    """RGB → tensor NCHW float32 normalizado com as estatísticas do ImageNet."""
    nw, nh = tamanho_inferencia(*rgb.size)
    pequena = rgb.resize((nw, nh), Image.BICUBIC)
    x = np.asarray(pequena, dtype=np.float32) / 255.0
    x = (x - MEDIA) / DESVIO
    return np.ascontiguousarray(x.transpose(2, 0, 1)[None], dtype=np.float32)


def posprocessar(
    bruto: np.ndarray,
    tamanho: tuple[int, int],
    alfa: Image.Image | None,
) -> Image.Image:
    """Profundidade crua → PNG cinza 8 bits no tamanho original.

    Duas decisões que definem a qualidade do resultado:

    1. A normalização min–max ignora os pixels transparentes. O fundo neutro
       que alimenta o modelo tem profundidade própria; deixá-lo entrar na conta
       encolhe a faixa que sobra para o objeto e achata justamente o que
       interessa (rosto, cabelo, dobras de roupa).
    2. O alfa é PRESERVADO num canal separado, não aplicado agora. Quem aplica
       é `converter.py::ajustar_cinza`, na hora de salvar — depois de inverter.
       Aplicar aqui obrigaria a multiplicar de novo lá (a inversão devolveria
       255 ao fundo), e o alfa entraria duas vezes, escurecendo demais as
       bordas semitransparentes.
    """
    d = np.asarray(bruto, dtype=np.float32).squeeze()
    if d.ndim != 2:
        raise ValueError(f"saída do modelo com forma inesperada: {bruto.shape}")

    # Volta ao tamanho original ANTES de normalizar: interpolar já normalizado
    # inventaria valores fora de 0–255 nas bordas.
    mapa = Image.fromarray(d, mode="F").resize(tamanho, Image.BICUBIC)
    d = np.asarray(mapa, dtype=np.float32)

    if alfa is not None:
        opacos = np.asarray(alfa, dtype=np.uint8) >= ALFA_OPACO
        amostra = d[opacos] if opacos.any() else d
    else:
        amostra = d

    lo, hi = float(amostra.min()), float(amostra.max())
    # Imagem de profundidade constante (parede lisa, tela sólida): sem faixa
    # para esticar, e dividir por zero devolveria NaN.
    d = np.zeros_like(d) if hi - lo < 1e-6 else (d - lo) / (hi - lo)

    cinza = Image.fromarray((np.clip(d, 0, 1) * 255).round().astype(np.uint8), mode="L")
    if alfa is None:
        return cinza

    # LA e não L: o alfa precisa sobreviver até o momento de salvar, senão
    # inverter a profundidade transformaria o fundo preto em fundo branco.
    return Image.merge("LA", (cinza, alfa))


def abrir_entrada(caminho: str) -> tuple[Image.Image, Image.Image | None]:
    """Abre a imagem e separa o alfa.

    Devolve `(rgb_para_inferencia, alfa_ou_None)`. Quando há transparência o RGB
    é achatado sobre cinza médio: preto ou branco puxariam a estimativa para um
    extremo e criariam uma borda falsa em volta do objeto.
    """
    img = Image.open(caminho)
    img.load()

    if max(img.size) > MAX_SAIDA:
        fator = MAX_SAIDA / max(img.size)
        img = img.resize(
            (max(1, round(img.width * fator)), max(1, round(img.height * fator))),
            Image.LANCZOS,
        )

    tem_alfa = img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info
    if not tem_alfa:
        return img.convert("RGB"), None

    rgba = img.convert("RGBA")
    alfa = rgba.getchannel("A")
    fundo = Image.new("RGB", rgba.size, (128, 128, 128))
    fundo.paste(rgba, mask=alfa)
    return fundo, alfa


# ─── Inferência ─────────────────────────────────────────────────────────────
PROVEDORES_PREFERIDOS = ("CUDAExecutionProvider", "DmlExecutionProvider", "CPUExecutionProvider")


def escolher_provedor() -> str:
    """GPU quando houver, CPU sempre como rede de segurança.

    A ordem cobre os três runtimes possíveis sem que o resto do código precise
    saber qual pacote do onnxruntime foi instalado: trocar `onnxruntime` por
    `onnxruntime-gpu` ou `onnxruntime-directml` liga a GPU sem mexer aqui.
    """
    import onnxruntime as ort

    disponiveis = set(ort.get_available_providers())
    for p in PROVEDORES_PREFERIDOS:
        if p in disponiveis:
            return p
    return "CPUExecutionProvider"


def gerar_profundidade(
    caminho_entrada: str,
    tamanho: str = MODELO_PADRAO,
    progresso: Callable[[int], None] | None = None,
    passo: Callable[[str], None] | None = None,
) -> tuple[Image.Image, str]:
    """Imagem → mapa de profundidade (`L` ou `LA`) + provedor efetivamente usado.

    O modelo é carregado aqui e destruído antes de retornar: nada de sessão
    global nem de cache entre chamadas. O custo é recarregar (~0,3 s de um
    arquivo já em cache no disco); o ganho é não deixar nada residente.
    """
    import onnxruntime as ort

    if passo:
        passo("Preparando a imagem")
    rgb, alfa = abrir_entrada(caminho_entrada)
    tamanho_original = rgb.size

    if not modelo_em_cache(tamanho):
        if passo:
            passo("Baixando o modelo (uma única vez)")
        baixar_modelo(tamanho, progresso)
    pesos = caminho_modelo(tamanho)

    sessao = None
    entrada = None
    bruto = None
    provedor = escolher_provedor()
    try:
        if passo:
            passo("Carregando o modelo")
        opcoes = ort.SessionOptions()
        # Sem o log do ORT em stdout: o contrato do sidecar é UMA linha JSON.
        opcoes.log_severity_level = 3
        opcoes.enable_cpu_mem_arena = ARENA_CPU
        sessao = ort.InferenceSession(str(pesos), opcoes, providers=[provedor])

        if passo:
            passo("Estimando a profundidade")
        entrada = preprocessar(rgb)
        nome = sessao.get_inputs()[0].name
        bruto = sessao.run(None, {nome: entrada})[0]

        if passo:
            passo("Montando o mapa")
        return posprocessar(bruto, tamanho_original, alfa), provedor
    finally:
        # Ordem importa: soltar as referências Python primeiro. `empty_cache()`
        # de qualquer runtime não desaloca nada que ainda esteja referenciado.
        del bruto, entrada, sessao
        rgb.close()
        gc.collect()
        _liberar_gpu()


def _liberar_gpu() -> None:
    """Devolve a VRAM quando algum runtime de GPU estiver presente.

    O ONNX Runtime já libera o alocador do EP ao destruir a sessão; isto cobre o
    caso de o torch estar no mesmo processo (o sidecar do Docling tem torch) e
    ter cache de CUDA pendurado. `try/except` porque nenhum dos dois é garantido.
    """
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
