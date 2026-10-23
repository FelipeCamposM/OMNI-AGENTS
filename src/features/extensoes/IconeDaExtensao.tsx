import type { ComponentType, SVGProps } from "react";
import { AgentIcon } from "../../components/ui/AgentIcon";
import { DockerIcon, GithubIcon, NpmIcon, VercelIcon } from "../../components/ui/PixelIcon";

type Icone = ComponentType<SVGProps<SVGSVGElement>>;

/** Marcas que já temos desenhadas, achadas pelo nome ou pelo destino (URL/comando) da extensão. */
const MARCAS: [RegExp, Icone | string][] = [
  [/github/, GithubIcon], [/vercel/, VercelIcon], [/docker/, DockerIcon], [/\bnpm\b/, NpmIcon],
  [/claude|anthropic/, "claude"], [/openai|codex|chatgpt/, "codex"], [/cursor/, "cursor"], [/antigravity/, "antigravity"],
];

/** Cor da inicial de quem não tem logo: das conhecidas, a da marca; do resto, uma estável pelo nome. */
const CORES: [RegExp, string][] = [
  [/figma/, "242 78 30"], [/stripe/, "99 91 255"], [/supabase/, "62 207 142"], [/notion/, "200 200 210"], [/slack/, "224 30 90"],
  [/linear/, "94 106 210"], [/gmail|google|drive|calendar/, "66 133 244"], [/canva/, "0 196 204"], [/lucid/, "255 130 0"],
  [/vercel|github/, "220 220 230"], [/mercado ?pago/, "0 158 227"], [/playwright|chrome/, "45 173 90"],
];
const PALETA = ["249 115 22", "168 85 247", "59 130 246", "16 185 129", "236 72 153", "234 179 8", "20 184 166", "239 68 68"];

function corDe(chave: string) {
  const conhecida = CORES.find(([re]) => re.test(chave))?.[1];
  if (conhecida) return conhecida;
  let h = 0;
  for (const c of chave) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETA[h % PALETA.length];
}

/**
 * A "foto" de um MCP, plugin ou conector: o logo do pacote quando o plugin traz (lido do manifesto
 * pelo Rust, já em `data:`), senão a marca que o app já tem desenhada, senão a inicial numa cor.
 */
export function IconeDaExtensao({ nome, logo, destino }: { nome: string; logo?: string | null; destino?: string }) {
  if (logo) return <span className="ext-foto is-logo" aria-hidden><img src={logo} alt="" draggable={false} /></span>;
  const chave = `${nome} ${destino ?? ""}`.toLowerCase();
  const marca = MARCAS.find(([re]) => re.test(chave))?.[1];
  if (typeof marca === "string") return <span className="ext-foto is-marca" aria-hidden><AgentIcon provider={marca} size={16} /></span>;
  if (marca) { const Marca = marca; return <span className="ext-foto is-marca" aria-hidden><Marca className="h-4 w-4" /></span>; }
  const inicial = nome.replace(/^(plugin|mcp)[-_ ]?/i, "").match(/[a-z0-9]/i)?.[0]?.toUpperCase() ?? "?";
  return <span className="ext-foto" style={{ "--cor": corDe(chave) } as React.CSSProperties} aria-hidden>{inicial}</span>;
}
