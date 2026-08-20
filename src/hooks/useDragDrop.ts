import { useState, useCallback, useEffect } from "react";
import type { SelectedFile } from "../types/conversion";
import { DEFAULT_SETTINGS } from "../types/settings";

interface UseDragDropOptions {
  onFiles: (files: SelectedFile[]) => void;
  onError: (message: string) => void;
  /** Extensões aceitas, minúsculas, sem ponto. Default: ["pdf"]. */
  accept?: string[];
  /** Limite por arquivo em MB (vem das configurações). */
  maxSizeMb?: number;
}

export function useDragDrop({
  onFiles,
  onError,
  accept = ["pdf"],
  maxSizeMb = DEFAULT_SETTINGS.maxFileSizeMb,
}: UseDragDropOptions) {
  const [isDragging, setIsDragging] = useState(false);

  // `["*"]` = aceita qualquer arquivo (ex.: Hash / Checksum). Sem este caso o
  // filtro viraria endsWith(".*"), que nunca casa, e todo drop seria recusado.
  const matches = useCallback(
    (name: string) =>
      accept.includes("*") || accept.some((ext) => name.toLowerCase().endsWith(`.${ext}`)),
    [accept]
  );

  const rejectedMsg = useCallback(
    (n: number) => `${n} arquivo(s) ignorado(s): apenas ${accept.join(", ").toUpperCase()}.`,
    [accept]
  );

  const validateAndEmit = useCallback(
    (filePaths: string[]) => {
      const valid: SelectedFile[] = [];
      let skipped = 0;
      for (const path of filePaths) {
        const name = path.split(/[/\\]/).pop() ?? path;
        if (matches(name)) valid.push({ name, path, size: 0 });
        else skipped++;
      }
      if (skipped > 0) onError(rejectedMsg(skipped));
      if (valid.length > 0) onFiles(valid);
    },
    [matches, rejectedMsg, onError, onFiles]
  );

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const appWindow = getCurrentWebviewWindow();
        // Tauri v2 unified drag-drop event.
        unlisten = await appWindow.onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            setIsDragging(true);
          } else if (payload.type === "leave") {
            setIsDragging(false);
          } else if (payload.type === "drop") {
            setIsDragging(false);
            validateAndEmit(payload.paths);
          }
        });
      } catch {
        // Fora do Tauri — os handlers HTML5 abaixo servem de fallback.
      }
    };

    setup();
    return () => { unlisten?.(); };
  }, [validateAndEmit]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const droppedFiles = Array.from(e.dataTransfer.files);
      if (droppedFiles.length === 0) return;

      const valid: SelectedFile[] = [];
      let skipped = 0;

      for (const file of droppedFiles) {
        if (!matches(file.name)) {
          skipped++;
          continue;
        }
        if (file.size > maxSizeMb * 1024 * 1024) {
          onError(`"${file.name}" muito grande. Máx. ${maxSizeMb} MB.`);
          continue;
        }
        valid.push({
          name: file.name,
          path: (file as File & { path?: string }).path ?? file.name,
          size: file.size,
        });
      }

      if (skipped > 0) onError(rejectedMsg(skipped));
      if (valid.length > 0) onFiles(valid);
    },
    [matches, rejectedMsg, onFiles, onError, maxSizeMb]
  );

  return { isDragging, handleDragOver, handleDragLeave, handleDrop };
}
