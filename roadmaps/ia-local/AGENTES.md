# Fluxo de agentes — Fase 4 (IA local)

Como executar `roadmaps/ia-local/roadmap.md` com trabalho paralelo sem virar bagunça.

Definições em `.claude/agents/`. O orquestrador **é a sessão principal** — não é um agente.

---

## O elenco

| Agente | Território | Não toca em |
|---|---|---|
| **orquestrador** (sessão principal) | Decide, revisa, integra, escreve o roadmap | — |
| `camps-medidor` | Mede peso de dependência empacotada | Código de produção |
| `camps-modulo` | `src-tauri/`, `python/build.py`, capabilities | `src/`, `converter.py` |
| `camps-sidecar` | `python/converter.py`, `test_converter.py` | `src/`, `src-tauri/` |
| `camps-ui` | `src/` | `src-tauri/`, `python/` |
| `camps-verificador` | Roda a bateria e reporta | Tudo — é só leitura |

Territórios não se sobrepõem. É isso que permite rodar em paralelo sem dois agentes editando o
mesmo arquivo.

---

## Por que o orquestrador não é um agente

Agente novo começa **frio**: relê o código, redescobre o contexto, gasta tokens repetindo o que a
sessão principal já sabe. Orquestrar é justamente a parte que precisa de memória contínua — quem
mediu o quê, qual decisão foi tomada e por quê, o que quebrou na tentativa anterior.

Delegar tem custo. Vale quando o território é isolado e o resultado cabe num relatório curto. Não
vale para "pensar sobre o problema".

---

## O fluxo de uma fase

```
                    ┌─ PORTÃO 0 ─────────────────────┐
                    │  camps-medidor                 │
                    │  mede o peso real do módulo    │
                    └────────────┬───────────────────┘
                                 │
                    orquestrador decide: segue / replaneja
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
   camps-modulo            camps-sidecar              camps-ui
   RemoteModule            tool + lógica pura         tela da ferramenta
   build.py                + pytest                   + registry
        │                        │                        │
        └────────────────────────┼────────────────────────┘
                                 │
                    ┌─ PORTÃO 1 ─────────────────────┐
                    │  camps-verificador             │
                    │  typecheck, vitest, pytest,    │
                    │  cargo debug + release         │
                    └────────────┬───────────────────┘
                                 │
                    orquestrador integra e revisa o diff
                                 │
                    ┌─ PORTÃO 2 ─────────────────────┐
                    │  npm run dev — SÓ O USUÁRIO    │
                    │  módulo, drag&drop e ffmpeg    │
                    │  real só existem no app real   │
                    └────────────────────────────────┘
                                 │
                    orquestrador escreve o roadmap
```

### Os três portões

**Portão 0 — medir antes de construir.** Bloqueante. Nenhuma linha de produção antes do número.
O Docling foi estimado "grande" e veio 700 MB; a correção custou o sistema de módulos inteiro.
Acima de ~400 MB de zip, a fase é replanejada, não implementada.

**Portão 1 — verificação automática.** Nada é "pronto" sem a bateria verde. As duas rodadas do
cargo são obrigatórias: os ramos `cfg(debug_assertions)` só compilam numa delas.

**Portão 2 — o app real.** `npm run dev` abre janela e não termina sozinho, então **agente nenhum
roda isso**. Download de módulo, drag&drop e ffmpeg empacotado só existem ali. Quem valida é você.

---

## Paralelismo

Depois do portão 0, os três executores podem correr juntos porque seus territórios não se cruzam.

Ordem de dependência real: o `camps-ui` precisa saber o **nome do módulo** e o **formato do
retorno** da tool para escrever a tela. Isso é uma linha de contrato — o orquestrador define
**antes** de disparar, e os três trabalham contra o mesmo contrato.

Definir o contrato depois é o que gera retrabalho: a tela espera `{segments: [...]}` e o sidecar
devolve `{outputs: [...]}`.

---

## O que o orquestrador escreve no roadmap ao fechar uma etapa

- Checkboxes marcados
- **Peso medido substituindo a estimativa** — o valor do roadmap está nos números reais
- Armadilhas encontradas, com caminho de arquivo
- Decisão que mude fase seguinte (registrar, não deixar só na conversa)

O roadmap é o que sobrevive à sessão. Conversa não.

---

## Prompt de arranque

`roadmaps/ia-local/PROMPT.md` cobre a Fase A. Cada fase seguinte merece o seu, com o mesmo
formato: contexto curto, escopo fechado, o que **não** fazer, e como verificar.

O "o que não fazer" não é firula — sem ele o agente resolve as fases B e C junto e entrega um diff
que ninguém consegue revisar.
