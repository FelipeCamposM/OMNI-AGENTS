#!/usr/bin/env python3
"""PDF to Markdown converter sidecar for Tauri."""

import sys
import json
import time
import argparse
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlparse

# Redirect all non-JSON output to stderr so stdout stays clean
def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def make_error(code: str, message: str) -> dict:
    return {"success": False, "errorCode": code, "message": message}


def make_success(output_path: str, markdown: str, duration_ms: int) -> dict:
    return {
        "success": True,
        "outputPath": output_path,
        "markdown": markdown,
        "durationMs": duration_ms,
    }


def validate_input(input_path: str, output_path: str | None) -> dict | None:
    if not input_path:
        return make_error("INVALID_INPUT", "Caminho do arquivo PDF não informado.")

    path = Path(input_path)

    if not path.exists():
        return make_error("FILE_NOT_FOUND", "Arquivo PDF não encontrado.")

    if path.suffix.lower() != ".pdf":
        return make_error("INVALID_EXTENSION", "O arquivo selecionado não é um PDF válido.")

    if output_path:
        out = Path(output_path)
        try:
            out.parent.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            log(f"OUTPUT_ERROR: {e}")
            return make_error("OUTPUT_ERROR", "Não foi possível criar o diretório de saída.")

    return None


def detect_first_run() -> bool:
    """Check if Docling models are already cached."""
    cache_dir = Path.home() / ".cache" / "huggingface" / "hub"
    # Look for any docling-related model cache
    if cache_dir.exists():
        for item in cache_dir.iterdir():
            if "docling" in item.name.lower() or "ds4sd" in item.name.lower():
                return False
    return True


def convert(input_path: str, output_path: str | None) -> dict:
    start = time.time()

    error = validate_input(input_path, output_path)
    if error:
        return error

    if detect_first_run():
        log("FIRST_RUN: Modelos do Docling não encontrados. O primeiro uso pode levar alguns minutos para baixar os modelos necessários.")

    try:
        from docling.document_converter import DocumentConverter
        from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions
        from docling.datamodel.base_models import InputFormat
        from docling.document_converter import PdfFormatOption
    except ImportError as e:
        log(f"MODEL_ERROR: {e}")
        return make_error("MODEL_ERROR", "Não foi possível carregar o Docling. Verifique a instalação.")

    try:
        log(f"STEP: Preparando documento: {Path(input_path).name}")
        ocr_options = RapidOcrOptions(backend="onnxruntime")
        pipeline_options = PdfPipelineOptions(ocr_options=ocr_options)
        converter = DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)}
        )

        log("STEP: Analisando páginas")
        result = converter.convert(input_path)

        log("STEP: Convertendo conteúdo")
        markdown = result.document.export_to_markdown()

        log("STEP: Gerando Markdown")
        duration_ms = int((time.time() - start) * 1000)

        if output_path:
            out = Path(output_path)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(markdown, encoding="utf-8")
            log(f"SAVED: {output_path}")

        return make_success(output_path or "", markdown, duration_ms)

    except Exception as e:
        log(f"CONVERSION_FAILED: {type(e).__name__}: {e}")
        return make_error("CONVERSION_FAILED", "Não foi possível converter o documento.")


# Aproximação do tema do Markdown Preview Enhanced (que é o CSS do GitHub).
#
# ⚠️ Teto conhecido: o xhtml2pdf entende um subconjunto pequeno de CSS 2.1 —
# nada de flexbox, grid, seletores modernos ou JavaScript. Então Mermaid e
# KaTeX do MPE não têm como funcionar aqui, e o resultado é "parecido com",
# não "idêntico a". Fidelidade real exigiria um motor de navegador.
PDF_CSS = """
@page {
  size: a4 portrait;
  margin: 2cm 1.8cm;
  @frame footer { -pdf-frame-content: rodape; bottom: 1cm; margin-left: 1.8cm;
                  margin-right: 1.8cm; height: 1cm; }
}
body { font-family: Helvetica, Arial, sans-serif; font-size: 10.5pt; color: #24292f;
       line-height: 1.55; }

h1, h2, h3, h4, h5, h6 { color: #1f2328; font-weight: bold; margin: 1.1em 0 0.5em; }
h1 { font-size: 20pt; border-bottom: 1px solid #d8dee4; padding-bottom: 5px; }
h2 { font-size: 16pt; border-bottom: 1px solid #d8dee4; padding-bottom: 4px; }
h3 { font-size: 13pt; } h4 { font-size: 11.5pt; }
h5, h6 { font-size: 10.5pt; color: #59636e; }
p { margin: 0 0 0.85em; }
a { color: #0969da; text-decoration: none; }
hr { border: none; border-top: 2px solid #d8dee4; margin: 1.4em 0; }

/* Código. `pre` não pode quebrar entre páginas no meio sem virar sopa. */
code { font-family: "Courier New", Courier, monospace; font-size: 9pt;
       background: #eff1f3; padding: 1px 4px; border-radius: 3px; }
pre { background: #f6f8fa; border: 1px solid #d8dee4; border-radius: 4px;
      padding: 10px 12px; margin: 0 0 1em; font-size: 9pt; line-height: 1.45; }
pre code { background: transparent; padding: 0; font-size: 9pt; }

blockquote { border-left: 4px solid #d0d7de; margin: 0 0 1em; padding: 2px 0 2px 14px;
             color: #59636e; }

/* Tabelas — o ponto que mais dói no xhtml2pdf.
   `repeat="1"` no <thead> (atributo, não CSS) é o que faz o cabeçalho se
   repetir quando a tabela quebra de página. A largura de cada coluna vem do
   <colgroup> gerado por _size_table_columns: sem ele o xhtml2pdf divide tudo
   em partes iguais e a coluna de descrição fica igual à de um número. */
table { border-collapse: collapse; width: 100%; margin: 0 0 1.1em; }
th, td { border: 1px solid #d0d7de; padding: 5px 9px; text-align: left;
         vertical-align: top; font-size: 9.5pt; }
th { background-color: #f6f8fa; font-weight: bold; }
tr.par td { background-color: #fafbfc; }

ul, ol { margin: 0 0 0.9em; padding-left: 1.6em; }
li { margin-bottom: 0.25em; }

img { max-width: 100%; }
.rodape { color: #8c959f; font-size: 8pt; text-align: center; }

/* Syntax highlight (Pygments, tema claro parecido com o do GitHub). */
.highlight .k, .highlight .kd, .highlight .kn { color: #cf222e; }
.highlight .nf, .highlight .nc { color: #8250df; }
.highlight .s, .highlight .s1, .highlight .s2, .highlight .sb { color: #0a3069; }
.highlight .c, .highlight .c1, .highlight .cm { color: #59636e; font-style: italic; }
.highlight .mi, .highlight .mf, .highlight .m { color: #0550ae; }
.highlight .o, .highlight .ow { color: #0550ae; }
.highlight .nb { color: #0550ae; }
.highlight .nd { color: #8250df; }
"""

# Paridade de GFM com o que o MPE renderiza. O `extra` do Python-Markdown já
# traz tables/footnotes/attr_list/def_list; o resto vem do pymdown-extensions.
MD_EXTENSIONS = [
    "extra",
    "sane_lists",
    "toc",
    "admonition",
    "pymdownx.highlight",
    "pymdownx.tilde",        # ~~riscado~~
    "pymdownx.tasklist",     # - [x] tarefa
    "pymdownx.magiclink",    # URL crua vira link
    "pymdownx.superfences",  # blocos de código aninhados/robustos
    "pymdownx.smartsymbols",
]

MD_EXTENSION_CONFIGS = {
    "pymdownx.highlight": {"css_class": "highlight", "guess_lang": False},
    "pymdownx.tasklist": {"custom_checkbox": False},
}

# Uma linha de tabela GFM: começa/termina com pipe ou tem pipe no meio.
_LINHA_TABELA = re.compile(r"^\s{0,3}\|?[^|\n]*\|")
# Linha separadora: |---|:--:|---:| (com ou sem pipes nas bordas)
_SEP_TABELA = re.compile(r"^\s{0,3}\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$")


def _normalize_markdown(texto: str) -> str:
    """
    Insere a linha em branco que o Python-Markdown exige antes de uma tabela.

    O GFM (e portanto o MPE) aceita uma tabela colada no parágrafo anterior; o
    Python-Markdown **não** — sem a linha em branco ele trata as linhas como
    texto corrido e a tabela sai como um parágrafo só. É a causa clássica de
    "a tabela virou uma coluna só".
    """
    linhas = texto.split("\n")
    saida: list[str] = []
    for i, linha in enumerate(linhas):
        # Uma tabela começa quando ESTA linha é o cabeçalho e a próxima é o
        # separador. Se a anterior tem conteúdo, falta a linha em branco.
        proxima = linhas[i + 1] if i + 1 < len(linhas) else ""
        comeca_tabela = bool(_LINHA_TABELA.match(linha)) and bool(_SEP_TABELA.match(proxima))
        if comeca_tabela and saida and saida[-1].strip():
            saida.append("")
        saida.append(linha)
    return "\n".join(saida)


def _size_table_columns(html: str) -> str:
    """
    Injeta `<colgroup>` com largura proporcional ao conteúdo de cada coluna, e
    marca as linhas pares para o zebrado.

    Sem isso o xhtml2pdf reparte a largura igualmente entre as colunas: numa
    tabela com "Módulo | Descrição longa | Tamanho", a descrição fica espremida
    no mesmo espaço do número. Navegador nenhum faz isso — é o principal
    motivo de a tabela sair feia aqui.
    """
    from html.parser import HTMLParser

    class Medidor(HTMLParser):
        """Mede o texto de cada célula da primeira <tr> de cada seção."""

        def __init__(self) -> None:
            super().__init__(convert_charrefs=True)
            self.tabelas: list[list[int]] = []
            self._larguras: list[int] | None = None
            self._col = -1
            self._profundidade = 0

        def handle_starttag(self, tag, attrs):
            if tag == "table":
                self._profundidade += 1
                if self._profundidade == 1:
                    self._larguras = []
            elif tag == "tr" and self._larguras is not None:
                self._col = -1
            elif tag in ("th", "td") and self._larguras is not None:
                self._col += 1
                if self._col >= len(self._larguras):
                    self._larguras.append(0)

        def handle_endtag(self, tag):
            if tag == "table":
                if self._profundidade == 1 and self._larguras is not None:
                    self.tabelas.append(self._larguras)
                    self._larguras = None
                self._profundidade = max(0, self._profundidade - 1)

        def handle_data(self, data):
            if self._larguras is not None and 0 <= self._col < len(self._larguras):
                # Acumula: a coluna mais "cheia" no total é a que precisa de espaço.
                self._larguras[self._col] += len(data.strip())

    medidor = Medidor()
    medidor.feed(html)
    pesos_por_tabela = list(medidor.tabelas)

    def percentuais(pesos: list[int]) -> list[float]:
        n = len(pesos)
        # Piso de 8%: uma coluna vazia não pode sumir. Teto vem da normalização.
        minimo = 8.0
        livre = 100.0 - minimo * n
        total = sum(pesos) or 1
        if livre <= 0:  # colunas demais: divide igual e desiste do peso
            return [100.0 / n] * n
        return [minimo + livre * (p / total) for p in pesos]

    # ⚠️ A largura vai no `width` de cada célula da PRIMEIRA linha, não num
    # <colgroup>: o xhtml2pdf ignora colgroup/<col> em silêncio (testado — o
    # colgroup saía correto no HTML e a tabela continuava com colunas iguais).
    def aplica_na_primeira_linha(bloco: str, larguras: list[float]) -> str:
        m_tr = re.search(r"<tr[^>]*>.*?</tr>", bloco, re.S)
        if not m_tr:
            return bloco
        linha = m_tr.group(0)
        i = -1

        def com_width(m_cel: re.Match[str]) -> str:
            nonlocal i
            i += 1
            if i >= len(larguras):
                return m_cel.group(0)
            return f'{m_cel.group(1)} width="{larguras[i]:.1f}%"{m_cel.group(2)}'

        nova = re.sub(r"(<t[hd])((?:\s[^>]*)?>)", com_width, linha)
        return bloco[: m_tr.start()] + nova + bloco[m_tr.end() :]

    # Fatia por tabela de nível 1 e reescreve cada uma. As substituições
    # abaixo (thead/checkbox) rodam MESMO sem tabela nenhuma — um documento só
    # com lista de tarefas também precisa delas.
    if pesos_por_tabela:
        saida: list[str] = []
        pos = 0
        indice = 0
        for m_tab in re.finditer(r"<table[^>]*>.*?</table>", html, re.S):
            if indice >= len(pesos_por_tabela):
                break
            saida.append(html[pos : m_tab.start()])
            saida.append(
                aplica_na_primeira_linha(m_tab.group(0), percentuais(pesos_por_tabela[indice]))
            )
            pos = m_tab.end()
            indice += 1
        saida.append(html[pos:])
        html = "".join(saida)

    # thead repeat: atributo do xhtml2pdf, não CSS — repete o cabeçalho quando
    # a tabela quebra de página.
    html = html.replace("<thead>", '<thead repeat="1">')

    # O xhtml2pdf não desenha <input type="checkbox">. Vira texto — e ASCII,
    # não ☑/☐: as fontes base do PDF (Helvetica & cia.) não têm esses glifos e
    # o reportlab desenha um quadrado preto no lugar.
    html = re.sub(r'<input[^>]*type="checkbox"[^>]*checked[^>]*>', "<b>[x]</b> ", html)
    html = re.sub(r'<input[^>]*type="checkbox"[^>]*>', "[&nbsp;] ", html)
    return html


def _html_to_pdf(html_body: str, output_path: str, start: float) -> dict:
    """HTML → PDF via xhtml2pdf. Ponto único de md2pdf e docx2pdf."""
    from xhtml2pdf import pisa

    # Tabelas passam pelo dimensionador aqui (e não só no md2pdf) porque o
    # docx2pdf também produz <table> e sofria do mesmo aperto de colunas.
    corpo = _size_table_columns(html_body)

    html = (
        "<html><head><meta charset='utf-8'>"
        f"<style>{PDF_CSS}</style></head><body>"
        f"{corpo}"
        '<div id="rodape" class="rodape"><pdf:pagenumber> / <pdf:pagecount></div>'
        "</body></html>"
    )

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    log("STEP: Gerando PDF")
    with open(out, "wb") as f:
        pisa_status = pisa.CreatePDF(html, dest=f, encoding="utf-8")

    if pisa_status.err:
        return make_error("RENDER_FAILED", "Falha ao gerar o PDF.")

    duration_ms = int((time.time() - start) * 1000)
    log(f"SAVED: {output_path}")
    return {"success": True, "outputPath": str(out), "durationMs": duration_ms}


def convert_docx_to_pdf(input_path: str | None, output_path: str | None) -> dict:
    """
    DOCX → PDF sem Word nem LibreOffice: mammoth extrai o conteúdo semântico
    para HTML e o xhtml2pdf (já usado pelo md2pdf) rasteriza.

    Consequência assumida: o resultado **não é fac-símile** do Word. Mammoth
    mapeia estrutura (títulos, listas, tabelas, negrito), não a diagramação —
    fontes, margens, cabeçalhos/rodapés e quebras de página do original se
    perdem. A alternativa fiel exigiria Word via COM ou LibreOffice headless,
    ou seja, uma instalação externa obrigatória; aqui tudo continua local e
    empacotado.
    """
    start = time.time()

    if not input_path:
        return make_error("INVALID_INPUT", "Nenhum arquivo .docx informado.")
    p = Path(input_path)
    if not p.exists():
        return make_error("FILE_NOT_FOUND", "Arquivo .docx não encontrado.")
    if p.suffix.lower() != ".docx":
        # .doc (binário, pré-2007) não é zip/OOXML — mammoth não lê.
        return make_error("UNSUPPORTED_FORMAT", "Só .docx é suportado (o .doc antigo não).")
    if not output_path:
        return make_error("OUTPUT_ERROR", "Caminho de saída não informado.")

    try:
        import mammoth
    except ImportError as e:
        log(f"MODEL_ERROR: {e}")
        return make_error("MODEL_ERROR", "Bibliotecas de geração de PDF não encontradas.")

    try:
        log("STEP: Lendo DOCX")
        with open(p, "rb") as f:
            resultado = mammoth.convert_to_html(f)
        for aviso in resultado.messages:
            log(f"DOCX: {aviso}")

        html_body = resultado.value
        if not html_body.strip():
            return make_error("EMPTY_DOCUMENT", "O documento não tem conteúdo legível.")

        return _html_to_pdf(html_body, output_path, start)

    except Exception as e:
        log(f"RENDER_FAILED: {type(e).__name__}: {e}")
        return make_error("RENDER_FAILED", "Não foi possível gerar o PDF.")


def convert_md_to_pdf(input_path: str | None, output_path: str | None, markdown_text: str | None) -> dict:
    start = time.time()

    if markdown_text:
        md_source = markdown_text
    elif input_path:
        p = Path(input_path)
        if not p.exists():
            return make_error("FILE_NOT_FOUND", "Arquivo Markdown não encontrado.")
        md_source = p.read_text(encoding="utf-8")
    else:
        return make_error("INVALID_INPUT", "Nenhum Markdown informado.")

    if not output_path:
        return make_error("OUTPUT_ERROR", "Caminho de saída não informado.")

    try:
        # pisa não é usado aqui (quem gera é _html_to_pdf) — o import existe
        # como guarda: falha cedo com MODEL_ERROR se o bundle veio incompleto.
        import markdown as md_lib
        from xhtml2pdf import pisa  # noqa: F401
    except ImportError as e:
        log(f"MODEL_ERROR: {e}")
        return make_error("MODEL_ERROR", "Bibliotecas de geração de PDF não encontradas.")

    try:
        log("STEP: Renderizando Markdown")
        html_body = md_lib.markdown(
            _normalize_markdown(md_source),
            extensions=MD_EXTENSIONS,
            extension_configs=MD_EXTENSION_CONFIGS,
        )
        return _html_to_pdf(html_body, output_path, start)

    except Exception as e:
        log(f"RENDER_FAILED: {type(e).__name__}: {e}")
        return make_error("RENDER_FAILED", "Não foi possível gerar o PDF.")


def pdf_merge(inputs: list[str], output_path: str | None) -> dict:
    start = time.time()
    if not inputs or len(inputs) < 2:
        return make_error("INVALID_INPUT", "Selecione ao menos dois PDFs para juntar.")
    if not output_path:
        return make_error("OUTPUT_ERROR", "Caminho de saída não informado.")

    try:
        import fitz
    except ImportError as e:
        log(f"MODEL_ERROR: {e}")
        return make_error("MODEL_ERROR", "Biblioteca de PDF (PyMuPDF) não encontrada.")

    try:
        merged = fitz.open()
        for path in inputs:
            p = Path(path)
            if not p.exists():
                merged.close()
                return make_error("FILE_NOT_FOUND", f"Arquivo não encontrado: {p.name}")
            with fitz.open(path) as src:
                merged.insert_pdf(src)
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        merged.save(str(out))
        merged.close()
        duration_ms = int((time.time() - start) * 1000)
        return {"success": True, "outputPath": str(out), "durationMs": duration_ms}
    except Exception as e:
        log(f"PDF_MERGE_FAILED: {type(e).__name__}: {e}")
        return make_error("CONVERSION_FAILED", "Não foi possível juntar os PDFs.")


def pdf_split(
    input_path: str | None,
    output_dir: str | None,
    every: int,
    ranges: list | None = None,
) -> dict:
    """Divide um PDF em vários arquivos.

    Com `ranges` (lista de [inicio, fim] 1-based inclusivo), gera um PDF por
    intervalo e ignora `every`. Sem `ranges`, divide em blocos de `every`
    páginas (every>=1).
    """
    start = time.time()
    if not input_path:
        return make_error("INVALID_INPUT", "Nenhum PDF informado.")
    p = Path(input_path)
    if not p.exists():
        return make_error("FILE_NOT_FOUND", "PDF não encontrado.")
    if not output_dir:
        return make_error("OUTPUT_ERROR", "Pasta de saída não informada.")
    every = max(1, int(every))

    try:
        import fitz
    except ImportError as e:
        log(f"MODEL_ERROR: {e}")
        return make_error("MODEL_ERROR", "Biblioteca de PDF (PyMuPDF) não encontrada.")

    try:
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        outputs = []
        with fitz.open(input_path) as src:
            total = src.page_count

            if ranges:
                blocks = []
                for r in ranges:
                    if not isinstance(r, (list, tuple)) or len(r) != 2:
                        return make_error("INVALID_INPUT", f"Intervalo inválido: {r!r}")
                    try:
                        ini, fim = int(r[0]), int(r[1])
                    except (TypeError, ValueError):
                        return make_error("INVALID_INPUT", f"Intervalo inválido: {r!r}")
                    if ini > fim:
                        ini, fim = fim, ini
                    if ini < 1 or fim > total:
                        return make_error(
                            "INVALID_INPUT",
                            f"Intervalo {ini}-{fim} fora das {total} páginas do PDF.",
                        )
                    blocks.append((ini - 1, fim - 1))
            else:
                blocks = [
                    (s, min(s + every - 1, total - 1)) for s in range(0, total, every)
                ]

            for start_page, end_page in blocks:
                part = fitz.open()
                part.insert_pdf(src, from_page=start_page, to_page=end_page)
                out = out_dir / f"{p.stem}_{start_page + 1}-{end_page + 1}.pdf"
                part.save(str(out))
                part.close()
                outputs.append(str(out))
        duration_ms = int((time.time() - start) * 1000)
        return {"success": True, "outputs": outputs, "durationMs": duration_ms}
    except Exception as e:
        log(f"PDF_SPLIT_FAILED: {type(e).__name__}: {e}")
        return make_error("CONVERSION_FAILED", "Não foi possível dividir o PDF.")


def pdf_pages(input_path: str | None, output_path: str | None, pages: list | None) -> dict:
    """Monta um PDF novo com as páginas de `pages`, na ordem dada (1-based).

    Cobre três operações da UI, que são a mesma coisa vista de ângulos
    diferentes: extrair as páginas marcadas, remover as marcadas (o front manda
    o complemento) e reordenar (o front manda a ordem nova).
    """
    start = time.time()
    if not input_path:
        return make_error("INVALID_INPUT", "Nenhum PDF informado.")
    p = Path(input_path)
    if not p.exists():
        return make_error("FILE_NOT_FOUND", "PDF não encontrado.")
    if not output_path:
        return make_error("OUTPUT_ERROR", "Caminho de saída não informado.")
    if not pages:
        return make_error("INVALID_INPUT", "Nenhuma página selecionada.")

    try:
        nums = [int(n) for n in pages]
    except (TypeError, ValueError):
        return make_error("INVALID_INPUT", "Lista de páginas inválida.")

    try:
        import fitz
    except ImportError as e:
        log(f"MODEL_ERROR: {e}")
        return make_error("MODEL_ERROR", "Biblioteca de PDF (PyMuPDF) não encontrada.")

    try:
        with fitz.open(input_path) as src:
            total = src.page_count
            fora = [n for n in nums if n < 1 or n > total]
            if fora:
                return make_error(
                    "INVALID_INPUT",
                    f"Página(s) fora das {total} do PDF: {', '.join(map(str, fora))}.",
                )

            out = Path(output_path)
            out.parent.mkdir(parents=True, exist_ok=True)
            novo = fitz.open()
            for n in nums:
                novo.insert_pdf(src, from_page=n - 1, to_page=n - 1)
            novo.save(str(out))
            novo.close()

        duration_ms = int((time.time() - start) * 1000)
        return {
            "success": True,
            "outputPath": str(out),
            "pageCount": len(nums),
            "durationMs": duration_ms,
        }
    except Exception as e:
        log(f"PDF_PAGES_FAILED: {type(e).__name__}: {e}")
        return make_error("CONVERSION_FAILED", "Não foi possível montar o PDF.")


def pdf_compress(inputs: list[str], output_dir: str | None) -> dict:
    start = time.time()
    if not inputs:
        return make_error("INVALID_INPUT", "Nenhum PDF informado.")
    if not output_dir:
        return make_error("OUTPUT_ERROR", "Pasta de saída não informada.")

    try:
        import fitz
    except ImportError as e:
        log(f"MODEL_ERROR: {e}")
        return make_error("MODEL_ERROR", "Biblioteca de PDF (PyMuPDF) não encontrada.")

    try:
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        outputs = []
        for path in inputs:
            p = Path(path)
            if not p.exists():
                return make_error("FILE_NOT_FOUND", f"Arquivo não encontrado: {p.name}")
            out = out_dir / f"{p.stem}_comprimido.pdf"
            with fitz.open(path) as src:
                src.save(str(out), garbage=4, deflate=True, clean=True)
            outputs.append(str(out))
        duration_ms = int((time.time() - start) * 1000)
        return {"success": True, "outputs": outputs, "durationMs": duration_ms}
    except Exception as e:
        log(f"PDF_COMPRESS_FAILED: {type(e).__name__}: {e}")
        return make_error("CONVERSION_FAILED", "Não foi possível comprimir o PDF.")


# ─── Mapa de profundidade (Depth Anything V2) ────────────────────────────────
DEPTH_EXTS = (".png", ".jpg", ".jpeg", ".webp")


def _dir_trabalho_depth() -> Path:
    """Onde vive o mapa antes de o usuário decidir salvar.

    Temp, não a pasta do usuário: enquanto ele mexe em inverter/contraste o
    arquivo é rascunho. Nome derivado da entrada, então gerar de novo sobrescreve
    em vez de acumular lixo.
    """
    d = Path(tempfile.gettempdir()) / "camps-utils" / "depth"
    d.mkdir(parents=True, exist_ok=True)
    return d


def depth_map(input_path: str | None, model: str | None = None) -> dict:
    """Imagem → mapa de profundidade monocular, 100% local.

    Roda no bundle `depth` (onnxruntime + numpy + Pillow), não no light.

    Devolve o caminho de um PNG de **rascunho** em temp, no modo `LA` quando a
    entrada tinha transparência. Inverter e contraste são pós-processamento
    (`depth_adjust`) e não passam por aqui — o modelo não é recarregado para
    mexer num slider.
    """
    start = time.time()

    if not input_path:
        return make_error("INVALID_INPUT", "Nenhuma imagem informada.")
    p = Path(input_path)
    if not p.exists():
        return make_error("FILE_NOT_FOUND", "Imagem não encontrada.")
    if p.suffix.lower() not in DEPTH_EXTS:
        return make_error(
            "INVALID_EXTENSION",
            f"Formato não suportado: {p.suffix or 'sem extensão'}. Use PNG, JPG ou WebP.",
        )

    try:
        import depth as depth_mod
    except ImportError as e:
        log(f"MODEL_ERROR: {e}")
        return make_error("MODEL_ERROR", "Módulo de profundidade não encontrado.")

    tamanho = (model or depth_mod.MODELO_PADRAO).lower()
    if tamanho not in depth_mod.MODELOS:
        return make_error("INVALID_INPUT", f"Modelo desconhecido: {tamanho}")

    try:
        mapa, provedor = depth_mod.gerar_profundidade(
            str(p),
            tamanho,
            progresso=lambda pct: log(f"PROGRESS: {pct}"),
            passo=lambda txt: log(f"STEP: {txt}"),
        )
    except MemoryError as e:
        log(f"OUT_OF_MEMORY: {e}")
        return make_error(
            "OUT_OF_MEMORY",
            "Memória insuficiente para esta imagem. Tente uma resolução menor.",
        )
    except OSError as e:
        # Pillow levanta OSError para arquivo corrompido/truncado, e urllib
        # para queda de rede no download do modelo. Separar dá a mensagem certa.
        log(f"DEPTH_IO_FAILED: {type(e).__name__}: {e}")
        if not depth_mod.modelo_em_cache(tamanho):
            return make_error(
                "MODEL_ERROR",
                "Não foi possível baixar o modelo de profundidade. Verifique a conexão.",
            )
        return make_error("INVALID_INPUT", "Não foi possível ler a imagem (arquivo corrompido?).")
    except Exception as e:
        texto = str(e).lower()
        if "out of memory" in texto or "cuda" in texto:
            log(f"OUT_OF_MEMORY: {type(e).__name__}: {e}")
            return make_error(
                "OUT_OF_MEMORY",
                "A GPU ficou sem memória. Feche outros programas ou use uma imagem menor.",
            )
        log(f"DEPTH_FAILED: {type(e).__name__}: {e}")
        return make_error("CONVERSION_FAILED", "Não foi possível gerar o mapa de profundidade.")

    try:
        saida = _dir_trabalho_depth() / f"{p.stem}-depth.png"
        mapa.save(saida, "PNG", optimize=False)
    except OSError as e:
        log(f"OUTPUT_ERROR: {e}")
        return make_error("OUTPUT_ERROR", "Não foi possível gravar o mapa de profundidade.")

    return {
        "success": True,
        "outputPath": str(saida),
        "width": mapa.width,
        "height": mapa.height,
        "hasAlpha": mapa.mode == "LA",
        "provider": provedor,
        "model": tamanho,
        "durationMs": int((time.time() - start) * 1000),
    }


def _lut_ajuste(inverter: bool, contraste: float) -> list[int]:
    """Tabela de 256 entradas equivalente a `filter: invert() contrast()` do CSS.

    A prévia na interface é um `<img>` com esse filtro CSS; o arquivo salvo
    precisa sair idêntico ao que foi visto. Por isso a fórmula é a do CSS
    (`(v - 0,5) * k + 0,5` em sRGB), e não o `ImageEnhance.Contrast` do Pillow,
    que ancora na média da imagem e daria outro resultado.

    LUT em Python puro de propósito: `depth_adjust` mora no bundle light, que
    não carrega numpy.
    """
    lut = []
    for v in range(256):
        x = (255 - v if inverter else v) / 255.0
        x = (x - 0.5) * contraste + 0.5
        lut.append(max(0, min(255, round(x * 255))))
    return lut


def ajustar_cinza(img, inverter: bool, contraste: float):
    """Aplica inversão/contraste e achata o alfa sobre preto. Devolve modo `L`."""
    from PIL import ImageChops

    alfa = img.getchannel("A") if img.mode in ("LA", "RGBA") else None
    cinza = img.convert("L").point(_lut_ajuste(inverter, contraste))
    if alfa is None:
        return cinza
    # multiply(l, a) = l*a/255 — borda semitransparente cai suave até o preto.
    # Recorte binário (paste com máscara) deixaria serrilha em cabelo e pelo.
    return ImageChops.multiply(cinza, alfa)


def depth_adjust(
    input_path: str | None,
    output_path: str | None,
    inverter: bool = False,
    contraste: float = 1.0,
) -> dict:
    """Salva o mapa já gerado com inversão/contraste aplicados.

    **Não** toca no modelo: roda no bundle light, com Pillow apenas. É o que
    garante que mexer num slider custe milissegundos em vez de uma inferência.
    """
    start = time.time()
    if not input_path or not output_path:
        return make_error("INVALID_INPUT", "Caminhos de entrada e saída são obrigatórios.")

    origem = Path(input_path)
    if not origem.exists():
        return make_error("FILE_NOT_FOUND", "Mapa de profundidade não encontrado. Gere de novo.")

    try:
        contraste = max(0.1, min(4.0, float(contraste)))
    except (TypeError, ValueError):
        contraste = 1.0

    try:
        from PIL import Image
    except ImportError as e:
        log(f"MODEL_ERROR: {e}")
        return make_error("MODEL_ERROR", "Biblioteca de imagem (Pillow) não encontrada.")

    try:
        destino = Path(output_path)
        destino.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(origem) as img:
            img.load()
            ajustar_cinza(img, bool(inverter), contraste).save(destino, "PNG")
    except OSError as e:
        log(f"DEPTH_ADJUST_FAILED: {type(e).__name__}: {e}")
        return make_error("OUTPUT_ERROR", "Não foi possível salvar o PNG.")

    return {
        "success": True,
        "outputPath": str(destino),
        "durationMs": int((time.time() - start) * 1000),
    }


# ─── Remover fundo (u2net) ──────────────────────────────────────────────────
REMBG_EXTS = (".png", ".jpg", ".jpeg", ".webp")


def _dir_trabalho_rembg() -> Path:
    """Onde vive o recorte antes de o usuário decidir salvar.

    Temp, e com nome derivado da entrada: refazer sobrescreve em vez de
    acumular lixo, como no mapa de profundidade.
    """
    d = Path(tempfile.gettempdir()) / "camps-utils" / "rembg"
    d.mkdir(parents=True, exist_ok=True)
    return d


def remove_bg(input_path: str | None) -> dict:
    """Imagem → PNG com fundo transparente, 100% local.

    Roda no bundle `rembg` (onnxruntime + numpy + Pillow), não no light.
    Devolve o caminho de um **rascunho** em temp; salvar é cópia, feita pelo
    Rust (`copy_file`), sem refazer a segmentação.
    """
    start = time.time()

    if not input_path:
        return make_error("INVALID_INPUT", "Nenhuma imagem informada.")
    p = Path(input_path)
    if not p.exists():
        return make_error("FILE_NOT_FOUND", "Imagem não encontrada.")
    if p.suffix.lower() not in REMBG_EXTS:
        return make_error(
            "INVALID_EXTENSION",
            f"Formato não suportado: {p.suffix or 'sem extensão'}. Use PNG, JPG ou WebP.",
        )

    try:
        import bgremove as bg_mod
    except ImportError as e:
        log(f"MODEL_ERROR: {e}")
        return make_error("MODEL_ERROR", "Módulo de remoção de fundo não encontrado.")

    try:
        recorte, provedor = bg_mod.remover_fundo(
            str(p),
            progresso=lambda pct: log(f"PROGRESS: {pct}"),
            passo=lambda txt: log(f"STEP: {txt}"),
        )
    except MemoryError as e:
        log(f"OUT_OF_MEMORY: {e}")
        return make_error(
            "OUT_OF_MEMORY",
            "Memória insuficiente para esta imagem. Tente uma resolução menor.",
        )
    except OSError as e:
        # Pillow levanta OSError para arquivo corrompido/truncado, e urllib para
        # queda de rede no download do modelo. Separar dá a mensagem certa.
        log(f"REMBG_IO_FAILED: {type(e).__name__}: {e}")
        if not bg_mod.modelo_em_cache():
            return make_error(
                "MODEL_ERROR",
                "Não foi possível baixar o modelo de recorte. Verifique a conexão.",
            )
        return make_error("INVALID_INPUT", "Não foi possível ler a imagem (arquivo corrompido?).")
    except Exception as e:
        log(f"REMBG_FAILED: {type(e).__name__}: {e}")
        return make_error("CONVERSION_FAILED", "Não foi possível remover o fundo.")

    try:
        saida = _dir_trabalho_rembg() / f"{p.stem}-sem-fundo.png"
        recorte.save(saida, "PNG")
    except OSError as e:
        log(f"OUTPUT_ERROR: {e}")
        return make_error("OUTPUT_ERROR", "Não foi possível gravar o PNG.")

    return {
        "success": True,
        "outputPath": str(saida),
        "width": recorte.width,
        "height": recorte.height,
        "provider": provedor,
        "durationMs": int((time.time() - start) * 1000),
    }


def _dir_trabalho_webcapture() -> Path:
    """Onde a captura de site escreve suas pastas, uma por execução.

    Mesmo padrão do rembg/depth: temp próprio, sem `outDir` de entrada.
    """
    d = Path(tempfile.gettempdir()) / "camps-utils" / "webcapture" / str(int(time.time() * 1000))
    d.mkdir(parents=True, exist_ok=True)
    return d


def capture_site(data: dict) -> dict:
    """Crawl de um site com Playwright/Edge → Markdown, HTML, texto, screenshots.

    Validação de URL é barata e roda ANTES do import do Playwright: o objetivo
    é nunca pagar o custo do módulo pesado por um erro de digitação.
    """
    start = time.time()

    url = (data.get("url") or "").strip()
    partes = urlparse(url)
    if partes.scheme not in ("http", "https") or not partes.netloc:
        return make_error("INVALID_INPUT", "URL inválida. Use um endereço http:// ou https://.")

    escopo = data.get("escopo") or "pagina"
    opcoes_padrao = {
        "texto": True,
        "markdown": True,
        "html": True,
        "links": True,
        "screenshot": True,
        "metadados": True,
        "explorarTabsAccordions": True,
        "scrollAutomatico": True,
    }
    opcoes = {**opcoes_padrao, **(data.get("opcoes") or {})}
    max_paginas = data.get("maxPaginas")
    concorrencia = data.get("concorrencia") or 5

    try:
        import asyncio

        from webcapture import capturar_site
    except ImportError as e:
        log(f"MODEL_ERROR: {e}")
        return make_error("MODEL_ERROR", "Playwright não encontrado. Verifique a instalação.")

    out_dir = _dir_trabalho_webcapture()
    try:
        resultado = asyncio.run(
            capturar_site(
                url=url,
                escopo=escopo,
                opcoes=opcoes,
                max_paginas=max_paginas,
                concorrencia=concorrencia,
                out_dir=str(out_dir),
                passo=lambda t: log(f"STEP: {t}"),
                pagina_evento=lambda evt: log(f"PAGEEVENT:{json.dumps(evt, ensure_ascii=False)}"),
            )
        )
    except Exception as e:
        log(f"WEBCAPTURE_FAILED: {type(e).__name__}: {e}")
        return make_error("CONVERSION_FAILED", "Não foi possível capturar o site.")

    return {
        **resultado,
        "success": True,
        "outputDir": str(out_dir),
        "durationMs": int((time.time() - start) * 1000),
    }


def _modelo_em_cache(model_size: str) -> bool:
    """Diz se o modelo do Whisper já está no cache da HuggingFace.

    Só para escolher a mensagem ("carregando" x "baixando"): errar aqui muda o
    texto, não o comportamento. Por isso qualquer exceção vira "está em cache".
    """
    try:
        raiz = os.environ.get("HF_HOME") or (Path.home() / ".cache" / "huggingface")
        hub = Path(raiz) / "hub"
        if not hub.exists():
            return False
        alvo = f"models--Systran--faster-whisper-{model_size}"
        return any(p.name == alvo for p in hub.iterdir())
    except Exception:
        return True


def subtitle_read(input_path: str | None) -> dict:
    """Lê .srt/.vtt/.ass e devolve os blocos, sem gravar nada.

    Existe para o editor: `restyle` também devolve segmentos, mas escreve um
    .ass no caminho — e esse arquivo seria descartado, já que depois da revisão
    o .ass é regerado. Ler e escrever são coisas diferentes.

    Roda no bundle light.
    """
    if not input_path:
        return make_error("INVALID_INPUT", "Nenhuma legenda informada.")
    p = Path(input_path)
    if not p.exists():
        return make_error("FILE_NOT_FOUND", "Arquivo de legenda não encontrado.")

    import subtitles

    try:
        blocos = subtitles.de_srt(p.read_text(encoding="utf-8", errors="replace"))
        if not blocos:
            return make_error("INVALID_INPUT", "Nenhuma legenda reconhecida no arquivo.")
        return {
            "success": True,
            # Sem `words`: nem .srt nem .vtt guardam tempo por palavra. Quem
            # consome sabe que karaokê fica indisponível nesse caminho.
            "segments": [{"start": b.start, "end": b.end, "text": b.texto} for b in blocos],
        }
    except Exception as e:
        log(f"SUBTITLE_READ_FAILED: {type(e).__name__}: {e}")
        return make_error("CONVERSION_FAILED", "Não foi possível ler a legenda.")


def subtitle_write(
    segmentos: list | None,
    output_path: str | None,
    fmt: str,
    estilo: str | None = None,
    fonte: str | None = None,
    tamanho: int | None = None,
    alinhamento: int | None = None,
    margem_v: int | None = None,
    karaoke: bool = False,
    cor: str | None = None,
    cor_contorno: str | None = None,
    cor_karaoke: str | None = None,
    cor_fundo: str | None = None,
) -> dict:
    """Grava legenda a partir dos blocos editados na interface.

    É o passo que fecha o editor: transcreve, corrige "transclica" para
    "transcrição", ajusta um tempo torto e grava. Sem isto a única saída seria
    transcrever de novo — perdendo a correção — ou editar o .srt fora do app.

    Roda no bundle light: só mexe em texto, não precisa do Whisper.
    """
    start = time.time()

    if not segmentos:
        return make_error("INVALID_INPUT", "Nenhum bloco de legenda informado.")
    if not output_path:
        return make_error("OUTPUT_ERROR", "Caminho de saída não informado.")

    fmt = (fmt or "srt").lower()
    if fmt not in ("srt", "vtt", "ass"):
        return make_error("INVALID_INPUT", f"Formato de legenda desconhecido: {fmt}")

    import subtitles

    try:
        blocos = subtitles.de_segmentos(segmentos)
        if not blocos:
            return make_error("INVALID_INPUT", "Todos os blocos ficaram vazios.")

        if fmt == "ass":
            conteudo = subtitles.para_ass(
                blocos,
                estilo or subtitles.ESTILO_PADRAO,
                fonte=fonte,
                tamanho=tamanho,
                alinhamento=alinhamento,
                margem_v=margem_v,
                karaoke=karaoke,
                cor=cor,
                cor_contorno=cor_contorno,
                cor_karaoke=cor_karaoke,
                cor_fundo=cor_fundo,
            )
        elif fmt == "vtt":
            conteudo = subtitles.para_vtt(blocos)
        else:
            conteudo = subtitles.para_srt(blocos)

        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(conteudo, encoding="utf-8")
        log(f"SAVED: {out}")

        return {
            "success": True,
            "outputPath": str(out),
            "durationMs": int((time.time() - start) * 1000),
            "segments": [{"start": b.start, "end": b.end, "text": b.texto} for b in blocos],
        }
    except Exception as e:
        log(f"SUBTITLE_WRITE_FAILED: {type(e).__name__}: {e}")
        return make_error("CONVERSION_FAILED", "Não foi possível gravar a legenda.")


def restyle(
    input_path: str | None,
    output_path: str | None,
    estilo: str | None = None,
    fonte: str | None = None,
    tamanho: int | None = None,
    alinhamento: int | None = None,
    margem_v: int | None = None,
    cor: str | None = None,
    cor_contorno: str | None = None,
    cor_fundo: str | None = None,
) -> dict:
    """Converte um .srt/.vtt já pronto em .ass estilizado.

    É o caminho "revisei a legenda à mão e agora quero gravá-la no vídeo".
    Sem isto, legenda importada só poderia ser queimada crua — estilo mora no
    .ass, e o .srt não carrega nenhum.

    Roda no bundle light: só mexe em texto, não precisa do Whisper.
    """
    start = time.time()

    if not input_path:
        return make_error("INVALID_INPUT", "Nenhuma legenda informada.")
    p = Path(input_path)
    if not p.exists():
        return make_error("FILE_NOT_FOUND", "Arquivo de legenda não encontrado.")
    if not output_path:
        return make_error("OUTPUT_ERROR", "Caminho de saída não informado.")

    import subtitles

    try:
        blocos = subtitles.de_srt(p.read_text(encoding="utf-8", errors="replace"))
        if not blocos:
            return make_error("INVALID_INPUT", "Nenhuma legenda reconhecida no arquivo.")

        conteudo = subtitles.para_ass(
            blocos,
            estilo or subtitles.ESTILO_PADRAO,
            fonte=fonte,
            tamanho=tamanho,
            alinhamento=alinhamento,
            margem_v=margem_v,
            cor=cor,
            cor_contorno=cor_contorno,
            cor_fundo=cor_fundo,
        )
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(conteudo, encoding="utf-8")
        log(f"SAVED: {out}")

        return {
            "success": True,
            "outputPath": str(out),
            "durationMs": int((time.time() - start) * 1000),
            "segments": [{"start": b.start, "end": b.end, "text": b.texto} for b in blocos],
        }
    except Exception as e:
        log(f"RESTYLE_FAILED: {type(e).__name__}: {e}")
        return make_error("CONVERSION_FAILED", "Não foi possível ler a legenda.")


def transcribe(
    input_path: str | None,
    output_path: str | None,
    language: str | None,
    model_size: str,
    fmt: str,
    estilo: str | None = None,
    ritmo: str | None = None,
    fonte: str | None = None,
    tamanho: int | None = None,
    alinhamento: int | None = None,
    margem_v: int | None = None,
    karaoke: bool = False,
    cor: str | None = None,
    cor_contorno: str | None = None,
    cor_karaoke: str | None = None,
    cor_fundo: str | None = None,
) -> dict:
    """Transcreve áudio/vídeo em legenda (.srt/.vtt) com faster-whisper.

    Roda no bundle `whisper`, não no light — a lib tem ~90 MB. O modelo em si é
    baixado à parte pela própria biblioteca, no cache da HuggingFace, igual ao
    Docling faz.

    Não precisa do módulo ffmpeg: o faster-whisper decodifica o vídeo pelo PyAV,
    que traz os próprios binários. Isso deixa o módulo autossuficiente.
    """
    start = time.time()

    if not input_path:
        return make_error("INVALID_INPUT", "Nenhum arquivo informado.")
    p = Path(input_path)
    if not p.exists():
        return make_error("FILE_NOT_FOUND", "Arquivo não encontrado.")
    if not output_path:
        return make_error("OUTPUT_ERROR", "Caminho de saída não informado.")

    fmt = (fmt or "srt").lower()
    if fmt not in ("srt", "vtt", "ass"):
        return make_error("INVALID_INPUT", f"Formato de legenda desconhecido: {fmt}")

    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        log(f"MODEL_ERROR: {e}")
        return make_error("MODEL_ERROR", "Módulo de transcrição não encontrado.")

    import subtitles

    try:
        # O modelo mora no cache da HuggingFace. Na primeira vez ele é BAIXADO,
        # e isso pode levar minutos sem que exista progresso de transcrição —
        # daí avisar antes, senão a barra parada parece travamento.
        ja_em_cache = _modelo_em_cache(model_size)
        if ja_em_cache:
            log(f"STEP: Carregando modelo {model_size}")
        else:
            log(f"STEP: Baixando modelo {model_size} (só na primeira vez)")

        # int8 em CPU: 4x mais rápido que float32 e sem perda audível para
        # legenda. `get_supported_compute_types` confirmou disponibilidade.
        modelo = WhisperModel(model_size, device="cpu", compute_type="int8")

        log("STEP: Transcrevendo")
        segmentos, info = modelo.transcribe(
            str(p),
            language=language or None,
            word_timestamps=True,
            # VAD Silero, que vem dentro do faster-whisper: pula o silêncio,
            # corta tempo de processamento e evita alucinação em trecho mudo.
            vad_filter=True,
        )

        total = float(getattr(info, "duration", 0) or 0)
        palavras: list[dict] = []
        texto_cru: list[str] = []

        for seg in segmentos:
            texto_cru.append(seg.text)
            for w in seg.words or []:
                palavras.append({"start": w.start, "end": w.end, "word": w.word})
            # Progresso REAL — o gerador entrega segmento a segmento e sabemos
            # a duração total. Nada de contador falso aqui.
            if total > 0:
                log(f"PROGRESS: {min(100, int(seg.end / total * 100))}")

        if not palavras:
            return make_error("CONVERSION_FAILED", "Nenhuma fala reconhecida no arquivo.")

        log("STEP: Montando legenda")
        blocos = subtitles.segmentar_por_ritmo(palavras, ritmo or subtitles.RITMO_PADRAO)
        if fmt == "ass":
            conteudo = subtitles.para_ass(
                blocos,
                estilo or subtitles.ESTILO_PADRAO,
                fonte=fonte,
                tamanho=tamanho,
                alinhamento=alinhamento,
                margem_v=margem_v,
                karaoke=karaoke,
                cor=cor,
                cor_contorno=cor_contorno,
                cor_karaoke=cor_karaoke,
                cor_fundo=cor_fundo,
            )
        elif fmt == "vtt":
            conteudo = subtitles.para_vtt(blocos)
        else:
            conteudo = subtitles.para_srt(blocos)

        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(conteudo, encoding="utf-8")
        log(f"SAVED: {out}")

        return {
            "success": True,
            "outputPath": str(out),
            "durationMs": int((time.time() - start) * 1000),
            "language": getattr(info, "language", language or ""),
            "segments": [
                {"start": b.start, "end": b.end, "text": b.texto} for b in blocos
            ],
            "text": "".join(texto_cru).strip(),
        }

    except Exception as e:
        log(f"TRANSCRIBE_FAILED: {type(e).__name__}: {e}")
        return make_error("CONVERSION_FAILED", "Não foi possível transcrever o arquivo.")


class _StderrLogger:
    """Loga toda saída do yt-dlp no stderr, mantendo o stdout limpo (só o JSON)."""
    def debug(self, msg): log(msg)
    def info(self, msg): log(msg)
    def warning(self, msg): log(msg)
    def error(self, msg): log(msg)


def _best_thumb(obj: dict) -> str:
    thumbs = obj.get("thumbnails") or []
    if thumbs:
        return thumbs[-1].get("url", "") or ""
    return obj.get("thumbnail") or ""


def youtube_info(url: str) -> dict:
    """Busca dados p/ preview. Playlist: nome + capa + total (rápido, sem ver faixa por faixa).
    Vídeo: título, thumbnail, duração, canal, qualidades."""
    if not url:
        return make_error("INVALID_URL", "URL não informada.")
    try:
        import yt_dlp
    except ImportError as e:
        log(f"MODEL_ERROR: {e}")
        return make_error("MODEL_ERROR", "yt-dlp não encontrado.")

    try:
        # 1) Extração "flat" — barata: lista sem processar cada vídeo.
        flat_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": True,
            "logger": _StderrLogger(),
        }
        with yt_dlp.YoutubeDL(flat_opts) as ydl:
            info = ydl.extract_info(url, download=False)
        if not info:
            return make_error("UNAVAILABLE", "Conteúdo indisponível.")

        # Playlist: só nome, capa e contagem.
        if info.get("_type") == "playlist" or "entries" in info:
            entries = [e for e in (info.get("entries") or []) if e]
            count = info.get("playlist_count") or len(entries)
            thumb = _best_thumb(info)
            if not thumb and entries:
                thumb = _best_thumb(entries[0])
            return {
                "success": True,
                "isPlaylist": True,
                "title": info.get("title") or "Playlist",
                "thumbnail": thumb,
                "uploader": info.get("uploader") or info.get("channel") or "",
                "trackCount": count,
                "heights": [],
            }
    except Exception as e:
        log(f"YOUTUBE_INFO_FAILED: {type(e).__name__}: {e}")
        return make_error("UNAVAILABLE", "Não foi possível obter os dados.")

    # 2) Vídeo único: extração completa (p/ qualidades).
    try:
        full_opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "noplaylist": True,
            "logger": _StderrLogger(),
        }
        with yt_dlp.YoutubeDL(full_opts) as ydl:
            info = ydl.extract_info(url, download=False)
        if not info:
            return make_error("UNAVAILABLE", "Vídeo indisponível.")

        heights = sorted(
            {
                f["height"]
                for f in (info.get("formats") or [])
                if f.get("height") and f.get("vcodec") not in (None, "none")
            },
            reverse=True,
        )
        return {
            "success": True,
            "isPlaylist": False,
            "title": info.get("title") or "",
            "thumbnail": info.get("thumbnail") or "",
            "duration": info.get("duration") or 0,
            "uploader": info.get("uploader") or "",
            "heights": heights,
        }
    except Exception as e:
        log(f"YOUTUBE_INFO_FAILED: {type(e).__name__}: {e}")
        return make_error("UNAVAILABLE", "Não foi possível obter os dados do vídeo.")


def _emit_event(obj: dict) -> None:
    """Envia um evento estruturado pelo stderr (o Rust reencaminha p/ o frontend)."""
    log("EVENT: " + json.dumps(obj, ensure_ascii=False))


def _yt_audio_url(video_url: str, output_dir: str, ffmpeg_location: str | None, audio_kbps: int | None) -> str:
    """Baixa um único vídeo do YouTube como MP3. Retorna o caminho. Lança em erro."""
    import yt_dlp

    opts: dict = {
        "outtmpl": str(Path(output_dir) / "%(title)s.%(ext)s"),
        "format": "bestaudio/best",
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "logger": _StderrLogger(),
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": str(audio_kbps or 192),
        }],
    }
    if ffmpeg_location:
        opts["ffmpeg_location"] = ffmpeg_location

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(video_url, download=True)
        entry = info["entries"][0] if isinstance(info, dict) and "entries" in info else info
        return str(Path(ydl.prepare_filename(entry)).with_suffix(".mp3"))


def youtube_playlist(url: str, output_dir: str, ffmpeg_location: str | None, audio_kbps: int | None) -> dict:
    """Baixa uma playlist do YouTube em MP3, uma faixa por vez.

    Emite eventos por faixa (fila/baixando/pronta/pulada) e progresso do total.
    Erros em faixas individuais são pulados sem interromper as demais.
    """
    import yt_dlp

    start = time.time()

    # 1) Lista a playlist sem baixar (flat).
    try:
        flat_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": True,
            "logger": _StderrLogger(),
        }
        with yt_dlp.YoutubeDL(flat_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as e:
        log(f"PLAYLIST_LIST_FAILED: {type(e).__name__}: {e}")
        return make_error("NETWORK_ERROR", "Não foi possível ler a playlist. Verifique a URL.")

    entries = [e for e in (info.get("entries") or []) if e] if isinstance(info, dict) else []
    if not entries:
        return make_error("UNAVAILABLE", "Playlist vazia ou indisponível.")

    tracks = [
        {"i": i, "title": e.get("title") or e.get("id") or f"Faixa {i + 1}", "id": e.get("id") or e.get("url")}
        for i, e in enumerate(entries)
    ]
    total = len(tracks)
    _emit_event({"type": "tracks", "tracks": [{"i": t["i"], "title": t["title"]} for t in tracks]})

    outputs: list[str] = []
    skipped: list[dict] = []

    for t in tracks:
        _emit_event({"type": "track", "i": t["i"], "status": "downloading"})
        try:
            video_url = f"https://www.youtube.com/watch?v={t['id']}"
            path = _yt_audio_url(video_url, output_dir, ffmpeg_location, audio_kbps)
            outputs.append(path)
            _emit_event({"type": "track", "i": t["i"], "status": "done"})
        except Exception as e:  # noqa: BLE001 — pula faixa com erro, segue as outras
            log(f"PLAYLIST_TRACK_SKIP: {t['title']}: {e}")
            skipped.append({"i": t["i"], "title": t["title"]})
            _emit_event({"type": "track", "i": t["i"], "status": "skipped"})
        log(f"PROGRESS: {int((t['i'] + 1) * 100 / total)}")

    if not outputs:
        return make_error("NETWORK_ERROR", "Nenhuma faixa da playlist pôde ser baixada.")

    duration_ms = int((time.time() - start) * 1000)
    return {"success": True, "outputs": outputs, "skipped": skipped, "durationMs": duration_ms}


def youtube_download(
    url: str,
    mode: str,
    output_dir: str | None,
    ffmpeg_location: str | None,
    audio_kbps: int | None,
    max_height: int | None = None,
) -> dict:
    if mode == "playlist_audio":
        if not url:
            return make_error("INVALID_URL", "URL não informada.")
        if not output_dir:
            return make_error("OUTPUT_ERROR", "Pasta de saída não informada.")
        Path(output_dir).mkdir(parents=True, exist_ok=True)
        return youtube_playlist(url, output_dir, ffmpeg_location, audio_kbps)

    start = time.time()
    if not url:
        return make_error("INVALID_URL", "URL não informada.")
    if not output_dir:
        return make_error("OUTPUT_ERROR", "Pasta de saída não informada.")

    try:
        import yt_dlp
    except ImportError as e:
        log(f"MODEL_ERROR: {e}")
        return make_error("MODEL_ERROR", "yt-dlp não encontrado.")

    Path(output_dir).mkdir(parents=True, exist_ok=True)

    def hook(d: dict) -> None:
        status = d.get("status")
        if status == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            pct = int(done * 100 / total) if total else 0
            log(f"PROGRESS: {pct}")
        elif status == "finished":
            log("PROGRESS: 100")
            log("STEP: Pós-processando")

    is_playlist = mode == "playlist_audio"
    is_audio = mode in ("audio", "playlist_audio")

    opts: dict = {
        "outtmpl": str(Path(output_dir) / "%(title)s.%(ext)s"),
        "noplaylist": not is_playlist,
        "progress_hooks": [hook],
        "quiet": True,
        "no_warnings": True,
        "ignoreerrors": is_playlist,
        "logger": _StderrLogger(),
    }
    if ffmpeg_location:
        opts["ffmpeg_location"] = ffmpeg_location

    if is_audio:
        opts["format"] = "bestaudio/best"
        opts["postprocessors"] = [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": str(audio_kbps or 192),
        }]
    else:
        if max_height:
            opts["format"] = (
                f"bestvideo[height<={max_height}][ext=mp4]+bestaudio[ext=m4a]/"
                f"best[height<={max_height}][ext=mp4]/best[height<={max_height}]/best"
            )
        else:
            opts["format"] = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        opts["merge_output_format"] = "mp4"

    try:
        outputs: list[str] = []
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            entries = info.get("entries") if isinstance(info, dict) and "entries" in info else [info]
            for entry in entries or []:
                if not entry:
                    continue
                filename = ydl.prepare_filename(entry)
                if is_audio:
                    filename = str(Path(filename).with_suffix(".mp3"))
                outputs.append(filename)

        duration_ms = int((time.time() - start) * 1000)
        return {"success": True, "outputs": outputs, "durationMs": duration_ms}

    except Exception as e:
        msg = str(e)
        log(f"YOUTUBE_FAILED: {type(e).__name__}: {msg}")
        if "ffmpeg" in msg.lower() or "ffprobe" in msg.lower():
            return make_error("FFMPEG_MISSING", "ffmpeg necessário não foi encontrado.")
        return make_error("NETWORK_ERROR", "Não foi possível baixar. Verifique a URL e a conexão.")


def dispatch(tool: str, data: dict) -> dict:
    if tool == "pdf2md":
        input_path = data.get("inputPath", "").strip()
        output_path = data.get("outputPath", "").strip() or None
        return convert(input_path, output_path)

    if tool == "md2pdf":
        return convert_md_to_pdf(
            data.get("inputPath", "").strip() or None,
            data.get("outputPath", "").strip() or None,
            data.get("markdown", "").strip() or None,
        )

    if tool == "docx2pdf":
        return convert_docx_to_pdf(
            data.get("inputPath", "").strip() or None,
            data.get("outputPath", "").strip() or None,
        )

    if tool == "pdf_merge":
        return pdf_merge(data.get("inputs", []), data.get("outputPath", "").strip() or None)

    if tool == "pdf_split":
        return pdf_split(
            data.get("inputPath", "").strip() or None,
            data.get("outputDir", "").strip() or None,
            data.get("every", 1),
            data.get("ranges") or None,
        )

    if tool == "pdf_pages":
        return pdf_pages(
            data.get("inputPath", "").strip() or None,
            data.get("outputPath", "").strip() or None,
            data.get("pages") or None,
        )

    if tool == "depth_map":
        return depth_map(
            data.get("inputPath", "").strip() or None,
            data.get("model", "").strip() or None,
        )

    if tool == "remove_bg":
        return remove_bg(data.get("inputPath", "").strip() or None)

    if tool == "capture_site":
        return capture_site(data)

    if tool == "depth_adjust":
        return depth_adjust(
            data.get("inputPath", "").strip() or None,
            data.get("outputPath", "").strip() or None,
            bool(data.get("invert")),
            data.get("contrast", 1.0),
        )

    if tool == "subtitle_read":
        return subtitle_read(data.get("inputPath", "").strip() or None)

    if tool == "subtitle_write":
        return subtitle_write(
            data.get("segments") or None,
            data.get("outputPath", "").strip() or None,
            data.get("format", "srt").strip() or "srt",
            data.get("style", "").strip() or None,
            data.get("font", "").strip() or None,
            data.get("size") or None,
            data.get("alignment") or None,
            # Aceita 0 (legenda colada na borda): `or None` engoliria o valor.
            data.get("marginV") if data.get("marginV") is not None else None,
            bool(data.get("karaoke")),
            data.get("color", "").strip() or None,
            data.get("outlineColor", "").strip() or None,
            data.get("highlightColor", "").strip() or None,
            data.get("boxColor", "").strip() or None,
        )

    if tool == "restyle":
        return restyle(
            data.get("inputPath", "").strip() or None,
            data.get("outputPath", "").strip() or None,
            data.get("style", "").strip() or None,
            data.get("font", "").strip() or None,
            data.get("size") or None,
            data.get("alignment") or None,
            data.get("marginV") if data.get("marginV") is not None else None,
            data.get("color", "").strip() or None,
            data.get("outlineColor", "").strip() or None,
            data.get("boxColor", "").strip() or None,
        )

    if tool == "transcribe":
        return transcribe(
            data.get("inputPath", "").strip() or None,
            data.get("outputPath", "").strip() or None,
            data.get("language", "pt").strip() or None,
            data.get("model", "small").strip() or "small",
            data.get("format", "srt").strip() or "srt",
            data.get("style", "").strip() or None,
            data.get("rhythm", "").strip() or None,
            data.get("font", "").strip() or None,
            data.get("size") or None,
            data.get("alignment") or None,
            # `margem_v` aceita 0 (legenda colada na borda), então `or None`
            # engoliria um valor legítimo — só None significa "usar o preset".
            data.get("marginV") if data.get("marginV") is not None else None,
            bool(data.get("karaoke")),
            data.get("color", "").strip() or None,
            data.get("outlineColor", "").strip() or None,
            data.get("highlightColor", "").strip() or None,
            data.get("boxColor", "").strip() or None,
        )

    if tool == "pdf_compress":
        return pdf_compress(data.get("inputs", []), data.get("outputDir", "").strip() or None)

    if tool == "youtube_info":
        return youtube_info(data.get("url", "").strip())

    if tool == "youtube":
        return youtube_download(
            data.get("url", "").strip(),
            data.get("mode", "audio").strip() or "audio",
            data.get("outputDir", "").strip() or None,
            data.get("ffmpegLocation") or None,
            data.get("audioKbps"),
            data.get("maxHeight"),
        )

    return make_error("INVALID_INPUT", f"Ferramenta desconhecida: {tool}")


def main() -> None:
    # Force UTF-8 output
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="CAMPS-UTILS conversion sidecar")
    parser.add_argument("--tool", default="pdf2md", help="Tool to run (pdf2md, md2pdf, …)")
    parser.add_argument("--input", required=False, help="JSON string with the tool's input")
    args = parser.parse_args()

    if args.input:
        raw = args.input
    else:
        raw = sys.stdin.read().strip()

    if not raw:
        result = make_error("INVALID_INPUT", "Nenhum dado de entrada recebido.")
        print(json.dumps(result, ensure_ascii=False), flush=True)
        sys.exit(1)

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        log(f"INVALID_INPUT: JSON parse error: {e}")
        result = make_error("INVALID_INPUT", "Dados de entrada inválidos.")
        print(json.dumps(result, ensure_ascii=False), flush=True)
        sys.exit(1)

    result = dispatch(args.tool, data)
    print(json.dumps(result, ensure_ascii=False), flush=True)

    sys.exit(0 if result.get("success") else 1)


if __name__ == "__main__":
    main()
