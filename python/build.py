#!/usr/bin/env python3
"""Build dos sidecars PyInstaller e dos módulos baixados sob demanda.

Alvos:
  light   -> converter-<triple>.exe (sem Docling) — vai no instalador (externalBin).
  docling -> converter-docling-<triple>.exe (só Docling) — zipado p/ o GitHub Release,
             baixado sob demanda no 1º uso do PDF→MD.
  whisper -> converter-whisper-<triple>.exe (faster-whisper) — zipado p/ o Release,
             baixado sob demanda no 1º uso da legenda automática. ~90 MB.
  depth   -> converter-depth-<triple>.exe (Depth Anything V2 via ONNX Runtime) —
             zipado p/ o Release, baixado sob demanda no 1º mapa de profundidade.
  rembg   -> converter-rembg-<triple>.exe (rembg/u2net via ONNX Runtime) —
             zipado p/ o Release, baixado sob demanda na 1ª remoção de fundo.
  webcapture -> converter-webcapture-<triple>.exe (Playwright dirigindo o Edge
             do Windows) — zipado p/ o Release, baixado sob demanda na 1ª captura.
  ffmpeg  -> camps-ffmpeg.zip (ffmpeg.exe + ffprobe.exe) — não compila nada, só
             empacota os binários que já estão em src-tauri/binaries/. Saíram do
             instalador porque somam 168 MB crus.

Uso:
  python build.py           # light + docling
  python build.py light
  python build.py docling
  python build.py whisper
  python build.py depth
  python build.py rembg
  python build.py webcapture
  python build.py ffmpeg
"""

import argparse
import hashlib
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).parent.parent
PYTHON_DIR = ROOT / "python"
DIST_DIR = PYTHON_DIR / "dist"
BUILD_DIR = PYTHON_DIR / "build"
BINARIES_DIR = ROOT / "src-tauri" / "binaries"
CONVERTER = PYTHON_DIR / "converter.py"

# Módulos pesados do Docling — excluídos do bundle light.
DOCLING_MODULES = [
    "docling", "docling_core", "docling_parse", "torch", "torchvision",
    "rapidocr", "onnxruntime", "transformers", "scipy", "cv2",
]

# Bibliotecas leves usadas pelas demais ferramentas (md2pdf, pdf-utils, youtube).
LIGHT_COLLECTS = [
    "markdown", "pymdownx", "pygments", "xhtml2pdf", "reportlab", "svglib",
    "fitz", "pikepdf", "yt_dlp", "mammoth",
]


# A pilha da captura de site, vista de fora. `converter.py::capture_site` faz
# `from webcapture import capturar_site` DENTRO da função — mesmo mecanismo do
# rembg/depth abaixo — então sem excluir esta lista todo bundle que não é o do
# webcapture arrastaria playwright + bs4 + markdownify (~46 MB) por uma
# ferramenta que ele nunca executa.
WEBCAPTURE_STACK = [
    "webcapture", "playwright", "greenlet", "pyee",
    "bs4", "beautifulsoup4", "soupsieve", "markdownify",
]

# A pilha da remoção de fundo, vista de fora. `converter.py::remove_bg` faz
# `import bgremove` DENTRO da função, e o PyInstaller segue isso: sem excluir,
# todo bundle que não é o do rembg engordaria ~100 MB (numba, llvmlite,
# pymatting, scipy) por causa de uma ferramenta que ele nunca executa.
REMBG_STACK = [
    "bgremove", "rembg", "pymatting", "numba", "llvmlite", "skimage",
    "imageio", "tifffile", "networkx", "jsonschema", "pooch",
]

# O PyInstaller segue import dentro de função. `converter.py::depth_map` faz
# `import depth`, e depth.py importa numpy + onnxruntime no topo — sem excluir o
# próprio módulo `depth`, o instalador engordaria ~70 MB com a inferência que
# nunca roda ali (o Rust manda `depth_map` para o sidecar `depth`).
LIGHT_EXCLUDES = ["depth"] + REMBG_STACK + WEBCAPTURE_STACK


# Arrastados transitivamente pelo yt-dlp e inúteis na transcrição.
WHISPER_EXCLUDES = [
    "websockets", "requests", "urllib3", "curl_cffi", "Cryptodome",
    "secretstorage", "brotli", "mutagen", "PIL", "reportlab", "html5lib",
]

# A pilha da transcrição, vista de fora. `WHISPER_EXCLUDES` não serve aqui: ela
# lista o que o bundle do whisper NÃO quer, e por definição não exclui o próprio
# whisper. Sem esta lista o bundle do depth saiu com 124 MB — `av.libs` (63 MB),
# `ctranslate2` (59 MB), pandas e lxml, tudo alcançado pelo `import
# faster_whisper` que mora DENTRO de `transcribe()`.
DEPTH_EXCLUDES = [
    "faster_whisper", "ctranslate2", "av", "tokenizers",
    "pandas", "huggingface_hub", "hf_xet", "lxml",
    "pydantic", "pydantic_core", "safetensors",
] + REMBG_STACK + WEBCAPTURE_STACK

# O que o bundle do rembg PRECISA e portanto não pode ser excluído pelas listas
# dos outros módulos. `requests`/`urllib3` estão aqui porque o pooch baixa os
# pesos com eles — e `WHISPER_EXCLUDES` os exclui. Sem esta subtração o exe
# compila e só falha em produção, na hora de baixar o modelo.
REMBG_NEEDS = REMBG_STACK + [
    "scipy", "onnxruntime", "numpy", "PIL",
    "requests", "urllib3", "certifi", "charset_normalizer", "idna",
]


def get_target_triple() -> str:
    try:
        result = subprocess.run(["rustc", "-vV"], capture_output=True, text=True, check=False)
        for line in result.stdout.splitlines():
            if line.startswith("host:"):
                return line.split(":", 1)[1].strip()
    except FileNotFoundError:
        pass
    return "x86_64-pc-windows-msvc"


def _run_pyinstaller(name: str, extra: list[str]) -> Path:
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile", "--noconfirm", "--clean",
        f"--name={name}",
        "--distpath", str(DIST_DIR),
        "--workpath", str(BUILD_DIR),
        *extra,
        str(CONVERTER),
    ]
    print("\n" + " ".join(cmd))
    if subprocess.run(cmd, cwd=str(PYTHON_DIR)).returncode != 0:
        print("ERRO: PyInstaller falhou.", file=sys.stderr)
        sys.exit(1)
    return DIST_DIR / f"{name}.exe"


def build_light(triple: str) -> None:
    name = f"converter-{triple}"
    print(f"\n=== Bundle LIGHT: {name} ===")
    extra: list[str] = []
    for lib in LIGHT_COLLECTS:
        extra += ["--collect-all", lib]
    for mod in DOCLING_MODULES + LIGHT_EXCLUDES:
        extra += ["--exclude-module", mod]

    exe = _run_pyinstaller(name, extra)
    BINARIES_DIR.mkdir(parents=True, exist_ok=True)
    dest = BINARIES_DIR / f"{name}.exe"
    if dest.exists():
        dest.unlink()
    shutil.copy2(exe, dest)
    print(f"Light copiado para: {dest}  ({dest.stat().st_size // (1024*1024)} MB)")


def build_docling(triple: str) -> None:
    name = f"converter-docling-{triple}"
    print(f"\n=== Bundle DOCLING: {name} ===")
    extra = [
        "--collect-data", "docling_parse",
        "--collect-all", "docling",
        "--collect-all", "rapidocr",
        "--collect-all", "onnxruntime",
    ]
    exe = _run_pyinstaller(name, extra)

    # Zip + SHA256 p/ o Release.
    zip_path = DIST_DIR / "camps-docling.zip"
    print(f"\nZipando {exe.name} -> {zip_path.name} …")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(exe, arcname=exe.name)

    sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    (DIST_DIR / "camps-docling.sha256").write_text(sha, encoding="utf-8")

    print(f"\nZip:    {zip_path}  ({zip_path.stat().st_size // (1024*1024)} MB)")
    print(f"SHA256: {sha}")
    print("\n>> Suba 'camps-docling.zip' num Release do GitHub e cole o SHA256 no app "
          "(src-tauri/src/commands.rs -> DOCLING_SHA256).")


def build_whisper(triple: str) -> None:
    """Sidecar de transcrição (faster-whisper). ~90 MB medidos.

    NÃO excluir `av` nem `onnxruntime`:
    - `av` é importado no topo de faster_whisper/audio.py; sem ele o exe nem
      abre. De quebra, ele traz o próprio ffmpeg, o que deixa este módulo
      autossuficiente (não depende do módulo ffmpeg estar instalado).
    - `onnxruntime` É o VAD Silero embutido. Cortar economiza 14 MB e leva o
      `vad_filter=True` junto.
    Ver o Portão 0 em roadmaps/ia-local/roadmap.md.
    """
    name = f"converter-whisper-{triple}"
    print(f"\n=== Bundle WHISPER: {name} ===")

    coletar = ["faster_whisper", "ctranslate2", "tokenizers", "onnxruntime", "av"]

    # O PyInstaller analisa o converter.py INTEIRO, inclusive imports dentro de
    # função — sem estas exclusões o bundle vinha com yt_dlp, websockets,
    # requests, reportlab e cia., e ia de ~99 para 144 MB. Este exe só atende
    # `transcribe` (o Rust roteia assim), então nada disso é alcançável.
    #
    # ⚠️ A subtração não é firula: `onnxruntime` está em DOCLING_MODULES, então
    # a lista crua emitia `--collect-all onnxruntime` E `--exclude-module
    # onnxruntime`. A exclusão vence, e o exe morria em tempo de execução com
    # "Applying the VAD filter requires the onnxruntime package" — só no
    # empacotado, porque em dev a .venv tem tudo.
    excluir = [m for m in DOCLING_MODULES + LIGHT_COLLECTS + WHISPER_EXCLUDES + REMBG_STACK + WEBCAPTURE_STACK
               if m not in coletar]

    extra: list[str] = []
    for lib in coletar:
        extra += ["--collect-all", lib]
    for mod in excluir:
        extra += ["--exclude-module", mod]

    exe = _run_pyinstaller(name, extra)

    zip_path = DIST_DIR / "camps-whisper.zip"
    print(f"\nZipando {exe.name} -> {zip_path.name} …")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(exe, arcname=exe.name)

    sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    (DIST_DIR / "camps-whisper.sha256").write_text(sha, encoding="utf-8")

    print(f"\nZip:    {zip_path}  ({zip_path.stat().st_size // (1024*1024)} MB)")
    print(f"SHA256: {sha}")
    print("\n>> Suba 'camps-whisper.zip' num Release com a tag 'whisper-v1' (marcado como "
          "pre-release) e cole o SHA256 em src-tauri/src/commands.rs -> WHISPER.sha256")


def build_depth(triple: str) -> None:
    """Sidecar de profundidade (Depth Anything V2 via ONNX Runtime).

    ONNX e não torch/transformers: medido na .venv, torch (492 MB) +
    transformers (90 MB) contra onnxruntime + numpy + Pillow (86 MB) — o mesmo
    modelo, os mesmos pesos, um décimo do peso. Ver o cabeçalho de `depth.py`.

    Os PESOS não entram no zip: `depth.py` os busca na HuggingFace no primeiro
    uso (~94 MB) e guarda em `~/.cache/camps-utils/models/`.
    """
    name = f"converter-depth-{triple}"
    print(f"\n=== Bundle DEPTH: {name} ===")

    # `numpy` fora do collect-all de propósito: o hook padrão do PyInstaller já
    # traz o que ele precisa, e `--collect-all` acrescentaria os testes e os
    # headers. `PIL` PRECISA estar aqui — está em WHISPER_EXCLUDES, e sem entrar
    # na subtração abaixo viraria `--exclude-module`.
    coletar = ["onnxruntime", "PIL"]

    # Mesma subtração do whisper, pelo mesmo motivo: `onnxruntime` está em
    # DOCLING_MODULES e a exclusão vence o `--collect-all`. Sem isto o exe
    # compila e só morre em produção, na hora da inferência.
    excluir = [m for m in DOCLING_MODULES + LIGHT_COLLECTS + WHISPER_EXCLUDES + DEPTH_EXCLUDES
               if m not in coletar]

    extra: list[str] = []
    for lib in coletar:
        extra += ["--collect-all", lib]
    for mod in excluir:
        extra += ["--exclude-module", mod]

    exe = _run_pyinstaller(name, extra)

    zip_path = DIST_DIR / "camps-depth.zip"
    print(f"\nZipando {exe.name} -> {zip_path.name} …")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(exe, arcname=exe.name)

    sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    (DIST_DIR / "camps-depth.sha256").write_text(sha, encoding="utf-8")

    print(f"\nZip:    {zip_path}  ({zip_path.stat().st_size // (1024*1024)} MB)")
    print(f"SHA256: {sha}")
    print("\n>> Suba 'camps-depth.zip' num Release com a tag 'depth-v1' (marcado como "
          "pre-release) e cole o SHA256 em src-tauri/src/commands.rs -> DEPTH.sha256")


def build_rembg(triple: str) -> None:
    """Sidecar de remoção de fundo (rembg + u2net via ONNX Runtime).

    **130,9 MB medidos** (Portão 0, 2026-08-13) — contra ~48 MB que a mesma
    tarefa custaria rodando `u2net.onnx` direto no onnxruntime. O peso e os
    ~14 s de import vêm do `pymatting`, que `rembg/bg.py` importa no topo e que
    arrasta `numba` + `llvmlite`. Decisão do usuário com os números na mão; ver
    o cabeçalho de `bgremove.py`.

    Os PESOS não entram no zip: o rembg baixa o u2net (~168 MB) no primeiro uso,
    e o `bgremove.py` aponta o `U2NET_HOME` para `~/.cache/camps-utils/models/`.
    """
    name = f"converter-rembg-{triple}"
    print(f"\n=== Bundle REMBG: {name} ===")

    coletar = ["rembg", "onnxruntime", "PIL", "pymatting", "numba"]

    # Mesma subtração dos outros módulos, e aqui ela é mais perigosa que o
    # normal: `WHISPER_EXCLUDES` corta `requests`/`urllib3`, que são justamente
    # como o pooch baixa os pesos. Ver `REMBG_NEEDS`.
    excluir = [m for m in DOCLING_MODULES + LIGHT_COLLECTS + WHISPER_EXCLUDES + DEPTH_EXCLUDES
               if m not in coletar and m not in REMBG_NEEDS]

    extra: list[str] = []
    for lib in coletar:
        extra += ["--collect-all", lib]
    for mod in excluir:
        extra += ["--exclude-module", mod]

    exe = _run_pyinstaller(name, extra)

    zip_path = DIST_DIR / "camps-rembg.zip"
    print(f"\nZipando {exe.name} -> {zip_path.name} …")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(exe, arcname=exe.name)

    sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    (DIST_DIR / "camps-rembg.sha256").write_text(sha, encoding="utf-8")

    print(f"\nZip:    {zip_path}  ({zip_path.stat().st_size // (1024*1024)} MB)")
    print(f"SHA256: {sha}")
    print("\n>> Suba 'camps-rembg.zip' num Release com a tag 'rembg-v1' (marcado como "
          "pre-release) e cole o SHA256 em src-tauri/src/commands.rs -> REMBG.sha256")


def build_webcapture(triple: str) -> None:
    """Sidecar de captura de site (Playwright dirigindo o Edge do Windows via
    `channel="msedge"`, sem baixar Chromium). ~46 MB medidos.

    Só o runtime do Playwright entra no zip — ele dirige o Edge já instalado no
    Windows, então não há binário de navegador para empacotar aqui.
    """
    name = f"converter-webcapture-{triple}"
    print(f"\n=== Bundle WEBCAPTURE: {name} ===")

    coletar = ["playwright", "bs4", "markdownify"]

    # Mesma subtração dos outros módulos: sem excluir as pilhas alheias, este
    # bundle arrastaria docling, whisper, depth e rembg por trás dos imports
    # dentro de função que `converter.py` faz para cada ferramenta.
    #
    # `DEPTH_EXCLUDES` já inclui `WEBCAPTURE_STACK` (subtração cruzada, ver seu
    # comentário) — sem filtrar por `WEBCAPTURE_STACK` aqui também, o próprio
    # bundle se auto-excluiria: `greenlet`/`pyee`/`soupsieve`/`beautifulsoup4`
    # não estão em `coletar` (só os três pacotes top-level estão) mas são
    # dependência direta de playwright/bs4.
    excluir = [m for m in DOCLING_MODULES + LIGHT_COLLECTS + WHISPER_EXCLUDES + DEPTH_EXCLUDES + REMBG_STACK
               if m not in coletar and m not in WEBCAPTURE_STACK]

    extra: list[str] = []
    for lib in coletar:
        extra += ["--collect-all", lib]
    for mod in excluir:
        extra += ["--exclude-module", mod]

    exe = _run_pyinstaller(name, extra)

    zip_path = DIST_DIR / "camps-webcapture.zip"
    print(f"\nZipando {exe.name} -> {zip_path.name} …")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(exe, arcname=exe.name)

    sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    (DIST_DIR / "camps-webcapture.sha256").write_text(sha, encoding="utf-8")

    print(f"\nZip:    {zip_path}  ({zip_path.stat().st_size // (1024*1024)} MB)")
    print(f"SHA256: {sha}")
    print("\n>> Suba 'camps-webcapture.zip' num Release com a tag 'webcapture-v1' (marcado como "
          "pre-release) e cole o SHA256 em src-tauri/src/commands.rs -> WEBCAPTURE.sha256")


def build_ffmpeg() -> None:
    """Zipa ffmpeg.exe + ffprobe.exe p/ o Release. Não compila nada."""
    print("\n=== Bundle FFMPEG ===")
    fontes = [BINARIES_DIR / "ffmpeg.exe", BINARIES_DIR / "ffprobe.exe"]
    faltando = [f.name for f in fontes if not f.exists()]
    if faltando:
        sys.exit(
            f"Não encontrei {', '.join(faltando)} em {BINARIES_DIR}.\n"
            "Baixe uma build do ffmpeg e coloque os dois .exe lá antes de empacotar."
        )

    DIST_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = DIST_DIR / "camps-ffmpeg.zip"
    print(f"Zipando {' + '.join(f.name for f in fontes)} -> {zip_path.name} …")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in fontes:
            # arcname sem pasta: o Rust procura runtime/ffmpeg.exe direto.
            zf.write(f, arcname=f.name)

    sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    (DIST_DIR / "camps-ffmpeg.sha256").write_text(sha, encoding="utf-8")

    print(f"\nZip:    {zip_path}  ({zip_path.stat().st_size // (1024*1024)} MB)")
    print(f"SHA256: {sha}")
    print("\n>> Suba 'camps-ffmpeg.zip' num Release com a tag 'ffmpeg-v1' e cole o SHA256 em "
          "src-tauri/src/commands.rs -> FFMPEG.sha256")


def build_realesrgan() -> None:
    """Zipa o Real-ESRGAN ncnn/Vulkan p/ o Release. Não compila nada.

    Espera `src-tauri/binaries/realesrgan/` com o exe, a `vcomp140.dll` e a
    pasta `models/`. A origem é o bundle do upstream:
    https://github.com/xinntao/Real-ESRGAN/releases → realesrgan-ncnn-vulkan-*-windows.zip
    (o repo Real-ESRGAN-ncnn-vulkan publica o exe SEM os modelos).

    Só o modelo geral (`realesrgan-x4plus`) entra: os de anime somam ~11 MB e
    ninguém os escolhe na interface hoje. Ver `MODELOS_UPSCALE` no commands.rs.
    """
    print("\n=== Bundle REAL-ESRGAN ===")
    raiz = BINARIES_DIR / "realesrgan"
    fontes = [
        raiz / "realesrgan-ncnn-vulkan.exe",
        raiz / "vcomp140.dll",
        raiz / "models" / "realesrgan-x4plus.param",
        raiz / "models" / "realesrgan-x4plus.bin",
    ]
    faltando = [str(f.relative_to(BINARIES_DIR)) for f in fontes if not f.exists()]
    if faltando:
        sys.exit(
            f"Não encontrei {', '.join(faltando)} em {BINARIES_DIR}.\n"
            "Baixe o realesrgan-ncnn-vulkan-*-windows.zip dos Releases do xinntao/Real-ESRGAN "
            "e copie exe + dll + models/realesrgan-x4plus.* para binaries/realesrgan/."
        )

    DIST_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = DIST_DIR / "camps-realesrgan.zip"
    print(f"Zipando {len(fontes)} arquivos -> {zip_path.name} …")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in fontes:
            # arcname com a pasta: o Rust procura runtime/realesrgan/... e o
            # binário acha os modelos pelo caminho relativo ao exe.
            zf.write(f, arcname=str(f.relative_to(BINARIES_DIR)).replace("\\", "/"))

    sha = hashlib.sha256(zip_path.read_bytes()).hexdigest()
    (DIST_DIR / "camps-realesrgan.sha256").write_text(sha, encoding="utf-8")

    print(f"\nZip:    {zip_path}  ({zip_path.stat().st_size // (1024*1024)} MB)")
    print(f"SHA256: {sha}")
    print("\n>> Suba 'camps-realesrgan.zip' num Release com a tag 'realesrgan-v1' (marcado como "
          "pre-release) e cole o SHA256 em src-tauri/src/commands.rs -> REALESRGAN.sha256")


def clean() -> None:
    """Limpa o trabalho do PyInstaller preservando os pacotes de Release.

    `camps-*.zip` e o `.sha256` correspondente são artefatos caros e prontos
    para publicar — o do Docling leva ~40 min para regerar. Apagá-los ao
    construir OUTRO alvo é destruir trabalho alheio ao que se está fazendo.
    """
    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR, ignore_errors=True)

    if not DIST_DIR.exists():
        return
    for item in DIST_DIR.iterdir():
        if item.name.startswith("camps-") and item.suffix in (".zip", ".sha256"):
            continue
        if item.is_dir():
            shutil.rmtree(item, ignore_errors=True)
        else:
            item.unlink(missing_ok=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build dos sidecars CAMPS-UTILS")
    parser.add_argument("target", nargs="?", default="both",
                        choices=["light", "docling", "whisper", "depth", "rembg", "webcapture",
                                 "ffmpeg", "realesrgan", "both"])
    args = parser.parse_args()

    # ffmpeg e realesrgan só empacotam binários prontos: não rodam PyInstaller
    # e, sobretudo, não podem chamar clean() — isso apagaria os sidecars já
    # compilados.
    if args.target in ("ffmpeg", "realesrgan"):
        (build_ffmpeg if args.target == "ffmpeg" else build_realesrgan)()
        print("\nBuild concluído.")
        raise SystemExit(0)

    triple = get_target_triple()
    print(f"Target triple: {triple}")
    clean()

    if args.target in ("light", "both"):
        build_light(triple)
    if args.target in ("docling", "both"):
        build_docling(triple)
    if args.target == "whisper":
        build_whisper(triple)
    if args.target == "depth":
        build_depth(triple)
    if args.target == "rembg":
        build_rembg(triple)
    if args.target == "webcapture":
        build_webcapture(triple)

    print("\nBuild concluído.")
