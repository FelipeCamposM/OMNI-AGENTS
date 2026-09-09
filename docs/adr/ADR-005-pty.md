# ADR-005 — PTY com `portable-pty`

Status: aceito para o spike/MVP em 2026-08-21.

## Decisão

Usar `portable-pty` 0.9, que abstrai ConPTY no Windows e expõe spawn, leitura, escrita e resize.
PowerShell é o shell padrão no Windows; outros shells poderão ser selecionados por sessão.

## Limites

Antes do release, validar TUI, Unicode, paste, cursor e resize em Windows 10 e 11. Se problemas de
ConPTY bloquearem esses critérios, avaliar `xpty` ou integração Win32 direta sem mudar o protocolo.
