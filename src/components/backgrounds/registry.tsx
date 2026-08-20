import { lazy, useEffect, useRef } from "react";
import type { ComponentType, LazyExoticComponent } from "react";
import type { CoresEfeito } from "../../lib/palettes";

/**
 * Registro dos fundos animados (React Bits). Mesmo padrão do
 * `src/tools/registry.tsx`: uma entrada aqui e o efeito já aparece nas
 * Configurações — nenhum outro arquivo precisa mudar.
 *
 * ── Como adicionar um efeito novo ────────────────────────────────────────
 * 1. `pnpm dlx shadcn@latest add @react-bits/<Nome>-TS-TW`
 *    (cai em `src/components/<Nome>/<Nome>.tsx` — ver components.json)
 * 2. Adicione uma entrada em BACKGROUND_EFFECTS abaixo, com os props do
 *    preset já embutidos no `lazy(...)`. As cores saem de `cores` (paleta do
 *    usuário), nunca hexadecimal fixo — senão o efeito ignora a escolha dele.
 * 3. Só isso. O `<AppBackground>` monta, as Configurações listam, e as
 *    settings aceitam o novo id porque `Background` é string.
 *
 * Regras dos efeitos:
 * - NÃO edite o arquivo vendorizado em `src/components/<Nome>/` — um
 *   `shadcn add` futuro sobrescreve. Presets moram aqui.
 * - O componente ocupa 100% do container e não recebe ponteiro (o
 *   AppBackground já cuida de posição, veil e pointer-events).
 * - `lazy` é obrigatório: cada efeito arrasta WebGL (ogl ~50 kB) e só deve
 *   entrar no bundle de quem escolheu usar.
 */
export interface BackgroundEffectProps {
  className?: string;
  /** true = renderiza parado (o usuário desligou animações ou o SO pediu). */
  still?: boolean;
  /**
   * Cores derivadas da paleta escolhida (`src/lib/palettes.ts`). Vêm por prop
   * porque canvas WebGL não enxerga CSS var — o efeito precisa do hexadecimal
   * na mão. Quem monta é o `<AppBackground>`.
   */
  cores: CoresEfeito;
}

export interface BackgroundEffect {
  /** Id gravado em `settings.background`. Estável — trocar reseta a escolha. */
  id: string;
  /** Rótulo nas Configurações (pt-BR). */
  label: string;
  component: LazyExoticComponent<ComponentType<BackgroundEffectProps>>;
}

const GradientWavesPreset = lazy(async () => {
  const { default: GradientWaves } = await import("../GradientWaves/GradientWaves");
  return {
    default: ({ className, still, cores }: BackgroundEffectProps) => (
      <GradientWaves
        className={className}
        speed={still ? 0 : 0.4}
        horizonColor={cores.ondas.horizonte}
        waveColor={cores.ondas.onda}
        crestColor={cores.ondas.crista}
        amplitude={1.25}
        waveScale={1.6}
        waveRatio={1.3}
        swell={16.5}
        turbulence={26.5}
        tilt={1.11}
        zoom={1.1}
        height={10}
        fogDepth={19}
        detail="medium"
        brightness={1.25}
        opacity={1}
        grain
        grainIntensity={0.05}
        mouseInteraction={false}
        parallaxStrength={0.5}
      />
    ),
  };
});

/**
 * Repassa o cursor da janela para o canvas do efeito.
 *
 * O <AppBackground> é `pointer-events: none` de propósito — sem isso o fundo
 * roubaria cliques da UI inteira. Só que o FloatingLines escuta `pointermove`
 * no próprio canvas, então `interactive`/`parallax` nunca disparariam. Aqui a
 * posição vem da janela e é reemitida no canvas.
 *
 * Fora do arquivo vendorizado de propósito: `src/components/FloatingLines.tsx`
 * é sobrescrito por um `shadcn add` futuro.
 */
function usePointerBridge(ativo: boolean) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!ativo) return;
    const host = hostRef.current;
    if (!host) return;

    function onMove(e: PointerEvent) {
      // O canvas é criado num efeito do filho, então só existe depois deste
      // effect rodar — busca preguiçosa, cacheada.
      if (!canvasRef.current) {
        canvasRef.current = host!.querySelector("canvas");
        if (!canvasRef.current) return;
      }
      canvasRef.current.dispatchEvent(
        new PointerEvent("pointermove", { clientX: e.clientX, clientY: e.clientY })
      );
    }

    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointermove", onMove);
      canvasRef.current = null;
    };
  }, [ativo]);

  return hostRef;
}

const FloatingLinesPreset = lazy(async () => {
  const { default: FloatingLines } = await import("../FloatingLines");
  return {
    default: ({ className, still, cores }: BackgroundEffectProps) => {
      const hostRef = usePointerBridge(!still);
      return (
        // O FloatingLines não aceita `className` (é `w-full h-full` fixo), daí
        // o wrapper — que também ancora a ponte de ponteiro.
        <div ref={hostRef} className={className}>
          <FloatingLines
            linesGradient={cores.linhas}
            animationSpeed={still ? 0 : 0.6}
            interactive={!still}
            bendRadius={5}
            bendStrength={-0.5}
            mouseDamping={0.05}
            parallax={!still}
            parallaxStrength={0.2}
          />
        </div>
      );
    },
  };
});

export const BACKGROUND_EFFECTS: BackgroundEffect[] = [
  {
    id: "gradient-waves",
    label: "Ondas",
    component: GradientWavesPreset,
  },
  {
    id: "floating-lines",
    label: "Linhas flutuantes",
    component: FloatingLinesPreset,
  },
];

export function getBackgroundEffect(id: string): BackgroundEffect | undefined {
  return BACKGROUND_EFFECTS.find((e) => e.id === id);
}

export function isBackgroundEffect(id: string): boolean {
  return BACKGROUND_EFFECTS.some((e) => e.id === id);
}
