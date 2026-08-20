import { Clock, Trash2 } from "lucide-react";
import { useState } from "react";
import type { HistoryEntry } from "../types/conversion";
import { MarkdownViewer } from "./MarkdownViewer";
import { useStagger } from "../lib/motion";
import { Button, Input } from "./ui";

interface HistoryViewProps {
  history: HistoryEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

/** Casa o termo com nome, caminhos, ferramenta e conteúdo convertido. */
function matches(entry: HistoryEntry, term: string): boolean {
  const haystack = [
    entry.filename,
    entry.inputPath,
    entry.outputPath,
    entry.tool,
    entry.markdown,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  return haystack.includes(term);
}

export function HistoryView({
  history,
  selectedId,
  onSelect,
  onDelete,
  onClear,
}: HistoryViewProps) {
  const [term, setTerm] = useState("");
  /** Só muda ao clicar em Buscar (ou Enter) — digitar não filtra. */
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const normalized = query.trim().toLowerCase();
  const visible = normalized
    ? history.filter((e) => matches(e, normalized))
    : history;

  const selected = visible.find((e) => e.id === selectedId) ?? null;

  function runSearch() {
    setQuery(term);
  }

  function clearSearch() {
    setTerm("");
    setQuery("");
  }

  const listRef = useStagger<HTMLUListElement>("li", [query, history.length]);

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center gap-2">
        <Clock className="w-8 h-8 text-text-muted" aria-hidden="true" />
        <p className="text-text-secondary text-sm font-medium">Nenhuma conversão ainda</p>
        <p className="text-text-muted text-xs">
          As conversões aparecerão aqui automaticamente
        </p>
      </div>
    );
  }

  return (
    <div className="flex gap-5 h-full">
      {/* List */}
      <div className="w-64 shrink-0 flex flex-col gap-2">
        {/* Busca — dispara só no botão/Enter */}
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <Input
              size="sm"
              type="search"
              value={term}
              aria-label="Pesquisar no histórico"
              placeholder="Pesquisar…"
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
              className="flex-1 min-w-0"
            />
            <Button variant="primary" size="sm" className="shrink-0" onClick={runSearch}>
              Buscar
            </Button>
          </div>
          {normalized && (
            <Button variant="ghost" size="sm" onClick={clearSearch}>
              Limpar busca
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-text-secondary text-xs font-medium">
            {normalized
              ? `${visible.length} de ${history.length}`
              : `${history.length} conversõe${history.length !== 1 ? "s" : ""}`}
          </p>
          {confirmClear ? (
            <span className="flex items-center gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={() => { onClear(); setConfirmClear(false); clearSearch(); }}
              >
                Confirmar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmClear(false)}>
                Cancelar
              </Button>
            </span>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)}>
              Limpar tudo
            </Button>
          )}
        </div>

        {visible.length === 0 ? (
          <p className="text-text-muted text-xs px-1 py-3">
            Nenhuma conversão encontrada para “{query.trim()}”.
          </p>
        ) : (
          <ul ref={listRef} className="space-y-1 overflow-y-auto max-h-[calc(100vh-240px)]">
            {visible.map((entry) => (
              <HistoryItem
                key={entry.id}
                entry={entry}
                active={entry.id === selectedId}
                onSelect={() => onSelect(entry.id)}
                onDelete={() => onDelete(entry.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* Detail */}
      <div className="flex-1 min-w-0">
        {selected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <p className="text-text-primary text-sm font-medium flex-1 truncate">
                {selected.filename}
              </p>
              <span
                className={[
                  "text-xs font-medium px-2 py-0.5 rounded-full border",
                  selected.success
                    ? "text-success bg-success/10 border-success/40"
                    : "text-danger bg-danger/10 border-danger/40",
                ].join(" ")}
              >
                {selected.success ? "Sucesso" : "Erro"}
              </span>
            </div>
            <p className="text-text-muted text-xs">
              {formatDate(selected.timestamp)}
              {selected.success && ` · ${(selected.durationMs / 1000).toFixed(1)}s`}
            </p>

            {selected.success && selected.markdown ? (
              <MarkdownViewer
                content={selected.markdown}
                onChange={() => {}}
                onCopy={() => {}}
                onClear={() => {}}
              />
            ) : (
              <div className="glass p-6 text-center">
                <p className="text-text-muted text-sm">Sem conteúdo disponível</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-48 text-center">
            <p className="text-text-muted text-sm">
              Selecione uma conversão para ver o resultado
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function HistoryItem({
  entry,
  active,
  onSelect,
  onDelete,
}: {
  entry: HistoryEntry;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <li
      className={[
        "group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-colors",
        active ? "bg-overlay/[0.06]" : "hover:bg-overlay/[0.07]",
      ].join(" ")}
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          entry.success ? "bg-success" : "bg-danger"
        }`}
      />
      <div className="flex-1 min-w-0">
        <p className="text-text-primary text-xs font-medium truncate">{entry.filename}</p>
        <p className="text-text-muted text-[10px]">{formatDate(entry.timestamp)}</p>
      </div>
      {hovered && (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Remover do histórico"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="!p-1 hover:!text-danger"
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </Button>
      )}
    </li>
  );
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Agora mesmo";
  if (diffMins < 60) return `Há ${diffMins}min`;
  if (diffHours < 24) return `Há ${diffHours}h`;
  if (diffDays < 7) return `Há ${diffDays} dia${diffDays !== 1 ? "s" : ""}`;

  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}


