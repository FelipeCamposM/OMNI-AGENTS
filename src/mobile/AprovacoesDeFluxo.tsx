import { useEffect, useState } from "react";
import { Button } from "../components/ui/Button";
import { request } from "./api";

/** Só o que esta tela lê da execução (o tipo completo mora em `features/fluxos/fluxosService.ts`, que é do PC). */
interface Execucao {
  id: string; status: string; entrada: string;
  fluxo: { nome: string; nos: { id: string; tipo: string; titulo: string; config: Record<string, unknown> }[]; conexoes: { de: string; para: string }[] };
  nos: Record<string, { status: string; saida: string }>;
}
export interface Pendente { execucao: string; no: string; fluxo: string; pergunta: string; entrada: string; anterior: string }

/** O nó de aprovação parado em cada execução que espera você, com a saída da etapa que levou até ele. */
export function pendentesDe(execucoes: Execucao[]): Pendente[] {
  return execucoes.flatMap((e) => {
    const no = e.fluxo.nos.find((n) => n.tipo === "aprovacao" && e.nos[n.id]?.status === "aguardando");
    if (!no) return [];
    const antes = e.fluxo.conexoes.map((c) => c.para === no.id ? e.nos[c.de] : undefined).find((n) => n?.saida);
    return [{
      execucao: e.id, no: no.id, fluxo: e.fluxo.nome, entrada: e.entrada, anterior: antes?.saida.slice(-1500) ?? "",
      pergunta: String(no.config.pergunta || no.titulo || "Aprovar para seguir?"),
    }];
  });
}

/**
 * Fluxo parado num nó "Aprovação": aparece em "Precisa de você" da web e do celular, com Aprovar e
 * Recusar. Antes só dava para responder no PC. Engine sem as rotas de fluxo: não mostra nada.
 */
export function AprovacoesDeFluxo({ aoMudar }: { aoMudar?: (quantas: number) => void }) {
  const [pendentes, setPendentes] = useState<Pendente[]>([]);
  const [respondendo, setRespondendo] = useState<string | null>(null);
  const [erro, setErro] = useState<{ execucao: string; texto: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    async function ler() {
      try {
        const lista = await request<{ id: string; status: string }[]>("/fluxos/execucoes");
        const detalhes = await Promise.all(lista.filter((e) => e.status === "aguardando")
          .map((e) => request<Execucao>(`/fluxos/execucoes/${encodeURIComponent(e.id)}`)));
        if (vivo) setPendentes(pendentesDe(detalhes));
      } catch { /* engine antigo ou fora do ar: a lista de conversas já avisa */ }
    }
    void ler();
    const timer = window.setInterval(() => void ler(), 5000);
    return () => { vivo = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { aoMudar?.(pendentes.length); }, [pendentes.length, aoMudar]);

  async function responder(p: Pendente, sim: boolean) {
    setRespondendo(p.execucao); setErro(null);    try {
      await request(`/fluxos/execucoes/${encodeURIComponent(p.execucao)}/nos/${encodeURIComponent(p.no)}/aprovar`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sim }),
      });
      setPendentes((atual) => atual.filter((x) => x.execucao !== p.execucao));
    } catch (motivo) { setErro({ execucao: p.execucao, texto: motivo instanceof Error ? motivo.message : String(motivo) }); }
    finally { setRespondendo(null); }
  }

  if (pendentes.length === 0) return null;
  return (
    <ul className="aprov-fluxo" aria-label="Fluxos esperando aprovação">
      {pendentes.map((p) => (
        <li key={p.execucao} className="aprov-fluxo-item glass">
          <span className="aprov-fluxo-rotulo">Fluxo · {p.fluxo}</span>
          <b className="aprov-fluxo-pergunta">{p.pergunta}</b>
          {p.entrada && <span className="aprov-fluxo-entrada">{p.entrada}</span>}
          {p.anterior && <details><summary>O que a etapa anterior entregou</summary><pre>{p.anterior}</pre></details>}
          {erro?.execucao === p.execucao && <p role="alert" className="text-xs text-danger">{erro.texto}</p>}
          <div className="aprov-fluxo-acoes">
            <Button size="sm" variant="ghost" disabled={respondendo !== null} onClick={() => void responder(p, false)}>Recusar</Button>
            <Button size="sm" variant="primary" disabled={respondendo !== null} onClick={() => void responder(p, true)}>
              {respondendo === p.execucao ? "Enviando…" : "Aprovar"}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
