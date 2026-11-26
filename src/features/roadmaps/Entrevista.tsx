// Fork (Roadmaps): criação por entrevista — uma pergunta por vez, depois o plano para revisar.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Textarea } from "../../components/ui";
import { aceitarPlano, chaves, gerarPlano, responderEntrevista } from "./acoes";
import { IconeDoRoadmap, PedidoEmAndamento, textoDoErro } from "./comuns";
import { foiCancelado } from "./ia";
import { tarefaEmAndamento, useLoja } from "./loja";
import type { RoadmapAberto } from "./armazenamento";
import type { Plano } from "./tipos";

export function Entrevista({ r, onVoltar }: { r: RoadmapAberto; onVoltar: () => void }) {
  useLoja();
  const id = r.meta.id;
  const [resposta, setResposta] = useState("");
  const [erro, setErro] = useState("");
  // O que tentar de novo depois de um erro (a resposta da pessoa já ficou gravada).
  const refazer = useRef<() => Promise<void>>(() => responderEntrevista(id));
  const fim = useRef<HTMLDivElement>(null);
  const perguntando = Boolean(tarefaEmAndamento(chaves.entrevista(id)));
  const montando = Boolean(tarefaEmAndamento(chaves.plano(id)));
  const ocupado = perguntando || montando;
  const { mensagens, proposta } = r.entrevista;
  const ultima = mensagens[mensagens.length - 1];
  const esperandoResposta = ultima?.de === "ia" && !proposta;

  useEffect(() => { fim.current?.scrollIntoView?.({ block: "end" }); }, [mensagens.length, ocupado, proposta]);
  // Sem pergunta pendente (recém-criado, ou a IA falhou depois da última resposta): continua daqui.
  const parada = !ocupado && !proposta && (mensagens.length === 0 || ultima?.de === "eu");
  const comecou = useRef(false);
  useEffect(() => {
    if (comecou.current || mensagens.length > 0 || ocupado || proposta) return;
    comecou.current = true;
    rodar(() => responderEntrevista(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rodar = (acao: () => Promise<void>, novaTentativa: () => Promise<void> = acao) => {
    setErro("");
    refazer.current = novaTentativa;
    void acao().catch((e) => { if (!foiCancelado(e)) setErro(textoDoErro(e)); });
  };
  const enviar = (texto: string) => {
    if (!texto.trim() || ocupado) return;
    setResposta("");
    rodar(() => responderEntrevista(id, texto), () => responderEntrevista(id));
  };
  const submeter = (e: FormEvent) => { e.preventDefault(); enviar(resposta); };

  return (
    <div className="h-full overflow-y-auto px-6 py-5 [scrollbar-gutter:stable]">
      <div className="mx-auto w-full max-w-[760px] space-y-4">
        <header className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={onVoltar}>← Roadmaps</Button>
          <IconeDoRoadmap icone={r.meta.icone} cor={r.meta.cor} tamanho={32} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-text-primary">{r.meta.nome}</h1>
            <p className="text-xs text-text-muted">{proposta ? "Confira o caminho antes de começar" : "Algumas perguntas para montar o seu caminho"}</p>
          </div>
        </header>

        <div className="roadmap-conversa" aria-live="polite">
          <div className="roadmap-balao is-eu">{r.entrevista.pedido}</div>
          {mensagens.map((m, i) => <div key={i} className={`roadmap-balao ${m.de === "eu" ? "is-eu" : "is-ia"}`}>{m.texto}</div>)}
          <div ref={fim} />
        </div>

        <PedidoEmAndamento chave={chaves.entrevista(id)} />
        <PedidoEmAndamento chave={chaves.plano(id)} />
        {montando && <p className="text-xs text-text-muted">Com pesquisa na web, isso pode levar alguns minutos. Pode sair desta tela: o plano fica salvo quando ficar pronto.</p>}
        {erro && (
          <div role="alert" className="roadmap-erro">
            <span className="flex-1">{erro}</span>
            <Button size="sm" onClick={() => rodar(refazer.current)}>Tentar de novo</Button>
          </div>
        )}

        {proposta ? (
          <RevisaoDoPlano plano={proposta} ocupado={ocupado} onAceitar={() => rodar(() => aceitarPlano(id))} onAjustar={(texto) => rodar(() => gerarPlano(id, texto))} />
        ) : (
          <>
            {parada && !erro && mensagens.length > 0 && (
              <div className="flex justify-center"><Button size="sm" variant="primary" onClick={() => rodar(() => responderEntrevista(id))}>Continuar a entrevista</Button></div>
            )}
            {esperandoResposta && ultima.opcoes && ultima.opcoes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {ultima.opcoes.map((o) => <Button key={o} size="sm" disabled={ocupado} onClick={() => enviar(o)}>{o}</Button>)}
              </div>
            )}
            <form className="space-y-2" onSubmit={submeter}>
              <Textarea aria-label="Sua resposta" rows={2} value={resposta} disabled={ocupado} onChange={(e) => setResposta(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(resposta); } }}
                placeholder={esperandoResposta ? "Responda com suas palavras" : "Aguarde a pergunta"} />
              <div className="flex flex-wrap justify-end gap-2">
                {mensagens.some((m) => m.de === "eu") && (
                  <Button size="sm" variant="ghost" disabled={ocupado} onClick={() => rodar(() => gerarPlano(id))}>Já respondi o bastante, montar o plano</Button>
                )}
                <Button size="sm" variant="primary" type="submit" disabled={ocupado || !resposta.trim()}>Responder</Button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function RevisaoDoPlano({ plano, ocupado, onAceitar, onAjustar }: { plano: Plano; ocupado: boolean; onAceitar: () => void; onAjustar: (texto: string) => void }) {
  const [ajuste, setAjuste] = useState("");
  const etapas = plano.modulos.reduce((n, m) => n + m.etapas.length, 0);
  const minutos = plano.modulos.reduce((n, m) => n + m.etapas.reduce((s, e) => s + e.minutos, 0), 0);
  return (
    <section className="glass space-y-3 p-4" aria-label="Plano proposto">
      <div>
        <h2 className="text-base font-semibold text-text-primary">{plano.objetivo || "Seu caminho"}</h2>
        {plano.visao && <p className="text-sm text-text-secondary">{plano.visao}</p>}
        <p className="mt-1 text-xs text-text-muted">{plano.modulos.length} módulos · {etapas} etapas · cerca de {Math.round(minutos / 60)} h no total{plano.prazo ? ` · prazo: ${plano.prazo}` : ""}</p>
      </div>
      <ol className="space-y-2">
        {plano.modulos.map((m, i) => (
          <li key={m.id}>
            <details open={i === 0}>
              <summary className="cursor-pointer text-sm font-medium text-text-primary">{i + 1}. {m.titulo} <span className="text-xs text-text-muted">({m.etapas.length} etapas)</span></summary>
              {m.descricao && <p className="mt-1 text-xs text-text-secondary">{m.descricao}</p>}
              <ul className="mt-1 space-y-0.5 pl-4 text-sm text-text-secondary">
                {m.etapas.map((e) => <li key={e.id}>• {e.titulo} <span className="text-xs text-text-muted">· {e.minutos} min{e.fontes.length ? ` · ${e.fontes.length} fonte${e.fontes.length > 1 ? "s" : ""}` : ""}</span></li>)}
              </ul>
            </details>
          </li>
        ))}
      </ol>
      <Textarea aria-label="Pedir ajuste" rows={2} value={ajuste} disabled={ocupado} onChange={(e) => setAjuste(e.target.value)} placeholder="Quer mudar algo? Ex.: menos teoria, mais prática; tenho só 15 min por dia" />
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" disabled={ocupado || !ajuste.trim()} onClick={() => { onAjustar(ajuste); setAjuste(""); }}>Pedir ajuste</Button>
        <Button size="sm" variant="primary" disabled={ocupado} onClick={onAceitar}>Aceitar e começar</Button>
      </div>
    </section>
  );
}
