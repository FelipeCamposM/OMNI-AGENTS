import { Button } from "./Button";
import type { ButtonSize } from "./Button";

export interface SegmentedOption<T> {
  value: T;
  label: string;
  disabled?: boolean;
  title?: string;
}

export interface SegmentedControlProps<T extends string | number> {
  label?: string;
  description?: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (v: T) => void;
  size?: ButtonSize;
  /** Botões dividem a linha igualmente. Desligue p/ largura pelo conteúdo. */
  grow?: boolean;
  className?: string;
}

/**
 * Grupo de opções mutuamente exclusivas. O estado selecionado sai inteiro do
 * seletor CSS `.btn-glass[aria-pressed="true"]` — nenhum call site escreve
 * `bg-accent text-white` de novo.
 */
export function SegmentedControl<T extends string | number>({
  label,
  description,
  options,
  value,
  onChange,
  size = "sm",
  grow = true,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div className={["space-y-1.5", className].filter(Boolean).join(" ")}>
      {label && <span className="text-text-secondary text-xs font-medium block">{label}</span>}
      <div role="group" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <Button
            key={String(o.value)}
            size={size}
            aria-pressed={value === o.value}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={grow ? "flex-1" : undefined}
          >
            {o.label}
          </Button>
        ))}
      </div>
      {description && <p className="text-text-muted text-[11px]">{description}</p>}
    </div>
  );
}
