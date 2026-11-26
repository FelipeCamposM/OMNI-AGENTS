import { lazy, Suspense, type ComponentProps } from "react";

/**
 * Fork (Roadmaps): a tela (FSRS, markdown, trilha) só carrega quando o usuário abre. Fechada, não
 * custa nada: sem timer, sem poll, sem processo. Mesmo componente e props.
 */
const RoadmapsViewReal = lazy(() => import("./RoadmapsView").then((modulo) => ({ default: modulo.RoadmapsView })));

type Props = ComponentProps<typeof import("./RoadmapsView").RoadmapsView>;

export function RoadmapsView(props: Props) {
  return (
    <Suspense fallback={<div className="h-full p-4 font-mono text-xs text-text-muted">Abrindo roadmaps…</div>}>
      <RoadmapsViewReal {...props} />
    </Suspense>
  );
}
