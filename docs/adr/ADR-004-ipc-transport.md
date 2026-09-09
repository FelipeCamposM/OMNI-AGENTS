# ADR-004 — IPC local por TCP autenticado

Status: aceito para o MVP em 2026-08-21.

## Decisão

O protocolo usa JSON por linha em TCP, limitado a `127.0.0.1:47321`. Cada requisição carrega um
token aleatório guardado no diretório privado do engine. Contratos moram em `omni-protocol` e são
compartilhados pelo engine e pelo cliente Tauri.

## Motivo

Loopback funciona de forma previsível no Windows, é fácil de testar e não prende o protocolo à
implementação Tauri. Named Pipes podem substituir o transporte sem mudar os contratos.

## Segurança

O listener nunca usa interfaces externas. Requisição sem token válido é recusada. Tokens não são
logados e arquivos do engine devem herdar ACL do AppData do usuário.
