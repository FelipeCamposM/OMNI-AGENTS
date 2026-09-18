/**
 * Comparação de caminho de projeto, num lugar só.
 *
 * Existiam três regras diferentes espalhadas (`workspaceReducer`, `recentProjectsService`,
 * `samePath` do histórico): uma só baixava a caixa, outra também trocava separador, nenhuma sabia
 * que `\\wsl$\Ubuntu\p` e `\\wsl.localhost\Ubuntu\p` são a mesma pasta. O resultado era projeto
 * duplicado na lista e filtro de histórico que não achava a conversa.
 */

/** Forma canônica: barra normal, sem barra final, minúsculo, host do WSL unificado. */
export function normalizePath(path: string): string {
  const semBarra = path.replace(/\\/g, "/").replace(/\/+$/, "");
  // `wsl$` é o host antigo; o Explorer moderno grava `wsl.localhost` para a mesma pasta.
  return semBarra.replace(/^\/\/wsl\$\//i, "//wsl.localhost/").toLowerCase();
}

export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  return a != null && b != null && normalizePath(a) === normalizePath(b);
}

/** `\\wsl.localhost\Ubuntu\home\ana\proj` (ou `\\wsl$\...`) → `Ubuntu`. */
export function wslDistroOf(path: string): string | null {
  const match = /^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)/i.exec(path.replace(/\\/g, "/"));
  return match ? match[1] : null;
}

export function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * Onde os comandos de um projeto rodam, em texto para a UI. `null` = projeto local, nada é
 * desviado. A conta SSH é resolvida pelo caminho montado, então aqui só sai o rótulo genérico.
 */
export function targetLabel(path: string, sshDrives: Record<string, string> = {}): string | null {
  const distro = wslDistroOf(path);
  if (distro) return `WSL · ${distro}`;
  const drive = /^([a-z]):/i.exec(path)?.[1];
  const conexao = drive ? sshDrives[`${drive.toUpperCase()}:`] : undefined;
  return conexao ? `SSH · ${conexao}` : null;
}
