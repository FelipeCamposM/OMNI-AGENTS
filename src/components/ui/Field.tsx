import type { ReactNode } from "react";

export interface FieldProps {
  label: string;
  htmlFor?: string;
  description?: string;
  children: ReactNode;
}

/** Label + controle + descrição. Layout padrão de qualquer campo de formulário. */
export function Field({ label, htmlFor, description, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-text-secondary text-xs font-medium block">
        {label}
      </label>
      {children}
      {description && <p className="text-text-muted text-[11px]">{description}</p>}
    </div>
  );
}
