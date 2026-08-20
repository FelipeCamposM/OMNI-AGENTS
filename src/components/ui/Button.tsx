import { LoaderCircle } from "lucide-react";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "glass" | "picker" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

// Use a prop `size` — NÃO passe padding/text-size por className. A escala do
// Tailwind é emitida em ordem crescente, então um `py-2` no call site perde
// para o `py-2.5` daqui e o override falha em silêncio.
const SIZE: Record<ButtonSize, string> = {
  sm: "px-3 py-2 text-xs",
  md: "px-4 py-2.5 text-sm",
  lg: "px-4 py-3 text-sm",
};

const VARIANT: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  glass: "btn-glass",
  picker: "btn-picker",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

/**
 * Botão único do app. O visual mora em `.btn*` no index.css — mexer no estilo
 * de todos os botões é editar aquele bloco, não este arquivo.
 *
 * `w-full` não é padrão de propósito: passe por className onde precisar
 * (largura não colide com nada da base).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "glass",
    size = "md",
    loading = false,
    className,
    children,
    disabled,
    type = "button",
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={["btn", VARIANT[variant], SIZE[size], className].filter(Boolean).join(" ")}
      {...rest}
    >
      {loading && <LoaderCircle aria-hidden="true" className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  );
});
