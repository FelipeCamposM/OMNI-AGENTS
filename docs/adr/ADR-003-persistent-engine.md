# ADR-003 — Engine persistente separado da UI

Status: aceito em 2026-08-21.

## Decisão

`omni-engine` é um binário Rust separado. Ele possui PTYs, processos, scrollback e snapshots; a UI
Tauri é apenas cliente. Fechar a janela não envia shutdown. Encerrar o engine é uma ação explícita.

Metadados recuperáveis são gravados em `%LOCALAPPDATA%/com.omni.agents/engine/`. Após crash ou
reboot, processos que não podem ser reanexados voltam como `stopped`; o engine nunca os reinicia
nem envia entrada automaticamente.

## Consequências

- sessões continuam enquanto a UI está fechada;
- UI pode reconectar e pedir snapshot incremental;
- empacotamento precisa incluir `omni-engine.exe`;
- lifecycle e logs do engine não dependem do WebView.
