import { useState } from "react";
import { request, type Timeline } from "./api";
import { usePoll } from "./usePoll";

export interface Subagente {
  id: string;
  tipo: string;
  descricao: string;
  estado: "rodando" | "concluido" | "parado";
  ultima_acao: string | null;
  atualizado_ms: number;
}

const ROTULO: Record<Subagente["estado"], string> = { rodando: "Rodando", concluido: "Concluído", parado: "Parado" };

/** Pedido ao agente principal: só ele encerra um subagente sem derrubar o turno (`TaskStop`). */
export function pedidoDeParada(sub: Pick<Subagente, "id" | "tipo" | "descricao">) {
  return `Pare só o subagente ${sub.tipo} "${sub.descricao}" (id ${sub.id}) com a ferramenta TaskStop. Não pare os outros nem mude o que você está fazendo.`;
}

/**
 * O que o agente está fazendo agora, além da conversa: os subagentes, cada um com estado, última
 * ação e o próprio histórico.
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
      // Primeiro pelo painel da CLI (setas + `x` na linha dele), que para na hora e sem gastar nada.
      const direto = await request<{ na_tela?: boolean }>(`${base}/subagentes/${encodeURIComponent(sub.id)}/parar`, { method: "POST" })
        .catch(() => null);
      if (direto?.na_tela) return;
      // Não achou a linha (o texto dela muda com o trabalho) ou engine antigo: pede ao agente, que sabe o
      // id. Com turno em andamento a mensagem entra na fila da CLI e é lida no próximo passo.
      await request(`${base}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: pedidoDeParada(sub), fila: ativo }) });
    } catch (motivo) { setErro(motivo instanceof Error ? motivo.message : String(motivo)); }
    finally { setParando(null); }
  }

  const recentes = subagentes.filter((s) => s.estado === "rodando" || Date.now() - s.atualizado_ms < 10 * 60_000);
  if (recentes.length === 0) return null;

  return (
    <div className="trabalho-ao-vivo" aria-label="Trabalho ao vivo">
      <ul className="trabalho-subagentes">
          {recentes.map((sub) => (
            <li key={sub.id} className={`trabalho-sub is-${sub.estado}`}>
              <div className="trabalho-sub-linha">
                <span className="trabalho-sub-estado">{ROTULO[sub.estado]}</span>
                <span className="trabalho-sub-nome" title={sub.descricao}><b>{sub.tipo}</b> {sub.descricao}</span>
                <button type="button" className="btn btn-ghost trabalho-botao" aria-expanded={aberto === sub.id}
                  onClick={() => setAberto(aberto === sub.id ? null : sub.id)}>{aberto === sub.id ? "Fechar" : "Ver"}</button>
                {sub.estado === "rodando" && live && (
                  <button type="button" className="btn btn-ghost trabalho-botao" disabled={parando === sub.id}
                    title="Encerra só este subagente; os outros e a conversa seguem" onClick={() => void parar(sub)}>
                    {parando === sub.id ? "Pedindo…" : "Parar"}
                  </button>
                )}
              </div>
              {sub.ultima_acao && <p className="trabalho-sub-acao">{sub.ultima_acao}</p>}
              {aberto === sub.id && <HistoricoDoSubagente rota={`${base}/subagentes/${encodeURIComponent(sub.id)}`} ativo={sub.estado === "rodando"} />}
            </li>
          ))}
      </ul>
      {erro && <p role="alert" className="m-alerta">{erro}</p>}
    </div>
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
      {mensagens.map((m) => (
        <li key={m.id} className={m.kind === "tool" ? "is-acao" : m.role === "user" ? "is-pedido" : undefined}>
          {m.kind === "tool" ? <><b>{m.tool}</b> {m.text}</> : m.text}
        </li>
      ))}
    </ol>
  );
}
