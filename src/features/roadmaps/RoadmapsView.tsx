// Roadmaps de estudo (do fork do Enzo, `EnzoViniski/niski`) + Pomodoro e análises: a tela — lista de roadmaps, entrevista ou trilha do roadmap aberto.
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../../components/ui";
import { CabecalhoDosEstudos, type SecaoDeEstudo } from "./CabecalhoDosEstudos";
import { TelaDeAnalises } from "./TelaDeAnalises";
import { TelaDoMentor } from "./TelaDoMentor";
import { TelaDoPomodoro } from "./TelaDoPomodoro";
import { lembrarUltimo, ultimoAberto } from "./armazenamento";
import { Entrevista } from "./Entrevista";
import { ListaDeRoadmaps } from "./ListaDeRoadmaps";
import { carregar, carregarLista, erroDaListaAtual, erroDoRoadmap, lembranca, lembrar, listaAtual, recarregar, roadmap, useLoja } from "./loja";
import { Trilha } from "./Trilha";
import { useTransicao } from "./useTransicao";
import "./roadmaps.css";

export type SecaoDosRoadmaps = SecaoDeEstudo;

/** Roadmap aberto na última vez que a tela esteve aberta (nesta execução do app). */
const ABERTO = "aberto";

export function RoadmapsView({ onClose, continuar = false, secao: secaoInicial = "roadmaps", onSecao }: { onClose: () => void; continuar?: boolean; secao?: SecaoDosRoadmaps; onSecao?: (s: SecaoDosRoadmaps) => void }) {
  useLoja();
  const [secao, setSecao] = useState<SecaoDosRoadmaps>(secaoInicial);
  const trocarSecao = (s: SecaoDosRoadmaps) => { setSecao(s); onSecao?.(s); };
  const [aberto, setAberto] = useState<string | null>(() => (continuar ? lembranca<string>(ABERTO) ?? ultimoAberto() : null));
  const lista = listaAtual();

  useEffect(() => { void carregarLista(); }, []);
  useEffect(() => {
    lembrar(ABERTO, aberto ?? undefined);
    if (!aberto) return;
    lembrarUltimo(aberto);
    void carregar(aberto).catch(() => undefined);
  }, [aberto]);
  // Voltou para a janela: o celular pode ter mudado algo (cards, caderno, etapa concluída). Só evento, sem timer.
  useEffect(() => {
    const aoVoltar = () => {
      if (document.hidden) return;
      if (aberto) void recarregar(aberto); else void carregarLista();
    };
    window.addEventListener("focus", aoVoltar);
    document.addEventListener("visibilitychange", aoVoltar);
    return () => { window.removeEventListener("focus", aoVoltar); document.removeEventListener("visibilitychange", aoVoltar); };
  }, [aberto]);
  // "Continuar estudo" com um roadmap que não existe mais: cai na lista.
  useEffect(() => {
    if (aberto && lista && !lista.some((m) => m.id === aberto)) setAberto(null);
  }, [aberto, lista]);

  const voltar = () => { setAberto(null); void carregarLista(); };
  // Abrir um roadmap entra pela direita; voltar à lista, pela esquerda. A entrevista que vira trilha também anima.
  const fase = aberto ? roadmap(aberto)?.meta.fase ?? "abrindo" : "lista";
  const tela = useTransicao<HTMLDivElement>(`${aberto ?? "lista"}:${fase}`, aberto ? "frente" : "tras");
  const embrulhar = (conteudo: ReactNode) => <div ref={tela} className="h-full min-h-0">{conteudo}</div>;

  if (secao === "mentor") return <ComAbas secao={secao} onSecao={trocarSecao} onFechar={onClose}><TelaDoMentor /></ComAbas>;
  if (secao === "pomodoro") return <ComAbas secao={secao} onSecao={trocarSecao} onFechar={onClose}><TelaDoPomodoro /></ComAbas>;
  if (secao === "analises") return <ComAbas secao={secao} onSecao={trocarSecao} onFechar={onClose}><TelaDeAnalises /></ComAbas>;
  if (aberto) {
    const r = roadmap(aberto);
    const erro = erroDoRoadmap(aberto);
    if (erro && !r) return (
      <div className="p-6 space-y-3">
        <p role="alert" className="roadmap-erro">Não consegui abrir este roadmap: {erro}</p>
        <Button size="sm" onClick={voltar}>← Roadmaps</Button>
      </div>
    );
    if (!r) return <div className="p-6 font-mono text-xs text-text-muted">Abrindo roadmap…</div>;
    return embrulhar(r.meta.fase === "ativo" && r.plano ? <Trilha r={r} onVoltar={voltar} /> : <Entrevista r={r} onVoltar={voltar} />);
  }
  if (!lista) {
    const erro = erroDaListaAtual();
    return erro
      ? <div className="p-6"><p role="alert" className="roadmap-erro">Não consegui ler os roadmaps: {erro}</p></div>
      : <div className="p-6 font-mono text-xs text-text-muted">Abrindo roadmaps…</div>;
  }
  return <ComAbas secao={secao} onSecao={trocarSecao} onFechar={onClose}>{embrulhar(<ListaDeRoadmaps lista={lista} onAbrir={setAberto} />)}</ComAbas>;
}

/** Topo e abas das seções (só nas telas de lista, não dentro de um roadmap aberto). */
function ComAbas({ secao, onSecao, onFechar, children }: { secao: SecaoDosRoadmaps; onSecao: (s: SecaoDosRoadmaps) => void; onFechar: () => void; children: ReactNode }) {
  return (
    <div className="es">
      <CabecalhoDosEstudos secao={secao} onSecao={onSecao} onFechar={onFechar} />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
