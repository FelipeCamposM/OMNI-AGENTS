import { useState } from "react";

interface EditableLabelProps {
  value: string;
  onCommit: (value: string) => void;
  /** Conteúdo exibido quando não está editando (permite ícone antes do texto). */
  children?: React.ReactNode;
  className?: string;
  inputClassName?: string;
  /** Como o leitor de tela anuncia o campo. */
  label?: string;
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
}

/**
 * Rótulo que vira campo no duplo clique. Mesmo comportamento do renomear de workspace
 * (`WorkspaceList.tsx`), extraído porque agora vale para aba, sessão e conversa do histórico:
 * Enter confirma, Esc cancela, sair do campo confirma.
 */
export function EditableLabel({
  value,
  onCommit,
  children,
  className,
  inputClassName,
  label,
  editing: editingProp,
  onEditingChange,
}: EditableLabelProps) {
  const [editingLocal, setEditingLocal] = useState(false);
  const editing = editingProp ?? editingLocal;

  function setEditing(next: boolean) {
    setEditingLocal(next);
    onEditingChange?.(next);
  }

  function confirmar(texto: string) {
    setEditing(false);
    const limpo = texto.trim();
    if (limpo && limpo !== value) onCommit(limpo);
  }

  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={value}
        aria-label={label ?? `Renomear ${value}`}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={(event) => confirmar(event.currentTarget.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          // Esc cancela sem gravar: o blur do `setEditing(false)` não chega a ler o campo.
          if (event.key === "Escape") setEditing(false);
        }}
        // Clique dentro do campo não pode selecionar a aba nem começar arraste.
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        className={inputClassName ?? "w-full min-w-0 border border-accent bg-bg-elevated px-1 text-[11px] text-text-primary outline-none"}
      />
    );
  }

  return (
    <span className={className} onDoubleClick={() => setEditing(true)}>
      {children ?? value}
    </span>
  );
}
