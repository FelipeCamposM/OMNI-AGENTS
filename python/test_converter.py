"""Tests for converter.py — tests our integration logic, not Docling internals."""

import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add python dir to path so we can import converter
sys.path.insert(0, str(Path(__file__).parent))

import re

from converter import (
    MD_EXTENSIONS,
    convert,
    convert_docx_to_pdf,
    convert_md_to_pdf,
    dispatch,
    make_error,
    make_success,
    pdf_compress,
    pdf_merge,
    pdf_pages,
    pdf_split,
    validate_input,
)


def _make_pdf(path, pages=1):
    import fitz
    doc = fitz.open()
    for _ in range(pages):
        doc.new_page()
    doc.save(str(path))
    doc.close()


class TestValidateInput:
    def test_empty_input_path(self):
        err = validate_input("", None)
        assert err is not None
        assert err["errorCode"] == "INVALID_INPUT"

    def test_nonexistent_file(self):
        err = validate_input("C:\\nao\\existe\\arquivo.pdf", None)
        assert err is not None
        assert err["errorCode"] == "FILE_NOT_FOUND"

    def test_invalid_extension(self, tmp_path):
        txt_file = tmp_path / "documento.txt"
        txt_file.write_text("conteudo")
        err = validate_input(str(txt_file), None)
        assert err is not None
        assert err["errorCode"] == "INVALID_EXTENSION"

    def test_valid_pdf_no_output(self, tmp_path):
        pdf = tmp_path / "doc.pdf"
        pdf.write_bytes(b"%PDF-1.4 test")
        err = validate_input(str(pdf), None)
        assert err is None

    def test_output_dir_created(self, tmp_path):
        pdf = tmp_path / "doc.pdf"
        pdf.write_bytes(b"%PDF-1.4 test")
        out_dir = tmp_path / "subdir" / "nested"
        out_path = out_dir / "doc.md"
        err = validate_input(str(pdf), str(out_path))
        assert err is None
        assert out_dir.exists()

    def test_special_chars_in_filename(self, tmp_path):
        pdf = tmp_path / "relatório_2024 (v2).pdf"
        pdf.write_bytes(b"%PDF-1.4 test")
        err = validate_input(str(pdf), None)
        assert err is None


class TestConvert:
    def test_file_not_found_returns_error_json(self):
        result = convert("C:\\nao\\existe\\arquivo.pdf", None)
        assert result["success"] is False
        assert result["errorCode"] == "FILE_NOT_FOUND"
        assert "message" in result

    def test_invalid_extension_returns_error_json(self, tmp_path):
        txt = tmp_path / "doc.txt"
        txt.write_text("texto")
        result = convert(str(txt), None)
        assert result["success"] is False
        assert result["errorCode"] == "INVALID_EXTENSION"

    def test_invalid_output_path(self, tmp_path):
        pdf = tmp_path / "doc.pdf"
        pdf.write_bytes(b"%PDF-1.4 test")
        # Pass a path to a location where we can't write (root of a non-writable path)
        # We mock the mkdir to raise OSError
        with patch("converter.Path.mkdir", side_effect=OSError("permission denied")):
            result = convert(str(pdf), "C:\\Windows\\System32\\cantwrite\\doc.md")
        assert result["success"] is False
        assert result["errorCode"] in ("OUTPUT_ERROR", "FILE_NOT_FOUND", "INVALID_INPUT")

    def test_successful_conversion(self, tmp_path):
        pdf = tmp_path / "doc.pdf"
        pdf.write_bytes(b"%PDF-1.4 test")
        output = tmp_path / "doc.md"

        mock_result = MagicMock()
        mock_result.document.export_to_markdown.return_value = "# Título\n\nConteúdo convertido."

        mock_converter_instance = MagicMock()
        mock_converter_instance.convert.return_value = mock_result

        with patch("docling.document_converter.DocumentConverter", return_value=mock_converter_instance):
            result = convert(str(pdf), str(output))

        assert result["success"] is True
        assert "markdown" in result
        assert result["markdown"] == "# Título\n\nConteúdo convertido."
        assert "durationMs" in result
        assert isinstance(result["durationMs"], int)
        assert output.read_text(encoding="utf-8") == "# Título\n\nConteúdo convertido."

    def test_conversion_without_output_path(self, tmp_path):
        pdf = tmp_path / "doc.pdf"
        pdf.write_bytes(b"%PDF-1.4 test")

        mock_result = MagicMock()
        mock_result.document.export_to_markdown.return_value = "# Sem salvar"

        mock_converter_instance = MagicMock()
        mock_converter_instance.convert.return_value = mock_result

        with patch("docling.document_converter.DocumentConverter", return_value=mock_converter_instance):
            result = convert(str(pdf), None)

        assert result["success"] is True
        assert result["markdown"] == "# Sem salvar"
        assert result["outputPath"] == ""

    def test_docling_exception_returns_conversion_failed(self, tmp_path):
        pdf = tmp_path / "doc.pdf"
        pdf.write_bytes(b"%PDF-1.4 test")

        mock_converter_instance = MagicMock()
        mock_converter_instance.convert.side_effect = RuntimeError("Docling internal error")

        with patch("docling.document_converter.DocumentConverter", return_value=mock_converter_instance):
            result = convert(str(pdf), None)

        assert result["success"] is False
        assert result["errorCode"] == "CONVERSION_FAILED"

    def test_special_chars_filename(self, tmp_path):
        pdf = tmp_path / "relatório_2024 (versão 2).pdf"
        pdf.write_bytes(b"%PDF-1.4 test")

        mock_result = MagicMock()
        mock_result.document.export_to_markdown.return_value = "# Relatório"

        mock_converter_instance = MagicMock()
        mock_converter_instance.convert.return_value = mock_result

        with patch("docling.document_converter.DocumentConverter", return_value=mock_converter_instance):
            result = convert(str(pdf), None)

        assert result["success"] is True


class TestDispatch:
    def test_unknown_tool(self):
        result = dispatch("inexistente", {})
        assert result["success"] is False
        assert result["errorCode"] == "INVALID_INPUT"

    def test_pdf2md_routes_to_convert(self):
        # inputPath vazio → mesma validação de convert()
        result = dispatch("pdf2md", {"inputPath": "", "outputPath": ""})
        assert result["success"] is False
        assert result["errorCode"] == "INVALID_INPUT"


class TestMdToPdf:
    def test_missing_output_path(self):
        result = convert_md_to_pdf(None, None, "# Olá")
        assert result["success"] is False
        assert result["errorCode"] in ("OUTPUT_ERROR", "INVALID_INPUT")

    def test_no_markdown_source(self, tmp_path):
        result = convert_md_to_pdf(None, str(tmp_path / "out.pdf"), None)
        assert result["success"] is False
        assert result["errorCode"] == "INVALID_INPUT"

    def test_generates_pdf_from_text(self, tmp_path):
        out = tmp_path / "out.pdf"
        result = convert_md_to_pdf(None, str(out), "# Título\n\nTexto **negrito**.")
        assert result["success"] is True, result
        assert out.exists()
        assert out.read_bytes()[:5] == b"%PDF-"

    def test_generates_pdf_from_file(self, tmp_path):
        src = tmp_path / "doc.md"
        src.write_text("# Do arquivo", encoding="utf-8")
        out = tmp_path / "out.pdf"
        result = convert_md_to_pdf(str(src), str(out), None)
        assert result["success"] is True, result
        assert out.exists()


class TestMarkdownTabelas:
    """A tabela virando 'uma coluna só' foi o bug relatado — trava aqui."""

    def test_tabela_colada_no_paragrafo_vira_tabela(self):
        from converter import _normalize_markdown
        import markdown as md

        # GFM/MPE aceitam sem linha em branco; o Python-Markdown cru não.
        origem = "Segue a tabela:\n| A | B |\n|---|---|\n| 1 | 2 |\n"
        assert "<table>" not in md.markdown(origem, extensions=MD_EXTENSIONS)
        assert "<table>" in md.markdown(
            _normalize_markdown(origem), extensions=MD_EXTENSIONS
        )

    def test_normalize_nao_mexe_em_tabela_ja_separada(self):
        from converter import _normalize_markdown

        origem = "Texto.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n"
        assert _normalize_markdown(origem) == origem

    def test_colunas_recebem_largura_proporcional(self):
        from converter import _size_table_columns

        html = (
            "<table><thead><tr><th>Id</th><th>Descricao bem mais longa que o resto</th>"
            "</tr></thead><tbody><tr><td>1</td>"
            "<td>Texto longo tambem aqui para pesar a coluna</td></tr></tbody></table>"
        )
        saida = _size_table_columns(html)
        larguras = [float(x) for x in re.findall(r'width="([\d.]+)%"', saida)]
        assert len(larguras) == 2
        # A coluna de descrição tem que ficar visivelmente maior que a de id.
        assert larguras[1] > larguras[0] * 2
        assert abs(sum(larguras) - 100.0) < 0.5

    def test_thead_repete_entre_paginas(self):
        from converter import _size_table_columns

        saida = _size_table_columns("<table><thead><tr><th>A</th></tr></thead></table>")
        assert '<thead repeat="1">' in saida

    def test_checkbox_vira_texto_ascii(self):
        from converter import _size_table_columns

        saida = _size_table_columns(
            '<li><input type="checkbox" disabled checked /> feito</li>'
            '<li><input type="checkbox" disabled /> pendente</li>'
        )
        # ☑/☐ não existem nas fontes base do PDF — viram quadrado preto.
        assert "☑" not in saida and "☐" not in saida
        assert "[x]" in saida
        assert "<input" not in saida

    def test_pdf_com_tabela_sai_valido(self, tmp_path):
        out = tmp_path / "tabela.pdf"
        origem = (
            "# T\n\nIntro:\n| Modulo | Descricao longa do modulo | MB |\n"
            "|---|---|---:|\n| a | texto | 1 |\n"
        )
        r = convert_md_to_pdf(None, str(out), origem)
        assert r["success"] is True, r
        assert out.read_bytes()[:5] == b"%PDF-"


def _make_docx(path):
    """
    DOCX mínimo escrito à mão — evita depender de python-docx só para gerar
    fixture. É um zip OOXML com o mínimo que o mammoth precisa ler.
    """
    import zipfile

    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        "</Types>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        "</Relationships>"
    )
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body>"
        '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Relatório</w:t></w:r></w:p>'
        "<w:p><w:r><w:t>Parágrafo com acentuação: ação, coração.</w:t></w:r></w:p>"
        "</w:body></w:document>"
    )

    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", document)


class TestDocxToPdf:
    def test_missing_input(self, tmp_path):
        result = convert_docx_to_pdf(None, str(tmp_path / "out.pdf"))
        assert result["success"] is False
        assert result["errorCode"] == "INVALID_INPUT"

    def test_file_not_found(self, tmp_path):
        result = convert_docx_to_pdf(str(tmp_path / "sumiu.docx"), str(tmp_path / "out.pdf"))
        assert result["success"] is False
        assert result["errorCode"] == "FILE_NOT_FOUND"

    def test_rejects_legacy_doc(self, tmp_path):
        # .doc é binário pré-2007, não OOXML — o mammoth não lê.
        legado = tmp_path / "antigo.doc"
        legado.write_bytes(b"\xd0\xcf\x11\xe0")
        result = convert_docx_to_pdf(str(legado), str(tmp_path / "out.pdf"))
        assert result["success"] is False
        assert result["errorCode"] == "UNSUPPORTED_FORMAT"

    def test_missing_output_path(self, tmp_path):
        docx = tmp_path / "doc.docx"
        _make_docx(docx)
        result = convert_docx_to_pdf(str(docx), None)
        assert result["success"] is False
        assert result["errorCode"] == "OUTPUT_ERROR"

    def test_generates_pdf(self, tmp_path):
        docx = tmp_path / "doc.docx"
        _make_docx(docx)
        out = tmp_path / "sub" / "out.pdf"
        result = convert_docx_to_pdf(str(docx), str(out))
        assert result["success"] is True, result
        assert out.exists()
        assert out.read_bytes()[:5] == b"%PDF-"

    def test_dispatch_routes_docx2pdf(self, tmp_path):
        docx = tmp_path / "doc.docx"
        _make_docx(docx)
        out = tmp_path / "out.pdf"
        result = dispatch("docx2pdf", {"inputPath": str(docx), "outputPath": str(out)})
        assert result["success"] is True, result
        assert out.exists()


class TestPdfMerge:
    def test_needs_two(self, tmp_path):
        pdf = tmp_path / "a.pdf"
        _make_pdf(pdf)
        result = pdf_merge([str(pdf)], str(tmp_path / "out.pdf"))
        assert result["success"] is False
        assert result["errorCode"] == "INVALID_INPUT"

    def test_merges(self, tmp_path):
        a, b = tmp_path / "a.pdf", tmp_path / "b.pdf"
        _make_pdf(a, 2)
        _make_pdf(b, 3)
        out = tmp_path / "merged.pdf"
        result = pdf_merge([str(a), str(b)], str(out))
        assert result["success"] is True, result
        import fitz
        with fitz.open(str(out)) as d:
            assert d.page_count == 5


class TestPdfSplit:
    def test_splits_every_page(self, tmp_path):
        src = tmp_path / "doc.pdf"
        _make_pdf(src, 3)
        out_dir = tmp_path / "parts"
        result = pdf_split(str(src), str(out_dir), 1)
        assert result["success"] is True, result
        assert len(result["outputs"]) == 3

    def test_splits_in_blocks(self, tmp_path):
        src = tmp_path / "doc.pdf"
        _make_pdf(src, 5)
        out_dir = tmp_path / "parts"
        result = pdf_split(str(src), str(out_dir), 2)
        assert result["success"] is True
        assert len(result["outputs"]) == 3  # 2+2+1

    def test_ranges_win_over_every(self, tmp_path):
        import fitz

        src = tmp_path / "doc.pdf"
        _make_pdf(src, 10)
        out_dir = tmp_path / "parts"
        # every=2 geraria 5 arquivos; ranges manda e gera 2.
        result = pdf_split(str(src), str(out_dir), 2, [[1, 3], [8, 10]])
        assert result["success"] is True, result
        assert len(result["outputs"]) == 2
        with fitz.open(result["outputs"][0]) as d:
            assert d.page_count == 3
        assert Path(result["outputs"][1]).name == "doc_8-10.pdf"

    def test_ranges_may_overlap(self, tmp_path):
        src = tmp_path / "doc.pdf"
        _make_pdf(src, 6)
        result = pdf_split(str(src), str(tmp_path / "p"), 1, [[1, 4], [3, 6]])
        assert result["success"] is True, result
        assert len(result["outputs"]) == 2

    def test_ranges_inverted_are_normalized(self, tmp_path):
        src = tmp_path / "doc.pdf"
        _make_pdf(src, 5)
        result = pdf_split(str(src), str(tmp_path / "p"), 1, [[4, 2]])
        assert result["success"] is True, result
        assert Path(result["outputs"][0]).name == "doc_2-4.pdf"

    def test_range_out_of_bounds(self, tmp_path):
        src = tmp_path / "doc.pdf"
        _make_pdf(src, 3)
        result = pdf_split(str(src), str(tmp_path / "p"), 1, [[1, 9]])
        assert result["success"] is False
        assert result["errorCode"] == "INVALID_INPUT"

    def test_malformed_range(self, tmp_path):
        src = tmp_path / "doc.pdf"
        _make_pdf(src, 3)
        result = pdf_split(str(src), str(tmp_path / "p"), 1, [[1]])
        assert result["success"] is False
        assert result["errorCode"] == "INVALID_INPUT"


class TestPdfPages:
    def test_keeps_given_order(self, tmp_path):
        import fitz

        src = tmp_path / "doc.pdf"
        _make_pdf(src, 5)
        out = tmp_path / "sel.pdf"
        result = pdf_pages(str(src), str(out), [4, 1, 4])
        assert result["success"] is True, result
        assert result["pageCount"] == 3
        with fitz.open(str(out)) as d:
            assert d.page_count == 3

    def test_empty_selection(self, tmp_path):
        src = tmp_path / "doc.pdf"
        _make_pdf(src, 3)
        result = pdf_pages(str(src), str(tmp_path / "out.pdf"), [])
        assert result["success"] is False
        assert result["errorCode"] == "INVALID_INPUT"

    def test_page_out_of_bounds(self, tmp_path):
        src = tmp_path / "doc.pdf"
        _make_pdf(src, 2)
        result = pdf_pages(str(src), str(tmp_path / "out.pdf"), [1, 7])
        assert result["success"] is False
        assert result["errorCode"] == "INVALID_INPUT"
        assert "7" in result["message"]

    def test_non_numeric_page(self, tmp_path):
        src = tmp_path / "doc.pdf"
        _make_pdf(src, 2)
        result = pdf_pages(str(src), str(tmp_path / "out.pdf"), ["a"])
        assert result["success"] is False
        assert result["errorCode"] == "INVALID_INPUT"

    def test_creates_missing_output_dir(self, tmp_path):
        src = tmp_path / "doc.pdf"
        _make_pdf(src, 2)
        out = tmp_path / "nova" / "sel.pdf"
        result = pdf_pages(str(src), str(out), [2])
        assert result["success"] is True, result
        assert out.exists()


class TestPdfCompress:
    def test_compress_produces_output(self, tmp_path):
        src = tmp_path / "doc.pdf"
        _make_pdf(src, 2)
        out_dir = tmp_path / "out"
        result = pdf_compress([str(src)], str(out_dir))
        assert result["success"] is True, result
        assert len(result["outputs"]) == 1
        assert Path(result["outputs"][0]).exists()


class TestJsonOutput:
    def test_make_error_structure(self):
        err = make_error("FILE_NOT_FOUND", "Arquivo não encontrado.")
        assert err == {
            "success": False,
            "errorCode": "FILE_NOT_FOUND",
            "message": "Arquivo não encontrado.",
        }

    def test_make_success_structure(self):
        ok = make_success("/path/doc.md", "# Título", 1500)
        assert ok == {
            "success": True,
            "outputPath": "/path/doc.md",
            "markdown": "# Título",
            "durationMs": 1500,
        }

    def test_result_is_json_serializable(self, tmp_path):
        pdf = tmp_path / "doc.pdf"
        pdf.write_bytes(b"%PDF-1.4 test")
        result = convert("nao_existe.pdf", None)
        # Must serialize without error
        serialized = json.dumps(result, ensure_ascii=False)
        parsed = json.loads(serialized)
        assert parsed["success"] is False


# ─── Mapa de profundidade ────────────────────────────────────────────────────
def _png(path: Path, size=(40, 30), alpha=False, cor=90):
    from PIL import Image

    if alpha:
        img = Image.new("RGBA", size, (cor, cor, cor, 0))
        # Quadrado opaco no meio; o resto é fundo transparente.
        img.paste((200, 180, 160, 255), (size[0] // 4, size[1] // 4, size[0] // 2, size[1] // 2))
    else:
        img = Image.new("RGB", size, (cor, cor, cor))
    img.save(path)
    return path


class TestDepthTamanhoInferencia:
    """Réplica do `keep_aspect_ratio`/`ensure_multiple_of` do DPT.

    Errar aqui não quebra nada visivelmente: o mapa continua saindo, só que com
    qualidade pior. Por isso a checagem é numérica.
    """

    def test_multiplo_de_14(self):
        import depth

        for w, h in [(900, 600), (1600, 700), (700, 1600), (97, 131), (3840, 2160)]:
            nw, nh = depth.tamanho_inferencia(w, h)
            assert nw % 14 == 0 and nh % 14 == 0, (w, h, nw, nh)

    def test_aspecto_comum_mantem_518_no_lado_menor(self):
        """O modelo foi treinado com 518 no lado menor; qualquer teto que corte
        isso num 16:7 troca detalhe por tempo sem ninguém pedir."""
        import depth

        for w, h in [(900, 600), (1600, 700), (700, 1600), (3840, 2160)]:
            nw, nh = depth.tamanho_inferencia(w, h)
            assert min(nw, nh) == 518, (w, h, nw, nh)

    def test_panorama_nao_estoura_o_teto(self):
        import depth

        nw, nh = depth.tamanho_inferencia(10000, 500)
        assert max(nw, nh) <= depth.MAX_LADO

    def test_dimensao_zero_e_erro(self):
        import depth

        with pytest.raises(ValueError):
            depth.tamanho_inferencia(0, 100)


class TestDepthPosprocessar:
    def test_normalizacao_ignora_o_transparente(self):
        """O fundo neutro tem profundidade própria; deixá-lo entrar na conta
        achata a faixa que sobra para o objeto."""
        import numpy as np
        from PIL import Image

        import depth

        bruto = np.zeros((4, 4), dtype=np.float32)
        bruto[1:3, 1:3] = [[1.0, 2.0], [3.0, 4.0]]
        bruto[0, 0] = 100.0  # fundo distante — sozinho já esmagaria a escala

        alfa = Image.new("L", (4, 4), 0)
        alfa.paste(255, (1, 1, 3, 3))

        mapa = depth.posprocessar(bruto, (4, 4), alfa)
        assert mapa.mode == "LA"
        canal = np.asarray(mapa.getchannel("L"), dtype=np.int32)
        # 1..4 esticado sobre 0..255: o objeto usa a faixa inteira.
        assert canal[1, 1] == 0 and canal[2, 2] == 255

    def test_sem_alfa_devolve_L_no_tamanho_pedido(self):
        import numpy as np

        import depth

        bruto = np.arange(9, dtype=np.float32).reshape(3, 3)
        mapa = depth.posprocessar(bruto, (12, 8), None)
        assert mapa.mode == "L" and mapa.size == (12, 8)

    def test_profundidade_constante_nao_vira_nan(self):
        import numpy as np

        import depth

        mapa = depth.posprocessar(np.full((4, 4), 7.0, dtype=np.float32), (4, 4), None)
        assert set(np.asarray(mapa).ravel()) == {0}


class TestDepthAbrirEntrada:
    def test_alfa_separado_e_fundo_neutro(self, tmp_path):
        import numpy as np

        import depth

        rgb, alfa = depth.abrir_entrada(str(_png(tmp_path / "a.png", alpha=True)))
        assert rgb.mode == "RGB" and alfa is not None
        # Onde era transparente o modelo recebe cinza médio, não preto nem
        # branco: um extremo criaria borda falsa em volta do objeto.
        assert tuple(np.asarray(rgb)[0, 0]) == (128, 128, 128)

    def test_sem_alfa_devolve_none(self, tmp_path):
        import depth

        rgb, alfa = depth.abrir_entrada(str(_png(tmp_path / "b.jpg")))
        assert alfa is None and rgb.mode == "RGB"

    def test_imagem_gigante_e_reduzida(self, tmp_path, monkeypatch):
        import depth

        monkeypatch.setattr(depth, "MAX_SAIDA", 32)
        rgb, _ = depth.abrir_entrada(str(_png(tmp_path / "c.png", size=(200, 100))))
        assert max(rgb.size) == 32


class TestDepthAjuste:
    """A prévia na interface é `filter: invert() contrast()` do CSS; o arquivo
    salvo tem que sair idêntico ao que foi visto."""

    def test_lut_neutra_e_identidade(self):
        from converter import _lut_ajuste

        assert _lut_ajuste(False, 1.0) == list(range(256))

    def test_lut_inverte(self):
        from converter import _lut_ajuste

        lut = _lut_ajuste(True, 1.0)
        assert lut[0] == 255 and lut[255] == 0

    def test_lut_contraste_usa_a_formula_do_css(self):
        from converter import _lut_ajuste

        lut = _lut_ajuste(False, 2.0)
        # (v/255 - 0,5)*2 + 0,5 — o meio não se move e as pontas saturam.
        assert lut[128] == round(((128 / 255 - 0.5) * 2 + 0.5) * 255)
        assert lut[0] == 0 and lut[255] == 255
        assert lut[64] == 0  # satura antes do fim: é isso que contraste faz

    def test_fundo_transparente_fica_preto_mesmo_invertido(self):
        import numpy as np
        from PIL import Image

        from converter import ajustar_cinza

        cinza = Image.new("L", (4, 4), 200)
        alfa = Image.new("L", (4, 4), 0)
        alfa.paste(255, (1, 1, 3, 3))
        saida = ajustar_cinza(Image.merge("LA", (cinza, alfa)), True, 1.0)

        arr = np.asarray(saida)
        assert saida.mode == "L"
        assert arr[0, 0] == 0, "fundo transparente tem que ficar preto"
        assert arr[1, 1] == 255 - 200

    def test_depth_adjust_grava_png(self, tmp_path):
        from converter import depth_adjust

        origem = _png(tmp_path / "mapa.png", alpha=True)
        destino = tmp_path / "saida.png"
        r = depth_adjust(str(origem), str(destino), False, 1.0)
        assert r["success"] is True, r
        assert destino.exists()

    def test_depth_adjust_prende_o_contraste(self, tmp_path):
        from PIL import Image

        from converter import depth_adjust

        origem = _png(tmp_path / "mapa.png")
        destino = tmp_path / "saida.png"
        # Valor absurdo não pode estourar; é preso na faixa antes de virar LUT.
        assert depth_adjust(str(origem), str(destino), False, 9999)["success"] is True
        assert Image.open(destino).mode == "L"

    def test_depth_adjust_sem_origem(self, tmp_path):
        from converter import depth_adjust

        r = depth_adjust(str(tmp_path / "nao_existe.png"), str(tmp_path / "o.png"))
        assert r["success"] is False and r["errorCode"] == "FILE_NOT_FOUND"


class TestDepthMapEntrada:
    """Validação antes de carregar o runtime de inferência — o caminho barato
    tem que reprovar sozinho."""

    def test_sem_caminho(self):
        from converter import depth_map

        assert depth_map(None)["errorCode"] == "INVALID_INPUT"

    def test_arquivo_inexistente(self, tmp_path):
        from converter import depth_map

        assert depth_map(str(tmp_path / "x.png"))["errorCode"] == "FILE_NOT_FOUND"

    def test_extensao_nao_suportada(self, tmp_path):
        from converter import depth_map

        alvo = tmp_path / "x.bmp"
        alvo.write_bytes(b"BM")
        assert depth_map(str(alvo))["errorCode"] == "INVALID_EXTENSION"

    def test_modelo_desconhecido(self, tmp_path):
        from converter import depth_map

        r = depth_map(str(_png(tmp_path / "x.png")), "gigante")
        assert r["errorCode"] == "INVALID_INPUT"


class TestRemoveBgEntrada:
    """Validação antes de importar o rembg — e aqui o caminho barato importa
    mais que nos outros módulos: só o `import rembg` leva ~14 s (medido)."""

    def test_sem_caminho(self):
        from converter import remove_bg

        assert remove_bg(None)["errorCode"] == "INVALID_INPUT"

    def test_arquivo_inexistente(self, tmp_path):
        from converter import remove_bg

        assert remove_bg(str(tmp_path / "x.png"))["errorCode"] == "FILE_NOT_FOUND"

    def test_extensao_nao_suportada(self, tmp_path):
        from converter import remove_bg

        alvo = tmp_path / "x.bmp"
        alvo.write_bytes(b"BM")
        assert remove_bg(str(alvo))["errorCode"] == "INVALID_EXTENSION"

    def test_dispatch_encaminha_remove_bg(self, tmp_path):
        r = dispatch("remove_bg", {"inputPath": str(tmp_path / "nada.png")})
        assert r["errorCode"] == "FILE_NOT_FOUND"


class TestRemoveBgSaida:
    """Contrato do resultado, com a segmentação trocada por um dublê.

    O modelo de verdade custa ~170 MB de download e segundos por imagem; o que
    esta suíte precisa provar é o que fica em volta dele — que o PNG sai com
    alfa, no caminho combinado, e que o erro do módulo vira mensagem em pt-BR.
    """

    def test_grava_png_com_alfa_e_devolve_medidas(self, tmp_path, monkeypatch):
        from PIL import Image

        import bgremove
        from converter import remove_bg

        recorte = Image.new("RGBA", (7, 5), (10, 20, 30, 0))
        recorte.putpixel((3, 2), (200, 60, 50, 255))
        monkeypatch.setattr(
            bgremove, "remover_fundo",
            lambda caminho, *a, **k: (recorte, "CPUExecutionProvider"),
        )

        r = remove_bg(str(_png(tmp_path / "entrada.png")))
        assert r["success"] is True, r
        assert (r["width"], r["height"]) == (7, 5)
        assert r["provider"] == "CPUExecutionProvider"

        salvo = Image.open(r["outputPath"])
        assert salvo.mode == "RGBA", "sem canal alfa o recorte não serve para nada"
        assert salvo.getpixel((0, 0))[3] == 0 and salvo.getpixel((3, 2))[3] == 255

    def test_falha_de_download_vira_mensagem_de_modelo(self, tmp_path, monkeypatch):
        """Sem separar isto, queda de rede no primeiro uso apareceria como
        'arquivo corrompido' — e o usuário iria procurar defeito na imagem."""
        import bgremove
        from converter import remove_bg

        def explode(*a, **k):
            raise OSError("connection reset")

        monkeypatch.setattr(bgremove, "remover_fundo", explode)
        monkeypatch.setattr(bgremove, "modelo_em_cache", lambda *a, **k: False)

        r = remove_bg(str(_png(tmp_path / "entrada.png")))
        assert r["errorCode"] == "MODEL_ERROR"
        assert "conexão" in r["message"]

    def test_com_modelo_em_cache_a_mesma_falha_e_de_leitura(self, tmp_path, monkeypatch):
        import bgremove
        from converter import remove_bg

        def explode(*a, **k):
            raise OSError("truncated file")

        monkeypatch.setattr(bgremove, "remover_fundo", explode)
        monkeypatch.setattr(bgremove, "modelo_em_cache", lambda *a, **k: True)

        r = remove_bg(str(_png(tmp_path / "entrada.png")))
        assert r["errorCode"] == "INVALID_INPUT"


class TestBgRemoveCache:
    def test_pesos_vao_para_o_cache_do_app(self, monkeypatch):
        """O rembg usaria `~/.u2net`. Espalhar peso de modelo por pastas
        escondidas é justamente o que o roadmap proíbe."""
        import bgremove

        monkeypatch.delenv("U2NET_HOME", raising=False)
        bgremove._preparar_ambiente()
        assert os.environ["U2NET_HOME"] == str(bgremove.dir_modelos())
        assert bgremove.dir_modelos().name == "models"
        assert "camps-utils" in str(bgremove.dir_modelos())

    def test_caminho_do_modelo_padrao(self):
        import bgremove

        assert bgremove.caminho_modelo().name == "u2net.onnx"


class TestDepthDispatch:
    def test_dispatch_encaminha_depth_map(self, tmp_path):
        r = dispatch("depth_map", {"inputPath": str(tmp_path / "nada.png")})
        assert r["errorCode"] == "FILE_NOT_FOUND"

    def test_dispatch_encaminha_depth_adjust(self, tmp_path):
        r = dispatch(
            "depth_adjust",
            {
                "inputPath": str(_png(tmp_path / "m.png")),
                "outputPath": str(tmp_path / "o.png"),
                "invert": True,
                "contrast": 1.5,
            },
        )
        assert r["success"] is True, r


class TestCaptureSiteEntrada:
    """Validação de URL é barata e roda ANTES de importar o Playwright — não
    pode disparar o import só porque o usuário digitou algo errado."""

    def test_url_vazia(self):
        from converter import capture_site

        assert capture_site({"url": ""})["errorCode"] == "INVALID_INPUT"

    def test_url_sem_url(self):
        from converter import capture_site

        assert capture_site({})["errorCode"] == "INVALID_INPUT"

    def test_scheme_nao_suportado(self):
        from converter import capture_site

        r = capture_site({"url": "ftp://exemplo.com/arquivo"})
        assert r["errorCode"] == "INVALID_INPUT"

    def test_sem_host(self):
        from converter import capture_site

        assert capture_site({"url": "http://"})["errorCode"] == "INVALID_INPUT"

    def test_nao_importa_webcapture_no_caminho_barato(self):
        """`webcapture` puxa o Playwright; a validação de URL tem de barrar
        antes disso, então o módulo não pode aparecer em `sys.modules`."""
        from converter import capture_site

        sys.modules.pop("webcapture", None)
        capture_site({"url": "não é uma url"})
        assert "webcapture" not in sys.modules

    def test_dispatch_encaminha_capture_site(self):
        r = dispatch("capture_site", {"url": "não é uma url"})
        assert r["errorCode"] == "INVALID_INPUT"


class TestCaptureSiteSaida:
    """Contrato do resultado, com o crawl trocado por um dublê.

    `capturar_site` é `async def`; o dublê precisa ser awaitable também.
    """

    def test_monta_json_de_sucesso(self, monkeypatch, tmp_path):
        import webcapture
        from converter import capture_site

        resultado_fake = {
            "encontradas": 3,
            "processadas": 3,
            "falharam": 1,
            "arquivos": {"markdown": 2, "html": 3, "screenshots": 2},
            "paginas": [
                {"url": "http://exemplo.com/", "status": "ok", "mdPath": "a.md", "htmlPath": "a.html", "screenshotPath": "a.png", "error": None},
                {"url": "http://exemplo.com/sobre", "status": "ok", "mdPath": "b.md", "htmlPath": "b.html", "screenshotPath": "b.png", "error": None},
                {"url": "http://exemplo.com/quebrada", "status": "erro", "mdPath": None, "htmlPath": None, "screenshotPath": None, "error": "timeout"},
            ],
        }

        async def fake_capturar_site(**kwargs):
            assert kwargs["url"] == "http://exemplo.com"
            assert kwargs["escopo"] == "dominio"
            assert kwargs["concorrencia"] == 5
            return resultado_fake

        monkeypatch.setattr(webcapture, "capturar_site", fake_capturar_site)

        r = capture_site({"url": "http://exemplo.com", "escopo": "dominio"})
        assert r["success"] is True, r
        assert r["outputDir"]
        assert isinstance(r["durationMs"], int)
        assert r["encontradas"] == 3
        assert r["processadas"] == 3
        assert r["falharam"] == 1
        assert r["arquivos"] == {"markdown": 2, "html": 3, "screenshots": 2}
        assert len(r["paginas"]) == 3

    def test_opcoes_default_todas_ligadas(self, monkeypatch):
        import webcapture
        from converter import capture_site

        capturadas = {}

        async def fake_capturar_site(**kwargs):
            capturadas.update(kwargs)
            return {"encontradas": 0, "processadas": 0, "falharam": 0, "arquivos": {}, "paginas": []}

        monkeypatch.setattr(webcapture, "capturar_site", fake_capturar_site)

        capture_site({"url": "http://exemplo.com"})
        assert capturadas["opcoes"] == {
            "texto": True,
            "markdown": True,
            "html": True,
            "links": True,
            "screenshot": True,
            "metadados": True,
            "explorarTabsAccordions": True,
            "scrollAutomatico": True,
        }
        assert capturadas["escopo"] == "pagina"

    def test_excecao_no_crawl_vira_conversion_failed(self, monkeypatch):
        import webcapture
        from converter import capture_site

        async def fake_capturar_site(**kwargs):
            raise RuntimeError("Edge não encontrado")

        monkeypatch.setattr(webcapture, "capturar_site", fake_capturar_site)

        r = capture_site({"url": "http://exemplo.com"})
        assert r["errorCode"] == "CONVERSION_FAILED"
