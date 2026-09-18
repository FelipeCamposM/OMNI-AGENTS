import { PALETA_PADRAO } from "../lib/palettes";
import type { ShortcutOverrides } from "../lib/shortcuts";

export type Theme = "escuro" | "claro" | "sistema";
/**
 * Fundos estáticos (CSS, em `src/index.css`) mais qualquer id de efeito
 * animado registrado em `src/components/backgrounds/registry.tsx`.
 * O `(string & {})` mantém o autocomplete dos presets sem travar ids novos —
 * adicionar efeito não deve exigir mexer neste arquivo.
 */
export type Background =
  | "mesh-1"
  | "mesh-2"
  | "mesh-3"
  | "custom"
  | "nenhum"
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});
export type GlassLevel = "sutil" | "medio" | "forte";
export type MotionLevel = "completas" | "reduzidas" | "desligadas";

/** Preferências visuais do shell. Cada workspace/pane herda daqui. */
export interface AppSettings {
  theme: Theme;

  /**
   * Id da paleta de cor (ver `src/lib/palettes.ts`). Vale para ícones, foco,
   * opção selecionada, barra de rolagem e os fundos animados — id desconhecido
   * cai na primeira paleta em vez de deixar o app sem cor.
   */
  accent: string;
  background: Background;
  /** Caminho no disco; só usado quando background === "custom". */
  backgroundPath: string;
  backgroundOpacity: number; // 0..100
  backgroundBlur: number; // px, 0..40
  /** Opacidade do fundo dos terminais, 0..100 — abaixo de 100 o fundo do app aparece atrás do texto. */
  terminalOpacity: number;
  glass: GlassLevel;
  animations: MotionLevel;

  /** Como o painel de arquivos salva edições: sozinho com debounce, ou só no Ctrl+S. */
  fileSaveMode: "auto" | "manual";

  /** Toast do Windows + piscar na barra quando um agente pede atenção com o app fora de foco. */
  notifyAttention: boolean;

  /** Só os atalhos que o usuário trocou; o resto cai no padrão de `SHORTCUTS`. */
  shortcuts: ShortcutOverrides;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "escuro",

  accent: PALETA_PADRAO,
  background: "gradient-waves",
  backgroundPath: "",
  backgroundOpacity: 55,
  backgroundBlur: 0,
  terminalOpacity: 100,
  glass: "forte",
  animations: "completas",

  fileSaveMode: "auto",

  notifyAttention: true,

  shortcuts: {},
};
