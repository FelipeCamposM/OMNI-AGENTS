// Pomodoro dos estudos: o botão no topo da trilha/estudo e a tela com o cronômetro grande e o histórico.
import { useEffect, useMemo, useState } from "react";
import { ClockIcon, CloseIcon, FlagIcon, GearIcon, HourglassIcon, ListIcon, PauseIcon, PlayIcon, ReloadIcon, TargetIcon } from "../../components/ui/PixelIcon";
import { Select } from "../../components/ui";
import { RodaDeNumeros } from "./RodaDeNumeros";
import { ROTULO_DA_ATIVIDADE } from "./tipos";
import { formatarMinutos, rotuloDoDia } from "./analises";
import { listaAtual } from "./loja";
import {
  ROTULO_DA_FASE, acoesDoPomodoro, carregarPomodoros, contando, decorrido, estadoDoPomodoro, formatarTempo, restante, usePomodoro,
  type Configuracao, type Fase, type Materia, type SessaoDePomodoro,
} from "./pomodoro";
import { diaLocal } from "./progresso";
import "./estudos.css";

const pintar = (cor?: string) => (el: HTMLElement | null) => { if (cor) el?.style.setProperty("--cor", cor); };

/** Chip do topo: parado, começa um foco nesta matéria; contando, mostra o tempo e pausa. */
export function BotaoDoPomodoro({ materia }: { materia: Materia }) {
  usePomodoro();
  const { cronometro } = estadoDoPomodoro();
  const agora = Date.now();
  const ativo = contando(cronometro);
  const comecado = cronometro.comecou !== null;
  const outraMateria = comecado && cronometro.materia.nome !== materia.nome;
  const acao = () => {
    if (ativo) { acoesDoPomodoro.pausar(); return; }
    if (!comecado) acoesDoPomodoro.materia(materia);
    acoesDoPomodoro.comecar();
  };
  return (
    <button type="button" className="es-chip-pomodoro" aria-pressed={ativo} onClick={acao}
      title={ativo ? `Pausar (${cronometro.materia.nome})` : comecado ? `Continuar (${cronometro.materia.nome})` : `Começar ${estadoDoPomodoro().historico.config.foco} min de foco em ${materia.nome}`}>
      {ativo ? <PauseIcon size={14} aria-hidden="true" /> : <HourglassIcon size={14} aria-hidden="true" />}
      {comecado || ativo
        ? <><span>{ROTULO_DA_FASE[cronometro.fase]}</span> <span className="es-chip-tempo">{formatarTempo(restante(cronometro, agora))}</span></>
        : <span>Pomodoro</span>}
      {outraMateria && <span className="text-text-muted">· {cronometro.materia.nome}</span>}
    </button>
  );
}

const RAIO = 90;
const CIRCUNFERENCIA = 2 * Math.PI * RAIO;
const FASES: Fase[] = ["foco", "pausa", "pausaLonga"];

export function TelaDoPomodoro() {
  usePomodoro();
  useEffect(() => { void carregarPomodoros(); }, []);
  const { cronometro, historico, erro } = estadoDoPomodoro();
  const agora = Date.now();
  const ativo = contando(cronometro);
  const fracao = cronometro.duracao ? decorrido(cronometro, agora) / cronometro.duracao : 0;
  const hoje = diaLocal(new Date(agora));
  const deHoje = historico.sessoes.filter((s) => diaLocal(new Date(s.inicio)) === hoje);
  const minutosHoje = deHoje.reduce((t, s) => t + s.minutos, 0);
  const emPausa = cronometro.fase !== "foco";

  return (
    <div className="es-rolagem h-full">
      <div className="es-miolo">
        <div className="es-grade-2">
          <section className={`pomodoro-palco${emPausa ? " is-pausa" : ""}`} aria-label="Cronômetro">
            <div className="pomodoro-fases" aria-hidden="true">
              {FASES.map((f) => <span key={f} className={f === cronometro.fase ? "is-atual" : ""}>{ROTULO_DA_FASE[f]}</span>)}
            </div>
            <p className="sr-only">{ROTULO_DA_FASE[cronometro.fase]}</p>
            <div className="pomodoro-anel">
              <svg viewBox="0 0 200 200" aria-hidden="true">
                <circle cx="100" cy="100" r={RAIO} className="pomodoro-anel-trilho" />
                <circle cx="100" cy="100" r={RAIO} className={`pomodoro-anel-frente is-${cronometro.fase}`}
                  strokeDasharray={CIRCUNFERENCIA} strokeDashoffset={CIRCUNFERENCIA * (1 - fracao)} transform="rotate(-90 100 100)" />
              </svg>
              <div className="pomodoro-tempo">
                <span className="pomodoro-digitos" role="timer" aria-live="off" aria-label="Tempo restante">{formatarTempo(restante(cronometro, agora))}</span>
                <span className="pomodoro-materia">
                  <span className="es-ponto" ref={pintar(cronometro.materia.cor)} aria-hidden="true" />
                  <span>{cronometro.materia.nome}{cronometro.materia.atividade ? ` · ${ROTULO_DA_ATIVIDADE[cronometro.materia.atividade]}` : ""}</span>
                </span>
              </div>
            </div>
            <div className="pomodoro-ciclo" aria-label={`${cronometro.focosNoCiclo} de ${historico.config.ciclos} focos até a pausa longa`}>
              {Array.from({ length: historico.config.ciclos }, (_, i) => <span key={i} className={i < cronometro.focosNoCiclo ? "is-feito" : ""} />)}
            </div>
            <div className="pomodoro-controles">
              {ativo
                ? <button type="button" className="es-botao is-grande" onClick={acoesDoPomodoro.pausar}><PauseIcon size={16} aria-hidden="true" />Pausar</button>
                : <button type="button" className="es-botao is-grande" onClick={acoesDoPomodoro.comecar}><PlayIcon size={16} aria-hidden="true" />{cronometro.comecou === null ? "Começar" : "Continuar"}</button>}
              <button type="button" className="es-botao is-contorno is-grande" onClick={acoesDoPomodoro.pular}
                title="Vai para a próxima fase; foco com 1 min ou mais entra no histórico como interrompido"><FlagIcon size={16} aria-hidden="true" />Pular</button>
              <button type="button" className="es-botao is-discreto is-grande" onClick={acoesDoPomodoro.zerar} disabled={cronometro.comecou === null}><ReloadIcon size={16} aria-hidden="true" />Zerar</button>
            </div>
            <ul className="pomodoro-hoje" aria-label="Hoje">
              <li><ClockIcon size={12} aria-hidden="true" /><strong>{formatarMinutos(minutosHoje)}</strong> de foco hoje</li>
              <li><HourglassIcon size={12} aria-hidden="true" /><strong>{deHoje.filter((s) => s.completo).length}</strong> pomodoros</li>
              <li><TargetIcon size={12} aria-hidden="true" />meta <strong>{formatarMinutos(historico.config.metaDiaria)}</strong></li>
            </ul>
            <EscolhaDaMateria />
            {erro && <p role="alert" className="es-erro">{erro}</p>}
          </section>
          <div className="es-coluna">
            <HistoricoDoPomodoro sessoes={historico.sessoes} />
            <AjustesDoPomodoro config={historico.config} />
          </div>
        </div>
      </div>
    </div>
  );
}

function EscolhaDaMateria() {
  const { cronometro } = estadoDoPomodoro();
  const roadmaps = (listaAtual() ?? []).filter((m) => !m.arquivado);
  const [livre, setLivre] = useState("");
  return (
    <div className="pomodoro-materias">
      <span className="es-etiqueta">Matéria</span>
      <Select<string> aria-label="Matéria do Pomodoro" value={cronometro.materia.roadmapId ?? "livre"}
        onChange={(valor) => {
          const m = roadmaps.find((r) => r.id === valor);
          acoesDoPomodoro.materia(m ? { nome: m.nome, roadmapId: m.id, cor: m.cor } : { nome: livre.trim() || "Estudo livre" });
        }}
        options={[
          ...roadmaps.map((m) => ({ value: m.id, label: m.nome, icon: <span className="es-ponto" ref={pintar(m.cor)} aria-hidden="true" /> })),
          { value: "livre", label: "Outra matéria…" },
        ]} />
      {!cronometro.materia.roadmapId && (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (livre.trim()) acoesDoPomodoro.materia({ nome: livre.trim().slice(0, 80) }); }}>
          <input className="es-campo" aria-label="Nome da matéria" placeholder={cronometro.materia.nome === "Estudo livre" ? "Ex.: Cálculo" : cronometro.materia.nome} value={livre} maxLength={80} onChange={(e) => setLivre(e.target.value)} />
          <button type="submit" className="es-botao is-contorno" disabled={!livre.trim()}>Usar</button>
        </form>
      )}
    </div>
  );
}

const CAMPOS: { chave: keyof Configuracao; rotulo: string; min: number; max: number; passo?: number; sufixo?: string; digitavel?: boolean }[] = [
  { chave: "foco", rotulo: "Foco", min: 1, max: 180, sufixo: "min" },
  { chave: "pausa", rotulo: "Pausa", min: 1, max: 60, sufixo: "min" },
  { chave: "pausaLonga", rotulo: "Pausa longa", min: 1, max: 120, sufixo: "min" },
  { chave: "ciclos", rotulo: "Focos até a longa", min: 1, max: 12 },
  { chave: "metaDiaria", rotulo: "Meta do dia", min: 5, max: 720, passo: 5, sufixo: "min", digitavel: true },
];

function AjustesDoPomodoro({ config }: { config: Configuracao }) {
  return (
    <details className="es-painel">
      <summary><span className="es-rotulo"><GearIcon size={14} aria-hidden="true" />Ajustes</span></summary>
      <div className="pomodoro-ajustes">
        {CAMPOS.map((c) => (
          <RodaDeNumeros key={c.chave} rotulo={c.rotulo} sufixo={c.sufixo} min={c.min} max={c.max} passo={c.passo} digitavel={c.digitavel}
            valor={Number(config[c.chave])} onChange={(n) => void acoesDoPomodoro.configurar({ [c.chave]: n })} />
        ))}
      </div>
      <label className="pomodoro-marcar">
        <input type="checkbox" checked={config.pausaAutomatica} onChange={(e) => void acoesDoPomodoro.configurar({ pausaAutomatica: e.target.checked })} />
        Começar a pausa sozinha quando o foco acabar
      </label>
    </details>
  );
}

const DIAS_POR_PAGINA = 7;

function HistoricoDoPomodoro({ sessoes }: { sessoes: SessaoDePomodoro[] }) {
  const [dias, setDias] = useState(DIAS_POR_PAGINA);
  const porDia = useMemo(() => {
    const mapa = new Map<string, SessaoDePomodoro[]>();
    for (const s of [...sessoes].reverse()) {
      const dia = diaLocal(new Date(s.inicio));
      mapa.set(dia, [...(mapa.get(dia) ?? []), s]);
    }
    return [...mapa.entries()];
  }, [sessoes]);
  const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return (
    <section className="es-painel" aria-label="Histórico do Pomodoro">
      <h2 className="es-rotulo"><ListIcon size={14} aria-hidden="true" />Histórico</h2>
      {porDia.length === 0 && <p className="es-dica">Nenhum pomodoro ainda. O primeiro foco concluído aparece aqui.</p>}
      <ol className="es-mostrar m-0 list-none p-0">
        {porDia.slice(0, dias).map(([dia, lista]) => (
          <li key={dia}>
            <p className="pomodoro-dia">
              <span>{rotuloDoDia(dia)}</span>
              <span>{formatarMinutos(lista.reduce((t, s) => t + s.minutos, 0))} · {lista.filter((s) => s.completo).length} pomodoros</span>
            </p>
            <ul className="es-lista">
              {lista.map((s) => (
                <li key={s.id} className="es-item" ref={pintar(s.cor)}>
                  <span className="es-hora">{hora(s.inicio)}–{hora(s.fim)}</span>
                  <span className="es-item-texto"><span className="es-item-titulo block">{s.materia}{s.atividade ? ` · ${ROTULO_DA_ATIVIDADE[s.atividade]}` : ""}</span></span>
                  <span className="es-hora">{s.minutos} min{s.completo ? "" : " · interrompido"}</span>
                  <button type="button" className="es-mini" aria-label={`Apagar pomodoro de ${s.materia} às ${hora(s.inicio)}`}
                    onClick={() => void acoesDoPomodoro.apagarSessao(s.id)}><CloseIcon size={12} /></button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      {porDia.length > dias && <button type="button" className="es-botao is-discreto mt-3" onClick={() => setDias(dias + DIAS_POR_PAGINA)}>Mostrar mais dias</button>}
    </section>
  );
}
