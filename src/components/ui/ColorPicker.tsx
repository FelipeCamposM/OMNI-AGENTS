import { useId } from "react";

/** Atalhos para as cores que aparecem em quase toda legenda. */
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
 * A roda é um `<input type="color">`, que abre o diálogo do sistema. Aqui isso
 * é aceitável — diferente do `<select>`, cujo dropdown ficava fora do tema, um
 * diálogo de cor é modal e esperado. Construir um HSV próprio seria muito
 * código para pouco ganho.
 *
 * O valor circula sempre como `#RRGGBB`; a conversão para o formato do ASS
 * (`&HAABBGGRR`, BGR e alfa invertido) mora no Python, num lugar só.
 */
export function ColorPicker({ id, value, onChange, onReset, disabled }: ColorPickerProps) {
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* A amostra É o input: o `<input type="color">` nativo é feio em todo
          navegador, então some e a cor vira o próprio botão. */}
      <label
        htmlFor={inputId}
        className={[
          "glass-inset relative w-8 h-8 shrink-0 rounded-lg overflow-hidden",
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
        style={{ backgroundColor: value }}
        title={value}
      >
        <input
          id={inputId}
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
      </label>

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
              "w-5 h-5 rounded-md border transition-transform",
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
