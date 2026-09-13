/** Atalhos que o xterm.js não entrega do jeito que este app precisa.
 *
 *  Armadilha central: `attachCustomKeyEventHandler` devolvendo `false` só diz "xterm, não processa
 *  essa tecla" — **não** cancela o evento. A ação padrão do browser continua acontecendo. Quem
 *  quiser realmente substituir a tecla precisa chamar `preventDefault()` na mão; quem quiser a
 *  ação padrão (o paste nativo) precisa justamente NÃO chamar. Errar isso foi o que fez o Ctrl+V
 *  colar duas vezes e o Shift+Enter enviar a mensagem.
 */
export interface TerminalKeyContext {
  hasSelection: () => boolean;
  copySelection: () => void;
  /** Escreve direto na PTY da sessão (ignora se não houver sessão viva). */
  write: (data: string) => void;
}

/** `true` = deixa o xterm tratar a tecla. `false` = xterm não trata. */
export function handleTerminalKey(event: KeyboardEvent, ctx: TerminalKeyContext): boolean {
  if (event.type !== "keydown") return true;

  // xterm.js segue a convenção clássica de terminal Unix: Ctrl+V manda o byte de controle literal
  // (^V) pro shell, só Shift+Insert/Ctrl+Shift+V colam. Este app é Windows-first — aqui Ctrl+V
  // sozinho também cola, sem tirar os atalhos antigos.
  if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
    const key = event.key.toLowerCase();

    // Sem `preventDefault` de propósito: tirar a tecla do xterm já impede o ^V, e a ação padrão
    // do browser (paste nativo) cai no textarea do xterm, que cola respeitando bracketed paste.
    // Ler o clipboard e escrever na PTY aqui colava o texto uma segunda vez — e sem bracketing,
    // o que faz CLI tipo Claude Code enviar cada linha de um texto multi-linha separadamente.
    if (key === "v") return false;

    // Ctrl+C só copia quando há seleção (como todo terminal moderno); sem seleção continua sendo
    // o SIGINT de sempre, e nem entramos aqui.
    if (key === "c" && ctx.hasSelection()) {
      ctx.copySelection();
      event.preventDefault();
      return false;
    }
  }

  // xterm.js real só olha `altKey` pro Enter (Alt+Enter manda ESC+CR) — Shift é ignorado, então
  // Shift+Enter saía idêntico a Enter puro (\r) e a CLI (Claude Code etc.) nunca via "quebra de
  // linha sem enviar". A sequência que essas CLIs (Ink) leem é ESC+CR (meta+Enter) — a mesma que
  // o `/terminal-setup` do Claude Code instala no VS Code e no iTerm2. CSI-u (ESC[13;2u) só vale
  // se a CLI ligar o protocolo kitty/fixterms; o Ink não liga, então aquilo chegava como lixo.
  if (event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && event.key === "Enter") {
    // Aqui o `preventDefault` é obrigatório: sem ele o browser ainda insere o "\n" no textarea do
    // xterm, o xterm manda esse "\n" pra PTY e a CLI entende como "enviar" — a mensagem ia embora
    // mesmo depois de a sequência certa ter sido escrita.
    event.preventDefault();
    ctx.write("\x1b\r");
    return false;
  }

  return true;
}
