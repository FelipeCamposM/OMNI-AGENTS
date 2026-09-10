# Uso por conta e acesso pelo celular

## Uso por conta

Em **Configurações → Agentes**, cada conta Claude/Codex tem consumo de 5 horas, consumo semanal,
reset e origem da observação. Ausência de dado não significa 0%.

- **Codex:** leitura local do último `event_msg/token_count` no rollout mais recentemente
  modificado em `<config_dir>/sessions`. Valida percentual e duração das janelas; ignora uma
  cauda ainda incompleta. Cache de 60 segundos. Depois do reset, o registro anterior aparece
  desatualizado até uma nova medição. Não consulta rede nem arquivo de autenticação.
- **Claude:** botão **Consultar /usage**, cache de cinco minutos para resultados e 15 segundos
  para falhas. Usa somente sessão existente do perfil. Reconhece o prompt vazio, o processo
  Claude descendente da PTY e o modo de colagem; reserva a entrada enquanto consulta (até dez
  segundos). A tela é reconstruída de bytes ANSI pelo `vt100`, incluindo resize.
  Se o prompt não for reconhecido, abra `/usage` manualmente naquele agente e clique novamente:
  uma tela de uso já aberta pode ser lida sem digitar nem fechar o diálogo do usuário.
- A leitura Claude é **melhor esforço**. Aceita as seções em inglês `Current session` e
  `Current week (all models)`, percentual explicitamente marcado `% used` e linha `Resets`.
  Limites por modelo não substituem o semanal geral. O reset da TUI é mostrado literalmente,
  sem converter uma data/fuso ambíguo. Formatos desconhecidos ficam indisponíveis.

Não há leitura de `.credentials.json` nem chamada direta ao endpoint OAuth de uso. Nenhuma
sessão é criada para consultar limites. Os fixtures de parser são sintéticos; validação contra
a versão do Claude instalada deve ser feita numa sessão existente, sem criar uma apenas para isso.

## Acesso pelo celular

1. Instale e conecte o Tailscale no PC e no celular, na mesma conta.
2. No desktop, abra **Configurações → Celular**.
3. Informe o IP do PC mostrado pelo Tailscale, com a porta, por exemplo `100.x.x.x:47322`.
4. Clique **Ativar / aplicar** e abra o endereço apresentado no navegador do celular.

O PC precisa estar ligado, sem suspensão, com o engine e o Tailscale ativos. Fechar a janela
desktop não encerra o servidor HTTP. O acesso começa desativado; `127.0.0.1:47322` permite
teste local. A interface remota deve corresponder ao IP retornado por `tailscale ip -4` no PC.
Não há fallback para `0.0.0.0`. Se o Tailscale não estiver disponível, a falha aparece nas
configurações e o engine desktop continua funcionando; aplique novamente após conectar.

Configuração: `%LOCALAPPDATA%/com.omni.agents/engine/mobile.json`. O TCP privilegiado continua
somente em `127.0.0.1:47321`. A autorização de dispositivos pertence ao Tailscale; o OMNI não
adiciona login, domínio, relay, túnel ou credencial no navegador. Não há PWA/push.

O celular lista conversas, mostra mensagens e permite responder ou permitir/negar um pedido
reconhecido. Não é um terminal. Sem sessão viva, a conversa permanece consultável, mas o envio
fica desativado. Os adaptadores de escrita são conservadores e verificam processos Windows;
menus desconhecidos exigem intervenção no desktop. O rótulo “Possível aprovação pendente”
vem da heurística antiga; sozinho não habilita o botão de aprovação.

## Contrato HTTP

UI e API usam a mesma origem, com validação de `Host`, `Origin` nos POSTs e corpos JSON limitados.

| Rota | Contrato |
| --- | --- |
| `GET /conversas` | Lista resumida, provider/perfil, estado e capacidades/revisão atuais. |
| `GET /conversas/:id/timeline?cursor=0` | Até 100 mensagens, próximo cursor, trechos indisponíveis e ações recentes. |
| `POST /conversas/:id/prompt` | `{ "texto": "..." }`, até 16000 bytes; sem slash command ou controles de terminal. |
| `POST /conversas/:id/aprovar` | `{ "permitir": true }` ou `false`; apenas escolha de uso único reconhecida. |
| `GET /atencao` | Sessões esperando entrada e possíveis pedidos de aprovação. |

Ambos os POSTs exigem `Idempotency-Key` e `If-Match` com a revisão retornada nas capacidades.
Respondem `202` com a ação. A fila do engine revalida sessão, processo, tela e revisão antes de
escrever; não inicia processos. Os estados são `queued`, `executing`, `sent` e `rejected`.
`sent` confirma a escrita na PTY, não a conclusão do trabalho pelo agente.

Limites: 128 ações esperando, 1024 registros, expiração de 60 segundos para executar e retenção
de dez minutos para idempotência. Mudança de contexto retorna `412`; sessão indisponível, `409`;
fila cheia, `429`. Não se reproduz a fila após reiniciar o engine. A UI mantém a chave em caso de
timeout, inclusive se atualizar o status antes de tentar novamente.

O índice continua em `conversations.json`; não há cópia do transcript. Claude usa os ponteiros
existentes e deduplica UUIDs preservados na troca de conta. Para Codex sem ID nativo, exige um
único rollout com metadados compatíveis de perfil, projeto e início do trecho (janela de 30 s);
ambiguidade resulta em histórico indisponível. Eventos de ferramentas não são expostos como
mensagens do usuário.

## Build e verificação

- `npm run build:engine` e `npm run build:engine:release` geram o bundle mobile antes do Rust.
  Os assets são embutidos no binário; não é necessário rodar Vite para acessar pelo celular.
- Para compilar diretamente com Cargo, rode primeiro `npm run build:mobile`.
- `node scripts/check-mobile-browser.mjs` inicia um servidor Rust com dados fictícios, abre
  Chrome headless com perfil isolado e verifica lista/detalhe em 320, 390 e 768 px. Exige Chrome
  instalado; `CHROME_PATH` permite escolher seu executável. Capturas ficam em `target/`.
  Nenhum perfil real ou sessão de agente é usado. A rota de encerramento do fixture existe
  somente no teste, nunca no engine distribuído.

Antes de considerar validados os CLIs em produção, conferir `/usage` e os diálogos reais de
Claude/Codex em sessões existentes. Também testar num celular em 4G com Tailscale, inclusive
após fechar a janela desktop. Esses testes dependem de ambiente/dispositivos que os testes
automatizados locais não substituem.
