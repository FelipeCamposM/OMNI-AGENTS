import type { ReactNode } from "react";

export interface CardProps {
  title: string;
  /** Canto direito do cabeçalho: um selo de estado, um botão pequeno. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Painel das telas de Configurações: fundo `glass`, título pixelado, blocos empilhados. */
export function Card({ title, aside, children, className }: CardProps) {
  return (
    <section className={["glass rounded-none p-5 space-y-4", className].filter(Boolean).join(" ")}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="pixel-text text-text-primary text-sm">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
