"""Remoção de fundo (u2net) via `rembg`.

Lógica pura e testável: não imprime nada em stdout, não conhece o protocolo JSON
do `converter.py`. Quem orquestra é `converter.py::remove_bg`.

**Peso, medido antes de entrar (Portão 0, 2026-08-13).** O pacote `rembg` custa
465 MB crus na .venv e **130,9 MB** empacotado com PyInstaller, contra ~48 MB da
pilha ONNX que o módulo de profundidade já usa. O import sozinho leva **~14 s a
quente** (72 s a frio) porque `rembg/bg.py` importa `pymatting` no topo, que
arrasta `numba` e `llvmlite`. Decisão do usuário, com os números na mão: ficar
com o `rembg` de verdade, pelo alpha matting e pela galeria de modelos que vêm
junto. Quem for otimizar depois: rodar `u2net.onnx` direto no onnxruntime é o
caminho, e o pré/pós-processamento cabe em ~25 linhas.

**Liberação de memória.** O sidecar é um processo separado e curto: ele morre
depois de cada recorte, então RAM e VRAM voltam ao sistema de forma
incondicional — mais forte que qualquer `gc.collect()`. A limpeza explícita em
`remover_fundo` existe mesmo assim porque custa pouco e continua correta se um
dia o processo virar residente.
"""

from __future__ import annotations

import gc
import os
from pathlib import Path
from typing import Callable

from PIL import Image

# ─── Modelo ─────────────────────────────────────────────────────────────────
# u2net é o padrão do próprio rembg para uso geral. `isnet-general-use` costuma
# ir melhor em cabelo, mas é outro download de ~170 MB; trocar aqui é uma linha
# — e o cache no disco é por nome de modelo, então conviver com os dois é de
# graça para quem já baixou.
MODELO_PADRAO = "u2net"
ARQUIVOS = {
    "u2net": "u2net.onnx",
    "isnet-general-use": "isnet-general-use.onnx",
    "u2netp": "u2netp.onnx",
}

PROVEDORES_PREFERIDOS = [
    "CUDAExecutionProvider",
    "DmlExecutionProvider",
    "CPUExecutionProvider",
]


def dir_modelos() -> Path:
    """Cache dos pesos no disco. O MESMO diretório do módulo de profundidade.

    O rembg usaria `~/.u2net`; apontar o `U2NET_HOME` para cá mantém tudo o que
    é peso de modelo num lugar só, que é o que o roadmap pede — e o usuário
    consegue apagar o cache inteiro sem caçar pastas escondidas.
    """
    return Path(os.path.expanduser("~")) / ".cache" / "camps-utils" / "models"


def _preparar_ambiente() -> None:
    """Aponta o rembg para o nosso cache. Tem de rodar ANTES de importá-lo.

    O `U2NET_HOME` é lido na hora de resolver o caminho do modelo, mas deixar
    para depois do import é apostar num detalhe de implementação da biblioteca.
    """
    destino = dir_modelos()
    destino.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("U2NET_HOME", str(destino))
    # Sem barra de download no stderr: o contrato do sidecar reserva o stderr
    # para `PROGRESS:`/`STEP:`, e o tqdm do pooch escreveria por cima.
    os.environ.setdefault("TQDM_DISABLE", "1")


def caminho_modelo(modelo: str = MODELO_PADRAO) -> Path:
    return dir_modelos() / ARQUIVOS.get(modelo, f"{modelo}.onnx")


def modelo_em_cache(modelo: str = MODELO_PADRAO) -> bool:
    p = caminho_modelo(modelo)
    return p.exists() and p.stat().st_size > 0


def escolher_provedor() -> str:
    """GPU quando houver, CPU sempre como rede de segurança.

    Mesma ordem do `depth.py`: trocar o pacote `onnxruntime` por `-gpu` ou
    `-directml` liga a GPU sem mexer aqui.
    """
    import onnxruntime as ort

    disponiveis = set(ort.get_available_providers())
    for p in PROVEDORES_PREFERIDOS:
        if p in disponiveis:
            return p
    return "CPUExecutionProvider"


def abrir_entrada(caminho: str) -> Image.Image:
    """Abre a imagem em RGBA.

    RGBA e não RGB: um PNG que já tem alfa (logo recortado, sticker) precisa
    chegar inteiro ao modelo — achatar sobre branco criaria uma borda que o
    recorte depois preservaria como se fosse do objeto.
    """
    img = Image.open(caminho)
    img.load()
    return img.convert("RGBA")


def remover_fundo(
    caminho_entrada: str,
    modelo: str = MODELO_PADRAO,
    progresso: Callable[[int], None] | None = None,
    passo: Callable[[str], None] | None = None,
) -> tuple[Image.Image, str]:
    """Imagem → PNG com alfa (`RGBA`) + provedor efetivamente usado.

    A sessão é criada aqui e destruída antes de retornar: nada de sessão global
    nem de cache entre chamadas. O custo é recarregar o modelo; o ganho é não
    deixar nada residente depois que a ferramenta foi usada uma vez.
    """
    _preparar_ambiente()

    if passo:
        passo("Preparando a imagem")
    entrada = abrir_entrada(caminho_entrada)

    if not modelo_em_cache(modelo):
        # O download é do próprio rembg (pooch) e não reporta progresso para
        # fora; sem este aviso a barra ficaria parada em 0% por ~170 MB.
        if passo:
            passo("Baixando o modelo (uma única vez)")

    sessao = None
    saida = None
    provedor = escolher_provedor()
    try:
        if passo:
            # O texto avisa da espera de propósito: só o `import rembg` leva
            # ~14 s (numba/llvmlite), e uma barra parada em 10% sem explicação
            # parece travamento.
            passo("Carregando o modelo (leva alguns segundos)")
        if progresso:
            progresso(10)
        from rembg import new_session, remove

        sessao = new_session(modelo, providers=[provedor])

        if passo:
            passo("Separando o objeto do fundo")
        if progresso:
            progresso(45)
        saida = remove(entrada, session=sessao)

        if progresso:
            progresso(95)
        # `remove` devolve PIL quando recebe PIL, mas o modo depende da versão;
        # normalizar aqui garante alfa de verdade no arquivo salvo.
        resultado = saida if saida.mode == "RGBA" else saida.convert("RGBA")
        # Cópia desamarra o resultado da sessão antes do `finally` — o objeto
        # que sobe para o chamador não pode depender de nada que será destruído.
        return resultado.copy(), provedor
    finally:
        # Ordem importa: soltar as referências Python primeiro. Nenhum
        # `empty_cache()` desaloca o que ainda está referenciado.
        del saida, sessao
        entrada.close()
        gc.collect()
        _liberar_gpu()


def _liberar_gpu() -> None:
    """Devolve a VRAM quando algum runtime de GPU estiver presente.

    O ONNX Runtime já libera o alocador do EP ao destruir a sessão; isto cobre o
    caso de o torch estar no mesmo processo e ter cache de CUDA pendurado.
    `try/except` porque nenhum dos dois é garantido.
    """
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
