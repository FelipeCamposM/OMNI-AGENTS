// Mentor de estudo: conversa com a IA sobre o que a pessoa está fazendo agora, com o contexto dela
// (o que estuda, plataformas) e as atividades de hoje. O próximo passo sugerido vira Pomodoro num toque.
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { Select } from "../../components/ui";
import {
  BookIcon, CalendarIcon, ChatIcon, CheckIcon, ClockIcon, CloseIcon, CompassIcon, GlobeIcon, HashIcon, HourglassIcon, PlayIcon,
  RobotIcon, SendIcon, TargetIcon, TrashIcon,
} from "../../components/ui/PixelIcon";
import { formatarMinutos, taxaDeAcerto } from "./analises";
import { EscolhaDaIa } from "./comuns";
import { carregarLista, listaAtual, useLoja } from "./loja";
import {
  ATIVIDADES, ROTULO_DA_ATIVIDADE, acoesDoMentor, carregarMentor, estadoDoMentor, useMentor,
  type Atividade, type Plataforma, type ProximoPasso, type TipoDeAtividade,
} from "./mentor";
import { acoesDoPomodoro, carregarPomodoros, estadoDoPomodoro } from "./pomodoro";
import { diaLocal } from "./progresso";
import "./estudos.css";

const NO_APP = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const ATALHOS = [
  "Comecei a aula de ",
  "Terminei a aula de … com … min",
  "Vou fazer questões de ",
  "Terminei … questões, acertei …",
  "Tenho … min livres agora, o que faço?",
  "Vou parar por hoje",
];

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function resumoDaAtividade(a: Atividade) {
  return [ROTULO_DA_ATIVIDADE[a.tipo], a.materia, a.plataforma, a.minutos !== undefined && `${a.minutos} min`,
    a.questoes !== undefined && `${a.acertos ?? "?"}/${a.questoes} questões`].filter(Boolean).join(" · ");
}

const opcoesDeTipo = (tipo: TipoDeAtividade, mudar: (t: TipoDeAtividade) => void, rotulo: string) => (
  <Select<TipoDeAtividade> aria-label={rotulo} value={tipo} onChange={mudar} options={ATIVIDADES.map((t) => ({ value: t, label: ROTULO_DA_ATIVIDADE[t] }))} />
);

export function TelaDoMentor() {
  useMentor();
  useLoja();
  useEffect(() => { void carregarMentor(); void carregarPomodoros(); if (!listaAtual()) void carregarLista(); }, []);
  const { dados, carregou, pensando, erro } = estadoDoMentor();
  const [mensagem, setMensagem] = useState("");
  const [contextoAberto, setContextoAberto] = useState(false);
  const fim = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { fim.current?.scrollIntoView?.({ block: "end" }); }, [dados.conversa.length, pensando]);
  const semContexto = carregou && !dados.perfil.contexto.trim();

  const enviar = () => {
    const texto = mensagem.trim();
    if (!texto || pensando) return;
    setMensagem("");
    const roadmaps = (listaAtual() ?? []).filter((m) => !m.arquivado);
    const { cronometro, historico } = estadoDoPomodoro();
    void acoesDoMentor.enviar(texto, { roadmaps, sessoes: historico.sessoes, cronometro });
  };

  return (
    <div className="es-rolagem h-full">
      <div className="es-miolo">
        <div className="es-grade-2">
          <section className="mentor-conversa" aria-label="Conversa com o Mentor">
            <h2 className="es-rotulo"><ChatIcon size={14} aria-hidden="true" />Conversa
              {dados.conversa.length > 0 && (
                <button type="button" className="es-botao is-discreto es-rotulo-fim" onClick={() => void acoesDoMentor.limparConversa()}>
                  <TrashIcon size={12} aria-hidden="true" />Limpar conversa
                </button>
              )}
            </h2>
            <div className="mentor-mensagens" aria-live="polite">
              {dados.conversa.length === 0 && (
                <div className="mentor-boas-vindas">
                  <span className="es-selo" aria-hidden="true"><CompassIcon size={24} /></span>
                  <h2 className="pixel-text">Seu mentor de estudo</h2>
                  <p className="es-dica">Conte o que está fazendo, como “terminei a aula de TypeScript de 40 min”. Ele registra a atividade e diz o próximo passo: quanto tempo, quantas questões, em qual plataforma.</p>
                  {semContexto && <p className="es-dica">Antes, conte seu contexto em <b>Meu contexto</b>, ao lado.</p>}
                </div>
              )}
              {dados.conversa.map((m) => (
                <div key={m.id} className={`mentor-linha is-${m.de}`}>
                  {m.de === "ia" && <span className="mentor-avatar" aria-hidden="true"><RobotIcon size={16} /></span>}
                  <div className="mentor-bolha">
                    {m.de === "ia"
                      ? <div className="roadmap-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{m.texto}</ReactMarkdown></div>
                      : <p className="m-0 whitespace-pre-wrap">{m.texto}</p>}
                    {m.registradas && m.registradas.length > 0 && (
                      <p className="mentor-registrou"><CheckIcon size={12} aria-hidden="true" /><span>Registrado: {m.registradas.map((id) => dados.atividades.find((a) => a.id === id)).filter((a): a is Atividade => !!a).map(resumoDaAtividade).join("; ") || "(apagado)"}</span></p>
                    )}
                    {m.proximo && <CartaoDoProximo passo={m.proximo} />}
                    <span className="mentor-hora">{hora(m.em)}</span>
                  </div>
                </div>
              ))}
              {pensando && (
                <div className="mentor-linha is-ia" role="status">
                  <span className="mentor-avatar" aria-hidden="true"><RobotIcon size={16} /></span>
                  <div className="mentor-bolha mentor-pensando">
                    <i /><i /><i /><span>Pensando…</span>
                    <button type="button" className="es-botao is-discreto" onClick={() => acoesDoMentor.cancelar()}>Cancelar</button>
                  </div>
                </div>
              )}
              <div ref={fim} />
            </div>
            <div className="mentor-pe">
              {erro && <p className="es-erro" role="alert">{erro}</p>}
              <div className="mentor-atalhos">
                {ATALHOS.map((a) => <button key={a} type="button" className="mentor-atalho" onClick={() => { setMensagem(a); campo.current?.focus(); }}>{a.replace(/ $/, "…")}</button>)}
              </div>
              <form className="mentor-entrada" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
                <textarea ref={campo} className="es-campo" aria-label="Mensagem para o Mentor" rows={2} value={mensagem} placeholder="O que você está fazendo agora?"
                  onChange={(e) => setMensagem(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }} />
                <button type="submit" className="es-botao" disabled={!mensagem.trim() || pensando}><SendIcon size={14} aria-hidden="true" />Enviar</button>
              </form>
            </div>
          </section>

          <aside className="es-coluna">
            <Hoje />
            <details className="es-painel" open={contextoAberto || semContexto} onToggle={(e) => setContextoAberto((e.target as HTMLDetailsElement).open)}>
              <summary><span className="es-rotulo"><BookIcon size={14} aria-hidden="true" />Meu contexto</span></summary>
              <MeuContexto />
            </details>
          </aside>
        </div>
      </div>
    </div>
  );
}

function CartaoDoProximo({ passo }: { passo: ProximoPasso }) {
  const comecar = () => acoesDoPomodoro.comecarCom({ nome: passo.materia, atividade: passo.tipo, ...(passo.roadmapId ? { roadmapId: passo.roadmapId } : {}) }, passo.minutos);
  return (
    <div className="mentor-proximo">
      <span className="mentor-proximo-selo" aria-hidden="true"><TargetIcon size={18} /></span>
      <div className="mentor-proximo-corpo">
        <p>Próximo passo</p>
        <p className="mentor-proximo-titulo">{passo.descricao}</p>
        <ul className="mentor-proximo-dados">
          <li><BookIcon size={10} aria-hidden="true" />{ROTULO_DA_ATIVIDADE[passo.tipo]}</li>
          <li><ClockIcon size={10} aria-hidden="true" />{passo.minutos} min</li>
          {passo.quantidade !== undefined && <li><HashIcon size={10} aria-hidden="true" />{passo.quantidade} {passo.tipo === "questoes" ? "questões" : "unidades"}</li>}
          {passo.plataforma && <li><GlobeIcon size={10} aria-hidden="true" />{passo.plataforma}</li>}
        </ul>
        <button type="button" className="es-botao" onClick={comecar}><PlayIcon size={14} aria-hidden="true" />Começar {passo.minutos} min</button>
      </div>
    </div>
  );
}

/** Hoje: números e a lista do que foi registrado (com apagar e registro à mão). */
function Hoje() {
  useMentor();
  const { dados } = estadoDoMentor();
  const hoje = diaLocal(new Date());
  const deHoje = dados.atividades.filter((a) => diaLocal(new Date(a.em)) === hoje);
  const minutos = deHoje.reduce((t, a) => t + (a.minutos ?? 0), 0);
  const questoes = deHoje.reduce((t, a) => t + (a.questoes ?? 0), 0);
  const acertos = deHoje.reduce((t, a) => t + (a.acertos ?? 0), 0);
  return (
    <section className="es-painel" aria-label="Hoje">
      <h3 className="es-rotulo"><CalendarIcon size={14} aria-hidden="true" />Hoje</h3>
      <dl className="es-numeros mb-3">
        <div className="es-numero"><dt>registrado</dt><dd>{formatarMinutos(minutos)}</dd></div>
        <div className="es-numero"><dt>questões</dt><dd>{questoes}{questoes > 0 && <span className="es-numero-detalhe">{taxaDeAcerto({ questoes, acertos })} de acerto</span>}</dd></div>
      </dl>
      {deHoje.length === 0 ? <p className="es-dica">Nada registrado ainda.</p> : (
        <ul className="es-lista">
          {deHoje.map((a) => (
            <li key={a.id} className="es-item">
              <span className="es-hora">{hora(a.em)}</span>
              <span className="es-item-texto"><span className="es-item-titulo block">{resumoDaAtividade(a)}</span></span>
              <button type="button" className="es-mini" aria-label={`Apagar ${resumoDaAtividade(a)}`} onClick={() => void acoesDoMentor.apagarAtividade(a.id)}><CloseIcon size={12} /></button>
            </li>
          ))}
        </ul>
      )}
      <NovaAtividade />
    </section>
  );
}

function MeuContexto() {
  useMentor();
  const { perfil } = estadoDoMentor().dados;
  const [contexto, setContexto] = useState(perfil.contexto);
  useEffect(() => { setContexto(perfil.contexto); }, [perfil.contexto]);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<TipoDeAtividade>("questoes");
  const plataformas = (lista: Plataforma[]) => void acoesDoMentor.perfil({ plataformas: lista });
  const adicionar = () => {
    if (!nome.trim()) return;
    plataformas([...perfil.plataformas, { id: `pl-${Date.now().toString(36)}`, nome: nome.trim().slice(0, 80), tipo }]);
    setNome("");
  };
  return (
    <div className="es-mostrar">
      <label className="es-etiqueta">O que você estuda
        <textarea className="es-campo" rows={4} value={contexto} onChange={(e) => setContexto(e.target.value)}
          onBlur={() => { if (contexto !== perfil.contexto) void acoesDoMentor.perfil({ contexto }); }}
          placeholder="Ex.: concurso de TI do TRF (banca FCC), prova em março; 3 h por dia útil; fraco em redes." />
      </label>
      <div>
        <p className="es-etiqueta mb-2">Plataformas</p>
        {perfil.plataformas.length > 0 && (
          <ul className="mentor-plataformas">
            {perfil.plataformas.map((p) => (
              <li key={p.id}>
                {p.nome} <small>{ROTULO_DA_ATIVIDADE[p.tipo]}</small>
                <button type="button" className="es-mini" aria-label={`Remover ${p.nome}`} onClick={() => plataformas(perfil.plataformas.filter((x) => x.id !== p.id))}><CloseIcon size={10} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="mentor-adicionar">
          <input className="es-campo" aria-label="Nome da plataforma" value={nome} placeholder="QConcursos, Alura…" onChange={(e) => setNome(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(); } }} />
          {opcoesDeTipo(tipo, setTipo, "Tipo da plataforma")}
          <button type="button" className="es-botao is-contorno" onClick={adicionar} disabled={!nome.trim()}>Adicionar</button>
        </div>
      </div>
      {NO_APP && <EscolhaDaIa valor={perfil.ia} onChange={(ia) => void acoesDoMentor.perfil({ ia })} />}
    </div>
  );
}

/** Registro à mão, sem IA (ex.: fez questões no ônibus). */
function NovaAtividade() {
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<TipoDeAtividade>("questoes");
  const [materia, setMateria] = useState("");
  const [minutos, setMinutos] = useState("");
  const [questoes, setQuestoes] = useState("");
  const [acertos, setAcertos] = useState("");
  if (!aberto) return <button type="button" className="es-botao is-contorno mt-3 w-full" onClick={() => setAberto(true)}><HourglassIcon size={14} aria-hidden="true" />Registrar à mão</button>;
  const numero = (v: string) => (v.trim() && Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : undefined);
  const salvar = () => {
    if (!materia.trim()) return;
    const q = numero(questoes), a = numero(acertos), m = numero(minutos);
    void acoesDoMentor.registrar({
      id: `a-${Date.now().toString(36)}`, em: new Date().toISOString(), tipo, materia: materia.trim().slice(0, 80),
      ...(m !== undefined ? { minutos: m } : {}), ...(q !== undefined ? { questoes: q } : {}), ...(a !== undefined ? { acertos: q !== undefined ? Math.min(a, q) : a } : {}),
    });
    setMateria(""); setMinutos(""); setQuestoes(""); setAcertos(""); setAberto(false);
  };
  return (
    <form className="mentor-manual" onSubmit={(e) => { e.preventDefault(); salvar(); }}>
      {opcoesDeTipo(tipo, setTipo, "Tipo da atividade")}
      <input className="es-campo" aria-label="Matéria" value={materia} placeholder="Matéria" onChange={(e) => setMateria(e.target.value)} />
      <input className="es-campo" aria-label="Minutos" inputMode="numeric" value={minutos} placeholder="Minutos" onChange={(e) => setMinutos(e.target.value)} />
      {tipo === "questoes" ? (
        <div className="grid grid-cols-2 gap-2">
          <input className="es-campo" aria-label="Questões" inputMode="numeric" value={questoes} placeholder="Questões" onChange={(e) => setQuestoes(e.target.value)} />
          <input className="es-campo" aria-label="Acertos" inputMode="numeric" value={acertos} placeholder="Acertos" onChange={(e) => setAcertos(e.target.value)} />
        </div>
      ) : <span />}
      <button type="submit" className="es-botao" disabled={!materia.trim()}>Registrar</button>
      <button type="button" className="es-botao is-discreto" onClick={() => setAberto(false)}>Cancelar</button>
    </form>
  );
}
