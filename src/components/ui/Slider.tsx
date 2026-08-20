import type { CSSProperties } from "react";

export interface SliderProps {
  id: string;
  label: string;
  unit?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  /** "sm" = trilho 4px / polegar 13px. */
  size?: "sm" | "md";
  /** Label à esquerda e trilho ocupando o resto, em vez de empilhado. */
  inline?: boolean;
  description?: string;
  className?: string;
}

/**
 * O texto do label é `{label}: {value}{unit}` e isso é contratual — é o nome
 * acessível pelo qual os testes acham o controle (src/test/App.test.tsx).
 * Não trocar por badge separado nem por aria-label.
 */
export function Slider({
  id,
  label,
  unit = "",
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled,
  size = "md",
  inline = false,
  description,
  className,
}: SliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;

  const input = (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ "--range-fill": `${pct}%` } as CSSProperties}
      className={["range", size === "sm" && "range-sm", inline && "flex-1"]
        .filter(Boolean)
        .join(" ")}
    />
  );

  const text = (
    <label htmlFor={id} className="text-text-secondary text-xs font-medium tabular-nums">
      {label}: {value}
      {unit}
    </label>
  );

  return (
    <div className={[inline ? "space-y-1" : "space-y-1.5", className].filter(Boolean).join(" ")}>
      {inline ? (
        <div className="flex items-center gap-3">
          {text}
          {input}
        </div>
      ) : (
        <>
          {text}
          {input}
        </>
      )}
      {description && <p className="text-text-muted text-[11px]">{description}</p>}
    </div>
  );
}
