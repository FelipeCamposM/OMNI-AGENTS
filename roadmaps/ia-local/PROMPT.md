# Prompt de arranque — Fase A (legenda automática)

Cole isto numa sessão nova do Claude Code, na raiz do projeto.

Foi escrito só para a **Fase A**. Cada fase seguinte merece o seu, com o mesmo formato: contexto
curto, escopo fechado, o que **não** fazer, e como verificar.

---

```
Leia antes de qualquer coisa:
- CLAUDE.md
- roadmaps/ia-local/roadmap.md  (o plano desta fase)
- src-tauri/src/commands.rs     (RemoteModule, ensure_module, resolve_bundled)
- python/build.py               (build_docling é o modelo a espelhar)
- src/components/ModuleGate.tsx (MODULES e o gate que bloqueia a tool)
- src/tools/registry.tsx        (como uma ferramenta é registrada)

OBJETIVO — Fase A e só ela: transcrição de vídeo para legenda.
Entra um vídeo, sai um .srt/.vtt correto. Sem estilo, sem queimar no vídeo, sem
editor de texto. Essas são as fases B e C e NÃO entram agora.

ANTES DE ESCREVER CÓDIGO DE PRODUÇÃO, faça o passo 0:

  Passo 0 — medir o peso real.
  Empacote um protótipo mínimo com PyInstaller usando faster-whisper e me diga
  quantos MB deu o .exe. O roadmap chuta 100–200 MB e esse chute pode estar
  muito errado: o bundle do Docling foi estimado "grande" e virou 700 MB.
  Se passar de ~400 MB, PARE e me apresente as alternativas antes de continuar.
  Não siga para o passo 1 sem eu confirmar o número.

Depois, nesta ordem:

1. Módulo `whisper-v1`
   - `RemoteModule WHISPER` em commands.rs, no mesmo formato de DOCLING e FFMPEG.
   - `python build.py whisper` gerando camps-whisper.zip + SHA256, espelhando
     build_docling. Conferir que o zip é reproduzível (empacotar 2x, comparar
     hash) — foi assim que o SHA do ffmpeg pôde ser fixado no código.
   - Comandos `whisper_installed` / `ensure_whisper`, evento `whisper-progress`.
   - Entrada em MODULES no ModuleGate.tsx.

2. Modelo separado do runtime
   - O usuário escolhe: tiny / base / small / medium / large-v3. Padrão: small.
   - Setting nova `whisperModel` em src/types/settings.ts + controle na seção
     Mídia das Configurações.
   - O modelo baixa na primeira transcrição, como o Docling faz com o cache da
     HuggingFace. NÃO empacotar modelo dentro do zip do módulo.

3. Tool Python `transcribe` no converter.py
   - Entrada: { inputPath, language, model, wordTimestamps }
   - language padrão "pt" FORÇADO. A autodetecção do Whisper confunde português
     com espanhol e o resultado fica sutilmente errado.
   - Extrair áudio com o ffmpeg antes (16 kHz mono WAV) — o ffmpeg já está
     resolvido por resolve_bundled.
   - Saída: segmentos + palavras com tempo, no contrato de uma linha JSON no
     stdout que o projeto já usa.
   - Progresso REAL via PROGRESS: no stderr. O faster-whisper reporta por
     segmento — aqui não se inventa progresso como no Docling.

4. Segmentação de linhas — a parte que decide a qualidade
   - Módulo Python separado e PURO (sem I/O), porque precisa de teste de unidade.
   - Regras: máx. 2 linhas, ~42 caracteres por linha, quebrar em fronteira de
     frase, respeitar duração mínima e máxima por bloco.
   - Casos que os testes precisam cobrir: segmento longo do Whisper virando
     vários blocos; frase curta que não deve ser quebrada; palavra maior que o
     limite de linha; e nunca quebrar entre "não" e o verbo.
   - Se isto ficar ruim, o recurso inteiro fica ruim. É onde vale gastar tempo.

5. Ferramenta na interface
   - Nova tool `video-subtitle` no registry.tsx com module: "whisper".
     O App já embrulha no ModuleGate sozinho — não escrever gate na tool.
   - Reusar DropZone, Button, ResultPanel, SegmentedControl do kit em
     src/components/ui. Não criar componente novo se já existe equivalente.
   - Escolher formato de saída: .srt ou .vtt.

O QUE NÃO FAZER NESTA FASE
- Nada de .ass, estilo visual, preview ou queimar legenda no vídeo (fase B).
- Nada de editor de transcrição nem karaokê palavra a palavra (fase C).
- Nada de tradução (fase D).
- Não instalar PyTorch. Se algo puxar torch, pare e me avise.
- Não editar os arquivos vendorizados em src/components/<Nome>/.

VERIFICAÇÃO — nada é "pronto" sem isto passando:
  npm run typecheck
  npm run test
  .venv\Scripts\python.exe -m pytest python/test_converter.py -q
  cargo check --manifest-path src-tauri/Cargo.toml

E o teste que importa de verdade, que só roda no app real:
  npm run dev  → baixar o módulo, transcrever um vídeo curto em português,
  abrir o .srt no VLC e conferir que os tempos batem com a fala.

AO TERMINAR
- Atualizar roadmaps/ia-local/roadmap.md: marcar os checkboxes da Fase A,
  SUBSTITUIR as estimativas de peso pelos números medidos, e anotar as
  armadilhas encontradas com caminho de arquivo.
- Se aparecer uma decisão que muda o plano das fases seguintes, escrever isso
  no roadmap em vez de deixar só na conversa.
```

---

## Por que o prompt é assim

Três coisas nele existem por causa de erro real já cometido neste projeto:

**O passo 0 bloqueante.** O bundle do Docling foi estimado "grande" e virou 700 MB, o que depois
custou o trabalho inteiro de criar o sistema de módulos e tirar o ffmpeg do instalador. Medir antes
de construir é mais barato que descobrir depois.

**"Progresso REAL, aqui não se inventa".** O `useConversion` avança um contador falso num
`setInterval` porque o Docling não reporta progresso. É uma dívida conhecida — não vale replicá-la
onde a biblioteca de fato reporta.

**"Se algo puxar torch, pare e me avise".** É a diferença entre um módulo de 150 MB e um de 2 GB, e
costuma entrar de carona sem ninguém perceber.
