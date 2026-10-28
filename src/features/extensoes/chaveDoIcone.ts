/**
 * Chave por nome do ícone de uma extensão (`mcp:stitch`, `plugin:vercel`, `conector:gmail`), igual à do
 * Rust (`omni_core::extensoes::chave_do_icone`): é por ela que o ícone salvo na aba Extensões aparece
 * também na conversa.
 */
function limpo(nome: string) {
  return nome.trim().replace(/^claude\.ai/i, "").trim().toLowerCase();
}

export function chaveDoIcone(destino: string, nome: string): string {
  if (destino.startsWith("conector:")) return `conector:${limpo(destino.slice("conector:".length))}`;
  if (destino.startsWith("pacote:")) return `plugin:${limpo(nome)}`;
  return `mcp:${limpo(nome)}`;
}

/**
 * Chave da extensão dona de uma ferramenta chamada na conversa: `mcp__<servidor>__<ferramenta>` do Claude.
 * `plugin_<plugin>_<servidor>` é MCP de plugin; `claude_ai_<Nome>` é conector do claude.ai.
 */
export function chaveDaFerramenta(tool: string | undefined): string | null {
  const servidor = /^mcp__(.+?)__/.exec(tool ?? "")?.[1];
  if (!servidor) return null;
  const conector = /^claude_ai_(.+)$/.exec(servidor)?.[1];
  if (conector) return `conector:${limpo(conector.replace(/_/g, " "))}`;
  const plugin = /^plugin_([^_]+)_/.exec(servidor)?.[1];
  if (plugin) return `plugin:${limpo(plugin)}`;
  return `mcp:${limpo(servidor)}`;
}
