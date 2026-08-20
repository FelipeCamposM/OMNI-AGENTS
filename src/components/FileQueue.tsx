import { X } from "lucide-react";
import type { FileItem } from "../types/conversion";
import { PROGRESS_STEPS } from "../hooks/useConversion";
import { useStagger } from "../lib/motion";
import { Button } from "./ui";

interface FileQueueProps {
  files: FileItem[];
  activeFileId: string | null;
  isConverting: boolean;
  onSelectFile: (id: string) => void;
  onRemoveFile: (id: string) => void;
  onConvertFile: (id: string) => void;
  onConvertAll: () => void;
  onClearDone: () => void;
}

export function FileQueue({
  files,
  activeFileId,
  isConverting,
  onSelectFile,
  onRemoveFile,
  onConvertFile,
  onConvertAll,
  onClearDone,
}: FileQueueProps) {
  const pendingCount = files.filter((f) => f.status === "pending").length;
  const doneCount = files.filter((f) => f.status === "success" || f.status === "error").length;
  const listRef = useStagger<HTMLUListElement>("li", [files.length]);

  return (
    <div className="glass overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle bg-overlay/[0.06]">
        <p className="text-text-primary text-sm font-medium flex-1">
          {files.length} arquivo{files.length !== 1 ? "s" : ""}
        </p>
        <div className="flex items-center gap-1.5">
          {doneCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onClearDone} disabled={isConverting}>
              Limpar concluídos
            </Button>
          )}
          {pendingCount > 1 && (
            <Button variant="primary" size="sm" onClick={onConvertAll} disabled={isConverting}>
              Converter todos ({pendingCount})
            </Button>
          )}
        </div>
      </div>

      {/* File list */}
      <ul ref={listRef} className="divide-y divide-border-subtle">
        {files.map((item) => (
          <FileRow
            key={item.id}
            item={item}
            active={item.id === activeFileId}
            isConverting={isConverting}
            onSelect={() => onSelectFile(item.id)}
            onRemove={() => onRemoveFile(item.id)}
            onConvert={() => onConvertFile(item.id)}
          />
        ))}
      </ul>
    </div>
  );
}

function FileRow({
  item,
  active,
  isConverting,
  onSelect,
  onRemove,
  onConvert,
}: {
  item: FileItem;
  active: boolean;
  isConverting: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onConvert: () => void;
}) {
  return (
    <li
      className={[
        "flex items-center gap-3 px-4 py-3 transition-colors",
        active ? "bg-overlay/[0.06]" : "hover:bg-overlay/[0.07]",
        (item.status === "success" || item.status === "error") ? "cursor-pointer" : "",
      ].join(" ")}
      onClick={() => {
        if (item.status === "success" || item.status === "error") onSelect();
      }}
    >
      <StatusDot status={item.status} />

      <div className="flex-1 min-w-0">
        <p className="text-text-primary text-sm truncate" title={item.file.name}>
          {item.file.name}
        </p>
        <StatusLabel item={item} />
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {item.status === "pending" && (
          <Button
            size="sm"
            disabled={isConverting}
            onClick={(e) => { e.stopPropagation(); onConvert(); }}
          >
            Converter
          </Button>
        )}

        {(item.status === "pending" || item.status === "error") && (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Remover arquivo"
            disabled={isConverting && item.status !== "error"}
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="!p-1"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </li>
  );
}

function StatusLabel({ item }: { item: FileItem }) {
  if (item.status === "converting") {
    const step = PROGRESS_STEPS[item.progressStep] ?? PROGRESS_STEPS[0];
    return (
      <p className="text-accent text-xs flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
        {step}
      </p>
    );
  }
  if (item.status === "success") {
    const secs = ((item.durationMs ?? 0) / 1000).toFixed(1);
    return <p className="text-success text-xs">Concluído em {secs}s</p>;
  }
  if (item.status === "error") {
    return <p className="text-danger text-xs truncate">{item.errorMessage ?? "Erro na conversão"}</p>;
  }
  return <p className="text-text-muted text-xs">Pendente</p>;
}

function StatusDot({ status }: { status: FileItem["status"] }) {
  const colors: Record<FileItem["status"], string> = {
    pending: "bg-border",
    converting: "bg-accent animate-pulse",
    success: "bg-success",
    error: "bg-danger",
  };
  return (
    <span
      className={`w-2 h-2 rounded-full shrink-0 ${colors[status]}`}
      aria-hidden="true"
    />
  );
}

