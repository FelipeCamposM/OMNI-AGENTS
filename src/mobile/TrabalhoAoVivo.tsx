import { useState, type ComponentType, type SVGProps } from "react";
import {
  BugIcon, EditIcon, EyeIcon, FileTextIcon, GlobeIcon, NotesIcon, RobotIcon, SearchIcon, StopIcon, TerminalIcon, ToolsIcon,
} from "../components/ui/PixelIcon";
import { actionKey, request, type Timeline } from "./api";
import { usePoll } from "./usePoll";

export interface Subagente {
  id: string;
  tipo: string;
  descricao: string;
  estado: "rodando" | "concluido" | "parado";
  ultima_acao: string | null;
  atualizado_ms: number;
}

type Icone = ComponentType<SVGProps<SVGSVGElement>>;

const ROTULO: Record<Subagente["estado"], string> = { rodando: "Rodando", concluido: "Concluído", parado: "Parado" };

/** Ícone pelo tipo do subagente (Explore, web-fetch, Plan…); o resto é um robô. */
function iconeDoTipo(tipo: string): Icone {
  const t = tipo.toLowerCase();
  if (t.includes("explore") || t.includes("investig") || t.includes("search")) return SearchIcon;
  if (t.includes("fetch") || t.includes("web")) return GlobeIcon;
  if (t.includes("plan")) return NotesIcon;
  if (t.includes("review") || t.includes("bug")) return BugIcon;
  return RobotIcon;
}

/** Ícone pela ferramenta da ação (primeira palavra de "Bash npm test"). */
function iconeDaFerramenta(ferramenta: string): Icone {
  const f = ferramenta.toLowerCase();
  if (f === "bash" || f === "powershell") return TerminalIcon;
  if (f === "read") return FileTextIcon;
  if (f === "edit" || f === "write" || f === "notebookedit") return EditIcon;
  if (f === "grep" || f === "glob") return SearchIcon;
  if (f.startsWith("web")) return GlobeIcon;
  return ToolsIcon;
}

function haQuanto(ms: number) {
  const min = Math.floor((Date.now() - ms) / 60_000);
  if (min < 1) return "agora";
  return min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h`;
}

/** Pedido ao agente principal: só ele encerra um subagente sem derrubar o turno (`TaskStop`). */
export function pedidoDeParada(sub: Pick<Subagente, "id" | "tipo" | "descricao">) {
  return `Pare só o subagente ${sub.tipo} "${sub.descricao}" (id ${sub.id}) com a ferramenta TaskStop. Não pare os outros nem mude o que você está fazendo.`;
}

/**
 * Painel dos subagentes da conversa: cada um com ícone do tipo, tarefa, estado, última ação, histórico
 * e o botão de parar só aquele. Só aparece enquanto algum roda; os que terminaram ficam recolhidos.
 */
export function TrabalhoAoVivo({ conversaId, provider, ativo, live }: {
  conversaId: string;
  provider: string | null;
  ativo: boolean;
  live: boolean;
}) {
  const base = `/conversas/${encodeURIComponent(conversaId)}`;
  const [subagentes, setSubagentes] = useState<Subagente[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [parando, setParando] = useState<string | null>(null);
  const [verAntigos, setVerAntigos] = useState(false);
  // Pedido de parada já mandado: o botão fica "Parando…" até o subagente sair de "rodando".
  const [pedidos, setPedidos] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);

  // Só o Claude grava subagentes. Trabalhando, relê a cada 3 s; parado, devagar.
  usePoll(async () => {
    if (provider !== "claude") return;
    // Engine anterior a esta rota (o instalado antes de atualizar) não manda a lista: nada a mostrar.
    const lista = (await request<{ subagentes?: Subagente[] } | null>(`${base}/subagentes`))?.subagentes;
    setSubagentes(Array.isArray(lista) ? lista : []);
  }, () => undefined, [base, provider], ativo ? 3_000 : 15_000);

  async function parar(sub: Subagente) {
    setParando(sub.id); setErro(null);
    try {
      // Pelo agente principal (`TaskStop`), que sabe o id. Teclar no rodapé da CLI deixava a sessão
      // num estado que a conversa não reconhecia. Com turno em andamento, entra na fila da CLI.
      await request(`${base}/prompt`, { method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": actionKey() },
        body: JSON.stringify({ texto: pedidoDeParada(sub), fila: ativo }) });
      setPedidos((atual) => new Set(atual).add(sub.id));
    } catch (motivo) { setErro(motivo instanceof Error ? motivo.message : String(motivo)); }
    finally { setParando(null); }
  }

  // Só os que rodam ficam à vista; terminou, sai da conversa (fica atrás de "Ver concluídos").
  const ativos = subagentes.filter((s) => s.estado === "rodando");
  const rodando = ativos.length;
  if (rodando === 0) return null;
  const antigos = subagentes.length - rodando;
  const visiveis = verAntigos ? subagentes : ativos;

  return (
    <section className="trabalho-ao-vivo" aria-label="Subagentes">
      <header className="trabalho-topo">
        <RobotIcon aria-hidden className="h-3.5 w-3.5" />
        <span className="trabalho-titulo">Subagentes</span>
        <span className="trabalho-contagem">
          {rodando} rodando · {subagentes.length} no total
        </span>
        {antigos > 0 && (
          <button type="button" className="btn btn-ghost trabalho-botao" aria-expanded={verAntigos}
            onClick={() => setVerAntigos(!verAntigos)}>
            {verAntigos ? "Só os rodando" : `Ver concluídos (${antigos})`}
          </button>
        )}
      </header>
      <ul className="trabalho-subagentes">
        {visiveis.map((sub) => {
          const Icone = iconeDoTipo(sub.tipo);
          const [ferramenta = "", ...alvo] = (sub.ultima_acao ?? "").split(" ");
          const IconeAcao = iconeDaFerramenta(ferramenta);
          return (
            <li key={sub.id} className={`trabalho-sub is-${sub.estado}`}>
              <div className="trabalho-sub-linha">
                <span className="trabalho-sub-icone" aria-hidden><Icone className="h-4 w-4" /></span>
                <div className="trabalho-sub-texto">
                  <span className="trabalho-sub-nome" title={sub.descricao}>{sub.descricao || sub.tipo}</span>
                  <span className="trabalho-sub-meta">
                    <span className="trabalho-sub-estado">{ROTULO[sub.estado]}</span> · {sub.tipo} · {haQuanto(sub.atualizado_ms)}
                  </span>
                </div>
                <button type="button" className="btn btn-ghost trabalho-botao" aria-expanded={aberto === sub.id}
                  title="Histórico das ações deste subagente" onClick={() => setAberto(aberto === sub.id ? null : sub.id)}>
                  <EyeIcon aria-hidden className="h-3 w-3" />{aberto === sub.id ? "Fechar" : "Ver"}
                </button>
                {sub.estado === "rodando" && live && (
                  <button type="button" className="btn btn-ghost trabalho-botao trabalho-parar" disabled={parando === sub.id || pedidos.has(sub.id)}
                    title="Encerra só este subagente; os outros e a conversa seguem" onClick={() => void parar(sub)}>
                    <StopIcon aria-hidden className="h-3 w-3" />{parando === sub.id || pedidos.has(sub.id) ? "Parando…" : "Parar"}
                  </button>
                )}
              </div>
              {sub.ultima_acao && (
                <p className="trabalho-sub-acao" title={sub.ultima_acao}>
                  <IconeAcao aria-hidden className="h-3 w-3" /><b>{ferramenta}</b> {alvo.join(" ")}
                </p>
              )}
              {aberto === sub.id && <HistoricoDoSubagente rota={`${base}/subagentes/${encodeURIComponent(sub.id)}`} ativo={sub.estado === "rodando"} />}
            </li>
          );
        })}
      </ul>
      {erro && <p role="alert" className="m-alerta">{erro}</p>}
    </section>
  );
}

function HistoricoDoSubagente({ rota, ativo }: { rota: string; ativo: boolean }) {
  const [mensagens, setMensagens] = useState<Timeline["timeline"]["messages"] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  usePoll(async () => { setMensagens((await request<Pick<Timeline, "timeline">>(rota)).timeline.messages); setErro(null); },
    (motivo) => setErro(String(motivo)), [rota], ativo ? 3_000 : 60_000);
  if (erro) return <p className="m-alerta">{erro}</p>;
  if (!mensagens) return <p className="m-dica">Carregando…</p>;
  return (
    <ol className="trabalho-sub-historico">
      {mensagens.map((m) => {
        if (m.kind !== "tool") return <li key={m.id} className={m.role === "user" ? "is-pedido" : undefined}>{m.text}</li>;
        const Icone = iconeDaFerramenta(m.tool ?? "");
        return <li key={m.id} className="is-acao"><Icone aria-hidden className="h-3 w-3" /><b>{m.tool}</b> {m.text}</li>;
      })}
    </ol>
  );
}
