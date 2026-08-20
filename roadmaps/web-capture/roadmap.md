# Roadmap: Capturar Site (crawl de domínio → Markdown/HTML/screenshot)

Nova ferramenta na suíte CAMPS-UTILS: dado uma URL, varre o site (fila + dedupe,
escopo configurável) e salva cada página como Markdown, HTML, texto, screenshot
full-page, metadados e links, explorando tabs/accordions e fazendo scroll
automático. Não é extensão de nenhum roadmap anterior — feature nova.

Decisões fechadas: Playwright puro (não Scrapling) + BeautifulSoup + markdownify;
browser = Edge do Windows via `channel="msedge"` (sem baixar Chromium); MVP já
inclui crawl completo de domínio (não fica pra v2). Peso medido do módulo: ~46MB
(playwright+bs4+markdownify), na faixa do realesrgan/depth.

## Passos

- [x] **1. Gate camps-medidor** — medido peso real do bundle PyInstaller do stack
  Playwright+BeautifulSoup+markdownify: 46MB exe / 45,5MB zip, viável.
  `channel="msedge"` confirmado funcionando sem `playwright install`. Driver Node
  embutido do Playwright é 79% do peso (inevitável, não é dado excluível).
- [x] **2. Python isolado** — `python/webcapture.py` (novo: `capturar_site()` async,
  fila BFS com N workers persistentes, scroll automático, exploração de
  tabs/accordions best-effort, extração via BeautifulSoup, conversão HTML→MD via
  markdownify). `python/converter.py`: branch `capture_site` no `dispatch()`,
  handler `capture_site()` com validação barata antes do import tardio de
  `webcapture`, callbacks `STEP:`/`PAGEEVENT:` no stderr. `python/requirements.txt`:
  `playwright`, `beautifulsoup4`, `markdownify`. `python/test_converter.py`:
  `TestCaptureSiteEntrada` + `TestCaptureSiteSaida` (9 testes novos). Suite completa:
  90/90 passando.
- [x] **3. Rust** — `src-tauri/src/commands.rs`: const `WEBCAPTURE` (RemoteModule,
  `sha256` vazio até o release existir), `webcapture_installed`/`ensure_webcapture`,
  novo prefixo stderr `PAGEEVENT:` → evento Tauri `capture-page-event`, arm de
  roteamento `"capture_site"` no sidecar, comando `create_zip` (crate `zip`,
  `spawn_blocking`). `src-tauri/src/lib.rs`: 3 comandos novos registrados.
  `python/build.py`: `WEBCAPTURE_STACK`, `build_webcapture()`, stack subtraída dos
  excludes de light/whisper/depth/rembg. `cargo check` debug+release: limpo.
- [x] **4. Frontend** — `src/tools/web-capture/WebCaptureTool.tsx` (URL, escopo via
  `SegmentedControl`, 8 checkboxes de captura, limite de páginas, `Slider` de
  concorrência, resumo final com 6 contadores, Abrir pasta/Baixar ZIP),
  `CrawlQueueList.tsx` (lista ao vivo por página), hook `useCaptureEvents.ts`
  (evento `capture-page-event`). `conversionService.ts`: tipos + `captureSite`/
  `webcaptureInstalled`/`ensureWebcapture`/`createZip`. `ModuleGate.tsx`: entrada
  `webcapture`. `registry.tsx`: tool `web-capture` (categoria utilitarios, wide).
  `npm run typecheck` + `npm run test`: limpos (104 testes).
- [x] **5. Empacotar e publicar** — `python build.py webcapture` gerou
  `camps-webcapture.zip` (56MB) + sha256
  `a7990e665875256f997784a71751e940e9dd82d6f1fefb11a8557a1a1cda78f8`. `.exe`
  compilado testado de verdade contra `https://example.com` (captura completa,
  channel=msedge sem baixar Chromium). Publicado
  [webcapture-v1](https://github.com/FelipeCamposM/CAMPS-UTILS/releases/tag/webcapture-v1)
  como pre-release. sha256 gravado em `commands.rs` → `WEBCAPTURE`.
- [x] **6. Smoke test manual** — usuário testou manualmente em `npm run dev` e
  confirmou funcionando.
- [x] **7. Release da versão 1.2.0** — `VERSION`/`version:sync`, entrada em
  `src/lib/changelog.ts`, verificações completas (typecheck/vitest/pytest/cargo
  debug+release, todas passando), `npm run build` assinado, `npm run release` →
  `latest.json`, publicado
  [v1.2.0](https://github.com/FelipeCamposM/CAMPS-UTILS/releases/tag/v1.2.0)
  (marcado "Latest" corretamente, na frente do `webcapture-v1` que é pre-release).

## Riscos conhecidos

- Heurística de tabs/accordions é best-effort — não cobre 100% dos sites.
- Crawl de "domínio inteiro" sem `maxPaginas` pode demorar bastante em sites
  grandes (sem limite de tempo total, só de páginas/concorrência).
