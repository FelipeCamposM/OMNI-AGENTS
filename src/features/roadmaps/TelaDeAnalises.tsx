// Análises dos estudos: hoje, a semana (com a anterior para comparar) e cada matéria.
import { useEffect, useMemo, useState } from "react";
import { SegmentedControl } from "../../components/ui";
import { ArrowLeftIcon, CalendarIcon, ChartBarIcon, ClockIcon, ListIcon } from "../../components/ui/PixelIcon";
import "./estudos.css";
import {
  analisarPeriodo, analisarTudo, taxaDeAcerto, formatarMinutos, inicioDaSemana, rotuloCurtoDoDia, rotuloDoDia, somarDias,
  type DadosDoRoadmap, type TotaisDaMateria,
} from "./analises";
import { carregar, listaAtual, roadmap, useLoja } from "./loja";
import { carregarMentor, estadoDoMentor, useMentor } from "./mentor";
import { carregarPomodoros, estadoDoPomodoro, usePomodoro } from "./pomodoro";
import { diaLocal } from "./progresso";

type Periodo = "dia" | "semana" | "materias";

/** Cor de uma bolinha/barra da matéria: estilo posto por JS (CSSOM), que a CSP do web aceita. */
const pintar = (cor: string) => (el: HTMLElement | null) => { el?.style.setProperty("--cor", cor); };
const largura = (fracao: number) => (el: HTMLElement | null) => { el?.style.setProperty("--fracao", String(Math.max(0, Math.min(1, fracao)))); };

export function TelaDeAnalises() {
  useLoja();
  usePomodoro();
  useMentor();
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [desloc, setDesloc] = useState(0);
  const lista = listaAtual();

  useEffect(() => { void carregarPomodoros(); void carregarMentor(); }, []);
  // Etapas e revisões moram em cada roadmap: carrega todos (a loja guarda o que já abriu).
  useEffect(() => { for (const m of lista ?? []) void carregar(m.id).catch(() => undefined); }, [lista]);

  const roadmaps: DadosDoRoadmap[] = (lista ?? []).flatMap((m) => { const r = roadmap(m.id); return r ? [{ meta: r.meta, plano: r.plano, progresso: r.progresso, cards: r.cards }] : []; });
  const { historico } = estadoDoPomodoro();
  const hoje = diaLocal(new Date());

  return (
    <div className="es-rolagem h-full">
      <div className="es-miolo">
        <div className="es-barra-de-ferramentas">
          <span className="es-rotulo m-0"><CalendarIcon size={14} aria-hidden="true" />Período</span>
          <span className="es-espaco" />
          <SegmentedControl value={periodo} onChange={(p) => { setPeriodo(p); setDesloc(0); }} grow={false}
            options={[{ value: "dia", label: "Dia" }, { value: "semana", label: "Semana" }, { value: "materias", label: "Matérias" }]} />
        </div>
        {periodo === "dia" && <Dia dia={somarDias(hoje, desloc)} hoje={hoje} roadmaps={roadmaps} onDesloc={(n) => setDesloc(Math.min(0, desloc + n))} />}
        {periodo === "semana" && <Semana segunda={somarDias(inicioDaSemana(hoje), desloc * 7)} hoje={hoje} roadmaps={roadmaps} onDesloc={(n) => setDesloc(Math.min(0, desloc + n))} />}
        {periodo === "materias" && <Materias roadmaps={roadmaps} hoje={hoje} />}
        {historico.sessoes.length === 0 && roadmaps.length === 0 && (
          <div className="es-vazio">
            <span className="es-vazio-icone" aria-hidden="true"><ChartBarIcon size={28} /></span>
            <p className="es-vazio-titulo">Ainda não há estudo registrado</p>
            <p className="es-dica">Use o Pomodoro, conte ao Mentor o que fez ou conclua uma etapa de um roadmap.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Navegar({ titulo, podeAvancar, onDesloc }: { titulo: string; podeAvancar: boolean; onDesloc: (n: number) => void }) {
  return (
    <div className="analise-navegar">
      <button type="button" className="es-botao is-contorno" aria-label="Anterior" onClick={() => onDesloc(-1)}><ArrowLeftIcon size={14} aria-hidden="true" /></button>
      <h2 className="text-center">{titulo}</h2>
      <button type="button" className="es-botao is-contorno" aria-label="Próximo" disabled={!podeAvancar} onClick={() => onDesloc(1)}><ArrowLeftIcon size={14} className="rotate-180" aria-hidden="true" /></button>
    </div>
  );
}

function Numero({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="es-numero">
      <dt>{rotulo}</dt>
      <dd>{valor}{detalhe && <span className="es-numero-detalhe">{detalhe}</span>}</dd>
    </div>
  );
}

function Dia({ dia, hoje, roadmaps, onDesloc }: { dia: string; hoje: string; roadmaps: DadosDoRoadmap[]; onDesloc: (n: number) => void }) {
  const { historico } = estadoDoPomodoro();
  const atividades = estadoDoMentor().dados.atividades;
  const a = useMemo(() => analisarPeriodo(historico.sessoes, roadmaps, dia, 1, atividades), [historico.sessoes, atividades, roadmaps, dia]);
  const ontem = useMemo(() => analisarPeriodo(historico.sessoes, roadmaps, somarDias(dia, -1), 1, atividades), [historico.sessoes, atividades, roadmaps, dia]);
  const meta = historico.config.metaDiaria;
  const sessoes = historico.sessoes.filter((s) => diaLocal(new Date(s.inicio)) === dia);
  // Foco por hora do dia (0–23): mostra quando a pessoa rende.
  const porHora = Array.from({ length: 24 }, () => 0);
  for (const s of sessoes) porHora[new Date(s.inicio).getHours()] += s.minutos;
  const maiorHora = Math.max(1, ...porHora);
  const horas = porHora.map((m, h) => ({ h, m })).filter(({ h, m }) => m > 0 || (h >= 7 && h <= 23));

  return (
    <div className="space-y-4">
      <Navegar titulo={dia === hoje ? `Hoje, ${rotuloDoDia(dia)}` : rotuloDoDia(dia)} podeAvancar={dia < hoje} onDesloc={onDesloc} />
      <dl className="es-numeros">
        <Numero rotulo="Foco" valor={formatarMinutos(a.total.minutos)} detalhe={`${Math.round((a.total.minutos / meta) * 100)}% da meta de ${formatarMinutos(meta)}`} />
        <Numero rotulo="Pomodoros" valor={String(a.total.pomodoros)} detalhe={a.total.interrompidos ? `${a.total.interrompidos} interrompidos` : undefined} />
        <Numero rotulo="Etapas concluídas" valor={String(a.total.etapas)} />
        <Numero rotulo="Cards revisados" valor={String(a.total.revisoes)} />
        {a.total.questoes > 0 && <Numero rotulo="Questões" valor={String(a.total.questoes)} detalhe={`${taxaDeAcerto(a.total)} de acerto`} />}
        <Numero rotulo="Comparado a ontem" valor={diferenca(a.total.minutos, ontem.total.minutos)} detalhe={`ontem: ${formatarMinutos(ontem.total.minutos)}`} />
      </dl>
      <div className="analise-barra-meta" role="meter" aria-label="Meta do dia" aria-valuemin={0} aria-valuemax={meta} aria-valuenow={a.total.minutos}>
        <span ref={largura(a.total.minutos / meta)} />
      </div>
      {sessoes.length > 0 && (
        <section className="es-painel" aria-label="Foco por hora">
          <h3 className="es-rotulo"><ClockIcon size={14} aria-hidden="true" />Foco por hora</h3>
          <div className="analise-colunas is-horas">
            {horas.map(({ h, m }) => (
              <div key={h} className="analise-coluna" title={`${String(h).padStart(2, "0")}h: ${formatarMinutos(m)}`}>
                <span className="analise-coluna-barra" ref={largura(m / maiorHora)} />
                <small>{h}</small>
              </div>
            ))}
          </div>
        </section>
      )}
      <PorMateria materias={a.materias} titulo="Matérias do dia" />
    </div>
  );
}

function diferenca(agora: number, antes: number): string {
  if (!antes) return agora ? "+" + formatarMinutos(agora) : "—";
  const p = Math.round(((agora - antes) / antes) * 100);
  return `${p >= 0 ? "+" : ""}${p}%`;
}

function Semana({ segunda, hoje, roadmaps, onDesloc }: { segunda: string; hoje: string; roadmaps: DadosDoRoadmap[]; onDesloc: (n: number) => void }) {
  const { historico } = estadoDoPomodoro();
  const atividades = estadoDoMentor().dados.atividades;
  const a = useMemo(() => analisarPeriodo(historico.sessoes, roadmaps, segunda, 7, atividades), [historico.sessoes, atividades, roadmaps, segunda]);
  const anterior = useMemo(() => analisarPeriodo(historico.sessoes, roadmaps, somarDias(segunda, -7), 7, atividades), [historico.sessoes, atividades, roadmaps, segunda]);
  const meta = historico.config.metaDiaria;
  const maior = Math.max(meta, ...a.dias.map((d) => d.minutos));
  const passados = a.dias.filter((d) => d.dia <= hoje);
  const comEstudo = a.dias.filter((d) => d.minutos > 0 || d.etapas > 0 || d.revisoes > 0 || d.atividades > 0).length;
  const melhor = a.dias.reduce((m, d) => (d.minutos > m.minutos ? d : m), a.dias[0]);
  const domingo = somarDias(segunda, 6);
  const fmt = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);

  return (
    <div className="space-y-4">
      <Navegar titulo={`Semana de ${fmt(segunda)} a ${fmt(domingo)}`} podeAvancar={domingo < hoje} onDesloc={onDesloc} />
      <dl className="es-numeros">
        <Numero rotulo="Foco na semana" valor={formatarMinutos(a.total.minutos)} detalhe={`semana anterior: ${formatarMinutos(anterior.total.minutos)} (${diferenca(a.total.minutos, anterior.total.minutos)})`} />
        <Numero rotulo="Média por dia" valor={formatarMinutos(passados.length ? a.total.minutos / passados.length : 0)} />
        <Numero rotulo="Dias com estudo" valor={`${comEstudo} de 7`} detalhe={`${a.dias.filter((d) => d.minutos >= meta).length} bateram a meta`} />
        <Numero rotulo="Pomodoros" valor={String(a.total.pomodoros)} detalhe={`${a.total.etapas} etapas · ${a.total.revisoes} revisões`} />
        {a.total.questoes > 0 && <Numero rotulo="Questões" valor={String(a.total.questoes)} detalhe={`${taxaDeAcerto(a.total)} de acerto${anterior.total.questoes ? ` (semana anterior: ${taxaDeAcerto(anterior.total)})` : ""}`} />}
        {melhor.minutos > 0 && <Numero rotulo="Melhor dia" valor={rotuloCurtoDoDia(melhor.dia)} detalhe={formatarMinutos(melhor.minutos)} />}
      </dl>
      <section className="es-painel" aria-label="Foco por dia da semana">
        <h3 className="es-rotulo"><ChartBarIcon size={14} aria-hidden="true" />Foco por dia</h3>
        <div className="analise-colunas">
          <span className="analise-linha-meta" ref={largura(meta / maior)} title={`Meta: ${formatarMinutos(meta)}`} aria-hidden="true" />
          {a.dias.map((d) => (
            <div key={d.dia} className={`analise-coluna ${d.dia === hoje ? "is-hoje" : ""}`}
              title={`${rotuloDoDia(d.dia)}: ${formatarMinutos(d.minutos)} de foco, ${d.pomodoros} pomodoros, ${d.etapas} etapas, ${d.revisoes} revisões`}>
              <span className="analise-coluna-valor">{d.minutos ? formatarMinutos(d.minutos) : ""}</span>
              <span className="analise-coluna-barra" ref={largura(d.minutos / maior)} />
              <small>{rotuloCurtoDoDia(d.dia)}</small>
            </div>
          ))}
        </div>
      </section>
      <PorMateria materias={a.materias} titulo="Matérias da semana" />
    </div>
  );
}

function PorMateria({ materias, titulo }: { materias: TotaisDaMateria[]; titulo: string }) {
  if (!materias.length) return <p className="es-painel es-dica">Nada estudado neste período.</p>;
  const maior = Math.max(1, ...materias.map((m) => m.minutos));
  return (
    <section className="es-painel" aria-label={titulo}>
      <h3 className="es-rotulo"><ListIcon size={14} aria-hidden="true" />{titulo}</h3>
      <ul className="m-0 list-none space-y-3 p-0">
        {materias.map((m) => (
          <li key={m.chave} className="analise-materia">
            <span className="flex items-center gap-2 text-sm text-text-primary">
              <span className="es-ponto" ref={pintar(m.cor)} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{m.nome}</span>
              <span className="es-hora">{formatarMinutos(m.minutos)}</span>
            </span>
            <span className="analise-materia-barra" ref={(el) => { pintar(m.cor)(el); largura(m.minutos / maior)(el); }} aria-hidden="true" />
            <span className="text-xs text-text-muted">{m.pomodoros} pomodoros · {m.etapas} etapas · {m.revisoes} revisões{m.questoes ? ` · ${m.questoes} questões (${taxaDeAcerto(m)})` : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Materias({ roadmaps, hoje }: { roadmaps: DadosDoRoadmap[]; hoje: string }) {
  const { historico } = estadoDoPomodoro();
  const atividades = estadoDoMentor().dados.atividades;
  const a = useMemo(() => analisarTudo(historico.sessoes, roadmaps, hoje, atividades), [historico.sessoes, atividades, roadmaps, hoje]);
  const semana = useMemo(() => analisarPeriodo(historico.sessoes, roadmaps, somarDias(hoje, -6), 7, atividades), [historico.sessoes, atividades, roadmaps, hoje]);
  const naSemana = new Map(semana.materias.map((m) => [m.chave, m.minutos]));
  return (
    <div className="space-y-4">
      <dl className="es-numeros">
        <Numero rotulo="Foco total" valor={formatarMinutos(a.total.minutos)} detalhe={`${a.total.pomodoros} pomodoros`} />
        <Numero rotulo="Sequência" valor={`${a.sequencia} ${a.sequencia === 1 ? "dia" : "dias"}`} detalhe={`${a.diasComEstudo} dias com estudo no total`} />
        <Numero rotulo="Etapas concluídas" valor={String(a.total.etapas)} />
        <Numero rotulo="Cards revisados" valor={String(a.total.revisoes)} />
        {a.total.questoes > 0 && <Numero rotulo="Questões" valor={String(a.total.questoes)} detalhe={`${taxaDeAcerto(a.total)} de acerto`} />}
      </dl>
      {a.materias.length > 0 && (
        <div className="es-painel overflow-x-auto">
          <table className="analise-tabela">
            <caption className="es-rotulo"><ListIcon size={14} aria-hidden="true" />Por matéria</caption>
            <thead>
              <tr><th scope="col">Matéria</th><th scope="col">Foco total</th><th scope="col">Últimos 7 dias</th><th scope="col">Pomodoros</th><th scope="col">Etapas</th><th scope="col">Revisões</th><th scope="col">Questões</th><th scope="col">Último estudo</th></tr>
            </thead>
            <tbody>
              {a.materias.map((m) => (
                <tr key={m.chave}>
                  <th scope="row"><span className="flex items-center gap-2"><span className="es-ponto" ref={pintar(m.cor)} aria-hidden="true" />{m.nome}</span></th>
                  <td>{formatarMinutos(m.minutos)}</td>
                  <td>{formatarMinutos(naSemana.get(m.chave) ?? 0)}</td>
                  <td>{m.pomodoros}{m.interrompidos ? ` (+${m.interrompidos})` : ""}</td>
                  <td>{m.etapasNoPlano ? `${m.etapas} de ${m.etapasNoPlano}` : m.etapas}</td>
                  <td>{m.revisoes}</td>
                  <td>{m.questoes ? `${m.acertos}/${m.questoes} (${taxaDeAcerto(m)})` : "—"}</td>
                  <td>{m.ultimoDia ? (m.ultimoDia === hoje ? "hoje" : rotuloDoDia(m.ultimoDia)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
