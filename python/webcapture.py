"""Captura de site (crawl) via Playwright dirigindo o Edge do Windows.

Lógica pura e testável: entra estrutura (URL, escopo, opções), sai estrutura
(contadores + lista de páginas). Não conhece o protocolo stdout/stderr do
sidecar — quem fala com o processo é `converter.py::capture_site`, através dos
callbacks `passo`/`pagina_evento`.

Roda no bundle `msedge` do sistema (`channel="msedge"`), sem baixar Chromium:
medido em ~46 MB de bundle contra centenas de MB do `playwright install`.
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import urljoin, urlparse, urlunparse

from bs4 import BeautifulSoup
from markdownify import markdownify
from playwright.async_api import async_playwright

OPCOES_PADRAO = {
    "texto": True,
    "markdown": True,
    "html": True,
    "links": True,
    "screenshot": True,
    "metadados": True,
    "explorarTabsAccordions": True,
    "scrollAutomatico": True,
}

MAX_SCROLL_ITERACOES = 20
MAX_CLIQUES_EXPLORACAO = 30
TIMEOUT_NAVEGACAO_MS = 30000


# ─── Funções puras auxiliares ───────────────────────────────────────────────


def normalizar_url(url: str) -> str:
    """Chave de dedupe: sem fragment, sem barra final duplicada."""
    partes = urlparse(url)
    path = re.sub(r"/{2,}$", "/", partes.path)
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    return urlunparse((partes.scheme, partes.netloc, path, partes.params, partes.query, ""))


def mesmo_dominio(url: str, host: str) -> bool:
    return urlparse(url).netloc.lower() == host.lower()


def slug_de_url(url: str) -> str:
    """Deriva um nome de pasta seguro no Windows a partir do path da URL."""
    path = urlparse(url).path.strip("/")
    slug = path or "index"
    slug = re.sub(r"[^\w\-./]", "_", slug).replace("/", "_")
    slug = slug.strip("_") or "index"
    # Componente de caminho no Windows tem limite de 255; cortar com folga.
    return slug[:150]


def slug_unico(base: str, usados: set[str]) -> str:
    slug = base
    n = 2
    while slug in usados:
        slug = f"{base}-{n}"
        n += 1
    usados.add(slug)
    return slug


def _meta_content(soup: BeautifulSoup, name: str) -> str | None:
    tag = soup.find("meta", attrs={"name": name})
    return tag.get("content") if tag else None


def _og_tags(soup: BeautifulSoup) -> dict:
    out: dict[str, str | None] = {}
    for tag in soup.find_all("meta", attrs={"property": re.compile(r"^og:")}):
        prop = tag.get("property")
        if prop:
            out[prop] = tag.get("content")
    return out


def _canonical(soup: BeautifulSoup) -> str | None:
    tag = soup.find("link", attrs={"rel": "canonical"})
    return tag.get("href") if tag else None


# ─── Playwright: uma página ─────────────────────────────────────────────────


async def _scroll_automatico(page, max_iteracoes: int = MAX_SCROLL_ITERACOES) -> None:
    """Rola até o fim ou até a altura parar de crescer, o que vier primeiro."""
    altura_anterior = 0
    for _ in range(max_iteracoes):
        altura = await page.evaluate("document.body.scrollHeight")
        if altura <= altura_anterior:
            break
        altura_anterior = altura
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        await page.wait_for_timeout(300)


async def _explorar_tabs_accordions(page, max_cliques: int = MAX_CLIQUES_EXPLORACAO) -> None:
    """Heurística best-effort: abre abas/acordeões pra expor conteúdo escondido.

    Cada clique é isolado em try/except — um elemento que falhar (coberto,
    desapareceu depois de outro clique, etc.) não pode abortar a página.
    """
    seletor = '[role="tab"], button[aria-expanded="false"], details:not([open]) summary'
    elementos = await page.query_selector_all(seletor)
    for el in elementos[:max_cliques]:
        try:
            await el.click(timeout=2000)
        except Exception:
            continue


async def _capturar_pagina(
    context,
    url: str,
    opcoes: dict,
    out_dir: Path,
    host: str,
    usados_slugs: set[str],
) -> dict:
    resultado: dict = {
        "url": url,
        "status": "erro",
        "mdPath": None,
        "htmlPath": None,
        "textPath": None,
        "screenshotPath": None,
        "metadataPath": None,
        "linksPath": None,
        "error": None,
        "linksInternos": [],
    }
    page = await context.new_page()
    try:
        try:
            resp = await page.goto(url, wait_until="networkidle", timeout=TIMEOUT_NAVEGACAO_MS)
        except Exception as e:
            # Falha de navegação não aborta o crawl — só esta página vira erro.
            resultado["error"] = f"Falha ao abrir a página: {e}"
            return resultado

        if opcoes.get("scrollAutomatico"):
            try:
                await _scroll_automatico(page)
            except Exception:
                pass
        if opcoes.get("explorarTabsAccordions"):
            try:
                await _explorar_tabs_accordions(page)
            except Exception:
                pass

        html = await page.content()
        soup = BeautifulSoup(html, "html.parser")

        # Links extraídos ANTES de remover nav/footer: menu e rodapé costumam
        # ser justamente por onde o crawl descobre o resto do site.
        links_todos: list[str] = []
        links_internos: list[str] = []
        for a in soup.find_all("a", href=True):
            href = urljoin(url, a["href"])
            if not href.startswith(("http://", "https://")):
                continue
            links_todos.append(href)
            if mesmo_dominio(href, host):
                links_internos.append(href)
        resultado["linksInternos"] = links_internos

        slug = slug_unico(slug_de_url(url), usados_slugs)
        pasta = out_dir / slug
        pasta.mkdir(parents=True, exist_ok=True)

        if opcoes.get("screenshot"):
            caminho = pasta / "screenshot.png"
            await page.screenshot(path=str(caminho), full_page=True)
            resultado["screenshotPath"] = str(caminho)

        if opcoes.get("html"):
            caminho = pasta / "pagina.html"
            caminho.write_text(html, encoding="utf-8")
            resultado["htmlPath"] = str(caminho)

        if opcoes.get("metadados"):
            meta = {
                "title": soup.title.get_text(strip=True) if soup.title else None,
                "description": _meta_content(soup, "description"),
                "og": _og_tags(soup),
                "canonical": _canonical(soup),
                "lang": soup.html.get("lang") if soup.html else None,
                "status": resp.status if resp else None,
                "contentType": resp.headers.get("content-type") if resp else None,
                "capturedAt": datetime.now(timezone.utc).isoformat(),
            }
            caminho = pasta / "metadados.json"
            caminho.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
            resultado["metadataPath"] = str(caminho)

        if opcoes.get("links"):
            caminho = pasta / "links.json"
            caminho.write_text(json.dumps(links_todos, ensure_ascii=False, indent=2), encoding="utf-8")
            resultado["linksPath"] = str(caminho)

        # Só agora limpa ruído — depois de já ter tirado links e metadados.
        if opcoes.get("markdown") or opcoes.get("texto"):
            for tag in soup.find_all(["script", "style", "nav", "footer"]):
                tag.decompose()
            conteudo = soup.find("main") or soup.find("article") or soup.find("body") or soup

            if opcoes.get("markdown"):
                caminho = pasta / "conteudo.md"
                caminho.write_text(markdownify(str(conteudo)), encoding="utf-8")
                resultado["mdPath"] = str(caminho)

            if opcoes.get("texto"):
                caminho = pasta / "conteudo.txt"
                caminho.write_text(
                    conteudo.get_text(separator="\n", strip=True), encoding="utf-8"
                )
                resultado["textPath"] = str(caminho)

        resultado["status"] = "ok"
        return resultado
    finally:
        await page.close()


# ─── Orquestração: fila BFS + N páginas concorrentes ────────────────────────


async def capturar_site(
    url: str,
    escopo: str,
    opcoes: dict,
    max_paginas: int | None,
    concorrencia: int,
    out_dir: str,
    passo: Callable[[str], None] | None = None,
    pagina_evento: Callable[[dict], None] | None = None,
) -> dict:
    """Crawl com fila+dedupe. `escopo`: "pagina" | "pagina_subpaginas" | "dominio"."""
    opcoes = {**OPCOES_PADRAO, **(opcoes or {})}
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    host = urlparse(url).netloc

    fila: asyncio.Queue = asyncio.Queue()
    visitadas: set[str] = {normalizar_url(url)}
    await fila.put((url, 0))

    paginas: list[dict] = []
    usados_slugs: set[str] = set()
    contador = 0
    lock = asyncio.Lock()

    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="msedge", headless=True)
        context = await browser.new_context()

        async def worker() -> None:
            nonlocal contador
            while True:
                item_url, profundidade = await fila.get()
                try:
                    if passo:
                        passo(f"Capturando {item_url}")
                    r = await _capturar_pagina(context, item_url, opcoes, out_path, host, usados_slugs)

                    async with lock:
                        contador += 1
                        r["index"] = contador
                        paginas.append(r)
                        total_conhecido = len(visitadas)

                    if pagina_evento:
                        pagina_evento(
                            {
                                "url": r["url"],
                                "status": r["status"],
                                "index": r["index"],
                                "total": total_conhecido,
                                "mdPath": r["mdPath"],
                                "htmlPath": r["htmlPath"],
                                "screenshotPath": r["screenshotPath"],
                                "error": r["error"],
                            }
                        )

                    # "pagina": não segue links. "pagina_subpaginas": só 1 nível
                    # a partir da semente. "dominio": BFS sem limite de profundidade.
                    pode_expandir = escopo == "dominio" or (
                        escopo == "pagina_subpaginas" and profundidade == 0
                    )
                    if r["status"] == "ok" and pode_expandir:
                        for link in r["linksInternos"]:
                            norm = normalizar_url(link)
                            async with lock:
                                if norm in visitadas:
                                    continue
                                if max_paginas is not None and len(visitadas) >= max_paginas:
                                    continue
                                visitadas.add(norm)
                            await fila.put((link, profundidade + 1))
                finally:
                    fila.task_done()

        workers = [asyncio.create_task(worker()) for _ in range(max(1, concorrencia))]
        try:
            await fila.join()
        finally:
            for w in workers:
                w.cancel()
            await asyncio.gather(*workers, return_exceptions=True)
            await context.close()
            await browser.close()

    falharam = sum(1 for pg in paginas if pg["status"] == "erro")
    manifesto = {
        "url": url,
        "escopo": escopo,
        "opcoes": opcoes,
        "maxPaginas": max_paginas,
        "concorrencia": concorrencia,
        "encontradas": len(visitadas),
        "processadas": len(paginas),
        "falharam": falharam,
        "paginas": paginas,
    }
    (out_path / "manifest.json").write_text(
        json.dumps(manifesto, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return {
        "encontradas": len(visitadas),
        "processadas": len(paginas),
        "falharam": falharam,
        "arquivos": {
            "markdown": sum(1 for pg in paginas if pg["mdPath"]),
            "html": sum(1 for pg in paginas if pg["htmlPath"]),
            "screenshots": sum(1 for pg in paginas if pg["screenshotPath"]),
        },
        "paginas": paginas,
    }
