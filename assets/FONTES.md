# Fontes das legendas

> ⚠️ Este arquivo fica FORA de `assets/fonts/` de propósito: o libass tenta abrir
> **todo** arquivo do `fontsdir` como fonte e reclama de cada um que não for
> (`Error opening memory font 'README.md'`). Só fontes ali dentro.

Binários **não versionados**. Rode `npm run fonts` para baixá-los (SIL Open Font License 1.1).

Esta pasta é usada por dois caminhos, e os dois precisam dela:

| Quem | Como |
|---|---|
| Interface (preview) | `@font-face` em `src/index.css`, empacotado pelo Vite |
| ffmpeg / libass (queima) | `bundle.resources` do `tauri.conf.json` → `fontsdir` no filtro `ass` |

Sem os arquivos aqui o app **não quebra**: `fontes_dir()` (`src-tauri/src/commands.rs`) devolve
`None`, o filtro sai sem `fontsdir` e o libass cai nas fontes do Windows. Mas a legenda sai com
outra fonte, **sem aviso nenhum** — daí valer rodar o script antes de gerar um instalador.

O nome da **família** (o que vai dentro do `.ass`) está em `src/lib/subtitleFonts.ts`. Não é o nome
do arquivo: `BebasNeue-Regular.ttf` tem família `Bebas Neue`. Errar isso faz o libass ignorar a
fonte silenciosamente.
