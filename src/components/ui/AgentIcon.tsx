import type { SVGProps } from "react";

/**
 * Marcas dos agentes, em pixel art, traçadas das artes de referência na grade
 * nativa de cada uma. Ficam fora de `PixelIcon.tsx` porque aquele arquivo é
 * gerado do pacote `pixelarticons`, que não traz logos.
 *
 * Cada uma nasce na cor da marca e aceita `fill="currentColor"` quando o
 * contexto (botão pressionado, aba ativa) precisa herdar a cor do texto.
 */
type BrandIconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function makeBrandIcon(path: string, grid: number, brand: string) {
  return function Icon({ size = 16, fill = brand, ...props }: BrandIconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox={`0 0 ${grid} ${grid}`}
        fill={fill}
        aria-hidden="true"
        {...props}
      >
        <path d={path} />
      </svg>
    );
  };
}

/** Claude Code (Anthropic). Grade nativa 16×16, cor de marca #d97757. */
export const ClaudeIcon = makeBrandIcon(
  "M2 3h12v2h-12zM2 5h2v6h-2zM5 5h6v6h-6zM12 5h2v6h-2zM0 7h2v2h-2zM4 7h1v4h-1zM11 7h1v4h-1zM14 7h2v2h-2zM3 11h1v2h-1zM5 11h1v2h-1zM10 11h1v2h-1zM12 11h1v2h-1z",
  16,
  "#d97757"
);

/** OpenAI / Codex / ChatGPT. Grade nativa 57×57.
 *  A marca é preta, que sumiria no tema escuro — herda a cor do texto em vez disso. */
export const GptIcon = makeBrandIcon(
  "M22 7h8v3h-8zM20 8h2v3h-2zM30 8h2v3h-2zM19 9h1v4h-1zM32 9h1v5h-1zM18 10h1v5h-1zM33 10h1v4h-1zM17 11h1v19h-1zM20 11h1v1h-1zM31 11h1v4h-1zM34 11h7v2h-7zM30 12h1v3h-1zM41 12h2v3h-2zM16 13h1v16h-1zM28 13h2v3h-2zM40 13h1v1h-1zM43 13h1v4h-1zM26 14h2v3h-2zM44 14h1v5h-1zM13 15h3v3h-3zM24 15h2v3h-2zM45 15h1v12h-1zM12 16h1v3h-1zM23 16h1v18h-1zM10 17h2v3h-2zM22 17h1v16h-1zM26 17h1v1h-1zM34 17h2v3h-2zM46 17h1v12h-1zM9 18h1v13h-1zM15 18h1v11h-1zM24 18h1v1h-1zM32 18h2v2h-2zM36 18h2v3h-2zM31 19h1v2h-1zM38 19h1v3h-1zM8 20h1v10h-1zM10 20h1v2h-1zM29 20h2v4h-2zM32 20h1v1h-1zM39 20h2v3h-2zM27 21h2v2h-2zM37 21h1v1h-1zM41 21h2v3h-2zM7 22h1v6h-1zM25 22h2v2h-2zM31 22h1v3h-1zM43 22h2v3h-2zM24 23h1v2h-1zM27 23h1v1h-1zM32 23h2v2h-2zM25 24h1v1h-1zM34 24h1v16h-1zM42 24h1v1h-1zM33 25h1v16h-1zM35 25h2v2h-2zM44 25h1v1h-1zM37 26h1v2h-1zM47 26h1v12h-1zM36 27h1v1h-1zM38 27h2v2h-2zM48 27h1v10h-1zM10 28h1v12h-1zM18 28h1v2h-1zM40 28h2v14h-2zM19 29h2v2h-2zM39 29h1v17h-1zM11 30h1v12h-1zM21 30h1v2h-1zM49 30h1v5h-1zM12 31h1v4h-1zM20 31h1v1h-1zM13 32h2v3h-2zM24 32h2v2h-2zM31 32h2v2h-2zM15 33h1v3h-1zM26 33h2v4h-2zM29 33h2v2h-2zM16 34h2v3h-2zM25 34h1v1h-1zM28 34h1v2h-1zM14 35h1v1h-1zM18 35h2v3h-2zM29 35h1v1h-1zM46 35h1v5h-1zM20 36h1v3h-1zM24 36h2v2h-2zM21 37h3v2h-3zM26 37h1v1h-1zM45 37h1v3h-1zM12 38h1v5h-1zM19 38h1v1h-1zM24 38h1v1h-1zM32 38h1v3h-1zM44 38h1v3h-1zM21 39h2v1h-2zM30 39h2v3h-2zM42 39h2v3h-2zM13 40h1v4h-1zM28 40h2v3h-2zM27 41h1v3h-1zM14 42h2v3h-2zM25 42h2v3h-2zM30 42h1v1h-1zM38 42h1v5h-1zM40 42h1v2h-1zM16 43h2v3h-2zM23 43h2v4h-2zM28 43h1v1h-1zM18 44h5v2h-5zM37 44h1v4h-1zM25 45h1v4h-1zM36 45h1v3h-1zM19 46h4v1h-4zM26 46h1v3h-1zM34 46h2v3h-2zM24 47h1v1h-1zM27 47h7v3h-7z",
  57,
  "currentColor"
);

/** Cursor. Grade nativa 33×35 numa caixa 35×35; a marca é preta, herda a cor do texto. */
export const CursorIcon = makeBrandIcon(
  "M16 0h3v9h-3zM14 1h2v8h-2zM19 1h2v8h-2zM12 2h2v7h-2zM21 2h2v7h-2zM11 3h1v6h-1zM23 3h1v6h-1zM9 4h2v5h-2zM24 4h2v5h-2zM7 5h2v4h-2zM26 5h2v4h-2zM5 6h2v3h-2zM28 6h2v3h-2zM3 7h2v2h-2zM30 7h2v2h-2zM2 8h1v19h-1zM32 8h1v19h-1zM1 9h1v17h-1zM33 9h1v17h-1zM3 10h1v18h-1zM31 10h1v18h-1zM4 11h2v17h-2zM6 12h2v17h-2zM30 12h1v16h-1zM8 13h2v17h-2zM29 13h1v16h-1zM10 14h2v17h-2zM12 15h2v18h-2zM28 15h1v14h-1zM14 16h2v18h-2zM27 16h1v14h-1zM16 17h1v18h-1zM26 18h1v12h-1zM25 19h1v12h-1zM24 20h1v11h-1zM23 22h1v10h-1zM22 23h1v10h-1zM21 25h1v8h-1zM5 28h1v1h-1zM20 28h1v6h-1zM7 29h1v1h-1zM19 29h1v5h-1zM9 30h1v1h-1zM11 31h1v1h-1zM18 31h1v4h-1zM17 32h1v3h-1z",
  35,
  "currentColor"
);

/** Ids de CLI com marca desenhada. Id desconhecido cai em `undefined` e não renderiza nada. */
export const AGENT_ICON: Record<string, typeof ClaudeIcon | undefined> = {
  claude: ClaudeIcon,
  codex: GptIcon,
  cursor: CursorIcon,
};

/** Ícone do provider, ou nada quando a CLI não tem marca desenhada. */
export function AgentIcon({ provider, ...props }: BrandIconProps & { provider: string | null | undefined }) {
  const Icon = provider ? AGENT_ICON[provider] : undefined;
  return Icon ? <Icon {...props} /> : null;
}
