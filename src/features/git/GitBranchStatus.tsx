import { useCallback, useEffect, useRef, useState } from "react";
import { matchesShortcut } from "../../lib/shortcuts";
import { isRemoteProject } from "../projects/targetState";
import { gitBranches, gitCheckoutBranch, gitPull, gitStatus, type GitBranch } from "./gitService";

/** Branch do projeto em foco no rodapé, com pull, troca de branch e criação ao lado. O status vem
 *  do mesmo `git_status` do painel lateral; relê sozinho porque quem troca de branch costuma ser o
 *  agente, no terminal. */
export function GitBranchStatus({ projectPath }: { projectPath: string | null }) {
  const [branch, setBranch] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [branches, setBranches] = useState<GitBranch[] | null>(null);
  const [nome, setNome] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const botaoRef = useRef<HTMLButtonElement>(null);
  /** Posição do popover em coordenadas de tela. O rodapé é `h-7` com `overflow-hidden`: um popover
   *  `absolute` nasce dentro dele e é recortado até sumir — `fixed` escapa do recorte. */
  const [ancora, setAncora] = useState({ left: 0, bottom: 0 });

  const refresh = useCallback(() => {
    if (!projectPath) {
      setBranch(null);
      return;
    }
    gitStatus(projectPath)
      .then((status) => setBranch(status?.branch ?? null))
      .catch(() => setBranch(null));
  }, [projectPath]);

  useEffect(() => {
    refresh();
    // Em projeto remoto cada leitura é um `wsl`/`ssh` — 3s viraria tráfego constante à toa.
    const ritmo = isRemoteProject(projectPath) ? 10_000 : 3_000;
    const timer = window.setInterval(refresh, ritmo);
    return () => window.clearInterval(timer);
  }, [refresh, projectPath]);

  // Em captura, como o Ctrl+P: sem isso o atalho não funcionaria com o foco no terminal, que é
  // justamente onde o usuário está quando decide abrir uma branch nova.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!matchesShortcut(event, "newBranch") || !projectPath) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [projectPath]);

  // A lista é relida a cada abertura: branch criada no terminal aparece sem precisar reabrir o app.
  useEffect(() => {
    if (!open || !projectPath) return;
    setNome("");
    setBranches(null);
    const rect = botaoRef.current?.getBoundingClientRect();
    if (rect) setAncora({ left: rect.left, bottom: window.innerHeight - rect.top + 4 });
    gitBranches(projectPath)
      .then(setBranches)
      .catch(() => setBranches([]));
    inputRef.current?.focus();
  }, [open, projectPath]);

  if (!projectPath || !branch) return null;

  async function correr(acao: () => Promise<string | void>) {
    if (!projectPath) return;
    setBusy(true);
    setMessage(null);
    try {
      const saida = await acao();
      setMessage((typeof saida === "string" && saida.trim()) || null);
      setOpen(false);
      refresh();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const alvo = nome.trim();
  const existe = (branches ?? []).some((item) => item.name === alvo);
  const listadas = (branches ?? []).filter((item) => item.name.toLowerCase().includes(alvo.toLowerCase()));

  return (
    <span className="relative flex min-w-0 items-center gap-1.5">
      <button
        ref={botaoRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`Branch atual: ${branch} — clique para trocar ou criar`}
        className="min-w-0 truncate hover:text-text-primary"
      >
        ⎇ {branch}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void correr(() => gitPull(projectPath))}
        title="git pull --ff-only"
        className="shrink-0 px-1 uppercase hover:text-text-primary disabled:opacity-40"
      >
        {busy ? "pull…" : "pull"}
      </button>
      {message && (
        // Clicar limpa: é recado de uma ação só, e no rodapé não cabe banner.
        <button
          type="button"
          onClick={() => setMessage(null)}
          title={message}
          className="hidden min-w-0 max-w-[16rem] truncate text-left hover:text-text-primary lg:inline"
        >
          {message.split("\n")[0]}
        </button>
      )}

      {open && (
        <>
          {/* Camada de fundo: clicar fora fecha, sem listener global no document. */}
          <span className="fixed inset-0 z-40" onPointerDown={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label="Branches"
            style={{ left: ancora.left, bottom: ancora.bottom }}
            className="popover fixed z-50 flex w-64 flex-col gap-1 p-1"
          >
            <input
              ref={inputRef}
              autoFocus
              value={nome}
              onChange={(event) => setNome(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false);
                if (event.key !== "Enter" || !alvo || busy) return;
                void correr(() => gitCheckoutBranch(projectPath, alvo, !existe));
              }}
              placeholder="Filtrar ou nome da branch nova"
              aria-label="Filtrar ou nome da branch nova"
              className="w-full border border-border-subtle bg-bg-elevated px-2 py-1 text-xs text-text-primary outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            />
            {alvo && !existe && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void correr(() => gitCheckoutBranch(projectPath, alvo, true))}
                className="border border-border-subtle px-2 py-1 text-left text-xs text-accent hover:bg-overlay/[0.07] disabled:opacity-40"
              >
                + Criar “{alvo}” a partir de {branch}
              </button>
            )}
            <ul className="max-h-48 overflow-y-auto">
              {branches === null && <li className="px-2 py-1 text-xs text-text-muted">Lendo branches…</li>}
              {branches !== null && listadas.length === 0 && (
                <li className="px-2 py-1 text-xs text-text-muted">Nenhuma branch com esse nome.</li>
              )}
              {listadas.map((item) => (
                <li key={item.name}>
                  <button
                    type="button"
                    disabled={busy || item.current}
                    onClick={() => void correr(() => gitCheckoutBranch(projectPath, item.name, false))}
                    className="w-full truncate px-2 py-1 text-left text-xs text-text-secondary hover:bg-overlay/[0.07] disabled:opacity-40"
                    title={item.current ? `${item.name} (atual)` : `Trocar para ${item.name}`}
                  >
                    {item.current ? "● " : "○ "}
                    {item.name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </span>
  );
}
