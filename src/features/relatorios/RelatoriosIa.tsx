import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Card, SegmentedControl } from "../../components/ui";
import { AgentIcon } from "../../components/ui/AgentIcon";
import {
  ChartIcon, ChatIcon, ClockIcon, CpuIcon, DatabaseIcon, FlagIcon, FolderIcon, GitBranchIcon, ReloadIcon, RobotIcon, SparkleIcon,
} from "../../components/ui/PixelIcon";

interface Dia { data: string; tokens: number; saida: number; cache_lido: number; prompts: number; respostas: number; conversas: number }
interface Fatia { nome: string; provider?: string; tokens: number; prompts: number }
interface Commit { em_ms: number; ia: boolean; linhas: number; removidas?: number }
interface RelatorioIa {
  uso: { dias: Dia[]; por_conta: Fatia[]; por_modelo: Fatia[]; por_projeto: Fatia[]; por_hora: number[] };
  commits: { caminho: string; commits: Commit[] }[];
}

const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const inteiro = new Intl.NumberFormat("pt-BR");
const fmt = (n: number) => (n < 10_000 ? inteiro.format(n) : compacto.format(n));
/** "16/10" a partir de "2026-10-16". */
const diaCurto = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;
const pasta = (caminho: string) => caminho.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || caminho;
const pct = (parte: number, todo: number) => (todo ? Math.round((parte / todo) * 100) : 0);

function haQuanto(ms: number, agora: number): string {
  const min = Math.floor(Math.max(0, agora - ms) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) return `há ${Math.floor(min / 60)} h`;
  return `há ${Math.floor(min / (24 * 60))} d`;
}

/** Último relatório de cada período, para a tela abrir na hora enquanto o novo é lido. */
const chaveGuardada = (dias: number) => `omni-relatorio-v1-${dias}`;
function lerGuardado(dias: number): { em: number; dados: RelatorioIa } | null {
  try {
    const bruto = localStorage.getItem(chaveGuardada(dias));
    return bruto ? JSON.parse(bruto) : null;
  } catch {
    return null;
  }
}
function guardar(dias: number, dados: RelatorioIa) {
  try { localStorage.setItem(chaveGuardada(dias), JSON.stringify({ em: Date.now(), dados })); } catch { /* sem armazenamento: só não abre instantâneo */ }
}

/** Barra horizontal com rótulo e valor: as listas por conta, modelo e projeto. */
export function Barras({ itens, total, vazio }: { itens: { chave: string; nome: React.ReactNode; valor: number; texto: React.ReactNode; titulo?: string }[]; total: number; vazio: string }) {
  if (itens.length === 0) return <p className="text-xs text-text-muted">{vazio}</p>;
  return (
    <ul className="rel-barras">
      {itens.map((item) => (
        <li key={item.chave} title={item.titulo}>
          <span className="rel-barras-nome">{item.nome}</span>
          <span className="rel-barras-trilho" aria-hidden><span style={{ width: `${total ? Math.min(100, Math.max(2, (item.valor / total) * 100)) : 0}%` }} /></span>
          <span className="rel-barras-valor">{item.texto}</span>
        </li>
      ))}
    </ul>
  );
}

export function Titulo({ icone: Icone, children }: { icone: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; children: React.ReactNode }) {
  return <span className="inline-flex items-center gap-2"><Icone className="h-3.5 w-3.5 text-accent" aria-hidden />{children}</span>;
}

export function Kpi({ tom, icone: Icone, rotulo, valor, sub }: {
  tom: "accent" | "info" | "success" | "warning" | "danger";
  icone: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  rotulo: string; valor: React.ReactNode; sub: React.ReactNode;
}) {
  return (
    <div className="rel-cartao glass" data-tom={tom}>
      <span className="rel-cartao-topo">
        <span className="rel-cartao-rotulo">{rotulo}</span>
        <span className="rel-cartao-icone" aria-hidden><Icone className="h-3.5 w-3.5" /></span>
      </span>
      <span className="rel-cartao-num">{valor}</span>
      <span className="rel-cartao-sub">{sub}</span>
    </div>
  );
}

/**
 * Relatórios de uso de IA: tokens e mensagens por dia (lidos dos transcripts de cada conta), commits
 * que a IA assinou nos projetos abertos e onde/quando você mais usa. Tudo calculado neste PC.
 *
 * Abre com o último resultado guardado e atualiza por trás. O lado nativo guarda em disco o que já
 * leu de cada transcript e só lê o que entrou desde a última vez — por isso a releitura é rápida.
 */
export function RelatoriosIa({ projectPaths }: { projectPaths: string[] }) {
  const [dias, setDias] = useState<7 | 30>(7);
  const [guardado, setGuardado] = useState(() => lerGuardado(7));
  const dados = guardado?.dados ?? null;
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const chaveProjetos = projectPaths.join("\n");

  useEffect(() => {
    const relogio = window.setInterval(() => setAgora(Date.now()), 30_000);
    return () => window.clearInterval(relogio);
  }, []);

  const ler = useCallback(async () => {
    setLendo(true);
    setErro(null);
    try {
      const novo = await invoke<RelatorioIa>("relatorio_ia", { dias, fusoMin: -new Date().getTimezoneOffset(), projetos: chaveProjetos ? chaveProjetos.split("\n") : [] });
      guardar(dias, novo);
      setGuardado({ em: Date.now(), dados: novo });
      setAgora(Date.now());
    } catch (motivo) {
      setErro(motivo instanceof Error ? motivo.message : String(motivo));
    } finally {
      setLendo(false);
    }
  }, [dias, chaveProjetos]);
  useEffect(() => { void ler(); }, [ler]);

  function trocarPeriodo(valor: 7 | 30) {
    setDias(valor);
    setGuardado(lerGuardado(valor));
  }

  const resumo = useMemo(() => {
    if (!dados) return null;
    const fuso = -new Date().getTimezoneOffset() * 60_000;
    const diaDe = (ms: number) => new Date(ms + fuso).toISOString().slice(0, 10);
    const primeiro = dados.uso.dias[0]?.data ?? "";
    const todos = dados.commits.flatMap((projeto) => projeto.commits.map((c) => ({ ...c, dia: diaDe(c.em_ms), projeto: projeto.caminho })))
      .filter((c) => c.dia >= primeiro);
    const ia = todos.filter((c) => c.ia);
    const commitsPorDia = new Map<string, { ia: number; total: number }>();
    for (const c of todos) {
      const atual = commitsPorDia.get(c.dia) ?? { ia: 0, total: 0 };
      atual.total += 1;
      if (c.ia) atual.ia += 1;
      commitsPorDia.set(c.dia, atual);
    }
    const porProjeto = dados.commits.map((projeto) => {
      const doPeriodo = todos.filter((c) => c.projeto === projeto.caminho);
      const daIa = doPeriodo.filter((c) => c.ia);
      return {
        caminho: projeto.caminho, total: doPeriodo.length, ia: daIa.length,
        mais: daIa.reduce((s, c) => s + c.linhas, 0), menos: daIa.reduce((s, c) => s + (c.removidas ?? 0), 0),
        ultimo: Math.max(0, ...doPeriodo.map((c) => c.em_ms)),
      };
    }).filter((p) => p.total > 0).sort((a, b) => b.ia - a.ia || b.total - a.total);
    const hoje = dados.uso.dias[dados.uso.dias.length - 1];
    const soma = (campo: keyof Omit<Dia, "data">) => dados.uso.dias.reduce((s, d) => s + d[campo], 0);
    const tokens = soma("tokens");
    const prompts = soma("prompts");
    const cacheLido = soma("cache_lido");
    const ativos = dados.uso.dias.filter((d) => d.tokens > 0 || d.prompts > 0);
    const pico = ativos.reduce<Dia | null>((maior, d) => (!maior || d.tokens > maior.tokens ? d : maior), null);
    // Dias seguidos com uso, contando de hoje (ou de ontem, se hoje ainda não teve nada) para trás.
    let sequencia = 0;
    const lista = [...dados.uso.dias].reverse();
    for (const [i, d] of lista.entries()) {
      if (d.tokens > 0 || d.prompts > 0) sequencia += 1;
      else if (i > 0 || sequencia > 0) break;
    }
    return {
      hoje, tokens, prompts, cacheLido, pico, commitsPorDia, porProjeto, sequencia,
      saida: soma("saida"), respostas: soma("respostas"), diasAtivos: ativos.length,
      mediaDia: ativos.length ? tokens / ativos.length : 0,
      porMensagem: prompts ? tokens / prompts : 0,
      commitsIa: ia.length, commitsTotal: todos.length,
      linhasIa: ia.reduce((s, c) => s + c.linhas, 0), removidasIa: ia.reduce((s, c) => s + (c.removidas ?? 0), 0),
    };
  }, [dados]);

  const maiorDia = Math.max(1, ...(dados?.uso.dias.map((d) => d.tokens) ?? [0]));
  const maiorHora = Math.max(1, ...(dados?.uso.por_hora ?? [0]));
  const horaPico = dados ? dados.uso.por_hora.indexOf(Math.max(...dados.uso.por_hora)) : -1;

  return (
    <div className="settings-grade">
      <Card title={<Titulo icone={ChartIcon}>Período</Titulo>} className="settings-largo"
        aside={
          <span className="flex items-center gap-3">
            {guardado && (
              <span className="text-[11px] text-text-muted" aria-live="polite">
                {lendo ? "atualizando…" : `atualizado ${haQuanto(guardado.em, agora)}`}
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={() => void ler()} disabled={lendo}>
              <ReloadIcon aria-hidden className={`h-3.5 w-3.5${lendo ? " anexo-girando" : ""}`} />{lendo ? "Lendo…" : "Atualizar"}
            </Button>
          </span>
        }>
        <SegmentedControl<7 | 30> options={[{ value: 7, label: "Últimos 7 dias" }, { value: 30, label: "Últimos 30 dias" }]}
          value={dias} onChange={trocarPeriodo} />
        <p className="text-[11px] text-text-muted">
          Lido das conversas que o Claude e o Codex guardam neste computador, em todas as contas, e do git dos projetos abertos.
          Nada sai daqui. Tokens = o que a IA leu e escreveu; leituras do cache contam à parte porque custam bem menos.
        </p>
        {erro && <p role="alert" className="text-xs text-danger">{erro}</p>}
      </Card>

      {!dados || !resumo ? (
        <Card title="Relatório" className="settings-largo"><p className="text-xs text-text-muted">{lendo ? "Somando o uso… a primeira leitura pode levar alguns segundos; as próximas só leem o que mudou." : "Sem dados."}</p></Card>
      ) : (
        <>
          <section className="rel-cartoes settings-largo" aria-label="Resumo">
            <Kpi tom="accent" icone={SparkleIcon} rotulo="Tokens hoje" valor={fmt(resumo.hoje?.tokens ?? 0)}
              sub={`média de ${fmt(Math.round(resumo.mediaDia))} por dia com uso`} />
            <Kpi tom="info" icone={ChatIcon} rotulo="Mensagens hoje" valor={fmt(resumo.hoje?.prompts ?? 0)}
              sub={`${fmt(resumo.prompts)} no período · ${resumo.hoje?.conversas ?? 0} conversas hoje`} />
            <Kpi tom="accent" icone={DatabaseIcon} rotulo="Tokens no período" valor={fmt(resumo.tokens)}
              sub={`${fmt(resumo.saida)} escritos pela IA · ${pct(resumo.cacheLido, resumo.cacheLido + resumo.tokens)}% do contexto veio do cache`} />
            <Kpi tom="warning" icone={FlagIcon} rotulo="Dias com uso" valor={`${resumo.diasAtivos}/${dias}`}
              sub={resumo.sequencia > 1 ? `${resumo.sequencia} dias seguidos` : `${fmt(resumo.respostas)} respostas da IA no período`} />
            <Kpi tom="success" icone={GitBranchIcon} rotulo="Commits da IA" valor={resumo.commitsIa}
              sub={`de ${resumo.commitsTotal} no período${resumo.commitsTotal ? ` · ${pct(resumo.commitsIa, resumo.commitsTotal)}%` : ""}`} />
            <Kpi tom="success" icone={RobotIcon} rotulo="Linhas da IA" valor={<>
              <span className="text-success">+{fmt(resumo.linhasIa)}</span>{" "}
              <span className="rel-cartao-num-menor text-danger">−{fmt(resumo.removidasIa)}</span>
            </>} sub="adicionadas e removidas nos commits da IA" />
          </section>

          <Card title={<Titulo icone={ChartIcon}>Uso por dia</Titulo>} className="settings-largo"
            aside={resumo.pico && <span className="text-[11px] text-text-muted">Dia mais intenso: {diaCurto(resumo.pico.data)} · {fmt(resumo.pico.tokens)}</span>}>
            <div className="rel-grafico" role="img" aria-label={`Tokens por dia nos últimos ${dias} dias`}>
              {dados.uso.dias.map((d) => {
                const commits = resumo.commitsPorDia.get(d.data);
                return (
                  <div key={d.data} className="rel-coluna"
                    title={`${diaCurto(d.data)}: ${inteiro.format(d.tokens)} tokens · ${d.prompts} mensagens · ${d.conversas} conversas · ${inteiro.format(d.cache_lido)} lidos do cache${commits ? ` · ${commits.ia}/${commits.total} commits da IA` : ""}`}>
                    <span className="rel-coluna-valor">{d.tokens ? fmt(d.tokens) : ""}</span>
                    <span className="rel-coluna-barra" style={{ height: `${(d.tokens / maiorDia) * 100}%` }} />
                    <span className="rel-coluna-commits" aria-hidden>{commits?.ia ? "◆".repeat(Math.min(3, commits.ia)) : ""}</span>
                    <span className="rel-coluna-dia">{dias === 30 && Number(d.data.slice(8)) % 5 !== 0 ? "" : diaCurto(d.data)}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-text-muted">Passe o mouse num dia para ver os números. ◆ = commit feito pela IA naquele dia.</p>
          </Card>

          <Card title={<Titulo icone={RobotIcon}>Por conta</Titulo>}>
            <Barras total={resumo.tokens} vazio="Nenhum uso no período."
              itens={dados.uso.por_conta.map((f) => ({
                chave: `${f.provider}-${f.nome}`, valor: f.tokens, texto: `${fmt(f.tokens)} · ${f.prompts} msg`,
                nome: <>{f.provider && <AgentIcon provider={f.provider} size={12} className="shrink-0" />}<span className="truncate">{f.nome}</span></>,
              }))} />
          </Card>

          <Card title={<Titulo icone={CpuIcon}>Por modelo</Titulo>}>
            <Barras total={resumo.tokens} vazio="Nenhum uso no período."
              itens={dados.uso.por_modelo.map((f) => ({
                chave: f.nome, valor: f.tokens, texto: `${fmt(f.tokens)} · ${pct(f.tokens, resumo.tokens)}%`,
                nome: <><CpuIcon className="h-3 w-3 shrink-0 text-text-muted" aria-hidden /><span className="truncate">{f.nome}</span></>,
              }))} />
          </Card>

          <Card title={<Titulo icone={FolderIcon}>Por projeto</Titulo>}>
            <Barras total={resumo.tokens} vazio="Nenhum uso no período."
              itens={dados.uso.por_projeto.slice(0, 8).map((f) => ({
                chave: f.nome, valor: f.tokens, texto: `${fmt(f.tokens)} · ${f.prompts} msg`,
                nome: <><FolderIcon className="h-3 w-3 shrink-0 text-accent" aria-hidden /><span className="truncate">{f.nome}</span></>,
              }))} />
          </Card>

          <Card title={<Titulo icone={GitBranchIcon}>Git por projeto</Titulo>}>
            {resumo.porProjeto.length === 0 ? <p className="text-xs text-text-muted">Nenhum commit nos projetos abertos no período.</p> : (
              <ul className="rel-git">
                {resumo.porProjeto.slice(0, 8).map((p) => (
                  <li key={p.caminho} title={p.caminho}>
                    <span className="rel-git-topo">
                      <GitBranchIcon className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-text-primary">{pasta(p.caminho)}</span>
                      <span className="rel-git-ultimo"><ClockIcon className="h-3 w-3" aria-hidden />{haQuanto(p.ultimo, agora)}</span>
                    </span>
                    <span className="rel-barras-trilho" aria-hidden><span style={{ width: `${Math.max(2, pct(p.ia, p.total))}%` }} /></span>
                    <span className="rel-git-meta">
                      <span><RobotIcon className="h-3 w-3" aria-hidden />{p.ia} de {p.total} commits pela IA</span>
                      <span className="text-success">+{fmt(p.mais)}</span>
                      <span className="text-danger">−{fmt(p.menos)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title={<Titulo icone={ClockIcon}>Quando você mais usa</Titulo>} className="settings-largo"
            aside={horaPico >= 0 && dados.uso.por_hora[horaPico] > 0 && <span className="text-[11px] text-text-muted">Pico às {horaPico}h</span>}>
            <div className="rel-horas" role="img" aria-label="Mensagens por hora do dia">
              {dados.uso.por_hora.map((n, hora) => (
                <div key={hora} className="rel-hora" title={`${hora}h: ${n} mensagens`}>
                  <span className={`rel-hora-barra${hora === horaPico && n > 0 ? " rel-hora-pico" : ""}`} style={{ height: `${(n / maiorHora) * 100}%` }} />
                  <span className="rel-hora-rotulo">{hora % 3 === 0 ? `${hora}h` : ""}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-text-muted">
              Em média {fmt(Math.round(resumo.porMensagem))} tokens por mensagem sua no período.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
