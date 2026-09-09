import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import type { WorkspaceTab } from "../../types/workspace";
import { joinPath, writeBinaryFile } from "../files/filesService";
import {
  ensureAgentTrust,
  ensureEngine,
  resizeTerminal,
  restartTerminal,
  spawnTerminal,
  stopTerminal,
  terminalSnapshot,
  type AgentCliStatus,
  type TerminalState,
  writeTerminal,
} from "./terminalService";
import { AgentLauncher } from "./AgentLauncher";

interface TerminalPaneProps {
  projectId: string;
  projectPath: string;
  paneId: string;
  tab: WorkspaceTab;
  onSessionCreated: (sessionId: string, title: string) => void;
}

export function TerminalPane({ projectId, projectPath, paneId, tab, onSessionCreated }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef(tab.resourceId);
  const sequenceRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<TerminalState>("stopped");
  const [retry, setRetry] = useState(0);
  const [agent, setAgent] = useState<AgentCliStatus | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let pollTimer: number | undefined;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "Cascadia Code, Consolas, monospace",
      fontSize: 13,
      scrollback: 10_000,
      theme: {
        background: "#0e0e14",
        foreground: "#e2e2ec",
        cursor: "#f97316",
        selectionBackground: "#f973164d",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();

    // xterm.js segue a convenção clássica de terminal Unix: Ctrl+V manda o byte de controle
    // literal (^V) pro shell, só Shift+Insert/Ctrl+Shift+V colam. Esse app é Windows-first — aqui
    // Ctrl+V sozinho também cola, sem tirar os atalhos antigos. Mesma lógica pro Ctrl+C: só copia
    // quando há seleção (como todo terminal moderno) — sem seleção, continua sendo o SIGINT de
    // sempre, não intercepta.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;

      if (event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
        const key = event.key.toLowerCase();

        if (key === "v") {
          const sessionId = sessionRef.current;
          if (sessionId) {
            void navigator.clipboard
              .readText()
              .then((text) => { if (text) void writeTerminal(sessionId, text); })
              .catch(() => undefined);
          }
          return false;
        }

        if (key === "c" && terminal.hasSelection()) {
          void navigator.clipboard.writeText(terminal.getSelection()).catch(() => undefined);
          return false;
        }
      }

      // xterm.js real só olha `altKey` pro Enter (Alt+Enter manda ESC+CR) — Shift é ignorado
      // completamente, então Shift+Enter saía idêntico a Enter puro (\r) e a CLI (Claude Code
      // etc.) nunca via sinal nenhum de "quebra de linha sem enviar". A sequência que essas CLIs
      // (Ink) reconhecem pra Shift+Enter é o protocolo CSI-u/"fixterms" — `ESC[13;2u`
      // (13 = code do Enter, 2 = modificador Shift) — é o que VS Code/Kitty/iTerm2 mandam quando
      // reconhecem esse protocolo; `ESC+CR` (primeira tentativa) é só o que Alt+Enter já manda por
      // padrão, CLI nenhuma olha pra ele como "nova linha".
      if (event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && event.key === "Enter") {
        const sessionId = sessionRef.current;
        if (sessionId) void writeTerminal(sessionId, "\x1b[13;2u").catch(() => undefined);
        return false;
      }

      return true;
    });

    async function start() {
      try {
        setError(null);
        await ensureEngine();
        if (!sessionRef.current) {
          if (agent) await ensureAgentTrust(agent.id, projectPath);
          const session = await spawnTerminal({
            projectId,
            name: `${agent?.label ?? tab.title} · agent`,
            cwd: projectPath,
            rows: terminal.rows,
            cols: terminal.cols,
            initialCommand: agent?.command,
          });
          if (cancelled) return;
          sessionRef.current = session.id;
          setState(session.state);
          onSessionCreated(session.id, session.name);
        }
        poll();
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }
    }

    async function poll() {
      if (cancelled || !sessionRef.current) return;
      try {
        const snapshot = await terminalSnapshot(sessionRef.current, sequenceRef.current);
        if (snapshot.from_seq > sequenceRef.current) terminal.write("\r\n[scrollback anterior descartado]\r\n");
        if (snapshot.data) terminal.write(snapshot.data);
        setState(snapshot.session.state);
        sequenceRef.current = snapshot.next_seq;
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }
      if (!cancelled) pollTimer = window.setTimeout(poll, 100);
    }

    const dataSubscription = terminal.onData((data) => {
      if (sessionRef.current) void writeTerminal(sessionRef.current, data).catch((reason) => setError(String(reason)));
    });
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      fit.fit();
      if (sessionRef.current) {
        void resizeTerminal(sessionRef.current, terminal.rows, terminal.cols).catch(() => undefined);
      }
    });
    resizeObserver?.observe(host);

    // Captura na fase de captura (antes do próprio textarea do xterm ver o evento): xterm só lê
    // `clipboardData.getData("text/plain")`, então colar uma imagem (sem texto no clipboard) hoje
    // não faz nada. Se houver imagem, salva como arquivo no projeto e digita o caminho na PTY —
    // mesmo padrão de paste-para-arquivo já usado em FileTree.tsx.
    async function handleImagePaste(event: ClipboardEvent) {
      const files = event.clipboardData?.files;
      const imageFile = files && Array.from(files).find((file) => file.type.startsWith("image/"));
      if (!imageFile || !sessionRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        const buffer = new Uint8Array(await imageFile.arrayBuffer());
        const extension = imageFile.type.split("/")[1] || "png";
        const fileName = /\.\w+$/.test(imageFile.name) ? imageFile.name : `pasted-${Date.now()}.${extension}`;
        const absolutePath = joinPath(projectPath, ".omni-agents", "pasted", fileName);
        await writeBinaryFile(projectPath, absolutePath, buffer);
        await writeTerminal(sessionRef.current, absolutePath);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
    host.addEventListener("paste", handleImagePaste, { capture: true });

    void start();

    return () => {
      cancelled = true;
      if (pollTimer) window.clearTimeout(pollTimer);
      resizeObserver?.disconnect();
      host.removeEventListener("paste", handleImagePaste, { capture: true });
      dataSubscription.dispose();
      terminal.dispose();
    };
  }, [agent, paneId, projectId, projectPath, retry, tab.id, tab.title, onSessionCreated]);

  if (!tab.resourceId && !agent) {
    const projectName = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath;
    return <AgentLauncher projectName={projectName} onLaunch={setAgent} />;
  }

  return (
    <div className="relative h-full min-h-0 bg-[#0e0e14]">
      <div
        ref={hostRef}
        className="absolute inset-0 p-2"
        aria-label={`Terminal ${tab.title}`}
        data-omni-context="terminal"
      />
      <div className="absolute right-3 top-2 z-10 flex items-center gap-2 bg-[#0e0e14]/90 px-2 py-1 text-[10px] uppercase text-text-muted">
        <span>{stateGlyph(state)} {state.replace(/_/g, " ")}</span>
        {state === "working" && sessionRef.current && (
          <button
            type="button"
            className="text-danger hover:underline"
            onClick={() => {
              const sessionId = sessionRef.current;
              if (!sessionId) return;
              void stopTerminal(sessionId).then(() => setState("stopped")).catch((reason) => setError(String(reason)));
            }}
          >
            parar
          </button>
        )}
        {sessionRef.current && state !== "orphan" && (
          <button
            type="button"
            className="hover:underline"
            onClick={() => {
              const sessionId = sessionRef.current;
              if (!sessionId) return;
              void restartTerminal(sessionId).catch((reason) => setError(String(reason)));
            }}
          >
            reiniciar
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="absolute inset-x-3 top-3 z-10 border-2 border-danger bg-bg-elevated p-3 text-xs text-danger">
          <p>{error}</p>
          <Button
            size="sm"
            variant="danger"
            className="mt-2"
            onClick={() => {
              if (isSessionMissing(error)) sessionRef.current = undefined;
              setRetry((value) => value + 1);
            }}
          >
            {isSessionMissing(error) ? "Iniciar nova sessão" : "Tentar reconectar"}
          </Button>
        </div>
      )}
    </div>
  );
}

function isSessionMissing(error: string) {
  return error.includes("session not found") || error.includes("session is not running");
}

function stateGlyph(state: TerminalState) {
  switch (state) {
    case "working": return "▸";
    case "answered": return "●";
    case "approval_required": return "⏵";
    case "crashed": return "✖";
    case "stopped": return "○";
    case "orphan": return "⚠";
  }
}
