# Windows, macOS e Linux

Um código só. Cada sistema compila o próprio instalador no GitHub Actions.

## Release

1. Subir `VERSION`, rodar `npm run version:sync`, escrever a entrada em `src/lib/changelog.ts`, commitar.
2. `git tag v0.5.0 && git push origin v0.5.0` — a tag precisa bater com `VERSION` (o workflow confere).
3. `.github/workflows/release.yml` compila nas três plataformas e cria um Release **em rascunho** com:
   - Windows: `*-setup.exe` (+ `.msi`)
   - macOS: `.dmg` universal (Intel e Apple Silicon) e `.app.tar.gz` do updater
   - Linux: `.AppImage`, `.deb`, `.rpm`
   - `latest.json` com as três plataformas, cada uma com assinatura do updater
4. Conferir o rascunho e clicar **Publish release**. Publicar como release normal, nunca pre-release.

Secrets do repositório (uma vez): `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
Mesma chave do build local — a pública gravada nos apps instalados não muda.

`npm run build` local continua gerando o instalador Windows para teste.

`.github/workflows/ci.yml` roda testes do engine e compila o app nas três plataformas a cada push.

## Atualização automática

| Sistema | Atualiza sozinho |
|---|---|
| Windows | sim (NSIS) |
| macOS | sim (`.app.tar.gz`) |
| Linux | só o AppImage; `.deb`/`.rpm` precisam reinstalar |

No Windows o hook do NSIS encerra o engine antes de trocar os arquivos. No macOS/Linux não há hook:
o app compara o binário que o engine carregou com o arquivo em disco (`Pong.engine_exe_modified_ms`)
e, se mudou, reinicia o engine. Nos dois casos as sessões abertas caem na atualização.

## Primeira abertura no macOS (app sem Apple Developer)

O app é assinado ad-hoc (`bundle.macOS.signingIdentity: "-"`), não notarizado.

1. Abrir o `.dmg` e arrastar **OMNI AGENTS** para **Aplicativos**.
2. Abrir o app. O macOS avisa que não pôde verificar o desenvolvedor — fechar o aviso.
3. **Ajustes do Sistema → Privacidade e Segurança** → rolar até o aviso do OMNI AGENTS → **Abrir Mesmo Assim**.
4. Confirmar com a senha. Das próximas vezes abre direto; atualizações pelo app não repetem o aviso.

Se aparecer "está danificado", rodar no Terminal:
`xattr -dr com.apple.quarantine "/Applications/OMNI AGENTS.app"`

## Windows: aviso do SmartScreen

Sem certificado de assinatura de código o SmartScreen mostra "O Windows protegeu o computador"
(**Mais informações → Executar assim mesmo**). A assinatura do updater (`TAURI_SIGNING_*`) não
resolve isso — ela só protege a atualização automática. Só some com certificado Authenticode.

## Diferenças por sistema

| | Windows | macOS | Linux |
|---|---|---|---|
| Dados do engine | `%LOCALAPPDATA%\com.omni.agents` | `~/Library/Application Support/com.omni.agents` | `~/.local/share/com.omni.agents` |
| Shell dos terminais | Git Bash, senão PowerShell | `$SHELL -l` | `$SHELL -l` |
| Login do agente | janela PowerShell | Terminal.app | x-terminal-emulator / gnome-terminal / konsole / xfce4-terminal / xterm |
| Processo do agente | ToolHelp (`claude.exe`) | `ps` | `ps` |
| Login Claude detectado por | `.credentials.json` | `oauthAccount` no `.claude.json` (token fica no Keychain) | `.credentials.json` |

App aberto pelo Finder/menu herda PATH mínimo; na inicialização o app importa o PATH do shell de
login do usuário (`engine_client::import_login_shell_path`) para achar `claude`/`codex`.

## Roteiro de teste (macOS/Linux)

Marcar o que funcionou e mandar print do que não funcionou.

1. Instalar e abrir (seção acima no macOS).
2. Rodapé mostra `ENGINE: ONLINE`.
3. Configurações → Agentes: Claude/Codex aparecem como instalados; conta logada aparece conectada.
4. Adicionar um projeto (pasta qualquer). Abrir um terminal: prompt do shell aparece, `ls` funciona.
5. Abrir um agente Claude: sobe sem pedir "trust this folder".
6. Com o Claude parado, clicar ↻ no rodapé: aparece 5H/SEMANA com reset.
7. Painel de arquivos: abrir, editar e salvar um arquivo. Painel git: status e histórico aparecem.
8. Conectar conta nova (Configurações → Agentes): abre o Terminal com o login do CLI.
9. Fechar o app e abrir de novo: terminais voltam.
10. Atualização: com a versão N instalada, publicar N+1 e confirmar que o app atualiza e o
    `ENGINE: ONLINE` volta (engine reiniciado).
11. Atalhos usam **Ctrl**, não Cmd, no macOS — anotar quais incomodam.

Riscos conhecidos a observar:
- **AppImage:** o engine continua rodando depois que o app fecha, mas a imagem montada do AppImage
  some junto com o app. Se o engine cair depois de fechar a janela, é isso.
- `.zshrc` lento (>3 s) ou que pede input: `claude` pode não ser encontrado.
