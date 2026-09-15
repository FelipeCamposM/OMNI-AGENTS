import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { useEffect, useMemo, useState } from "react";
import { Button, Input, SegmentedControl, Select } from "../../components/ui";
import { baseName } from "../files/filesService";
import {
  filterHistory,
  listHistory,
  readTranscript,
  type HistoryEntry,
  type HistoryProvider,
  type HistoryTranscript,
} from "./historyService";

const PROVIDERS = [
  { value: "claude" as const, label: "Claude" },
  { value: "codex" as const, label: "Codex" },
];

/** Lista longa (centenas de conversas) renderiza aos poucos; a busca é quem acha as antigas. */
const PAGE = 100;

function formatDate(ms: number | null) {
  return ms ? new Date(ms).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";
}

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

interface HistoryViewProps {
  /** Reabre a conversa no CLI dentro de um terminal do projeto dela. */
  onResume: (entry: HistoryEntry) => Promise<void>;
}

/** Conversas gravadas pelo Claude Code e pelo Codex em todas as contas cadastradas, com o OMNI
 *  aberto ou não. Lê direto dos transcripts do CLI — nada é copiado. */
export function HistoryView({ onResume }: HistoryViewProps) {
  const [provider, setProvider] = useState<HistoryProvider>("claude");
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [cwd, setCwd] = useState("");
  const [profileId, setProfileId] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    listHistory(provider)
      .then((list) => {
        if (!cancelled) setEntries(list);
      })
      .catch((reason) => {
        if (!cancelled) {
          setEntries([]);
          setError(errorText(reason));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [provider, reload]);

  // Trocar de provider zera filtros que só fazem sentido no outro (pasta e conta).
  function changeProvider(next: HistoryProvider) {
    setProvider(next);
    setCwd("");
    setProfileId("");
    setSelectedPath(null);
    setLimit(PAGE);
  }

  const projectOptions = useMemo(() => {
    const byKey = new Map<string, string>();
    for (const entry of entries ?? []) {
      if (entry.cwd && !byKey.has(entry.cwd.toLowerCase())) byKey.set(entry.cwd.toLowerCase(), entry.cwd);
    }
    const paths = [...byKey.values()].sort((a, b) => baseName(a).localeCompare(baseName(b)));
    return [{ value: "", label: "Todos os projetos" }, ...paths.map((path) => ({ value: path, label: baseName(path), hint: path }))];
  }, [entries]);

  const profileOptions = useMemo(() => {
    const names = new Map((entries ?? []).map((entry) => [entry.profile_id, entry.profile_name]));
    return [{ value: "", label: "Todas as contas" }, ...[...names].map(([value, label]) => ({ value, label }))];
  }, [entries]);

  const filtered = useMemo(() => filterHistory(entries ?? [], { query, cwd, profileId }), [entries, query, cwd, profileId]);
  const selected = filtered.find((entry) => entry.path === selectedPath) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-4 py-4 md:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-sm font-medium text-text-primary">Histórico de conversas</h1>
        <SegmentedControl options={PROVIDERS} value={provider} onChange={changeProvider} grow={false} />
        <Button variant="ghost" size="sm" onClick={() => setReload((value) => value + 1)} disabled={entries === null}>
          Atualizar
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          size="sm"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(PAGE);
          }}
          placeholder="Pesquisar por título, prompt ou pasta"
          aria-label="Pesquisar conversas"
          className="min-w-0 flex-[2_1_14rem]"
        />
        <Select
          size="sm"
          value={cwd}
          options={projectOptions}
          onChange={(value) => {
            setCwd(value);
            setLimit(PAGE);
          }}
          searchable={projectOptions.length > 15}
          searchPlaceholder="Pesquisar projeto…"
          className="min-w-0 flex-[1_1_10rem]"
        />
        {profileOptions.length > 2 && (
          <Select size="sm" value={profileId} options={profileOptions} onChange={setProfileId} className="min-w-0 flex-[1_1_8rem]" />
        )}
      </div>

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
        <section aria-label="Conversas" className="glass flex max-h-[40vh] min-h-0 flex-col md:max-h-none md:w-[38%] md:min-w-[16rem]">
          <p className="border-b border-border-subtle/60 px-3 py-2 text-[11px] text-text-muted">
            {entries === null ? "Lendo transcripts…" : `${filtered.length} de ${entries.length} conversas`}
          </p>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {filtered.slice(0, limit).map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => setSelectedPath(entry.path)}
                  aria-current={entry.path === selectedPath ? "true" : undefined}
                  className={[
                    "w-full border-l-2 px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                    entry.path === selectedPath
                      ? "border-accent bg-accent-muted"
                      : "border-transparent hover:bg-overlay/[0.07]",
                  ].join(" ")}
                >
                  <span className="block truncate text-xs text-text-primary">{entry.title ?? entry.first_prompt}</span>
                  <span className="mt-0.5 flex gap-2 text-[11px] text-text-muted">
                    <span className="truncate">{entry.cwd ? baseName(entry.cwd) : "sem pasta"}</span>
                    <span className="ml-auto shrink-0">{formatDate(entry.updated_at_ms)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {filtered.length > limit && (
            <Button variant="ghost" size="sm" onClick={() => setLimit((value) => value + PAGE)}>
              Mostrar mais
            </Button>
          )}
        </section>

        <section aria-label="Conversa selecionada" className="glass flex min-h-0 flex-1 flex-col">
          {selected ? (
            <ConversationDetail key={selected.path} entry={selected} onResume={onResume} />
          ) : (
            <p className="m-auto px-6 text-center text-xs text-text-muted">Escolha uma conversa para ver as mensagens.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function ConversationDetail({ entry, onResume }: { entry: HistoryEntry; onResume: HistoryViewProps["onResume"] }) {
  const [transcript, setTranscript] = useState<HistoryTranscript | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readTranscript(entry)
      .then((result) => {
        if (!cancelled) setTranscript(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(errorText(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  async function resume() {
    setResuming(true);
    setError(null);
    try {
      await onResume(entry);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setResuming(false);
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-start gap-3 border-b border-border-subtle/60 px-4 py-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 className="text-sm font-medium text-text-primary">{entry.title ?? entry.first_prompt}</h2>
          <p className="break-all text-[11px] text-text-muted">{entry.cwd ?? "Pasta não registrada"}</p>
          <p className="text-[11px] text-text-muted">
            {entry.profile_name} · início {formatDate(entry.started_at_ms)} · última atividade {formatDate(entry.updated_at_ms)}
          </p>
        </div>
        <Button size="sm" onClick={() => void resume()} loading={resuming} disabled={!entry.cwd}>
          Retomar no terminal
        </Button>
      </header>
      {error && (
        <p role="alert" className="px-4 pt-2 text-xs text-danger">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {transcript === null && !error && <p className="text-xs text-text-muted">Carregando mensagens…</p>}
        {transcript && transcript.total > transcript.messages.length && (
          <p className="text-[11px] text-text-muted">
            Mostrando as últimas {transcript.messages.length} de {transcript.total} mensagens.
          </p>
        )}
        {transcript?.messages.map((message, index) => (
          <article
            key={index}
            className={[
              "border-l-2 pl-3",
              message.role === "user" ? "border-accent" : "border-border-subtle",
            ].join(" ")}
          >
            <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
              {message.role === "user" ? "Você" : entry.provider === "claude" ? "Claude" : "Codex"}
            </p>
            <div className="prose prose-invert max-w-none text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
                {message.text}
              </ReactMarkdown>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
