---
title: OMNI AGENTS — Especificação do Produto e Arquitetura
aliases:
  - OMNI AGENTS
  - Omni Agents
status: draft
versao_spec: 0.1.0
plataforma_mvp: Windows 10/11
stack_principal:
  - Tauri 2
  - Rust
  - React
  - TypeScript
  - Vite
  - SQLite
python: proibido-no-novo-produto
atualizado: 2026-08-20
---

# OMNI AGENTS — spec.md

> **Em uma frase:** OMNI AGENTS é um workspace desktop persistente para coordenar múltiplos agentes de programação, terminais, comandos, arquivos, Git e stacks Docker em vários projetos, com múltiplas contas por provider e uma interface multipane altamente customizável.

---

## 0. Status deste documento

Este documento define a visão de produto, arquitetura, escopo do MVP, modelos de dados, UX, requisitos técnicos, segurança, persistência, Docker, agentes, distribuição e critérios de aceite do **OMNI AGENTS**.

Ele parte de três referências principais:

1. **CAMPS-UTILS atual** — base técnica a ser duplicada para reaproveitar Tauri, React, Vite, Rust, sistema visual, configurações, updater, instalador, scripts, CSP e infraestrutura de build.
2. **Tesseract** — referência funcional para engine persistente, sessões/células, estados de atenção, recuperação segura, painel Docker e operação simultânea.
3. **Imagem de referência enviada na conversa** — referência de UX para sidebar hierárquica, projetos, splits, agentes, terminais, comandos, tabs e panes simultâneas.

### 0.1. Regra de interpretação

Quando este documento disser **MUST / obrigatório**, trata-se de requisito do MVP.

Quando disser **SHOULD / recomendado**, pode ser adiado apenas se houver impedimento técnico real.

Quando disser **MAY / futuro**, está explicitamente fora do escopo mínimo inicial.

---

# 1. Identidade do produto

## 1.1. Nome

**OMNI AGENTS**

Uso recomendado:

- Marca: `OMNI AGENTS`
- Texto corrente: `Omni Agents`
- Repositório: `omni-agents`
- Executável principal: `omni-agents.exe`
- Engine: `omni-agent-engine.exe`
- Banco local: `omni-agents.db`
- Pasta de configuração por projeto: `.omni/`
- Diretório de dados do aplicativo: `OMNI-AGENTS`
- Tauri `productName`: `OMNI AGENTS`
- Tauri identifier sugerido: `com.omni.agents`

## 1.2. Posicionamento

OMNI AGENTS não deve ser tratado como “um launcher do Claude” nem como “um terminal bonito”.

O produto deve ser concebido como:

> **um IDE/orquestrador local para desenvolvimento assistido por múltiplos agentes e processos.**

O usuário deve conseguir abrir um ou vários projetos e, dentro de cada um, executar lado a lado:

- agentes;
- terminais;
- comandos persistentes;
- logs;
- arquivos;
- Markdown;
- Git diff;
- painel Docker;
- logs de serviços Docker.

---

# 2. Objetivos do produto

## 2.1. Objetivos principais

O MVP deve permitir:

1. cadastrar múltiplos projetos locais;
2. cadastrar múltiplas contas/perfis do Claude Code;
3. escolher qual conta será usada por cada agente;
4. executar vários agentes simultaneamente;
5. executar vários terminais simultaneamente;
6. executar comandos de desenvolvimento salvos;
7. organizar tudo em panes/splits redimensionáveis;
8. persistir layout e estado do workspace;
9. manter agentes/processos ativos quando a janela principal for fechada;
10. reconstruir o workspace após reabrir o app;
11. detectar agentes que:
   - estão trabalhando;
   - terminaram;
   - precisam de entrada;
   - precisam de aprovação;
   - falharam;
   - foram parados;
12. oferecer um centro de atenção;
13. navegar pelos arquivos do projeto;
14. exibir Markdown com atualização quando o arquivo mudar;
15. exibir informações e diff do Git;
16. gerenciar Docker Compose por projeto;
17. visualizar logs Docker como pane;
18. permitir personalização visual equivalente ou superior ao CAMPS-UTILS;
19. atualizar o aplicativo por GitHub Releases com assinatura;
20. funcionar sem Python.

## 2.2. Não objetivos do MVP

Não é objetivo inicial:

- substituir VS Code/JetBrains como editor completo;
- implementar um editor de código completo;
- implementar servidor remoto multiusuário;
- sincronizar workspaces na nuvem;
- substituir Docker Desktop;
- implementar Kubernetes;
- implementar SSH remoto;
- executar containers destrutivamente;
- fornecer uma IDE Docker completa;
- suportar todos os providers de IA no primeiro release;
- compartilhar automaticamente credenciais entre contas;
- armazenar senha/token de provider no SQLite;
- reconstruir agentes disparando prompts automaticamente depois de reboot.

---

# 3. Estratégia de origem: duplicar o CAMPS-UTILS

## 3.1. Decisão

O OMNI AGENTS deve nascer como **duplicata limpa do CAMPS-UTILS estável**, e não como projeto iniciado do zero.

O Python existente no CAMPS-UTILS **não é impeditivo** porque está isolado como sidecar/módulo. Ele deve ser removido da cópia durante a etapa de sanitização.

## 3.2. O que deve ser reaproveitado

Reaproveitar, quando aplicável:

- Tauri 2;
- React;
- TypeScript;
- Vite;
- Tailwind;
- Lucide;
- shell da aplicação;
- componentes UI reutilizáveis;
- sistema de tema;
- sistema de accent color;
- configurações locais;
- diálogos;
- filesystem Tauri;
- estrutura de permissões/capabilities;
- updater;
- GitHub Releases;
- assinatura de updater;
- scripts de build;
- scripts de release;
- instalador Windows;
- CSP;
- testes de infraestrutura;
- convenções de versionamento;
- padrões de logs;
- estrutura base Rust;
- infraestrutura de módulos/downloads que ainda fizer sentido.

## 3.3. O que deve ser removido da cópia

Remover progressivamente:

- `python/`;
- PyInstaller;
- `.venv`;
- `requirements.txt`;
- `build:python`;
- `build:all` com dependência Python;
- sidecar `converter`;
- `externalBin` do converter legado;
- Docling;
- Whisper Python;
- Depth Python;
- PyMuPDF;
- pikepdf;
- Pillow;
- NumPy;
- ONNX usados apenas pelas ferramentas antigas;
- serviços de conversão do frontend;
- ferramentas antigas do catálogo;
- código legado de `pdf-to-markdown`;
- nomenclaturas de conversão que não façam sentido no OMNI.

## 3.4. Ordem obrigatória da migração

1. duplicar o repositório;
2. confirmar que a cópia compila sem mudanças;
3. renomear identidade do produto;
4. separar AppData;
5. separar GitHub Releases;
6. configurar nova chave de updater;
7. remover ferramentas antigas da UI;
8. remover chamadas do frontend às conversões;
9. remover comandos Rust associados;
10. remover módulos remotos antigos não utilizados;
11. remover sidecar Python;
12. remover scripts Python;
13. remover Python do setup;
14. confirmar build sem Python;
15. criar shell vazio do OMNI AGENTS;
16. iniciar implementação do domínio `Workspace → Project → Pane → Session`.

## 3.5. Resultado esperado da etapa de limpeza

A primeira baseline do novo projeto deve ser capaz de:

- abrir;
- salvar configurações;
- mudar tema;
- mudar accent color;
- atualizar via updater de teste;
- abrir seletor de diretório;
- ler filesystem autorizado;
- compilar o instalador;
- não possuir dependência de Python;
- exibir um workspace vazio.

---

# 4. Princípios arquiteturais

## 4.1. Separação entre UI e engine

A aplicação deve possuir dois processos principais:

```text
OMNI AGENTS UI
omni-agents.exe
React + Tauri
        │
        │ IPC local
        ▼
OMNI Agent Engine
omni-agent-engine.exe
Rust
        │
        ├── Agent sessions
        ├── PTYs
        ├── terminals
        ├── commands
        ├── Docker watchers
        ├── notifications
        └── persistence
```

### Regra

Fechar a janela principal **não deve encerrar automaticamente o engine nem as sessões ativas**.

## 4.2. Engine persistente

O engine será responsável por:

- criar processos;
- anexar/desanexar PTYs;
- manter sessões;
- registrar stdout/stderr;
- atualizar estados;
- acompanhar Docker;
- acompanhar processos de comandos;
- persistir metadados;
- emitir notificações;
- responder à UI por IPC;
- reanexar a sessões compatíveis;
- executar shutdown explícito quando solicitado pelo usuário.

## 4.3. UI descartável

A UI é uma visão do estado do engine.

Ela deve poder:

1. iniciar;
2. descobrir/conectar ao engine;
3. pedir snapshot do estado;
4. reconstruir panes;
5. reanexar streams;
6. operar normalmente.

A UI não deve ser a dona da vida útil das sessões.

## 4.4. Sem Python

O OMNI AGENTS não terá Python no runtime, build nem instalador.

Prioridade técnica:

1. Rust;
2. CLI/binário externo já instalado pelo usuário;
3. sidecar Rust próprio, se necessário;
4. bibliotecas nativas.

---

# 5. Stack

## 5.1. Obrigatória

| Área | Tecnologia |
|---|---|
| Desktop | Tauri 2 |
| Frontend | React + TypeScript + Vite |
| Core | Rust |
| Persistência | SQLite |
| Terminal UI | xterm.js ou equivalente compatível |
| PTY | crate Rust compatível com Windows ConPTY |
| Git | CLI Git no MVP ou crate Rust se necessário |
| Docker | Docker CLI + Docker Compose CLI |
| Atualização | Tauri Updater |
| Releases | GitHub Releases |
| Instalador Windows | NSIS inicialmente |
| Ícones | Lucide |
| Tema | CSS variables/tokens reaproveitados do CAMPS-UTILS |

## 5.2. Recomendadas

- Zustand para estado efêmero do frontend;
- TanStack Query ou camada equivalente para snapshots/queries do engine;
- Monaco apenas para preview/diff se houver ganho real;
- `git2` apenas se CLI Git se mostrar insuficiente;
- `portable-pty` ou alternativa Rust adequada após spike técnico.

---

# 6. Modelo conceitual

A hierarquia principal será:

```text
Workspace
 ├── Project
 │    ├── Split/Layout
 │    ├── Agent
 │    ├── Terminal
 │    ├── Command
 │    ├── Docker
 │    ├── Files
 │    └── Git
 └── Project
```

## 6.1. Workspace

Conjunto persistente de projetos abertos e sua organização visual.

Campos mínimos:

- id;
- nome;
- projetos;
- layout ativo;
- tabs;
- panes;
- timestamps;
- última sessão ativa.

## 6.2. Project

Representa uma pasta real.

Campos mínimos:

- id;
- nome;
- path;
- git root;
- branch atual;
- provider padrão;
- profile padrão;
- compose detectado;
- comandos salvos;
- última abertura.

## 6.3. Pane

Unidade visual.

Tipos do MVP:

- `agent`;
- `terminal`;
- `command`;
- `file`;
- `markdown`;
- `git-diff`;
- `logs`;
- `docker-logs`.

## 6.4. Session

Processo ou unidade viva ligada ao engine.

Pode representar:

- agente;
- terminal;
- comando;
- stream de logs.

## 6.5. Agent

Especialização de Session.

Campos:

- id;
- provider;
- profile;
- project;
- cwd;
- nome;
- externalSessionId;
- state;
- pid quando aplicável;
- startedAt;
- lastActivityAt;
- model;
- permissionMode;
- metadata.

## 6.6. Profile

Conta/configuração isolada de um provider.

Exemplo:

```text
Claude
├── Pessoal
├── Trabalho
└── Cliente X
```

O profile deve armazenar metadados de localização/configuração, nunca senha em texto puro.

---

# 7. Interface e UX

## 7.1. Referência visual

A interface deve se inspirar na imagem fornecida:

- janela escura;
- sidebar à esquerda;
- projetos agrupados;
- grupos `SPLITS`, `AGENTS`, `TERMINALS`, `COMMANDS`;
- tabs no topo;
- múltiplas panes lado a lado;
- terminal como conteúdo principal;
- status discreto, porém sempre presente;
- separadores finos;
- foco claro;
- densidade semelhante a ferramenta de desenvolvimento profissional.

Não copiar pixels ou marca de outro produto. Copiar apenas padrões funcionais de organização.

## 7.2. Estrutura principal

```text
┌──────────────────────────────────────────────────────────────────┐
│ Top bar / tabs / workspace                              Settings │
├────────────────────┬─────────────────────────────────────────────┤
│ Sidebar            │ Pane area                                   │
│                    │                                             │
│ Workspaces         │ ┌────────────────┬────────────────────────┐ │
│ Projects           │ │ Pane           │ Pane                   │ │
│ Agents             │ │                │                        │ │
│ Terminals          │ │                │                        │ │
│ Commands           │ ├────────────────┴────────────────────────┤ │
│ Docker             │ │ Pane                                     │ │
│ Files              │ └──────────────────────────────────────────┘ │
│ Git                │                                             │
├────────────────────┴─────────────────────────────────────────────┤
│ Status bar                                                       │
└──────────────────────────────────────────────────────────────────┘
```

## 7.3. Sidebar

Cada projeto deve poder exibir:

```text
PROJECT
├── SPLITS
├── AGENTS
├── TERMINALS
├── COMMANDS
├── DOCKER
├── FILES
└── GIT
```

As seções podem ser recolhidas.

## 7.4. Splits

Obrigatório no MVP:

- split horizontal;
- split vertical;
- redimensionamento;
- fechar pane;
- maximizar pane;
- mover tab para pane;
- arrastar tab para criar split;
- persistir tamanhos;
- restaurar layout.

## 7.5. Tabs

Uma pane pode conter uma ou mais tabs.

Uma tab pode ser:

- agente;
- terminal;
- comando;
- arquivo;
- Markdown;
- diff;
- log.

## 7.6. Foco

O app deve deixar claro:

- pane ativa;
- tab ativa;
- sessão com teclado;
- agente exigindo atenção.

A área de terminal/agente não pode conflitar com atalhos globais do app.

---

# 8. Personalização visual

## 8.1. Requisito

O OMNI AGENTS deve preservar a filosofia de customização visual do CAMPS-UTILS.

O usuário deve poder personalizar pelo menos:

- modo claro/escuro/sistema, se já suportado;
- accent color;
- cores principais do shell;
- terminal;
- cursor;
- seleção;
- tabs;
- bordas;
- intensidade de backgrounds;
- tamanho de fonte do terminal;
- família de fonte do terminal quando permitido;
- densidade da UI.

## 8.2. Tokens

O frontend deve usar tokens e não cores hardcoded.

Exemplo conceitual:

```css
--app-bg
--panel-bg
--panel-bg-elevated
--border
--text
--text-muted
--accent
--accent-hover
--terminal-bg
--terminal-fg
--terminal-cursor
--status-working
--status-answered
--status-approve
--status-failed
--status-stopped
```

## 8.3. Estados não podem depender apenas de cor

Cada estado deve possuir simultaneamente:

- ícone/glyph;
- texto;
- forma/ênfase.

Exemplo:

```text
▸ WORKING
● ANSWERED
⏵ APPROVAL REQUIRED
✕ CRASHED
○ STOPPED
⚠ PROJECT MISSING
```

O estado urgente deve ser reconhecível mesmo em monocromático.

---

# 9. Agentes e providers

## 9.1. Arquitetura de provider

Não espalhar nomes de Claude pelo core.

Criar abstração equivalente a:

```rust
trait AgentProvider {
    fn detect(...);
    fn version(...);
    fn auth_status(...);
    fn start_interactive(...);
    fn start_background(...);
    fn list_sessions(...);
    fn attach(...);
    fn stop(...);
    fn resume(...);
    fn logs(...);
}
```

## 9.2. Providers do MVP

### P0 — obrigatório

- Claude Code;
- terminal genérico;
- comandos genéricos.

### P1 — arquitetura pronta, implementação posterior

- OpenAI Codex CLI;
- Gemini CLI;
- Cursor CLI;
- Custom CLI Provider.

A UI não deve assumir que “agent == Claude”.

## 9.3. Múltiplas contas Claude

Obrigatório.

Usar diretórios de configuração separados.

Estrutura sugerida:

```text
AppData/OMNI-AGENTS/
└── profiles/
    └── claude/
        ├── <profile-id-1>/
        ├── <profile-id-2>/
        └── <profile-id-3>/
```

Ao iniciar um processo Claude de um profile, definir `CLAUDE_CONFIG_DIR` para o diretório absoluto daquele profile.

O Claude Code documenta essa variável especificamente como útil para múltiplas contas lado a lado.

## 9.4. Credenciais

OMNI AGENTS não deve armazenar:

- senha Claude;
- token OAuth;
- `.credentials.json` em SQLite;
- API key em campo de texto persistido sem proteção explícita.

OMNI registra:

- nome do profile;
- provider;
- configDir;
- status;
- versão;
- último uso;
- metadata não sensível.

A autenticação deve continuar sendo gerenciada pelo provider/CLI.

## 9.5. Profile Health Check

Antes de iniciar um agente:

```text
Claude Trabalho

✓ CLI encontrado
✓ versão suportada
✓ profile encontrado
✓ autenticação válida
✓ projeto acessível
✓ engine disponível
```

Falhas devem produzir ação concreta:

- instalar/selecionar CLI;
- autenticar;
- corrigir caminho;
- recriar profile.

---

# 10. Claude Code — integração do MVP

## 10.1. Estratégia

Para Claude Code, preferir integração com recursos oficiais de background/session quando disponíveis, em vez de tentar deduzir tudo apenas do texto do terminal.

A versão atual do Claude Code oferece:

- `claude agents`;
- `claude agents --json`;
- `claude agents --cwd <path>`;
- `claude --bg`;
- `claude attach <id>`;
- `claude logs <id>`;
- `claude stop <id>`;
- `claude respawn <id>`.

## 10.2. Benefício

`claude agents --json` fornece estado estruturado como:

- `working`;
- `blocked`;
- `done`;
- `failed`;
- `stopped`.

Isso deve ser utilizado pelo adapter do provider para reduzir heurísticas frágeis.

## 10.3. Sessão interativa

Quando o usuário abrir uma sessão interativa:

- criar/anexar PTY;
- cwd = projeto selecionado;
- aplicar profile;
- mostrar TUI real;
- respeitar resize;
- suportar clipboard;
- preservar scrollback;
- permitir detach sem matar.

## 10.4. Sessão em background

O usuário deve poder criar:

```text
New Agent
Provider: Claude
Profile: Trabalho
Project: CAMPS-UTILS
Name: Refactor backend
Mode: Background
```

A sessão deve aparecer na sidebar mesmo sem terminal anexado.

## 10.5. Attach

Ao abrir um agente background:

- a UI deve solicitar attach;
- a sessão deve ocupar uma pane;
- detach posterior não deve matá-la.

---

# 11. Estados de atenção

## 11.1. Estados normalizados do OMNI

Providers diferentes devem ser convertidos para estados comuns:

| Estado OMNI | Significado |
|---|---|
| `working` | produzindo/trabalhando |
| `answered` | terminou um turno e há conteúdo para ler |
| `needs_input` | aguarda resposta |
| `approval_required` | bloqueado em aprovação |
| `failed` | falhou/crashou |
| `stopped` | parado preservando metadata |
| `restorable` | sessão pode ser retomada |
| `orphan_project` | diretório sumiu |
| `unknown` | provider não forneceu sinal confiável |

## 11.2. Distinção crítica

`answered` **não é** `approval_required`.

Uma resposta pronta não bloqueia trabalho.

Uma aprovação pendente bloqueia.

A UI deve tornar essa distinção óbvia.

## 11.3. Attention Center

Obrigatório.

Deve agrupar:

- approvals;
- needs input;
- failures;
- respostas concluídas não lidas.

Ordenação sugerida:

1. approval required;
2. needs input;
3. failed;
4. answered.

## 11.4. Navegação de atenção

Atalho global configurável para:

> ir para o próximo item que precisa de atenção.

Deve atravessar projetos.

---

# 12. Terminais

## 12.1. Shells

MVP Windows:

- PowerShell;
- cmd;
- Git Bash, quando encontrado;
- WSL, quando encontrado.

## 12.2. Requisitos

- PTY real;
- resize;
- UTF-8;
- ANSI;
- true color quando suportado;
- copy/paste;
- scrollback;
- busca;
- limpar terminal;
- renomear;
- duplicate terminal;
- detach;
- kill com confirmação.

## 12.3. CWD

Todo terminal criado dentro de um projeto deve iniciar no root do projeto, salvo override explícito.

---

# 13. Commands

## 13.1. Conceito

Commands são tarefas repetíveis associadas ao projeto.

Exemplos:

- `npm run dev`;
- `cargo check`;
- `npm test`;
- `docker compose up -d`.

## 13.2. Persistência

Preferência:

```text
<project>/.omni/commands.json
```

Exemplo:

```json
{
  "commands": [
    {
      "id": "frontend-dev",
      "name": "Frontend",
      "command": "npm run dev",
      "cwd": ".",
      "restartable": true
    }
  ]
}
```

## 13.3. Execução

Um command:

- roda em PTY quando interatividade for útil;
- pode virar pane;
- mostra status;
- pode reiniciar;
- pode parar;
- guarda últimas linhas;
- pode ser marcado como autoStart posteriormente, mas autoStart fica fora do MVP salvo decisão explícita.

---

# 14. Files

## 14.1. Escopo

O File Explorer deve ser restrito aos roots autorizados de projetos.

Não criar um explorer geral do computador.

## 14.2. Lazy loading

Diretórios são carregados sob demanda.

Ignorar por padrão:

```text
.git
node_modules
target
dist
build
.venv
venv
__pycache__
.next
coverage
```

O usuário pode configurar exclusões.

## 14.3. MVP

- árvore de pastas;
- abrir arquivo;
- preview texto;
- Markdown;
- JSON;
- logs;
- detectar alteração externa;
- copiar path;
- revelar no Explorer;
- abrir no editor externo.

Editar arquivos dentro do OMNI é P1, não requisito do MVP.

---

# 15. Markdown

## 15.1. Motivação

Markdown deve funcionar como pane de leitura, permitindo acompanhar documentação sendo escrita por agentes.

## 15.2. Requisitos

- listar `.md` do projeto;
- pesquisar por nome;
- renderização segura;
- reload automático quando arquivo mudar;
- scroll independente;
- tabelas;
- code blocks;
- headings;
- blockquotes;
- links;
- dark/light theme consistente.

---

# 16. Git

## 16.1. MVP

Por projeto:

- detectar repositório;
- branch atual;
- arquivos modificados;
- added/deleted;
- diff por arquivo;
- abrir diff como pane;
- refresh automático ou sob evento;
- copiar hash/branch/path quando aplicável.

## 16.2. Fora do MVP

- commit UI completo;
- rebase;
- merge visual;
- resolução de conflitos avançada;
- push/pull automáticos;
- gerenciamento completo de PR.

---

# 17. Docker — OBRIGATÓRIO NO MVP

## 17.1. Decisão

O painel Docker inspirado no Tesseract permanece **dentro do MVP**, não será adiado.

Ele pertence ao **Project**, não a uma sessão/agente.

## 17.2. Detecção

Ao abrir/adicionar um projeto, procurar Compose:

Prioridade:

1. root do projeto;
2. pastas de primeiro nível;
3. override configurado em `.omni/project.json`.

Nomes aceitos inicialmente:

- `compose.yml`;
- `compose.yaml`;
- `docker-compose.yml`;
- `docker-compose.yaml`.

Evitar selecionar automaticamente arquivos claramente destinados a produção, por exemplo:

- `compose.prod.yml`;
- `docker-compose.prod.yml`;
- variantes com `production`.

Se houver múltiplos candidatos plausíveis, perguntar qual usar e persistir a escolha.

## 17.3. Pré-requisitos Docker

Executar health check:

```text
docker version
docker compose version
```

Estados:

- Docker não instalado;
- Docker instalado, daemon parado;
- Compose indisponível;
- Compose encontrado;
- stack válida;
- compose inválido.

## 17.4. Lista de serviços

O painel deve mostrar:

- service;
- state;
- health;
- published ports;
- uptime/age quando disponível;
- container name;
- imagem opcionalmente;
- exit code quando parado/falhou.

Preferir saída estruturada do Docker CLI, como `docker compose ps --format json`.

## 17.5. Ações por stack

Obrigatório:

- `Start/Up`;
- `Stop`;
- `Restart`;
- `Build/Rebuild`;
- refresh;
- abrir logs gerais.

## 17.6. Ações por serviço

Obrigatório:

- start/up;
- stop;
- restart;
- build;
- rebuild + up;
- abrir logs;
- copiar porta;
- abrir porta HTTP no browser quando aplicável.

## 17.7. Logs Docker como pane

Cada serviço pode gerar uma pane:

```text
Docker Logs
Project: my-app
Service: api
```

Requisitos:

- follow;
- pause visual;
- clear view;
- busca;
- copiar;
- status do serviço;
- reconectar se o serviço reiniciar;
- sobreviver ao fechamento da UI por meio do engine quando apropriado.

## 17.8. Operações proibidas no MVP

Não oferecer por botão:

- `docker compose down -v`;
- remoção de volumes;
- prune;
- apagar imagens;
- apagar networks;
- remoção irreversível de dados.

Operações destrutivas não fazem parte do painel inicial.

## 17.9. Feedback progressivo

Durante `up/build/restart`:

- mostrar qual operação está rodando;
- atualizar serviços progressivamente;
- não esperar o comando inteiro terminar para só então mudar tudo;
- refletir estados conforme os containers sobem.

## 17.10. Recuperação

Após reinício do Windows ou do engine:

- reconstruir o painel;
- detectar estado real no Docker;
- reanexar panes de logs quando possível;
- **não iniciar automaticamente uma stack que esteja parada**.

Docker voltar a subir deve ser uma decisão do usuário.

## 17.11. Integração com sidebar

Exemplo:

```text
DOCKER
├── ● frontend    :5173
├── ● api         :3000
├── ● postgres    :5432
└── ○ worker
```

Clicar no serviço abre painel/context menu.

---

# 18. Engine e persistência

## 18.1. Responsabilidades do engine

- gerenciar lifecycle;
- spawn;
- PTY;
- attach/detach;
- streams;
- status;
- heartbeat;
- notificações;
- Docker polling/events;
- session registry;
- snapshots;
- recovery;
- logs internos;
- shutdown seguro.

## 18.2. IPC

Requisitos:

- local only;
- autenticação/segredo local ou proteção equivalente;
- protocolo versionado;
- request/response;
- events;
- reconnect;
- timeout;
- health check.

Possíveis transportes:

- named pipe no Windows;
- loopback socket protegido, se necessário.

A escolha deve ser fechada em spike técnico.

## 18.3. Banco

SQLite armazenará metadata, não conteúdo sensível desnecessário.

Tabelas sugeridas:

```text
workspaces
projects
project_settings
profiles
sessions
panes
tabs
commands
attention_events
docker_projects
recent_files
settings
app_versions
```

## 18.4. Scrollback

Não armazenar scrollback ilimitado.

Definir teto configurável por sessão.

Estratégia possível:

- ring buffer em memória;
- persistência opcional em arquivo local segmentado;
- truncate seguro.

---

# 19. Fechar UI, fechar engine e sair

O usuário deve perceber três ações diferentes.

## 19.1. Fechar janela

Comportamento padrão:

> esconder/fechar a UI; engine continua.

Sessões continuam.

## 19.2. Exit UI

Encerra UI, mantém engine.

## 19.3. Stop OMNI Engine

Ação explícita e confirmada.

Mostra:

```text
Existem 4 sessões ativas.
Parar o engine encerrará esses processos.

[Cancelar] [Parar tudo]
```

---

# 20. Recovery

## 20.1. Fechamento da UI

Ao reabrir:

1. conectar ao engine;
2. obter snapshot;
3. restaurar layout;
4. reanexar streams;
5. manter os mesmos estados.

## 20.2. Crash da UI

Mesmo comportamento de reabertura normal.

## 20.3. Crash do engine

Na próxima abertura:

- detectar sessions metadata;
- consultar providers;
- detectar processos ainda vivos quando possível;
- reconciliar;
- marcar sessões mortas como `restorable` ou `failed`.

## 20.4. Reboot do Windows

O reboot naturalmente encerra processos.

Ao voltar:

- restaurar projetos;
- restaurar layout;
- restaurar tabs;
- consultar sessões do provider;
- oferecer resume/reconnect;
- reanexar logs Docker se stack estiver rodando;
- não iniciar stack Docker automaticamente;
- não disparar prompts automaticamente.

## 20.5. Regra de segurança

**Reconstituir uma conversa nunca deve enviar um prompt automaticamente.**

Restore ≠ Continue work.

---

# 21. Notificações

## 21.1. Fonte

Notificações devem vir do engine, não depender da UI aberta.

## 21.2. Eventos

Configuração por evento:

- approval required;
- needs input;
- answered;
- failed;
- command failed;
- Docker service unhealthy.

## 21.3. Conteúdo

Exemplo:

```text
OMNI AGENTS
CAMPS-UTILS · Backend Agent
Approval required
```

## 21.4. Preferências

- sistema;
- som;
- silencioso;
- apenas approvals;
- por projeto;
- por agent.

---

# 22. Atalhos e modos de teclado

## 22.1. Problema

Terminal e agentes usam muitos atalhos.

O OMNI não deve interceptar teclas enquanto o usuário está digitando dentro de um PTY sem intenção.

## 22.2. Modelo

Dois contextos:

### APP/NAVIGATION

Atalhos pertencem ao OMNI.

### TERMINAL INPUT

Teclas pertencem ao PTY, exceto uma combinação reservada para devolver o foco ao app.

## 22.3. Atalhos sugeridos

Devem ser configuráveis.

Exemplos:

- próximo item de atenção;
- command palette;
- novo agent;
- novo terminal;
- split right;
- split down;
- fechar pane;
- maximizar pane;
- devolver foco à aplicação.

Não copiar obrigatoriamente as mesmas teclas do Tesseract.

---

# 23. Command Palette

Obrigatório no MVP.

Ações pesquisáveis:

- Add Project;
- New Agent;
- New Terminal;
- Run Command;
- Open File;
- Open Docker;
- Restart Service;
- Open Git Diff;
- Next Attention;
- Change Theme;
- Change Profile;
- Check for Updates.

---

# 24. Configuração por projeto

## 24.1. Estrutura

```text
project/
├── .omni/
│   ├── project.json
│   ├── commands.json
│   └── workspace.json   # opcional
├── src/
└── ...
```

## 24.2. project.json

Exemplo:

```json
{
  "version": 1,
  "name": "CAMPS-UTILS",
  "defaultProvider": "claude",
  "defaultProfile": "claude-personal",
  "composeFile": "infra/compose.yml",
  "exclude": [
    "node_modules",
    "target",
    "dist"
  ]
}
```

## 24.3. Portabilidade

O `.omni/` não deve conter:

- tokens;
- senhas;
- paths absolutos de profiles;
- secrets.

Deve ser possível versioná-lo em Git quando o usuário desejar.

---

# 25. Segurança

## 25.1. Filesystem

Cada Project define seu root autorizado.

O app não recebe acesso global ao disco sem necessidade.

## 25.2. Processos

Evitar expor `spawn arbitrary command` diretamente ao frontend.

Frontend solicita uma ação tipada ao Rust/engine.

## 25.3. Credentials

Providers controlam suas credenciais.

OMNI só controla isolamento/seleção de profiles.

## 25.4. Docker

Painel inicial evita destruição de volumes e prune.

## 25.5. Updates

Updates devem ser assinados.

Chave privada nunca entra no repositório.

## 25.6. IPC

Engine deve aceitar apenas cliente local autorizado.

---

# 26. Updater e distribuição

## 26.1. Repositório próprio

OMNI AGENTS precisa de repo e releases independentes do CAMPS-UTILS.

## 26.2. Endpoint

Modelo:

```text
https://github.com/<owner>/omni-agents/releases/latest/download/latest.json
```

## 26.3. Assinatura

Gerar nova chave de updater exclusiva para OMNI AGENTS.

Não reutilizar a chave do CAMPS-UTILS.

## 26.4. GitHub Actions

Pipeline:

```text
tag vX.Y.Z
   ↓
GitHub Actions
   ↓
typecheck/tests/cargo
   ↓
build Windows
   ↓
sign updater artifact
   ↓
GitHub Release
   ↓
latest.json
```

## 26.5. Instalador

MVP Windows:

- NSIS `.exe`;
- instalação por usuário inicialmente;
- opção de code signing Windows quando disponível.

---

# 27. Estrutura de frontend proposta

```text
src/
├── app/
│   ├── App.tsx
│   ├── router/
│   └── providers/
│
├── components/
│   ├── shell/
│   ├── sidebar/
│   ├── tabs/
│   ├── panes/
│   ├── terminal/
│   ├── attention/
│   ├── dialogs/
│   └── ui/
│
├── features/
│   ├── workspaces/
│   ├── projects/
│   ├── layouts/
│   ├── agents/
│   ├── profiles/
│   ├── terminals/
│   ├── commands/
│   ├── docker/
│   ├── files/
│   ├── markdown/
│   ├── git/
│   ├── settings/
│   ├── themes/
│   └── updater/
│
├── stores/
├── hooks/
├── services/
├── types/
└── lib/
```

---

# 28. Estrutura Rust/Tauri proposta

```text
src-tauri/
├── src/
│   ├── lib.rs
│   ├── commands/
│   ├── engine_client/
│   ├── projects/
│   ├── profiles/
│   ├── providers/
│   │   ├── mod.rs
│   │   └── claude.rs
│   ├── sessions/
│   ├── filesystem/
│   ├── docker/
│   ├── git/
│   ├── database/
│   ├── updater/
│   └── security/
│
├── capabilities/
├── Cargo.toml
└── tauri.conf.json
```

---

# 29. Estrutura do engine proposta

Preferencialmente no mesmo workspace Cargo:

```text
crates/
├── omni-protocol/
├── omni-core/
├── omni-providers/
├── omni-pty/
├── omni-docker/
└── omni-engine/
    └── src/
        ├── main.rs
        ├── ipc/
        ├── sessions/
        ├── pty/
        ├── providers/
        ├── attention/
        ├── docker/
        ├── notifications/
        ├── recovery/
        └── persistence/
```

Isso evita duplicar contratos entre `omni-agents.exe` e `omni-agent-engine.exe`.

---

# 30. Schema inicial de dados

## 30.1. profiles

```text
id
provider
name
config_dir
is_default
created_at
updated_at
last_used_at
metadata_json
```

## 30.2. projects

```text
id
name
path
git_root
default_provider
default_profile_id
compose_file
last_opened_at
created_at
updated_at
```

## 30.3. sessions

```text
id
project_id
kind
provider
profile_id
external_session_id
name
cwd
state
pid
started_at
last_activity_at
stopped_at
metadata_json
```

## 30.4. panes

```text
id
workspace_id
layout_node_id
active_tab_id
created_at
```

## 30.5. tabs

```text
id
pane_id
kind
resource_id
title
position
pinned
```

## 30.6. commands

```text
id
project_id
name
command
cwd
shell
restartable
metadata_json
```

## 30.7. attention_events

```text
id
session_id
type
created_at
seen_at
resolved_at
payload_json
```

---

# 31. Docker — modelo interno

## 31.1. DockerProject

```text
project_id
compose_file
compose_project_name
last_refresh_at
engine_status
```

## 31.2. DockerService

```text
name
container_id
container_name
image
state
health
exit_code
publishers
started_at
updated_at
```

## 31.3. DockerOperation

```text
id
project_id
service
operation
state
started_at
finished_at
exit_code
last_output
```

Operações:

- up;
- stop;
- restart;
- build;
- rebuild;
- logs.

---

# 32. Observabilidade e logs do próprio OMNI

## 32.1. Logs separados

```text
logs/
├── ui.log
├── engine.log
├── docker.log
└── updater.log
```

## 32.2. Requisitos

- rotação;
- sem secrets;
- timestamp;
- level;
- component;
- correlation/session id quando aplicável.

## 32.3. Tela de diagnóstico

MVP deve possuir ao menos um painel simples de diagnóstico:

- versão UI;
- versão engine;
- caminho AppData;
- DB;
- engine status;
- Docker status;
- Claude version;
- profiles;
- updater endpoint;
- botão copiar diagnóstico.

---

# 33. Performance

## 33.1. Requisitos gerais

Abertura da UI não deve:

- escanear recursivamente projetos inteiros;
- carregar node_modules;
- carregar todo scrollback de todas as sessões;
- solicitar logs Docker ilimitados;
- instanciar terminal de tabs não visíveis sem necessidade.

## 33.2. Estratégias

- lazy filesystem;
- virtualização de listas;
- panes/tabs lazy;
- ring buffer;
- debounce de filesystem;
- polling Docker controlado;
- structured state diff via IPC;
- snapshots incrementais.

---

# 34. Compatibilidade Windows

MVP focado em:

- Windows 10;
- Windows 11;
- x86_64 inicialmente.

Verificar:

- WebView2;
- ConPTY;
- PowerShell;
- Git Bash;
- WSL;
- Docker Desktop;
- Docker Engine/CLI;
- paths longos;
- UTF-8;
- ACL de profile.

---

# 35. Fluxos obrigatórios

## 35.1. Primeira abertura

```text
Open OMNI
  ↓
Welcome
  ↓
Add Project
  ↓
Choose directory
  ↓
Detect Git / Docker / available providers
  ↓
Workspace
```

## 35.2. Adicionar Claude profile

```text
Settings
  ↓
Providers
  ↓
Claude Code
  ↓
Add Profile
  ↓
Create isolated config dir
  ↓
Open authentication flow
  ↓
Health check
  ↓
Profile ready
```

## 35.3. Novo Agent

```text
+ Agent
  ↓
Provider
  ↓
Profile
  ↓
Project
  ↓
Name
  ↓
Mode: Interactive / Background
  ↓
Start
  ↓
Sidebar + pane
```

## 35.4. Docker

```text
Project
  ↓
Docker
  ↓
compose detected
  ↓
services
  ↓
Start API
  ↓
live state
  ↓
Open Logs
  ↓
new logs pane
```

## 35.5. Fechar e voltar

```text
2 agents running
npm dev running
Docker running

Close UI
  ↓
engine continues
  ↓
Open OMNI
  ↓
same workspace
  ↓
reattach
```

---

# 36. Requisitos do MVP por prioridade

## P0 — bloqueadores de release

### Fundação

- [ ] clone limpo do CAMPS-UTILS;
- [ ] identidade OMNI AGENTS;
- [ ] sem Python;
- [ ] AppData próprio;
- [ ] updater próprio;
- [ ] instalador próprio;
- [ ] sistema de temas preservado;
- [ ] accent color customizável.

### Workspace/UI

- [ ] projects;
- [ ] sidebar hierárquica;
- [ ] tabs;
- [ ] splits horizontal/vertical;
- [ ] resize;
- [ ] layout persistente;
- [ ] command palette.

### Engine

- [ ] processo separado;
- [ ] IPC;
- [ ] snapshots;
- [ ] persistent sessions;
- [ ] reconnect da UI;
- [ ] shutdown explícito.

### Terminal

- [ ] PTY;
- [ ] PowerShell;
- [ ] resize;
- [ ] copy/paste;
- [ ] scrollback;
- [ ] detach.

### Claude

- [ ] detectar CLI;
- [ ] profiles múltiplos;
- [ ] `CLAUDE_CONFIG_DIR`;
- [ ] auth health;
- [ ] iniciar no cwd do projeto;
- [ ] background;
- [ ] listagem estruturada;
- [ ] attach;
- [ ] logs;
- [ ] stop;
- [ ] resume/respawn quando aplicável;
- [ ] estados working/blocked/done/failed/stopped.

### Attention

- [ ] approval/needs input;
- [ ] answered;
- [ ] failed;
- [ ] attention center;
- [ ] next attention.

### Commands

- [ ] commands salvos;
- [ ] run/stop/restart;
- [ ] command pane.

### Files/Markdown/Git

- [ ] lazy file tree;
- [ ] text preview;
- [ ] Markdown live reload;
- [ ] Git status;
- [ ] Git diff pane.

### Docker

- [ ] Docker detect;
- [ ] Compose detect;
- [ ] services;
- [ ] state;
- [ ] health;
- [ ] ports;
- [ ] uptime/age;
- [ ] up/start;
- [ ] stop;
- [ ] restart;
- [ ] build/rebuild;
- [ ] stack actions;
- [ ] service actions;
- [ ] logs pane;
- [ ] sem operações destrutivas;
- [ ] não auto-start após recovery.

### Release

- [ ] GitHub Actions;
- [ ] signed updater;
- [ ] `latest.json`;
- [ ] NSIS installer;
- [ ] version sync;
- [ ] release checklist.

## P1 — pós-MVP imediato

- Codex provider;
- Gemini provider;
- Custom CLI provider;
- worktrees no UI;
- editor leve;
- commit UI;
- browser pane;
- Docker stats;
- Docker exec shell;
- project templates;
- compartilhamento de `.omni/`;
- presets de layouts.

## P2 — futuro

- SSH;
- remote engines;
- Linux;
- macOS;
- Kubernetes;
- multi-machine;
- workspace sync;
- plugin SDK;
- provider marketplace;
- browser automation;
- database pane.

---

# 37. Critérios de aceite do MVP

O MVP é considerado válido apenas quando todos os cenários abaixo funcionarem em build de produção.

## 37.1. Sessões persistentes

1. iniciar Claude A;
2. iniciar Claude B;
3. iniciar `npm run dev`;
4. fechar a janela;
5. confirmar processos vivos;
6. reabrir;
7. confirmar layout e sessões;
8. continuar usando.

## 37.2. Múltiplos profiles

1. profile `Pessoal`;
2. profile `Trabalho`;
3. autenticar ambos;
4. executar agentes simultâneos;
5. confirmar config dirs independentes;
6. não misturar sessão/profile.

## 37.3. Attention

1. agente trabalhando;
2. agente pede aprovação;
3. UI marca aprovação;
4. notification aparece com UI fechada;
5. reabrir;
6. `next attention` navega para ele.

## 37.4. Docker

1. adicionar projeto com compose;
2. detectar compose;
3. listar serviços;
4. iniciar stack;
5. estados atualizarem progressivamente;
6. abrir logs de um serviço em pane;
7. restart serviço;
8. pane continuar/reconectar;
9. fechar/reabrir UI;
10. Docker manter estado real;
11. nenhum volume ser apagado;
12. após reboot com stack parada, OMNI não iniciar automaticamente.

## 37.5. Recovery seguro

1. sessão Claude salva;
2. reiniciar máquina;
3. abrir OMNI;
4. layout volta;
5. sessão aparece como retomável quando aplicável;
6. nenhum prompt ser enviado automaticamente.

## 37.6. Theme

1. mudar accent color;
2. reiniciar app;
3. cor persistir;
4. terminal continuar legível;
5. estados de atenção continuarem distinguíveis sem depender apenas de cor.

## 37.7. Update

1. publicar release assinada;
2. OMNI detectar;
3. baixar;
4. validar assinatura;
5. instalar;
6. reiniciar na versão nova;
7. preservar banco/workspaces.

---

# 38. Estratégia de testes

## 38.1. Frontend

- componentes;
- stores;
- layout serialization;
- theme;
- command palette;
- sidebar;
- attention ordering.

## 38.2. Rust core

- project scope;
- provider profile env;
- IPC protocol;
- DB migrations;
- Docker parser;
- command escaping;
- session lifecycle.

## 38.3. Engine

- spawn;
- PTY resize;
- detach;
- reconnect;
- crash recovery;
- shutdown;
- multiple sessions.

## 38.4. Docker integration tests

Fixtures com compose mínimo:

```text
frontend
api
redis
```

Validar:

- config;
- ps JSON;
- health;
- up;
- stop;
- restart;
- build;
- logs;
- failure;
- daemon unavailable.

Não usar volumes destrutivos em teste automatizado de usuário.

## 38.5. E2E

Cenários completos descritos nos critérios de aceite.

---

# 39. Roadmap de implementação

## Fase 0 — Fork interno do CAMPS-UTILS

- duplicar;
- renomear;
- desacoplar release;
- nova chave;
- limpar legado;
- remover Python;
- build verde.

## Fase 1 — Workspace Shell

- sidebar;
- projects;
- tabs;
- panes;
- splits;
- layout persistence;
- themes.

## Fase 2 — Engine

- binary;
- IPC;
- state snapshot;
- lifecycle;
- DB.

## Fase 3 — PTY/Terminal

- ConPTY;
- xterm;
- input/output;
- resize;
- detach/reconnect.

## Fase 4 — Claude Profiles

- detect;
- config dirs;
- auth;
- health checks;
- multi-account.

## Fase 5 — Claude Sessions

- interactive;
- background;
- list JSON;
- attach;
- logs;
- stop;
- attention states.

## Fase 6 — Commands

- config;
- run;
- terminal pane;
- persistence.

## Fase 7 — Files + Markdown + Git

- lazy explorer;
- watchers;
- markdown;
- git status;
- diff.

## Fase 8 — Docker MVP

- detection;
- compose selection;
- service state;
- actions;
- logs panes;
- engine integration;
- notifications/health.

## Fase 9 — Attention + Notifications

- attention center;
- ordering;
- OS notifications;
- UI closed.

## Fase 10 — Recovery

- UI restart;
- engine restart;
- Windows reboot;
- safe session reconstruction.

## Fase 11 — Release

- GitHub Actions;
- installer;
- updater;
- signing;
- release checklist.

---

# 40. Definition of Done por feature

Uma feature só é concluída quando possui:

- UI;
- contrato TS;
- implementação Rust/engine quando aplicável;
- tratamento de erro;
- loading;
- empty state;
- logs;
- testes;
- persistência quando aplicável;
- keyboard/focus test;
- theme test;
- build de produção testado;
- documentação curta.

---

# 41. Decisões fechadas

As seguintes decisões não devem ser rediscutidas sem motivo técnico documentado:

1. produto se chama **OMNI AGENTS**;
2. Windows é a plataforma do MVP;
3. Tauri + React + TypeScript + Vite + Rust permanecem;
4. Python não faz parte do novo produto;
5. projeto nasce de uma cópia sanitizada do CAMPS-UTILS;
6. cores/tema continuam customizáveis;
7. UI multipane é parte central;
8. engine separado da UI é obrigatório;
9. fechar UI não mata sessões;
10. múltiplos profiles Claude são obrigatórios;
11. Docker está dentro do MVP;
12. Docker pertence ao Project;
13. logs Docker podem virar panes;
14. operações destrutivas de volumes não entram no MVP;
15. recovery nunca envia prompt automaticamente;
16. updater usa GitHub Releases e assinatura própria;
17. provider abstraction existe desde o início.

---

# 42. Decisões ainda abertas

Precisam de spike/ADR antes de implementação definitiva:

1. crate PTY final;
2. IPC: Named Pipes vs outra solução local;
3. estratégia exata para autostart do engine no login;
4. formato de persistência de scrollback;
5. Zustand vs outra store;
6. Git CLI vs `git2`;
7. Monaco no MVP ou preview próprio;
8. estratégia de worktree para agentes paralelos;
9. polling vs event-driven para Docker;
10. política de versões mínimas do Claude Code.

Cada decisão deve gerar um ADR em:

```text
docs/adr/
```

---

# 43. ADRs iniciais sugeridos

```text
ADR-001-clone-camps-utils.md
ADR-002-no-python.md
ADR-003-persistent-engine.md
ADR-004-ipc-transport.md
ADR-005-pty.md
ADR-006-provider-abstraction.md
ADR-007-claude-profiles.md
ADR-008-docker-mvp.md
ADR-009-recovery-safety.md
ADR-010-updater-identity.md
```

---

# 44. Riscos

## 44.1. PTY no Windows

Risco:
- comportamento de TUI, resize, clipboard e attach.

Mitigação:
- spike isolado antes de construir a UI completa.

## 44.2. Provider muda CLI

Risco:
- comandos e JSON mudarem.

Mitigação:
- adapters versionados;
- detection de versão;
- feature flags;
- fallback seguro.

## 44.3. Múltiplas contas

Risco:
- mistura de config/profile.

Mitigação:
- config dirs absolutos;
- health check;
- nunca reutilizar env global sem controle.

## 44.4. Engine órfão

Risco:
- processo persistente travado.

Mitigação:
- heartbeat;
- status command;
- restart engine mantendo sessões quando possível;
- botão diagnóstico.

## 44.5. Docker

Risco:
- daemon indisponível;
- compose inválido;
- operações demoradas;
- serviço unhealthy.

Mitigação:
- estados explícitos;
- cancelamento quando suportado;
- logs;
- timeout;
- nunca ocultar stderr.

## 44.6. Layout complexo

Risco:
- persistência corrompida.

Mitigação:
- schema version;
- validation;
- fallback para layout seguro.

---

# 45. Fontes e referências

## 45.1. Base do projeto

- `RESUME.md` do CAMPS-UTILS fornecido na conversa.

## 45.2. Tesseract

- README: https://github.com/AndreLuizMMS/tesseract/blob/main/README.md
- Manual: https://github.com/AndreLuizMMS/tesseract/blob/main/docs/manual.md
- Atalhos: https://github.com/AndreLuizMMS/tesseract/blob/main/docs/atalhos.md

Conceitos adotados/adaptados:

- engine independente da tela;
- grid/panes simultâneas;
- distinguir answered de approve;
- recovery sem disparar prompt;
- Docker por projeto;
- service state/port/health/uptime;
- logs Docker como unidade visual;
- não oferecer destruição de volumes;
- navegação para o próximo item de atenção.

## 45.3. Claude Code

- Environment variables: https://code.claude.com/docs/en/env-vars
- Agent view: https://code.claude.com/docs/en/agent-view
- Authentication: https://code.claude.com/docs/en/authentication
- Sessions: https://code.claude.com/docs/en/sessions

Conceitos usados:

- `CLAUDE_CONFIG_DIR` para profiles isolados;
- sessões background;
- `claude agents --json`;
- attach/logs/stop/respawn;
- estados estruturados.

## 45.4. Docker

- Compose ps: https://docs.docker.com/reference/cli/docker/compose/ps/
- Compose up: https://docs.docker.com/reference/cli/docker/compose/up/
- Compose stop: https://docs.docker.com/reference/cli/docker/compose/stop/
- Compose restart: https://docs.docker.com/reference/cli/docker/compose/restart/
- Compose build: https://docs.docker.com/reference/cli/docker/compose/build/
- Compose config: https://docs.docker.com/reference/cli/docker/compose/config/

## 45.5. Tauri

- Updater: https://v2.tauri.app/plugin/updater/
- GitHub pipeline: https://v2.tauri.app/distribute/pipelines/github/
- Sidecars/external binaries: https://v2.tauri.app/develop/sidecar/

---

# 46. Resumo final do MVP

```text
OMNI AGENTS
│
├── Customizable UI
│   ├── theme
│   ├── accent color
│   ├── terminal theme
│   └── persistent layout
│
├── Workspaces
│   └── Projects
│       ├── Splits / Panes
│       ├── Agents
│       │   └── Claude multi-profile
│       ├── Terminals
│       ├── Commands
│       ├── Docker
│       │   ├── services
│       │   ├── health
│       │   ├── ports
│       │   ├── start/stop/restart/build
│       │   └── logs panes
│       ├── Files
│       ├── Markdown
│       └── Git Diff
│
├── Attention Center
│
├── Persistent Rust Engine
│   ├── PTY
│   ├── IPC
│   ├── Sessions
│   ├── Docker
│   ├── Notifications
│   └── Recovery
│
├── SQLite
│
├── GitHub Releases
├── Signed Tauri Updater
└── NSIS Installer

Python: NONE
```

---

# 47. Norte de produto

Toda decisão de implementação deve responder à pergunta:

> **Isso torna mais fácil controlar muitos agentes e processos em vários projetos sem perder contexto, sem perder estado e sem precisar ficar alternando entre dezenas de terminais?**

Se a resposta for não, a feature provavelmente não pertence ao core do OMNI AGENTS.

