Quero que você desenvolva um aplicativo desktop para Windows chamado provisoriamente de **PDF to Markdown**, capaz de converter arquivos PDF em Markdown utilizando **Python e Docling**.

O aplicativo será utilizado apenas localmente, inicialmente por uma única pessoa. Não haverá autenticação, banco de dados, pagamento, servidor externo ou hospedagem em nuvem.

## Objetivo

Criar um aplicativo desktop instalável para Windows no qual o usuário possa:

1. Abrir o aplicativo normalmente pelo Windows.
2. Arrastar um PDF para a interface ou selecionar o arquivo pelo explorador.
3. Converter o PDF para Markdown utilizando o Docling.
4. Visualizar o Markdown gerado dentro do aplicativo.
5. Copiar o conteúdo convertido.
6. Escolher onde salvar o arquivo `.md`.
7. Abrir a pasta onde o arquivo foi salvo.
8. Realizar todo o processamento localmente, sem enviar arquivos para a internet.

## Tecnologias obrigatórias

### Interface desktop

* Tauri 2
* React
* TypeScript
* Vite
* Tailwind CSS

Não utilizar Next.js, pois o aplicativo será totalmente local e não precisa de SSR, servidor web ou API Routes.

### Conversão

* Python 3
* Docling
* PyInstaller para empacotar o conversor Python
* O executável Python deverá funcionar como um sidecar do Tauri

## Arquitetura esperada

A arquitetura deve seguir este fluxo:

```text
Interface React/Tauri
        ↓
Comando do Tauri
        ↓
Sidecar Python empacotado
        ↓
Docling processa o PDF
        ↓
Markdown é salvo ou retornado
        ↓
React exibe o resultado
```

Estruture o projeto de maneira organizada, aproximadamente assim:

```text
pdf-to-markdown/
├── src/
│   ├── components/
│   ├── hooks/
│   ├── services/
│   ├── types/
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   ├── binaries/
│   ├── capabilities/
│   ├── tauri.conf.json
│   └── Cargo.toml
├── python/
│   ├── converter.py
│   ├── requirements.txt
│   └── build.py
├── scripts/
├── package.json
├── vite.config.ts
├── tailwind.config.ts
└── README.md
```

Você pode ajustar a estrutura caso exista uma organização melhor, desde que mantenha separadas a interface, a integração Tauri e o código Python.

## Requisitos funcionais

### 1. Seleção de arquivo

O usuário deve conseguir:

* arrastar e soltar um PDF na área principal;
* clicar na área para abrir o seletor de arquivos;
* selecionar apenas arquivos `.pdf`;
* visualizar o nome e o tamanho do arquivo selecionado;
* remover o arquivo e escolher outro.

Valide:

* extensão `.pdf`;
* existência do arquivo;
* tamanho máximo configurável;
* mensagens de erro amigáveis.

Defina inicialmente um limite de 100 MB, mas centralize essa configuração para facilitar alterações.

### 2. Conversão

O botão “Converter para Markdown” deve:

* permanecer desabilitado sem um PDF selecionado;
* iniciar o sidecar Python;
* passar o caminho absoluto do PDF;
* aguardar o resultado;
* impedir múltiplas conversões simultâneas;
* exibir estado de carregamento;
* apresentar mensagens claras em caso de erro.

O Docling deve utilizar:

```python
from docling.document_converter import DocumentConverter
```

A conversão principal deve seguir aproximadamente:

```python
converter = DocumentConverter()
result = converter.convert(input_path)
markdown = result.document.export_to_markdown()
```

Não inicialize desnecessariamente o `DocumentConverter` várias vezes durante a mesma execução do processo.

### 3. Comunicação com o Python

Implemente uma comunicação robusta entre Tauri e o sidecar.

O sidecar deverá receber dados por argumentos ou JSON, contendo pelo menos:

```json
{
  "inputPath": "C:\\Documentos\\arquivo.pdf",
  "outputPath": "C:\\Documentos\\arquivo.md"
}
```

A resposta do Python deverá ser estruturada em JSON.

Exemplo de sucesso:

```json
{
  "success": true,
  "outputPath": "C:\\Documentos\\arquivo.md",
  "markdown": "# Conteúdo convertido",
  "durationMs": 12500
}
```

Exemplo de erro:

```json
{
  "success": false,
  "errorCode": "CONVERSION_FAILED",
  "message": "Não foi possível converter o documento."
}
```

Não retorne stack traces diretamente para a interface do usuário. Registre detalhes técnicos separadamente para diagnóstico.

### 4. Pré-visualização do Markdown

Depois da conversão, exiba o resultado em uma área de pré-visualização.

A interface deve permitir:

* visualizar o Markdown como texto;
* alternar entre “Código Markdown” e “Prévia renderizada”;
* editar o Markdown antes de salvar;
* copiar todo o conteúdo;
* limpar o resultado;
* salvar novamente em outro local.

Use um renderizador Markdown seguro. Não execute HTML arbitrário contido no Markdown.

### 5. Salvamento

Implemente duas possibilidades:

#### Conversão direta

Antes de converter, o usuário pode escolher o destino do `.md`.

#### Conversão com salvamento posterior

O aplicativo converte, mostra o resultado e depois o usuário escolhe onde salvar.

O nome sugerido deve ser baseado no PDF:

```text
relatorio.pdf → relatorio.md
```

Utilize o diálogo nativo de salvamento do Tauri.

Após salvar, exiba:

* caminho completo;
* mensagem de sucesso;
* botão “Abrir pasta”;
* botão “Converter outro PDF”.

### 6. Estados da aplicação

Crie estados bem definidos:

```text
IDLE
FILE_SELECTED
CONVERTING
SUCCESS
ERROR
```

Evite espalhar diversos booleanos sem organização. Utilize um estado tipado ou reducer.

### 7. Cancelamento

Caso seja viável com a arquitetura do sidecar, implemente um botão “Cancelar conversão” que encerre o processo Python atual.

Se a implementação segura de cancelamento for muito complexa para o MVP, deixe a arquitetura preparada e documente essa limitação no README.

## Interface e experiência visual

Quero uma interface moderna, minimalista e profissional.

Características:

* tema escuro;
* visual inspirado em ferramentas de produtividade;
* cartões com bordas discretas;
* fundo escuro;
* bom contraste;
* tipografia limpa;
* poucos elementos decorativos;
* estados de hover e focus claros;
* layout responsivo dentro da janela;
* suporte a redimensionamento da janela.

Tela inicial sugerida:

```text
┌──────────────────────────────────────────────┐
│ PDF to Markdown                             │
│ Converta PDFs localmente com privacidade    │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │                                        │  │
│  │       Arraste um PDF aqui              │  │
│  │   ou clique para selecionar            │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  documento.pdf                 12,4 MB       │
│                                              │
│  [ Converter para Markdown ]                 │
│                                              │
│  Todo o processamento ocorre localmente.     │
└──────────────────────────────────────────────┘
```

Após converter:

```text
┌──────────────────────────────────────────────┐
│ documento.pdf convertido com sucesso        │
│                                              │
│ [ Markdown ] [ Prévia ]                      │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ # Título                                │ │
│ │                                          │ │
│ │ Conteúdo convertido...                  │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ [ Copiar ] [ Salvar .md ] [ Abrir pasta ]   │
└──────────────────────────────────────────────┘
```

## Barra de progresso

O Docling pode não fornecer progresso detalhado de forma simples.

Para o MVP:

* exiba indicador indeterminado;
* mostre mensagens de etapa, como:

  * “Preparando documento”
  * “Analisando páginas”
  * “Convertendo conteúdo”
  * “Gerando Markdown”

Não invente porcentagens falsas.

Caso consiga obter progresso real de maneira confiável, implemente. Caso contrário, utilize apenas carregamento indeterminado.

## Python

O arquivo Python deve:

* validar argumentos;
* aceitar caminhos com espaços;
* verificar se o PDF existe;
* verificar a extensão;
* criar diretórios quando necessário;
* trabalhar com UTF-8;
* capturar erros;
* imprimir apenas JSON válido no `stdout`;
* enviar logs técnicos para `stderr`;
* retornar códigos de saída apropriados;
* não sobrescrever arquivos silenciosamente sem confirmação prévia da interface.

Crie erros tipados, por exemplo:

```text
INVALID_INPUT
FILE_NOT_FOUND
INVALID_EXTENSION
OUTPUT_ERROR
MODEL_ERROR
CONVERSION_FAILED
UNKNOWN_ERROR
```

Não exponha informações confidenciais ou caminhos internos desnecessariamente em mensagens amigáveis.

## Modelos do Docling

Considere que o Docling pode precisar baixar modelos na primeira utilização.

Implemente uma experiência adequada:

* detectar quando os modelos ainda não estão disponíveis;
* informar que o primeiro uso pode levar mais tempo;
* exibir uma mensagem amigável;
* manter o cache para usos futuros;
* não baixar novamente os modelos a cada conversão.

Se for possível empacotar os modelos de maneira confiável sem tornar o build excessivamente complexo, documente essa alternativa, mas não a torne obrigatória no primeiro MVP.

## PyInstaller

Empacote o conversor Python como executável.

Prefira inicialmente:

```text
onedir
```

em vez de:

```text
onefile
```

Isso deve reduzir problemas de inicialização, extração temporária e dependências do Docling.

Crie um script para gerar o executável, por exemplo:

```bash
python python/build.py
```

O script deve:

* limpar builds anteriores;
* executar o PyInstaller;
* mover ou copiar os arquivos necessários;
* preparar o sidecar na pasta esperada pelo Tauri;
* utilizar o nome correto exigido pelo target do sistema.

Considere a nomenclatura de sidecars do Tauri para Windows e a arquitetura utilizada.

## Tauri

Configure corretamente:

* permissões mínimas necessárias;
* shell sidecar;
* seletor de arquivo;
* seletor de salvamento;
* acesso ao sistema de arquivos somente quando necessário;
* abertura de pasta;
* ícones;
* janela principal;
* nome do produto;
* identificador do aplicativo.

Não habilite permissões amplas sem necessidade.

O aplicativo deve conseguir:

* executar o sidecar;
* capturar `stdout`;
* capturar `stderr`;
* verificar código de saída;
* encerrar o sidecar quando necessário;
* tratar caminhos do Windows corretamente.

## Segurança

Como o aplicativo abre arquivos locais:

* valide todos os caminhos;
* não monte comandos concatenando strings de usuário;
* passe argumentos separadamente;
* não utilize `shell=True` no Python;
* não permita execução arbitrária de comandos;
* não renderize HTML não confiável;
* evite permissões Tauri excessivas.

## Logs

Crie logs locais simples para diagnóstico.

Exemplo:

```text
%APPDATA%/PDFToMarkdown/logs/app.log
```

Não registre o conteúdo integral dos documentos.

Registre apenas:

* horário;
* nome do arquivo, caso necessário;
* duração;
* status;
* erro técnico;
* versão do aplicativo.

Implemente rotação simples ou limite de tamanho para evitar crescimento infinito.

## Configurações

Crie uma tela ou modal simples de configurações com:

* pasta padrão de saída;
* comportamento após conversão;
* abrir pasta automaticamente;
* salvar automaticamente ao lado do PDF;
* limite máximo de arquivo;
* tema do aplicativo;
* opção de preservar configurações entre execuções.

Salve configurações localmente.

Para o MVP, podem ser incluídas apenas:

* pasta padrão de saída;
* salvar automaticamente ao lado do PDF;
* abrir pasta após salvar.

## Acessibilidade

Garanta:

* navegação por teclado;
* foco visível;
* textos de botões claros;
* labels para inputs;
* suporte a Enter e Escape nos diálogos;
* contraste adequado;
* mensagens não dependentes apenas de cor.

## Requisitos de qualidade

* TypeScript em modo estrito.
* Evitar `any`.
* Componentes pequenos e reutilizáveis.
* Serviços separados da interface.
* Tipos compartilhados para respostas do Python.
* Tratamento centralizado de erros.
* Funções com nomes claros.
* Comentários apenas onde agregarem valor.
* Sem código duplicado.
* Sem dependências desnecessárias.
* Sem mocks permanentes na versão final.

## Testes

Crie ao menos:

### Testes do Python

* arquivo inexistente;
* extensão inválida;
* caminho de saída inválido;
* JSON de sucesso;
* JSON de erro;
* caracteres especiais no nome do arquivo.

### Testes da interface

* seleção de PDF;
* rejeição de arquivo inválido;
* estado de conversão;
* exibição de erro;
* exibição de sucesso;
* copiar conteúdo;
* limpar resultado.

Não é necessário testar internamente o Docling, apenas nossa integração.

## Build e instalação

Prepare o projeto para gerar:

* aplicativo de desenvolvimento;
* executável do sidecar;
* build do Tauri;
* instalador do Windows.

Crie scripts como:

```json
{
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build",
    "build:python": "python python/build.py",
    "build:all": "npm run build:python && tauri build"
  }
}
```

Adapte os comandos conforme necessário.

## README obrigatório

Crie um README completo contendo:

1. Visão geral do projeto.
2. Tecnologias utilizadas.
3. Pré-requisitos.
4. Como instalar Rust.
5. Como instalar dependências do Tauri.
6. Como criar o ambiente virtual Python.
7. Como instalar Docling.
8. Como rodar em desenvolvimento.
9. Como gerar o sidecar Python.
10. Como gerar o instalador.
11. Onde os modelos do Docling são armazenados.
12. Como limpar cache e builds.
13. Limitações conhecidas.
14. Solução de problemas comuns.
15. Estrutura de pastas.

Inclua instruções específicas para Windows e PowerShell.

## Forma de trabalho

Antes de começar a programar:

1. Analise os requisitos.
2. Apresente a arquitetura escolhida.
3. Liste as dependências.
4. Explique como será feita a comunicação entre Tauri e Python.
5. Identifique possíveis dificuldades com Docling, PyInstaller e modelos.
6. Depois implemente o projeto por etapas.

Durante a implementação:

* crie os arquivos reais;
* não entregue apenas exemplos isolados;
* não deixe partes essenciais como pseudocódigo;
* execute verificações de TypeScript, Rust e Python quando possível;
* corrija erros encontrados;
* mantenha o projeto executável após cada etapa;
* não altere arquivos fora da pasta do projeto;
* não apague arquivos existentes sem necessidade;
* informe claramente qualquer limitação técnica.

## Prioridade do MVP

Implemente primeiro:

1. Interface básica.
2. Seleção de PDF.
3. Conversor Python funcionando.
4. Execução do Python pelo Tauri.
5. Exibição do Markdown.
6. Salvamento em `.md`.
7. Empacotamento com PyInstaller.
8. Build do aplicativo.

Somente depois implemente:

* configurações;
* logs avançados;
* múltiplos PDFs;
* cancelamento;
* histórico;
* OCR configurável;
* opções avançadas de conversão.

## Resultado esperado

Ao final, quero conseguir executar:

```bash
npm install
python -m venv .venv
.venv\Scripts\activate
pip install -r python\requirements.txt
npm run build:python
npm run dev
```

E abrir um aplicativo desktop funcional que converta PDFs localmente para Markdown.

Depois, quero poder executar:

```bash
npm run build:all
```

e obter um instalador para Windows que funcione sem exigir que o usuário instale Python, Node.js ou Rust separadamente.

Comece analisando o projeto e montando a estrutura inicial. Em seguida, implemente o MVP completo passo a passo.
