import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui";
import type { WorkspaceTab } from "../../types/workspace";
import { joinPath, writeBinaryFile } from "../files/filesService";
import {
  attachTerminal,
  beginConversation,
  ensureAgentTrust,
  ensureEngine,
  resizeTerminal,
  restartTerminal,
  spawnTerminal,
  stopTerminal,
  terminalSnapshot,
  type AgentCliStatus,
  type AgentLaunch,
  type LaunchPlan,
  type Profile,
  type TerminalState,
  writeTerminal,
} from "./terminalService";
import { handleTerminalKey } from "./keyBindings";
import { AgentLauncher } from "./AgentLauncher";
import { AgentSwitcher } from "./AgentSwitcher";
import { AgentRuntimeBadge } from "./AgentRuntimeBadge";

/** Colar imagem numa CLI de agente: ESC v (meta+v) — o que o Alt+V já mandava e funcionava.
 *  Se alguma CLI passar a escutar ^V (0x16) em vez disso, é aqui que muda. */
const CLI_IMAGE_PASTE = "\x1bv";

/** Falhas seguidas do poll antes de mostrar o banner de erro. Com poll de 100ms, três falhas são
 *  ~0,3s de engine mudo — abaixo disso é soluço, não queda, e o banner só atrapalha. */
const FALHAS_ATE_AVISAR = 3;

interface TerminalPaneProps {
  projectId: string;
  projectPath: string;
  paneId: string;
  tab: WorkspaceTab;
  onSessionCreated: (sessionId: string, title: string, provider?: string) => void;
}

export function TerminalPane({ projectId, projectPath, paneId, tab, onSessionCreated }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef(tab.resourceId);
  const sequenceRef = useRef(0);
  const falhasRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<TerminalState>("stopped");
  const [retry, setRetry] = useState(0);
  const [launch, setLaunch] = useState<AgentLaunch | null>(null);
  const [switching, setSwitching] = useState(false);
  const [inputLocked, setInputLocked] = useState(false);
  const conversationRef = useRef<string | null>(null);
  /** Quem está atendendo esta aba, do ponto de vista da SESSÃO (e não do launcher).
   *
   *  Tem de vir do snapshot: `launch` só existe quando foi esta montagem da pane que abriu o
   *  agente. Numa sessão restaurada (app reaberto, aba reatachada) ele é `null` para sempre — foi
   *  o que deixou a etiqueta de modelo invisível justamente no caso mais comum. */
  const [sessao, setSessao] = useState<{
    provider?: string;
    profileId?: string;
    externalSessionId?: string;
  }>({});
  const agent = launch?.agent ?? null;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let pollTimer: number | undefined;
    let firstPoll = true;
    let reviving = false;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "Cascadia Code, Consolas, monospace",
      fontSize: 13,
      scrollback: 10_000,
      // Fundo transparente no xterm; a cor sai do container, com a opacidade de Configurações → Fundo.
      allowTransparency: true,
      theme: {
        background: "#00000000",
        foreground: "#e2e2ec",
        cursor: "#f97316",
        selectionBackground: "#f973164d",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    fit.fit();

    terminal.attachCustomKeyEventHandler((event) =>
      handleTerminalKey(event, {
        hasSelection: () => terminal.hasSelection(),
        copySelection: () => {
          void navigator.clipboard.writeText(terminal.getSelection()).catch(() => undefined);
        },
        write: (data) => {
          const sessionId = sessionRef.current;
          if (sessionId) void writeTerminal(sessionId, data).catch(() => undefined);
        },
      })
    );

    async function start() {
      try {
        setError(null);
        await ensureEngine();
        if (!sessionRef.current) {
          if (agent) await ensureAgentTrust(agent.id, projectPath, launch?.profile?.id);

          // A conversa é a entidade que sobrevive à troca de conta e de IA. Abri-la antes do
          // spawn é o que fixa o `--session-id` do Claude e, com ele, o caminho do transcript.
          let command = agent?.command;
          let externalSessionId: string | undefined;
          let planoTitulo: string | undefined;
          if (agent && !conversationRef.current) {
            const plan = launch?.conversationId
              ? null
              : await beginConversation({
                  projectId,
                  cwd: projectPath,
                  provider: agent.id,
                  profileId: launch?.profile?.id,
                  command: agent.command,
                  title: tab.title,
                });
            conversationRef.current = plan?.conversation_id ?? launch?.conversationId ?? null;
            if (plan) {
              command = plan.initial_command;
              externalSessionId = plan.external_session_id ?? undefined;
              planoTitulo = plan.title;
            }
          }

          const session = await spawnTerminal({
            projectId,
            // Nome da **conversa**, não "Claude · agent": é ele que aparece na aba, na barra lateral
            // e na notificação, e o engine o atualiza sozinho quando o primeiro prompt der um nome.
            name: planoTitulo ?? (agent ? `${agent.label} · agent` : tab.title),
            cwd: projectPath,
            rows: terminal.rows,
            cols: terminal.cols,
            initialCommand: command,
            provider: agent?.id,
            profileId: launch?.profile?.id,
            conversationId: conversationRef.current ?? undefined,
            externalSessionId,
          });
          if (cancelled) return;
          sessionRef.current = session.id;
          if (conversationRef.current) {
            await attachTerminal(conversationRef.current, session.id).catch(() => undefined);
          }
          setState(session.state);
          onSessionCreated(session.id, session.name, agent?.id);
        }
        poll();
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      }
    }

    /** Religa a sessão que o engine só conhece como histórica (engine reiniciado por update ou
     *  reabertura do app) ou cuja CLI saiu. Mesmo caminho do botão "reiniciar": mesmo id, e conversa
     *  Claude volta com `--resume`. Sem isto a aba ficava preta e digitar dava "session is not running". */
    async function revive(sessionId: string) {
      if (reviving) return;
      reviving = true;
      try {
        await restartTerminal(sessionId);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        reviving = false;
      }
    }

    async function poll() {
      if (cancelled || !sessionRef.current) return;
      try {
        const snapshot = await terminalSnapshot(sessionRef.current, sequenceRef.current);
        // Sessão histórica: o engine devolve `next_seq` 0 e nenhuma saída. Só na primeira leitura,
        // para não ressuscitar em loop quem o usuário parou nesta mesma montagem.
        const dead = snapshot.session.state === "stopped" || snapshot.session.state === "crashed";
        if (firstPoll && dead && snapshot.next_seq === 0) void revive(sessionRef.current);
        firstPoll = false;
        if (snapshot.from_seq > sequenceRef.current) terminal.write("\r\n[scrollback anterior descartado]\r\n");
        if (snapshot.data) terminal.write(snapshot.data);
        setState(snapshot.session.state);
        setInputLocked(Boolean(snapshot.session.input_locked));
        // Mantém o que já sabia quando o campo vier vazio: o engine só preenche `external_session_id`
        // depois que o provider grava a sessão dele.
        setSessao((anterior) => {
          const proximo = {
            provider: snapshot.session.provider ?? anterior.provider,
            profileId: snapshot.session.profile_id ?? anterior.profileId,
            externalSessionId: snapshot.session.external_session_id ?? anterior.externalSessionId,
          };
          const igual =
            proximo.provider === anterior.provider &&
            proximo.profileId === anterior.profileId &&
            proximo.externalSessionId === anterior.externalSessionId;
          // Isto roda 10x por segundo: devolver o objeto anterior evita re-render a cada poll.
          return igual ? anterior : proximo;
        });
        terminal.options.disableStdin = Boolean(snapshot.session.input_locked);
        sequenceRef.current = snapshot.next_seq;
        // Voltou a responder: derruba um aviso que tenha sobrado. Atualização funcional porque
        // isto roda 10x por segundo — devolver o mesmo valor faz o React nem re-renderizar.
        falhasRef.current = 0;
        setError((anterior) => (anterior === null ? anterior : null));
      } catch (reason) {
        falhasRef.current += 1;
        // Uma falha isolada não vira banner: o poll é a cada 100ms e qualquer soluço momentâneo
        // do engine deixava o erro colado na tela até trocar de projeto e voltar (o remount era a
        // única coisa que limpava).
        if (!cancelled && falhasRef.current >= FALHAS_ATE_AVISAR) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      }
      // Enquanto está falhando, espaça as tentativas: martelar de 100 em 100ms um engine que caiu
      // só gasta socket e atrasa a recuperação.
      if (!cancelled) {
        pollTimer = window.setTimeout(poll, falhasRef.current >= FALHAS_ATE_AVISAR ? 1_000 : 100);
      }
    }

    const dataSubscription = terminal.onData((data) => {
      const sessionId = sessionRef.current;
      if (sessionId) void writeTerminal(sessionId, data).catch((reason) => {
        if (String(reason).includes("Consulta de uso")) setInputLocked(true);
        // Digitar numa sessão morta é pedido para voltar a ela, não motivo de banner.
        else if (String(reason).includes("session is not running")) void revive(sessionId);
        else setError(String(reason));
      });
    });
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      fit.fit();
      if (sessionRef.current) {
        void resizeTerminal(sessionRef.current, terminal.rows, terminal.cols).catch(() => undefined);
      }
    });
    resizeObserver?.observe(host);

    // Captura na fase de captura (antes do próprio textarea do xterm ver o evento): xterm só lê
    // `clipboardData.getData("text/plain")`, então colar uma imagem (sem texto no clipboard) não
    // faria nada sozinho.
    //
    // Numa aba de agente quem sabe lidar com imagem é a própria CLI — ela lê o clipboard do
    // sistema e anexa como `[Image #N]`. O papel daqui é só entregar a tecla: manda a mesma
    // sequência que o Alt+V já mandava (ESC v, meta+v), que é o atalho de colar imagem que
    // funciona nessas CLIs. Salvar em disco e digitar o caminho continua sendo o caminho de
    // terminal puro, onde não há ninguém pra ler o clipboard.
    async function handleImagePaste(event: ClipboardEvent) {
      const files = event.clipboardData?.files;
      const imageFile = files && Array.from(files).find((file) => file.type.startsWith("image/"));
      if (!imageFile || !sessionRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (agent) {
        void writeTerminal(sessionRef.current, CLI_IMAGE_PASTE).catch(() => undefined);
        return;
      }
      try {
        const buffer = new Uint8Array(await imageFile.arrayBuffer());
        const extension = imageFile.type.split("/")[1] || "png";
        // O caminho é digitado cru na PTY, sem aspas — espaço e vírgula no nome (o padrão de
        // print do ChatGPT, p.ex.) fariam a CLI ler só o primeiro pedaço. Troca tudo que não for
        // seguro por "-" em vez de tentar citar pra cada shell.
        const rawName = /\.\w+$/.test(imageFile.name) ? imageFile.name : `pasted-${Date.now()}.${extension}`;
        const fileName = rawName.replace(/[^\w.-]+/g, "-");
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
  }, [agent, launch?.profile?.id, paneId, projectId, projectPath, retry, tab.id, tab.title, onSessionCreated]);

  /** Aplica a troca preparada pelo backend: para a sessão atual e relança na conta/IA nova,
   *  mantendo a mesma conversa. Não abre aba nem conversa nova — é a mesma timeline. */
  async function applySwitch(plan: LaunchPlan, nextAgent: AgentCliStatus, profile: Profile | null) {
    const current = sessionRef.current;
    setSwitching(false);
    if (current) await stopTerminal(current).catch(() => undefined);
    sessionRef.current = undefined;
    sequenceRef.current = 0;
    conversationRef.current = plan.conversation_id;
    if (plan.notice) setError(plan.notice);
    setLaunch({
      agent: { ...nextAgent, command: plan.initial_command },
      profile,
      conversationId: plan.conversation_id,
    });
  }

  // Aba de terminal puro não passa pelo seletor de CLI: sobe direto no shell do sistema.
  if (tab.kind !== "terminal" && !tab.resourceId && !agent) {
    const projectName = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath;
    return <AgentLauncher projectName={projectName} projectPath={projectPath} onLaunch={setLaunch} />;
  }

  return (
    <div className="relative h-full min-h-0" style={{ backgroundColor: "rgb(14 14 20 / var(--terminal-opacity, 1))" }}>
      <div
        ref={hostRef}
        className="absolute inset-0 p-2"
        aria-label={`Terminal ${tab.title}`}
        data-omni-context="terminal"
      />
      <div className="absolute right-3 top-2 z-10 flex items-center gap-2 bg-[#0e0e14]/90 px-2 py-1 text-[10px] uppercase text-text-muted">
        <span>{stateGlyph(state)} {state.replace(/_/g, " ")}</span>
        {inputLocked && <span className="text-xs text-warning">Consultando /usage…</span>}
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
        {conversationRef.current && agent && (
          <button type="button" className="hover:underline" onClick={() => setSwitching(true)}>
            trocar conta / IA
          </button>
        )}
      </div>
      {(sessao.provider ?? agent?.id) && (
        <AgentRuntimeBadge
          provider={(sessao.provider ?? agent?.id) as string}
          profileId={sessao.profileId ?? launch?.profile?.id}
          cwd={projectPath}
          externalSessionId={sessao.externalSessionId}
          className="absolute bottom-2 right-3 z-10"
        />
      )}
      {switching && conversationRef.current && agent && (
        <AgentSwitcher
          conversationId={conversationRef.current}
          currentProvider={agent.id}
          currentProfileId={launch?.profile?.id ?? null}
          onCancel={() => setSwitching(false)}
          onSwitch={(plan, nextAgent, profile) => void applySwitch(plan, nextAgent, profile)}
        />
      )}
      {error && (
        <div role="alert" className="absolute inset-x-3 top-3 z-10 border-2 border-danger bg-bg-elevated p-3 text-xs text-danger">
          <p>{error}</p>
          <Button
            size="sm"
            variant="danger"
            className="mt-2"
            onClick={() => {
              const sessionId = sessionRef.current;
              if (sessionId && error.includes("session is not running")) {
                setError(null);
                void restartTerminal(sessionId).catch((reason) => setError(String(reason)));
                return;
              }
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
  return error.includes("session not found");
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
