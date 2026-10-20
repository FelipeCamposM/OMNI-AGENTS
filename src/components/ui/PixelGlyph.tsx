import type { ReactNode } from "react";

/*
 * Glifos pequenos desenhados em pixel (`crispEdges`, traço de 2 px), para os controles de janela e
 * de painel. Antes eram caracteres Unicode (▥ ▤ ▦ □ ×), que cada fonte desenha com tamanho e peso
 * diferentes — ficavam tortos e fora do estilo pixel do resto do app.
 */

function Glifo({ largura = 10, altura = 10, children, className }: { largura?: number; altura?: number; children: ReactNode; className?: string }) {
  return (
    <svg width={largura} height={altura} viewBox={`0 0 ${largura} ${altura}`} shapeRendering="crispEdges" fill="currentColor"
      aria-hidden className={className}>
      {children}
    </svg>
  );
}

/* Janela (10×10) */
export const GlifoMinimizar = () => <Glifo><rect x="0" y="8" width="10" height="2" /></Glifo>;
export const GlifoMaximizar = () => <Glifo><path d="M0 0h10v10H0z M2 3v5h6V3z" fillRule="evenodd" /></Glifo>;
export const GlifoRestaurar = () => (
  <Glifo>
    <path d="M3 0h7v7H8V2H3z" />
    <path d="M0 3h7v7H0z M2 5v3h3V5z" fillRule="evenodd" />
  </Glifo>
);
export const GlifoFechar = () => (
  <Glifo><path d="M0 0h2v2H0zM2 2h2v2H2zM4 4h2v2H4zM6 2h2v2H6zM8 0h2v2H8zM2 6h2v2H2zM0 8h2v2H0zM6 6h2v2H6zM8 8h2v2H8z" /></Glifo>
);

export const GlifoMais = () => <Glifo><path d="M4 0h2v4h4v2H6v4H4V6H0V4h4z" /></Glifo>;

/* Layouts e divisões de painel (14×12: moldura + divisórias) */
const MOLDURA = <path d="M0 0h14v12H0z M2 2v8h10V2z" fillRule="evenodd" />;
export const GlifoColunas = () => <Glifo largura={14} altura={12}>{MOLDURA}<rect x="6" y="2" width="2" height="8" /></Glifo>;
export const GlifoLinhas = () => <Glifo largura={14} altura={12}>{MOLDURA}<rect x="2" y="5" width="10" height="2" /></Glifo>;
export const GlifoGrade = () => (
  <Glifo largura={14} altura={12}>{MOLDURA}<rect x="6" y="2" width="2" height="8" /><rect x="2" y="5" width="10" height="2" /></Glifo>
);
/** Painel maximizado dentro do projeto: moldura cheia com cantos para fora. */
export const GlifoExpandir = () => (
  <Glifo largura={12} altura={12}>
    <path d="M0 0h5v2H2v3H0zM7 0h5v5h-2V2H7zM0 7h2v3h3v2H0zM10 7h2v5H7v-2h3z" />
  </Glifo>
);
export const GlifoRecolher = () => (
  <Glifo largura={12} altura={12}>
    <path d="M3 0h2v5H0V3h3zM7 0h2v3h3v2H7zM0 7h5v5H3V9H0zM7 7h5v2H9v3H7z" />
  </Glifo>
);
