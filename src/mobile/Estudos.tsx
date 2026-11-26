// Estudos no celular/web pareado: Roadmaps (do fork do Enzo, `EnzoViniski/niski`: estudar a etapa,
// concluir, revisar os cards, escrever no caderno), Pomodoro e análises. Os arquivos são os mesmos do PC
// (rotas `/roadmaps` do engine, `mobile_roadmaps.rs`). A IA (criar roadmap, preparar etapa, gerar
// cards) roda só no computador. Carregado só quando a tela abre (`EstudosTardio`).
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckIcon, FireIcon, LockIcon, PlayIcon, StarFilledIcon, StarIcon } from "../components/ui/PixelIcon";
import { AbasDosEstudos } from "../features/roadmaps/CabecalhoDosEstudos";
import { usarTransporteDaIa } from "../features/roadmaps/ia";
import { carregarMentor, usarTransporteDoMentor } from "../features/roadmaps/mentor";
import { carregarPomodoros, usarTransporteDoPomodoro } from "../features/roadmaps/pomodoro";
import { TelaDoMentor } from "../features/roadmaps/TelaDoMentor";
import { TelaDoPomodoro } from "../features/roadmaps/TelaDoPomodoro";
import { TelaDeAnalises } from "../features/roadmaps/TelaDeAnalises";
import { request } from "./api";
import { usarTransporteDosRoadmaps, type TransporteDosRoadmaps } from "../features/roadmaps/armazenamento";
import { Caderno } from "../features/roadmaps/Caderno";
import { IconeDoRoadmap } from "../features/roadmaps/comuns";
import { estrelas, metaDoDia, nivel, xp } from "../features/roadmaps/jogo";
import { carregar, carregarLista, erroDaListaAtual, erroDoRoadmap, listaAtual, recarregar, roadmap, useLoja } from "../features/roadmaps/loja";
import { PainelDaEtapa } from "../features/roadmaps/PainelDaEtapa";
import { estadosDasEtapas, etapaDeHoje } from "../features/roadmaps/progresso";
import { filaDeAgora } from "../features/roadmaps/revisao";
import { TelaDeRevisao } from "../features/roadmaps/TelaDeRevisao";
import type { RoadmapAberto } from "../features/roadmaps/armazenamento";
import { TamanhoDoTexto, useEscalaDoTexto } from "../features/roadmaps/Divisor";
import { BotaoDoPomodoro } from "../features/roadmaps/TelaDoPomodoro";
import { animarCascata } from "../features/roadmaps/animacoes";
import { useTransicao } from "../features/roadmaps/useTransicao";
import "../features/roadmaps/roadmaps.css";

const SO_NO_PC = "Isso ainda é feito no computador.";

const peloEngine: TransporteDosRoadmaps = {
  listar: () => request("/roadmaps"),
  criar: () => Promise.reject(new Error(SO_NO_PC)),
  ler: async (id, arquivo) => (await request<{ conteudo: string | null }>(`/roadmaps/${encodeURIComponent(id)}/arquivo?nome=${encodeURIComponent(arquivo)}`)).conteudo,
  gravar: async (id, nome, conteudo) => { await request(`/roadmaps/${encodeURIComponent(id)}/arquivo`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome, conteudo }), signal: AbortSignal.timeout(60_000) }); },
  anexar: async (id, linha) => { await request(`/roadmaps/${encodeURIComponent(id)}/conversa`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linha }) }); },
  ordenar: () => Promise.reject(new Error(SO_NO_PC)),
  backupAntesDeMigrar: () => Promise.reject(new Error("Este roadmap é de uma versão antiga: abra no computador uma vez para atualizar.")),
};
/** Arquivo de todos os estudos (`pomodoros.json`, `mentor.json`) pela rota `/roadmaps/geral` do engine. */
const arquivoGeralPeloEngine = (nome: string) => ({
  ler: async () => (await request<{ conteudo: string | null }>(`/roadmaps/geral?nome=${encodeURIComponent(nome)}`)).conteudo,
  gravar: async (conteudo: string) => { await request("/roadmaps/geral", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome, conteudo }), signal: AbortSignal.timeout(60_000) }); },
});
// Dentro do app do computador o transporte continua o do Tauri (esta tela é do celular/web).
if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) {
  usarTransporteDosRoadmaps(peloEngine);
  usarTransporteDoPomodoro(arquivoGeralPeloEngine("pomodoros.json"));
  usarTransporteDoMentor(arquivoGeralPeloEngine("mentor.json"));
  // A IA roda no PC (CLI e conta de lá), pela rota do engine; pode levar minutos.
  usarTransporteDaIa(async (pedido) => (await request<{ texto: string }>("/roadmaps/ia", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pedido), signal: AbortSignal.timeout(620_000),
  })).texto, (chave) => request("/roadmaps/ia/cancelar", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chave }),
  }));
}

export type SecaoDeEstudos = "roadmaps" | "mentor" | "pomodoro" | "analises";

export function Estudos({ secao, roadmap: id, ir }: { secao: SecaoDeEstudos; roadmap: string | null; ir: (secao: SecaoDeEstudos, roadmap?: string | null) => void }) {
  // Voltou para o navegador do celular: relê o Pomodoro (o PC pode ter gravado um foco).
  useEffect(() => {
    const aoVoltar = () => { if (!document.hidden) { void carregarPomodoros(); void carregarMentor(); } };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, []);
  return (
    <div className="estudos-m">
      {!id && (
        <div className="px-3 pt-2"><AbasDosEstudos secao={secao} onSecao={(s) => ir(s)} /></div>
      )}
      {secao === "mentor" ? <TelaDoMentor /> : secao === "pomodoro" ? <TelaDoPomodoro /> : secao === "analises" ? <TelaDeAnalises /> : <Roadmaps roadmap={id} abrir={(r) => ir("roadmaps", r)} />}
    </div>
  );
}

/** Link no celular: abre no navegador do aparelho (fora do app). */
const abrirFora = (url: string) => { window.open(url, "_blank", "noopener,noreferrer"); };

function Roadmaps({ roadmap: id, abrir }: { roadmap: string | null; abrir: (id: string | null) => void }) {
  useLoja();
  // Abrir um roadmap entra pela direita; voltar à lista, pela esquerda.
  const tela = useTransicao<HTMLDivElement>(id ?? "lista", id ? "frente" : "tras");
  useEffect(() => { if (!id) void carregarLista(); else void carregar(id).catch(() => undefined); }, [id]);
  // Voltou para o navegador do celular: relê (o PC pode ter mudado algo).
  useEffect(() => {
    const aoVoltar = () => { if (!document.hidden) { if (id) void recarregar(id); else void carregarLista(); } };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => document.removeEventListener("visibilitychange", aoVoltar);
  }, [id]);

  if (id) {
    const r = roadmap(id);
    const erro = erroDoRoadmap(id);
    if (!r) return <p className="m-vazio">{erro ? `Não consegui abrir: ${erro}` : "Abrindo roadmap…"}</p>;
    if (r.meta.fase !== "ativo" || !r.plano) return <p className="m-vazio">Este roadmap ainda está na entrevista. Termine a criação no computador.</p>;
    return <div ref={tela}><RoadmapNoCelular r={r} /></div>;
  }
  const lista = listaAtual();
  if (!lista) return <p className="m-vazio">{erroDaListaAtual() ? `Não consegui ler os roadmaps: ${erroDaListaAtual()}` : "Abrindo roadmaps…"}</p>;
  const ativos = lista.filter((m) => !m.arquivado);
  if (ativos.length === 0) return <p className="m-vazio">Nenhum roadmap ainda. Crie o primeiro no computador (Estudos, na barra lateral). O Pomodoro e as análises já funcionam aqui.</p>;
  return (
    <div ref={tela}>
    <ul className="roadmaps-m-lista">
      {ativos.map((m) => {
        const pct = m.resumo.etapas ? Math.round((m.resumo.concluidas / m.resumo.etapas) * 100) : 0;
        return (
          <li key={m.id}>
            <button type="button" className="roadmap-pasta glass roadmaps-m-pasta" onClick={() => abrir(m.id)} aria-label={`Abrir ${m.nome}`}>
              <span className="flex items-center gap-3">
                <IconeDoRoadmap icone={m.icone} cor={m.cor} tamanho={40} />
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-medium text-text-primary">{m.nome}</span>
                  <span className="block truncate text-xs text-text-muted">{m.fase !== "ativo" ? "Na entrevista (termine no computador)" : m.resumo.proximaEtapa ? `Próxima: ${m.resumo.proximaEtapa}` : "Caminho concluído"}</span>
                </span>
              </span>
              {m.fase === "ativo" && <>
                <span className="roadmap-barra mt-2 block"><span style={{ width: `${pct}%`, background: m.cor }} /></span>
                <span className="mt-1 flex gap-3 text-xs text-text-secondary">
                  <span>{m.resumo.concluidas}/{m.resumo.etapas}</span>
                  <span className="inline-flex items-center gap-1"><FireIcon size={12} className="es-fogo" aria-hidden="true" />{m.resumo.sequencia}</span>
                  {m.resumo.cardsParaHoje > 0 && <span className="text-accent">{m.resumo.cardsParaHoje} para revisar</span>}
                </span>
              </>}
            </button>
          </li>
        );
      })}
    </ul>
    </div>
  );
}

function RoadmapNoCelular({ r }: { r: RoadmapAberto }) {
  const plano = r.plano;
  const [etapa, setEtapa] = useState<string | null>(null);
  const [aba, setAba] = useState<"mapa" | "caderno">("mapa");
  const [revisando, setRevisando] = useState(false);
  const nos = useRef(new Map<string, HTMLElement>());
  const estados = plano ? estadosDasEtapas(plano, r.progresso) : {};
  const hoje = plano ? etapaDeHoje(plano, r.progresso) : undefined;
  const agora = new Date();
  const pontos = xp(plano, r.progresso, r.cards, agora);
  const lvl = nivel(pontos.total);
  const fila = filaDeAgora(r.cards, agora).length;
  const [escala, setEscala] = useEscalaDoTexto();
  // Etapa entra pela direita; voltar ao mapa, pela esquerda; Mapa ↔ Caderno troca suave.
  const vista = useTransicao<HTMLDivElement>(`${etapa ?? "mapa"}:${aba}`, etapa ? "frente" : "tras", false);
  const lista = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (etapa || aba !== "mapa") return;
    const animacoes = animarCascata([...(lista.current?.querySelectorAll<HTMLElement>(".roadmaps-m-etapa") ?? [])], 22, 12);
    if (hoje) nos.current.get(hoje.id)?.scrollIntoView?.({ block: "center" });
    return () => { for (const a of animacoes) a.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [etapa === null, aba]);

  if (!plano) return null;

  if (etapa) {
    return (
      <div ref={vista} className="roadmaps-m" style={{ ["--roadmap-cor" as string]: r.meta.cor, ["--roadmap-escala" as string]: escala }}>
        <div className="flex items-center justify-between">
          <button type="button" className="btn btn-ghost" onClick={() => setEtapa(null)}>← Mapa</button>
          <TamanhoDoTexto escala={escala} onChange={setEscala} />
        </div>
        <PainelDaEtapa r={r} etapaId={etapa} estado={estados[etapa] ?? "bloqueada"} semIa onAbrirLink={abrirFora}
          onPerguntar={() => undefined} onAbrirEtapa={setEtapa} />
      </div>
    );
  }

  return (
    <div ref={vista} className="roadmaps-m" style={{ ["--roadmap-cor" as string]: r.meta.cor, ["--roadmap-escala" as string]: escala }}>
      <div className="roadmaps-m-placar glass">
        <IconeDoRoadmap icone={r.meta.icone} cor={r.meta.cor} tamanho={36} />
        <div className="min-w-0 flex-1">
          <strong className="block truncate text-text-primary">{r.meta.nome}</strong>
          <span className="flex items-center gap-2 text-xs text-text-secondary">
            <span className="roadmap-nivel">Nv {lvl.nivel}</span>
            <span>{lvl.noNivel}/{lvl.paraOProximo} XP</span>
            <span className="inline-flex items-center gap-1"><FireIcon size={12} className="es-fogo" aria-hidden="true" />{r.meta.resumo.sequencia}</span>
            <span>Hoje {pontos.hoje}/{metaDoDia(plano)}</span>
          </span>
        </div>
      </div>
      <BotaoDoPomodoro materia={{ nome: r.meta.nome, roadmapId: r.meta.id, cor: r.meta.cor, ...(hoje ? { etapaId: hoje.id } : {}) }} />
      <div className="roadmaps-m-acoes">
        <button type="button" className={`btn ${fila > 0 ? "btn-primary" : "btn-glass"}`} disabled={r.cards.cards.length === 0} onClick={() => setRevisando(true)}>Revisar{fila > 0 ? ` (${fila})` : ""}</button>
        <button type="button" className={`btn ${aba === "mapa" ? "btn-glass" : "btn-ghost"}`} aria-pressed={aba === "mapa"} onClick={() => setAba("mapa")}>Mapa</button>
        <button type="button" className={`btn ${aba === "caderno" ? "btn-glass" : "btn-ghost"}`} aria-pressed={aba === "caderno"} onClick={() => setAba("caderno")}>Caderno</button>
      </div>
      <div ref={lista} className="flex flex-col gap-2">
      {aba === "caderno" ? <Caderno r={r} etapa={hoje} semIa compacto onAbrirLink={abrirFora} /> : plano.modulos.map((modulo, mi) => (
        <section key={modulo.id} className="roadmap-regiao roadmaps-m-regiao" aria-label={modulo.titulo}>
          <div className="roadmap-regiao-faixa">
            <span className="roadmap-regiao-numero">{mi + 1}</span>
            <strong className="min-w-0 flex-1 truncate text-text-primary">{modulo.titulo}</strong>
          </div>
          <ol className="roadmaps-m-etapas">
            {modulo.etapas.map((e) => {
              const estado = estados[e.id] ?? "bloqueada";
              const n = estrelas(e, r.progresso, r.cards);
              return (
                <li key={e.id}>
                  <button type="button" ref={(el) => { if (el) nos.current.set(e.id, el); else nos.current.delete(e.id); }}
                    className={`roadmaps-m-etapa is-${estado} ${e.id === hoje?.id && estado !== "concluida" ? "is-hoje" : ""}`} onClick={() => setEtapa(e.id)}
                    aria-label={`${e.titulo}: ${estado === "concluida" ? "Concluída" : estado === "andamento" ? "Em andamento" : estado === "disponivel" ? "Disponível" : "Bloqueada"}`}>
                    <span className="roadmaps-m-hex" aria-hidden="true">{estado === "concluida" ? <CheckIcon size={16} /> : estado === "bloqueada" ? <LockIcon size={14} /> : estado === "andamento" ? <PlayIcon size={14} /> : <StarIcon size={14} />}</span>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-sm text-text-primary">{e.titulo}</span>
                      <span className="block text-xs text-text-muted">{e.minutos} min{e.id === hoje?.id && estado !== "concluida" ? " · hoje" : ""}</span>
                    </span>
                    {estado === "concluida" && <span className="roadmap-estrelas" aria-label={`${n} de 3 estrelas`}>{[1, 2, 3].map((k) => <StarFilledIcon key={k} size={12} className={k <= n ? "is-ganha" : ""} />)}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
      </div>
      {revisando && <TelaDeRevisao r={r} onFechar={() => setRevisando(false)} />}
    </div>
  );
}
