import { useEffect, useRef } from "react";
import gsap from "gsap";
import { CATEGORY_ORDER, CATEGORY_LABELS, toolsByCategory } from "../tools/registry";
import { useStagger } from "../lib/motion";
import { NovidadesAviso } from "./Novidades";

interface HomeProps {
  onSelect: (id: string) => void;
  /** Última versão cujas novidades o usuário já viu (`settings.lastSeenVersion`). */
  ultimaVersaoVista: string;
  onNovidadesVistas: (versao: string) => void;
}

export function Home({ onSelect, ultimaVersaoVista, onNovidadesVistas }: HomeProps) {
  const gridRef = useStagger<HTMLDivElement>("[data-tool-card]");

  return (
    <div ref={gridRef} className="space-y-8">
      <div>
        <h1 className="text-text-primary text-xl font-semibold">CAMPS-UTILS</h1>
        <p className="text-text-muted text-sm">
          Ferramentas de conversão locais. Escolha uma ferramenta para começar.
        </p>
      </div>

      <NovidadesAviso ultimaVista={ultimaVersaoVista} onVisto={onNovidadesVistas} />

      {CATEGORY_ORDER.map((category) => {
        const tools = toolsByCategory(category);
        if (tools.length === 0) return null;
        return (
          <section key={category} className="space-y-3">
            <h2 className="text-text-secondary text-xs font-medium uppercase tracking-wider">
              {CATEGORY_LABELS[category]}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {tools.map((tool) => (
                <ToolCard key={tool.id} tool={tool} onSelect={onSelect} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ToolCard({
  tool,
  onSelect,
}: {
  tool: ReturnType<typeof toolsByCategory>[number];
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);

  // Tilt sutil seguindo o cursor + brilho do vidro na mesma passada.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    gsap.set(el, { transformPerspective: 600 });
    const rx = gsap.quickTo(el, "rotateX", { duration: 0.5, ease: "power3.out" });
    const ry = gsap.quickTo(el, "rotateY", { duration: 0.5, ease: "power3.out" });

    function onMove(e: PointerEvent) {
      const r = el!.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      el!.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el!.style.setProperty("--my", `${e.clientY - r.top}px`);
      rx(-(py - 0.5) * 6);
      ry((px - 0.5) * 6);
    }
    function onLeave() {
      rx(0);
      ry(0);
    }

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      // Escopado nas props do tilt: killTweensOf(el) apagaria o stagger de
      // entrada da grade e o card ficaria invisível.
      gsap.killTweensOf(el, "rotateX,rotateY");
    };
  }, []);

  return (
    <button
      ref={ref}
      data-tool-card
      onClick={() => onSelect(tool.id)}
      aria-label={`Abrir ${tool.name}`}
      className="group glass glass-hover glass-sheen flex items-start gap-3 p-4 text-left will-change-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <span className="neon-idle w-8 h-8 shrink-0 rounded-lg bg-selected/20 p-1.5 transition-colors group-hover:bg-selected/30">
        {tool.icon}
      </span>
      <span className="min-w-0">
        <span className="block text-text-primary text-sm font-medium">{tool.name}</span>
        <span className="block text-text-muted text-xs">{tool.description}</span>
      </span>
    </button>
  );
}
