// Fork (Roadmaps): caderno do roadmap (`caderno.md`) — a pessoa escreve o que aprende e pede revisão à IA.
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { useEffect, useRef, useState } from "react";
import { Button, SegmentedControl, Textarea } from "../../components/ui";
import { chaves, gravarCaderno, lerCaderno, revisarCaderno } from "./acoes";
import { PedidoEmAndamento, linksNoRoadmap, textoDoErro } from "./comuns";
import { foiCancelado } from "./ia";
import { lembranca, lembrar, tarefaEmAndamento, useLoja } from "./loja";
import type { RoadmapAberto } from "./armazenamento";
import type { Etapa } from "./tipos";

/** Espera depois da última tecla para gravar (e grava ao sair do campo ou fechar). */
const ESPERA_PARA_GRAVAR_MS = 800;

export function Caderno({ r, etapa, onAbrirLink, compacto = false, semIa = false }: { r: RoadmapAberto; etapa?: Etapa; onAbrirLink: (url: string) => void; compacto?: boolean; semIa?: boolean }) {
  useLoja();
  const id = r.meta.id;
  const [texto, setTexto] = useState<string | null>(lembranca<string>(`caderno:${id}`) ?? null);
  const [modo, setModo] = useState<"escrever" | "ler">("escrever");
  const [estado, setEstado] = useState<"" | "salvando" | "salvo">("");
  const [erro, setErro] = useState("");
  const revisao = lembranca<string>(`revisao-do-caderno:${id}`);
  const pendente = useRef<number | null>(null);
  const ultimo = useRef<string | null>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const revisando = Boolean(tarefaEmAndamento(chaves.caderno(id)));

  useEffect(() => {
    if (texto !== null) return;
    let vivo = true;
    void lerCaderno(id).then((t) => { if (!vivo) return; const lido = t ?? ""; ultimo.current = lido; lembrar(`caderno:${id}`, lido); setTexto(lido); })
      .catch((e) => { if (vivo) { setErro(textoDoErro(e)); setTexto(""); } });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const gravarAgora = (valor: string) => {
    if (pendente.current !== null) { window.clearTimeout(pendente.current); pendente.current = null; }
    if (valor === ultimo.current || r.somenteLeitura) return;
    ultimo.current = valor;
    setEstado("salvando");
    void gravarCaderno(id, valor).then(() => setEstado("salvo")).catch((e) => { ultimo.current = null; setEstado(""); setErro(textoDoErro(e)); });
  };
  // Fechar a aba ou trocar de etapa no meio da digitação: grava o que ficou.
  const textoAtual = useRef(texto);
  textoAtual.current = texto;
  useEffect(() => () => { if (textoAtual.current !== null) gravarAgora(textoAtual.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mudar = (valor: string) => {
    setTexto(valor);
    lembrar(`caderno:${id}`, valor);
    setEstado("");
    if (pendente.current !== null) window.clearTimeout(pendente.current);
    pendente.current = window.setTimeout(() => gravarAgora(valor), ESPERA_PARA_GRAVAR_MS);
  };

  const inserirTitulo = () => {
    if (!etapa || texto === null) return;
    const titulo = `## ${etapa.titulo}\n\n`;
    const novo = texto.includes(`## ${etapa.titulo}\n`) ? texto : `${texto.trimEnd()}${texto.trim() ? "\n\n" : ""}${titulo}`;
    mudar(novo);
    setModo("escrever");
    requestAnimationFrame(() => { const c = campo.current; if (c) { c.focus(); c.setSelectionRange(novo.length, novo.length); } });
  };

  const pedirRevisao = () => {
    if (texto === null) return;
    gravarAgora(texto);
    setErro("");
    void revisarCaderno(id).then((t) => lembrar(`revisao-do-caderno:${id}`, t)).catch((e) => { if (!foiCancelado(e)) setErro(textoDoErro(e)); });
  };

  return (
    <div className={`roadmap-caderno ${compacto ? "is-compacto" : ""}`} data-links-proprios onClickCapture={linksNoRoadmap(onAbrirLink)}>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl value={modo} onChange={setModo} grow={false}
          options={[{ value: "escrever", label: "Escrever" }, { value: "ler", label: "Ler" }]} />
        {etapa && <Button size="sm" variant="ghost" onClick={inserirTitulo} disabled={r.somenteLeitura}>+ {etapa.titulo}</Button>}
        <span className="ml-auto text-[11px] text-text-muted" role="status">{estado === "salvando" ? "Salvando…" : estado === "salvo" ? "Salvo" : ""}</span>
      </div>
      {texto === null ? <p className="text-xs text-text-muted">Abrindo o caderno…</p>
        : modo === "escrever" ? (
          <Textarea ref={campo} aria-label="Texto do caderno" value={texto} disabled={r.somenteLeitura} onChange={(e) => mudar(e.target.value)} onBlur={() => gravarAgora(texto)}
            className="roadmap-caderno-campo" spellCheck
            placeholder={"Escreva com as suas palavras o que você está aprendendo.\nUse ## para títulos e - para listas. A IA revisa quando você pedir."} />
        ) : (
          <div className="roadmap-markdown roadmap-caderno-leitura">{texto.trim() ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{texto}</ReactMarkdown> : <p className="text-text-muted">Ainda vazio.</p>}</div>
        )}
      <PedidoEmAndamento chave={chaves.caderno(id)} />
      {erro && <p role="alert" className="roadmap-erro">{erro}</p>}
      {!semIa && <div className="flex justify-end">
        <Button size="sm" variant="primary" disabled={revisando || r.somenteLeitura || !texto?.trim()} onClick={pedirRevisao}>Pedir revisão à IA</Button>
      </div>}
      {revisao && (
        <section className="roadmap-proposta glass" aria-label="Revisão do caderno">
          <div className="flex items-center">
            <strong className="flex-1 text-sm text-text-primary">Revisão da IA</strong>
            <button className="roadmap-mini" aria-label="Fechar revisão do caderno" onClick={() => lembrar(`revisao-do-caderno:${id}`, undefined)}>×</button>
          </div>
          <div className="roadmap-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{revisao}</ReactMarkdown></div>
          <p className="text-[11px] text-text-muted">Fica guardada também na conversa da IA ao lado.</p>
        </section>
      )}
    </div>
  );
}
