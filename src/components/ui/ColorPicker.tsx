import { useId } from "react";
import { SeletorDeCor } from "./SeletorDeCor";

/** Atalhos para as cores mais comuns. */
const RAPIDAS = [
  "#FFFFFF",
  "#000000",
  "#FFD24A",
  "#A855F7",
  "#8300FF",
  "#22D3EE",
  "#4ADE80",
  "#F87171",
];

export interface ColorPickerProps {
  id?: string;
  value: string;
  onChange: (hex: string) => void;
  /** Volta ao valor do preset. Ausente, o botão não aparece. */
  onReset?: () => void;
  disabled?: boolean;
}

/**
 * Seletor de cor: amostra + atalhos + roda nativa.
 *
 * A amostra abre o `SeletorDeCor` (popover próprio, no tema do app): a roda nativa
 * abria o diálogo do sistema, fora do visual.
 *
 * O valor circula sempre como `#RRGGBB`.
 */
export function ColorPicker({ id, value, onChange, onReset, disabled }: ColorPickerProps) {
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* A amostra É o input: o `<input type="color">` nativo é feio em todo
          navegador, então some e a cor vira o próprio botão. */}
      <SeletorDeCor value={value} onChange={onChange} disabled={disabled} rotulo={`Escolher cor (${value})`}
        className={[
          "glass-inset relative w-8 h-8 shrink-0 rounded-none overflow-hidden block",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}>
        <span id={inputId} className="block w-full h-full" style={{ backgroundColor: value }} />
      </SeletorDeCor>

      <span className="text-text-muted text-[10px] font-mono tabular-nums w-16">{value}</span>

      <div className="flex items-center gap-1">
        {RAPIDAS.map((c) => (
          <button
            key={c}
            type="button"
            disabled={disabled}
            aria-label={`Usar ${c}`}
            onClick={() => onChange(c)}
            className={[
              "w-5 h-5 rounded-none border transition-transform",
              value.toUpperCase() === c ? "border-selected scale-110" : "border-border-subtle",
              disabled ? "opacity-50" : "hover:scale-110",
            ].join(" ")}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      {onReset && (
        <button
          type="button"
          disabled={disabled}
          onClick={onReset}
          className="text-text-muted hover:text-text-primary text-[10px] underline disabled:opacity-50"
        >
          padrão
        </button>
      )}
    </div>
  );
}
