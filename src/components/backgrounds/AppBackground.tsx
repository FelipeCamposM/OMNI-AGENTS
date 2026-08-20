import { Component, Suspense } from "react";
import type { ErrorInfo, ReactNode } from "react";
import type { AppSettings } from "../../types/settings";
import { motionOn } from "../../lib/motion";
import { coresDoEfeito } from "../../lib/palettes";
import { getBackgroundEffect } from "./registry";

/**
 * Camada de fundo animada (React Bits). Os fundos estáticos — mesh, imagem do
 * usuário, nenhum — continuam sendo CSS puro em `src/index.css` (body::before
 * / ::after); só os efeitos com WebGL passam por aqui.
 *
 * Fica dentro do #root com z-index negativo: o #root cria contexto de
 * empilhamento, então o canvas fica atrás da UI mas à frente do body. O veil
 * é redesenhado aqui porque o `body::after` do CSS ficaria ATRÁS do canvas.
 */
export function AppBackground({ settings }: { settings: AppSettings }) {
  const efeito = getBackgroundEffect(settings.background);
  if (!efeito) return null;

  const Efeito = efeito.component;

  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
      {/* ponytail: só opacidade, sem --app-bg-blur. Desfocar um canvas que
          repinta a 60fps custa um blur por frame, e o efeito já é arte de
          fundo — o slider de desfoque some da UI quando um efeito está ativo. */}
      <div className="absolute inset-0" style={{ opacity: settings.backgroundOpacity / 100 }}>
        <EffectBoundary>
          <Suspense fallback={null}>
            {/* Movimento desligado (ou prefers-reduced-motion): o efeito continua
                desenhado, só congela. Sumir com ele deixaria o app chapado. */}
            {/* `key` força remontar ao trocar de paleta: os efeitos montam o
                material do WebGL uma vez, e mudar a cor por prop não repinta
                o que já está na GPU. */}
            <Efeito
              key={settings.accent}
              className="h-full w-full"
              still={!motionOn()}
              cores={coresDoEfeito(settings.accent)}
            />
          </Suspense>
        </EffectBoundary>
      </div>

      <div
        className="absolute inset-0"
        style={{ background: "rgb(var(--app-bg-veil) / var(--app-bg-veil-a))" }}
      />
    </div>
  );
}

/**
 * Um fundo decorativo nunca pode derrubar o app. Máquina sem WebGL2, driver
 * capado, contexto perdido: engole o erro e fica só o veil.
 */
class EffectBoundary extends Component<{ children: ReactNode }, { falhou: boolean }> {
  state = { falhou: false };

  static getDerivedStateFromError() {
    return { falhou: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("fundo animado falhou:", error, info.componentStack);
  }

  render() {
    return this.state.falhou ? null : this.props.children;
  }
}
