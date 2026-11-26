// Fork (Roadmaps): fila de revisão do dia (FSRS) — mostrar resposta e errei / difícil / bom / fácil.
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui";
import { revisar } from "./acoes";
import { animarEntrada, animarTroca } from "./animacoes";
import { textoDoErro } from "./comuns";
import { useLoja } from "./loja";
import { filaDeAgora, NOTAS, previa, proximoDeHoje, type Nota } from "./revisao";
import type { RoadmapAberto } from "./armazenamento";

export function TelaDeRevisao({ r, onFechar }: { r: RoadmapAberto; onFechar: () => void }) {
  useLoja();
  const [mostrando, setMostrando] = useState(false);
  const [feitas, setFeitas] = useState(0);
  const [erro, setErro] = useState("");
  // "Agora" só anda quando a pessoa responde: sem relógio rodando com a tela aberta.
  const [agora, setAgora] = useState(() => new Date());
  const fila = useMemo(() => filaDeAgora(r.cards, agora), [r.cards, agora]);
  const card = fila[0];
  const rotulos = useMemo(() => (card ? previa(card, agora) : null), [card, agora]);
  const etapa = card && r.plano ? r.plano.modulos.flatMap((m) => m.etapas).find((e) => e.id === card.etapaId) : undefined;
  const caixa = useRef<HTMLDivElement>(null);
  const proximo = card ? undefined : proximoDeHoje(r.cards, agora);

  const verso = useRef<HTMLDivElement>(null);
  const primeiro = useRef(true);
  // Abrir a revisão: a caixa sobe. Próximo card: desliza da direita.
  useEffect(() => {
    const a = primeiro.current ? animarEntrada(caixa.current) : animarTroca(caixa.current, "frente");
    primeiro.current = false;
    return () => a?.cancel();
  }, [card?.id]);
  useEffect(() => { if (!mostrando) return; const a = animarTroca(verso.current); return () => a?.cancel(); }, [mostrando]);

  const responder = (nota: Nota) => {
    if (!card || r.somenteLeitura) return;
    setErro("");
    const momento = new Date();
    void revisar(r.meta.id, card.id, nota, momento).then(() => {
      setFeitas((n) => n + 1); setMostrando(false); setAgora(new Date());
    }).catch((e) => setErro(textoDoErro(e)));
  };

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "Escape") { e.preventDefault(); onFechar(); return; }
      if (!card) return;
      if (!mostrando && (e.key === " " || e.key === "Enter")) { e.preventDefault(); setMostrando(true); return; }
      if (mostrando && ["1", "2", "3", "4"].includes(e.key)) { e.preventDefault(); responder(Number(e.key) as Nota); }
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  });

  return (
    <div className="roadmap-revisao" role="dialog" aria-modal="true" aria-label="Revisão">
      <div ref={caixa} className="roadmap-revisao-caixa glass">
        <div className="flex items-center gap-2">
          <strong className="flex-1 text-sm text-text-primary">Revisão{fila.length ? ` · ${fila.length} agora` : ""}</strong>
          <span className="text-xs text-text-muted">{feitas} feitas</span>
          <Button size="sm" variant="ghost" onClick={onFechar} aria-label="Fechar revisão">×</Button>
        </div>
        {erro && <p role="alert" className="roadmap-erro">{erro}</p>}
        {card ? (
          <>
            {etapa && <p className="text-xs text-text-muted">{etapa.titulo}</p>}
            <div className="roadmap-card-frente roadmap-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{card.frente}</ReactMarkdown></div>
            {mostrando ? (
              <>
                <div ref={verso} className="roadmap-card-verso roadmap-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{card.verso}</ReactMarkdown></div>
                <div className="grid grid-cols-4 gap-2">
                  {NOTAS.map(({ nota, rotulo }) => (
                    <Button key={nota} size="sm" variant={nota === 3 ? "primary" : "glass"} disabled={r.somenteLeitura} onClick={() => responder(nota)}>
                      <span className="flex flex-col items-center leading-tight"><span>{rotulo}</span><span className="text-[10px] opacity-70">{rotulos?.[nota]}</span></span>
                    </Button>
                  ))}
                </div>
              </>
            ) : (
              <Button variant="primary" className="w-full" onClick={() => setMostrando(true)}>Mostrar resposta</Button>
            )}
            <p className="text-center text-[11px] text-text-muted">Espaço mostra · 1 a 4 respondem · Esc fecha</p>
          </>
        ) : (
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-text-primary">{feitas ? "Pronto por agora. Bom trabalho!" : "Nada para revisar agora."}</p>
            {proximo && <p className="text-xs text-text-muted">O próximo card volta hoje às {new Date(proximo.fsrs.due).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.</p>}
            <div className="flex justify-center gap-2">
              {proximo && <Button size="sm" onClick={() => setAgora(new Date())}>Conferir de novo</Button>}
              <Button size="sm" variant="primary" onClick={onFechar}>Voltar à trilha</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
