import { open } from "@tauri-apps/plugin-dialog";
import type { ReactNode } from "react";
import { useDragDrop } from "../../hooks/useDragDrop";
import { Button } from "./Button";
import type { ButtonSize } from "./Button";

export interface FilePickerProps {
  /** Extensões aceitas, minúsculas e sem ponto. Vale p/ o diálogo e p/ o drop. */
  accept: string[];
  /** Rótulo do filtro no diálogo nativo ("Vídeos", "Áudio", …). */
  filterName: string;
  /** Recebe os caminhos escolhidos — por clique OU por arrastar. */
  onPick: (paths: string[]) => void;
  /** Extensão errada ou arquivo grande demais. */
  onError?: (message: string) => void;
  maxSizeMb?: number;
  multiple?: boolean;
  size?: ButtonSize;
  className?: string;
  /** Texto do botão. */
  children: ReactNode;
}

/**
 * Seletor de arquivo que aceita clique **e** arrastar-e-soltar.
 *
 * Antes cada ferramenta chamava `open()` no `onClick` de um `<Button
 * variant="picker">` e ponto — nenhuma delas tinha handler de drop, então só
 * dava para arrastar em Converter/Comprimir imagens (que montavam o
 * `useDragDrop` por conta própria). Concentrar aqui faz o arrastar valer em
 * todas de uma vez.
 *
 * No Tauri o `useDragDrop` escuta `onDragDropEvent` da **janela**, não deste
 * elemento: basta o hook estar montado, o cursor não precisa estar sobre o
 * botão. Os handlers HTML5 continuam ligados como plano B fora do Tauri.
 */
export function FilePicker({
  accept,
  filterName,
  onPick,
  onError,
  maxSizeMb,
  multiple = false,
  size = "lg",
  className,
  children,
}: FilePickerProps) {
  const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useDragDrop({
    accept,
    maxSizeMb,
    onFiles: (arquivos) => onPick(arquivos.map((f) => f.path)),
    onError: onError ?? (() => {}),
  });

  async function escolher() {
    // `["*"]` = sem filtro no diálogo (o Hash aceita qualquer arquivo).
    const semFiltro = accept.includes("*");
    const escolhido = await open({
      multiple,
      ...(semFiltro ? {} : { filters: [{ name: filterName, extensions: accept }] }),
    });
    if (!escolhido) return;
    onPick(Array.isArray(escolhido) ? escolhido : [escolhido]);
  }

  return (
    <Button
      variant="picker"
      size={size}
      className={className}
      onClick={escolher}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-dragging={isDragging || undefined}
    >
      {children}
    </Button>
  );
}
