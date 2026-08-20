import { Plus, Upload } from "lucide-react";
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { SelectedFile } from "../types/conversion";
import { DEFAULT_SETTINGS } from "../types/settings";
import { useDragDrop } from "../hooks/useDragDrop";

interface DropZoneProps {
  onFiles: (files: SelectedFile[]) => void;
  disabled?: boolean;
  compact?: boolean;
  /** Limite por arquivo em MB (configurações). */
  maxSizeMb?: number;
  /** false = seletor de um arquivo só (ex.: dividir PDF). */
  multiple?: boolean;
  /** Sobrescreve o texto principal. */
  label?: string;
}

export function DropZone({
  onFiles,
  disabled,
  compact,
  maxSizeMb = DEFAULT_SETTINGS.maxFileSizeMb,
  multiple = true,
  label,
}: DropZoneProps) {
  const [dropError, setDropError] = useState<string | null>(null);

  const { isDragging, handleDragOver, handleDragLeave, handleDrop } = useDragDrop({
    onFiles: (files) => { setDropError(null); onFiles(files); },
    onError: setDropError,
    maxSizeMb,
  });

  async function openFilePicker() {
    if (disabled) return;
    setDropError(null);

    const result = await open({
      multiple,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    if (!result) return;
    const paths = Array.isArray(result) ? result : [result];
    const files: SelectedFile[] = paths.map((p) => ({
      name: p.split(/[/\\]/).pop() ?? p,
      path: p,
      size: 0,
    }));
    if (files.length > 0) onFiles(files);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openFilePicker();
    }
  }

  if (compact) {
    return (
      <div className="space-y-1">
        <button
          onClick={openFilePicker}
          disabled={disabled}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={[
            "glass glass-hover w-full flex items-center justify-center gap-2 !rounded-lg border-dashed px-4 py-3 text-sm",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
            isDragging
              ? "!border-accent bg-accent/10 text-accent shadow-glow"
              : "text-text-muted hover:text-text-secondary",
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
          ].join(" ")}
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {isDragging ? "Solte os PDFs aqui" : label ?? "Adicionar mais PDFs"}
        </button>
        {dropError && (
          <p role="alert" className="text-danger text-xs px-1">{dropError}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Área de arrastar e soltar PDFs. Clique ou pressione Enter para selecionar arquivos."
        aria-disabled={disabled}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={openFilePicker}
        onKeyDown={handleKeyDown}
        className={[
          "glass glass-hover glass-sheen border-2 border-dashed p-10 flex flex-col items-center justify-center gap-3 cursor-pointer",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
          isDragging ? "!border-accent bg-accent/10 shadow-glow" : "",
          disabled ? "opacity-50 cursor-not-allowed" : "",
        ].join(" ")}
      >
        <UploadIcon dragging={isDragging} />
        <div className="text-center space-y-1">
          <p className="text-text-primary text-sm font-medium">
            {isDragging
              ? multiple ? "Solte os PDFs aqui" : "Solte o PDF aqui"
              : label ?? (multiple ? "Arraste PDFs aqui" : "Arraste um PDF aqui")}
          </p>
          <p className="text-text-muted text-xs">
            ou clique para selecionar — {multiple ? "múltiplos arquivos, " : ""}máx. {maxSizeMb} MB cada
          </p>
        </div>
      </div>

      {dropError && (
        <p role="alert" className="text-danger text-xs px-1">{dropError}</p>
      )}
    </div>
  );
}

function UploadIcon({ dragging }: { dragging: boolean }) {
  return (
    <Upload
      strokeWidth={1.5}
      aria-hidden="true"
      className={`w-10 h-10 transition-colors ${dragging ? "text-accent animate-float" : "text-text-muted"}`}
    />
  );
}
