# Prints do README

Coloque as imagens **nesta pasta** (`docs/screenshots/`) com exatamente os nomes da tabela. O
`README.md` já aponta para eles — assim que o arquivo existir com o nome certo, a imagem aparece.

Formato: **PNG**. Não precisa redimensionar; o README limita a largura.

## Antes de começar

- **Janela do app em 1600 × 900** (ou maximizada num monitor 1080p). Evita print gigante e mantém
  as telas com a mesma proporção.
- Deixe o tema como você gosta — as imagens servem para mostrar o produto. O padrão é escuro com a
  paleta laranja; trocar em **Configurações → Aparência**.
- **Esconda o que for privado**: caminhos com seu nome de usuário, nomes de clientes, conteúdo de
  conversas reais. Se precisar, crie um projeto de exemplo numa pasta como `C:\dev\exemplo`.
- Como tirar: `Win + Shift + S` (Ferramenta de Captura) e salvar como PNG, ou `Alt + PrtScn` para
  copiar só a janela ativa.

## As imagens

| Arquivo | O que mostra | Onde tirar |
|---|---|---|
| `01-workspace.png` | A tela principal, o cartão de visita do projeto | Abra um projeto, divida o painel (`Ctrl+\`) e deixe **dois agentes rodando lado a lado** (ex.: Claude e Codex), de preferência um respondendo algo. Barra lateral aberta. Print da **janela inteira**. |
| `02-novo-agente.png` | Escolher qual CLI e qual conta abrir | Numa aba nova, clique em **Novo agente**. O print é da tela do seletor, com a lista de CLIs aberta. |
| `03-rodape-uso.png` | Uso da conta, modelo e esforço | Com um agente em foco, tire um print **só da faixa de baixo da janela** (barra de status), mostrando as barras de 5H e SEMANA e o modelo. |
| `04-git-graph.png` | O grafo do Git | Barra lateral → **GIT** → abrir o Git Graph. Ideal num repositório com ramos e merges. Print do painel. |
| `05-historico.png` | Retomar conversas antigas | Barra lateral → ícone de **Histórico**, com uma conversa selecionada mostrando as mensagens. |
| `06-skills.png` | Gerenciar skills | **Configurações → Skills**, com algumas skills listadas. |
| `07-aparencia.png` | Temas e paletas | **Configurações → Aparência**, mostrando as paletas de cor. |
| `09-celular-chat.png` | Conversa no celular, com um anexo na barra de digitação | No **celular**, abra uma conversa, anexe um arquivo e tire o print (iPhone: Power + Volume↑; Android: Power + Volume↓). |
| `10-celular-projetos.png` | Lista de projetos no celular | No **celular**, a tela inicial do app, com os projetos. |

### Opcionais

| Arquivo | O que mostra | Onde tirar |
|---|---|---|
| `11-kanban.png` | Quadro de tarefas | Barra lateral → **KANBAN**, com algumas tarefas. |
| `12-arquivos.png` | Árvore e editor de arquivos | Barra lateral → **FILES**, com um arquivo aberto no editor. |

Se você não tirar alguma, é só apagar a linha correspondente do `README.md` — senão fica um ícone
de imagem quebrada.
