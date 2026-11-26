import { lazy, Suspense, type ComponentProps } from "react";

// Estudos (roadmaps com FSRS e markdown, Pomodoro, análises): só baixa no celular quando a tela abre.
const Real = lazy(() => import("./Estudos").then((m) => ({ default: m.Estudos })));

export function EstudosNoCelular(props: ComponentProps<typeof import("./Estudos").Estudos>) {
  return <Suspense fallback={<p className="m-vazio">Abrindo estudos…</p>}><Real {...props} /></Suspense>;
}
