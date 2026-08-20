import { forwardRef } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

export type FieldSize = "sm" | "md";

// Mesma escala do Button — passe pela prop `size`, não por className: a escala
// do Tailwind é emitida em ordem crescente e um `py-2` no call site perderia
// para o `py-2.5` daqui, falhando em silêncio.
const SIZE: Record<FieldSize, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3 py-2 text-sm",
};

function cls(size: FieldSize, extra?: string) {
  return ["field", SIZE[size], extra].filter(Boolean).join(" ");
}

/* `size` do HTML é um número (largura em caracteres) e colidiria com a nossa
   prop — omitido do tipo nativo em todos os três. */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: FieldSize;
}

/**
 * Campo de texto do app. O visual mora em `.field` no index.css — mexer no
 * estilo de todos os campos é editar aquele bloco, não este arquivo.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { size = "md", className, ...rest },
  ref
) {
  return <input ref={ref} className={cls(size, className)} {...rest} />;
});

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> {
  size?: FieldSize;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { size = "md", className, ...rest },
  ref
) {
  return <textarea ref={ref} className={cls(size, ["resize-y", className].filter(Boolean).join(" "))} {...rest} />;
});
