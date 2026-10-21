import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Button, Card, SegmentedControl } from "../../components/ui";
import { AgentIcon } from "../../components/ui/AgentIcon";
import { ChatIcon, ClockIcon, CopyIcon, DatabaseIcon, FolderIcon, ReloadIcon, RobotIcon, TrashIcon } from "../../components/ui/PixelIcon";
import { NOME_DO_AGENTE, request } from "../../mobile/api";
import { Barras, Kpi, Titulo } from "../relatorios/RelatoriosIa";

/** Espelho de `omni_core::armazenamento`. */
interface Parte { nome: string; bytes: number; arquivos: number }
interface Conversa { titulo: string | null; arquivo: string; caminho: string; bytes: number; modificado_ms: number }
interface DaConta {
  provider: string; conta_id: string; conta_nome: string; caminho: string; bytes: number;
  partes: Parte[]; maiores: Conversa[]; conversas: number;
}
interface Medicao { bytes: number; contas: DaConta[] }

/** `GET /limpeza` do engine (`mobile.rs`). */
interface Antiga { provider: string; id: string; titulo: string | null; contas: string[]; bytes: number; usada_ms: number }
interface Sugestao { dias: number; conversas: number; bytes: number; lista: Antiga[] }
interface AjusteDeLimpeza { automatica: boolean; dias: number }
interface EstadoDaLimpeza {
  ajuste: AjusteDeLimpeza;
  sugestoes: Sugestao[];
  ultima: { em_ms: number; dias: number; conversas: number; bytes: number; automatica: boolean } | null;
}
interface Limpeza { conversas: number; bytes: number; erros: string[] }

const postJson = (corpo: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(corpo), headers: { "Content-Type": "application/json" } });
/** As sugestões que a tela mostra; o engine também aceita 90. */
const PERIODOS = [30, 60];

const umaCasa = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
export function tamanho(bytes: number): string {
  const unidades = ["B", "KB", "MB", "GB", "TB"];
  let valor = bytes;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) { valor /= 1024; i += 1; }
  return `${i === 0 ? valor : umaCasa.format(valor)} ${unidades[i]}`;
}

const nomeDaIa = (provider: string) => (provider === "omni" ? "OMNI" : NOME_DO_AGENTE[provider] ?? provider);
const dia = (ms: number) => (ms ? new Date(ms).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");
const abrir = (caminho: string) => void revealItemInDir(caminho).catch(() => undefined);

/**
 * Configurações → Armazenamento: quanto as conversas ocupam neste computador — total, por IA, por
 * conta e as maiores. Só leitura; o que é conversa de cada CLI está em `omni_core::armazenamento`.
 */
export function Armazenamento() {
  const [dados, setDados] = useState<Medicao | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ler = useCallback(async () => {
    setLendo(true);
    setErro(null);
    try { setDados(await invoke<Medicao>("armazenamento")); }
    catch (motivo) { setErro(motivo instanceof Error ? motivo.message : String(motivo)); }
    finally { setLendo(false); }
  }, []);
  useEffect(() => { void ler(); }, [ler]);

  const resumo = useMemo(() => {
    if (!dados) return null;
    const porIa = new Map<string, { bytes: number; conversas: number; contas: number }>();
    for (const c of dados.contas) {
      const atual = porIa.get(c.provider) ?? { bytes: 0, conversas: 0, contas: 0 };
      porIa.set(c.provider, { bytes: atual.bytes + c.bytes, conversas: atual.conversas + c.conversas, contas: atual.contas + 1 });
    }
    const ias = [...porIa.entries()].map(([provider, v]) => ({ provider, ...v })).sort((a, b) => b.bytes - a.bytes);
    // A troca de conta copia o transcript para a conta nova: o mesmo arquivo em duas contas da mesma IA.
    const ondeEsta = new Map<string, string[]>();
    for (const c of dados.contas) for (const m of c.maiores) {
      const chave = `${c.provider}/${m.arquivo}`;
      ondeEsta.set(chave, [...(ondeEsta.get(chave) ?? []), c.conta_nome]);
    }
    const maiores = dados.contas.flatMap((c) => c.maiores.map((m) => ({ ...m, conta: c, em: ondeEsta.get(`${c.provider}/${m.arquivo}`) ?? [] })))
      .sort((a, b) => b.bytes - a.bytes).slice(0, 15);
    const copias = [...ondeEsta.values()].filter((contas) => contas.length > 1).length;
    return { ias, maiores, copias, conversas: ias.reduce((s, i) => s + i.conversas, 0) };
  }, [dados]);

  return (
    <div className="settings-grade">
      <Card title={<Titulo icone={DatabaseIcon}>Armazenamento das conversas</Titulo>} className="settings-largo"
        aside={
          <Button size="sm" variant="ghost" onClick={() => void ler()} disabled={lendo}>
            <ReloadIcon aria-hidden className={`h-3.5 w-3.5${lendo ? " anexo-girando" : ""}`} />{lendo ? "Medindo…" : "Medir de novo"}
          </Button>
        }>
        <p className="text-[11px] text-text-muted">
          Conversas, histórico de edições e índices que cada CLI guarda neste computador, em todas as contas, mais os dados do
          próprio OMNI. Plugins, caches e o programa em si ficam de fora. Nada é apagado aqui.
        </p>
        {erro && <p role="alert" className="text-xs text-danger">{erro}</p>}
        {!dados && !erro && <p className="text-xs text-text-muted">Medindo…</p>}
        {dados && resumo && (
          <div className="rel-cartoes">
            <Kpi tom="accent" icone={DatabaseIcon} rotulo="Total" valor={tamanho(dados.bytes)} sub={`${dados.contas.length} pastas medidas`} />
            <Kpi tom="info" icone={ChatIcon} rotulo="Conversas" valor={resumo.conversas.toLocaleString("pt-BR")}
              sub={resumo.ias[0] ? `mais espaço: ${nomeDaIa(resumo.ias[0].provider)}` : "nenhuma ainda"} />
            <Kpi tom="warning" icone={CopyIcon} rotulo="Em mais de uma conta" valor={resumo.copias}
              sub="junte abaixo, na conta mestra de cada IA" />
          </div>
        )}
      </Card>

      <CopiasCard aoJuntar={() => void ler()} />
      <LimpezaCard aoLimpar={() => void ler()} />

      {dados && resumo && (
        <>
          <Card title={<Titulo icone={RobotIcon}>Por IA</Titulo>}>
            <Barras total={dados.bytes} vazio="Nada medido."
              itens={resumo.ias.map((ia) => ({
                chave: ia.provider,
                nome: <span className="inline-flex items-center gap-1.5"><AgentIcon provider={ia.provider} className="h-3.5 w-3.5" />{nomeDaIa(ia.provider)}</span>,
                valor: ia.bytes,
                texto: tamanho(ia.bytes),
                titulo: `${ia.conversas} conversas em ${ia.contas} ${ia.contas === 1 ? "conta" : "contas"}`,
              }))} />
          </Card>

          <Card title={<Titulo icone={FolderIcon}>Por conta</Titulo>}>
            <Barras total={dados.bytes} vazio="Nenhuma conta."
              itens={dados.contas.map((c) => ({
                chave: `${c.provider}/${c.conta_id}`,
                nome: <span className="inline-flex items-center gap-1.5"><AgentIcon provider={c.provider} className="h-3.5 w-3.5" />{nomeDaIa(c.provider)} · {c.conta_nome}</span>,
                valor: c.bytes,
                texto: tamanho(c.bytes),
                titulo: c.caminho,
              }))} />
          </Card>

          <Card title={<Titulo icone={ChatIcon}>Maiores conversas</Titulo>} className="settings-largo">
            {resumo.maiores.length === 0 ? <p className="text-xs text-text-muted">Nenhuma conversa guardada.</p> : (
              <ul className="armaz-lista">
                {resumo.maiores.map((m) => (
                  <li key={`${m.conta.conta_id}/${m.caminho}`}>
                    <span className="min-w-0">
                      <span className="armaz-titulo" title={m.arquivo}>{m.titulo ?? m.arquivo}</span>
                      <span className="armaz-sub">
                        <AgentIcon provider={m.conta.provider} className="h-3 w-3" /> {nomeDaIa(m.conta.provider)} · {m.conta.conta_nome} · {dia(m.modificado_ms)}
                        {m.em.length > 1 && <span className="armaz-copia"> · também em {m.em.filter((n) => n !== m.conta.conta_nome).join(", ")}</span>}
                      </span>
                    </span>
                    <span className="armaz-tamanho">{tamanho(m.bytes)}</span>
                    <Button size="sm" variant="ghost" onClick={() => abrir(m.caminho)} aria-label={`Mostrar ${m.arquivo} na pasta`} title="Mostrar na pasta">
                      <FolderIcon className="h-3.5 w-3.5" aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {dados.contas.map((c) => (
            <Card key={`${c.provider}/${c.conta_id}`} className="settings-largo"
              title={<span className="inline-flex items-center gap-2"><AgentIcon provider={c.provider} className="h-3.5 w-3.5" />{nomeDaIa(c.provider)} · {c.conta_nome}</span>}
              aside={
                <span className="flex items-center gap-3">
                  <span className="text-xs text-text-secondary">{tamanho(c.bytes)}{c.provider !== "omni" && ` · ${c.conversas} conversas`}</span>
                  <Button size="sm" variant="ghost" onClick={() => abrir(c.caminho)} title={c.caminho}>
                    <FolderIcon className="h-3.5 w-3.5" aria-hidden />Abrir pasta
                  </Button>
                </span>
              }>
              <Barras total={c.bytes} vazio="Nada guardado."
                itens={c.partes.map((p) => ({
                  chave: p.nome, nome: p.nome, valor: p.bytes, texto: tamanho(p.bytes),
                  titulo: `${p.arquivos.toLocaleString("pt-BR")} arquivos`,
                }))} />
            </Card>
          ))}
        </>
      )}
    </div>
  );
}

/** `GET /copias` do engine. */
interface Duplicada { provider: string; id: string; titulo: string | null; contas: string[]; bytes: number }
interface Copias { conversas: number; bytes: number; lista: Duplicada[] }

/**
 * Conversas guardadas em mais de uma conta (de antes da conta mestra). Juntar deixa um arquivo só,
 * na mestra: a versão mais recente fica e as outras vão para a Lixeira. O engine refaz a lista.
 */
function CopiasCard({ aoJuntar }: { aoJuntar: () => void }) {
  const [copias, setCopias] = useState<Copias | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [juntando, setJuntando] = useState(false);
  const [feito, setFeito] = useState<Limpeza | null>(null);

  const ler = useCallback(async () => {
    try { setCopias(await request<Copias>("/copias")); }
    catch (motivo) { setErro(motivo instanceof Error ? motivo.message : String(motivo)); }
  }, []);
  useEffect(() => { void ler(); }, [ler]);

  async function juntar() {
    setJuntando(true);
    setErro(null);
    try {
      setFeito(await request<Limpeza>("/copias", { method: "POST" }));
      setConfirmando(false);
      await ler();
      aoJuntar();
    } catch (motivo) { setErro(motivo instanceof Error ? motivo.message : String(motivo)); }
    finally { setJuntando(false); }
  }

  return (
    <Card title={<Titulo icone={CopyIcon}>Conversas em mais de uma conta</Titulo>} className="settings-largo">
      <p className="text-[11px] text-text-muted">
        Cada IA guarda as conversas na conta mestra (a da estrela em Agentes) e as outras contas usam o mesmo arquivo. Conversas
        de antes disso ainda estão copiadas em cada conta. Juntar deixa só a versão mais recente, na mestra; as outras vão para
        a Lixeira, de onde dá para restaurar. Conversa aberta num terminal fica para depois.
      </p>
      {!copias && !erro && <p className="text-xs text-text-muted">Procurando cópias…</p>}
      {copias && (
        <div className="armaz-sugestao">
          <span className="armaz-sugestao-texto">
            <CopyIcon className="h-3.5 w-3.5 text-accent" aria-hidden />
            <span>
              {copias.conversas === 0 ? "Tudo num arquivo só." : <>{copias.conversas} {copias.conversas === 1 ? "conversa" : "conversas"} para juntar · <strong>{tamanho(copias.bytes)}</strong> a liberar</>}
            </span>
          </span>
          {copias.conversas > 0 && (confirmando ? (
            <span className="flex items-center gap-2">
              <span className="text-xs text-warning">Mandar as versões antigas para a Lixeira?</span>
              <Button size="sm" variant="primary" onClick={() => void juntar()} disabled={juntando}>{juntando ? "Juntando…" : "Juntar"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmando(false)} disabled={juntando}>Cancelar</Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmando(true)}>
              <CopyIcon className="h-3.5 w-3.5" aria-hidden />Juntar na mestra
            </Button>
          ))}
          {copias.conversas > 0 && (
            <details className="armaz-detalhes">
              <summary>Ver quais{copias.conversas > copias.lista.length ? ` (as ${copias.lista.length} maiores)` : ""}</summary>
              <ul className="armaz-lista">
                {copias.lista.map((d) => (
                  <li key={`${d.provider}/${d.id}`}>
                    <span className="min-w-0">
                      <span className="armaz-titulo" title={d.id}>{d.titulo ?? d.id}</span>
                      <span className="armaz-sub">
                        <AgentIcon provider={d.provider} className="h-3 w-3" /> {nomeDaIa(d.provider)} · {d.contas.join(", ")}
                      </span>
                    </span>
                    <span className="armaz-tamanho">{d.bytes ? tamanho(d.bytes) : "só ligar"}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      {feito && (
        <p role="status" className="text-xs text-success">
          {feito.conversas === 0 ? "Nada para juntar." : `${feito.conversas} ${feito.conversas === 1 ? "conversa juntada" : "conversas juntadas"}, ${tamanho(feito.bytes)} na Lixeira.`}
          {feito.erros.length > 0 && ` ${feito.erros.length} ficaram (em uso ou sem permissão).`}
        </p>
      )}
      {erro && <p role="alert" className="text-xs text-danger">{erro}</p>}
    </Card>
  );
}

/**
 * Sugestão de limpeza: conversas sem uso há 30 ou 60 dias (todas as cópias paradas, nenhuma sessão
 * aberta) e a limpeza automática. Quem decide o que sai é o engine, refazendo a lista na hora.
 */
function LimpezaCard({ aoLimpar }: { aoLimpar: () => void }) {
  const [estado, setEstado] = useState<EstadoDaLimpeza | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<number | null>(null);
  const [limpando, setLimpando] = useState(false);
  const [feito, setFeito] = useState<Limpeza | null>(null);

  const ler = useCallback(async () => {
    try { setEstado(await request<EstadoDaLimpeza>("/limpeza")); }
    catch (motivo) { setErro(motivo instanceof Error ? motivo.message : String(motivo)); }
  }, []);
  useEffect(() => { void ler(); }, [ler]);

  async function automatica(valor: string) {
    if (!estado) return;
    const ajuste = valor === "off" ? { ...estado.ajuste, automatica: false } : { automatica: true, dias: Number(valor) };
    try { setErro(null); setEstado({ ...estado, ajuste: await request<AjusteDeLimpeza>("/limpeza", postJson(ajuste)) }); }
    catch (motivo) { setErro(motivo instanceof Error ? motivo.message : String(motivo)); }
  }

  async function limpar(dias: number) {
    setLimpando(true);
    setErro(null);
    try {
      setFeito(await request<Limpeza>("/limpeza/agora", postJson({ dias })));
      setConfirmando(null);
      await ler();
      aoLimpar();
    } catch (motivo) { setErro(motivo instanceof Error ? motivo.message : String(motivo)); }
    finally { setLimpando(false); }
  }

  const sugestoes = estado?.sugestoes.filter((s) => PERIODOS.includes(s.dias)) ?? [];
  return (
    <Card title={<Titulo icone={TrashIcon}>Limpeza de conversas antigas</Titulo>} className="settings-largo">
      <p className="text-[11px] text-text-muted">
        Conversa sem nenhuma mensagem nova há mais tempo que o escolhido, em todas as contas onde ela está. Sai a conversa
        inteira (subagentes e histórico de edições juntos) e ela some da lista do OMNI. Conversa aberta num terminal nunca
        sai. Apagar é de vez: não vai para a lixeira.
      </p>
      {!estado && !erro && <p className="text-xs text-text-muted">Procurando conversas paradas…</p>}
      {sugestoes.map((s) => (
        <div key={s.dias} className="armaz-sugestao">
          <span className="armaz-sugestao-texto">
            <ClockIcon className="h-3.5 w-3.5 text-accent" aria-hidden />
            <span>
              Sem uso há mais de <strong>{s.dias} dias</strong>:{" "}
              {s.conversas === 0 ? "nenhuma conversa" : <>{s.conversas} {s.conversas === 1 ? "conversa" : "conversas"} · <strong>{tamanho(s.bytes)}</strong></>}
            </span>
          </span>
          {s.conversas > 0 && (confirmando === s.dias ? (
            <span className="flex items-center gap-2">
              <span className="text-xs text-danger">Apagar {s.conversas} de vez?</span>
              <Button size="sm" variant="danger" onClick={() => void limpar(s.dias)} disabled={limpando}>{limpando ? "Apagando…" : "Apagar"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmando(null)} disabled={limpando}>Cancelar</Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmando(s.dias)}>
              <TrashIcon className="h-3.5 w-3.5" aria-hidden />Limpar {tamanho(s.bytes)}
            </Button>
          ))}
          {s.conversas > 0 && (
            <details className="armaz-detalhes">
              <summary>Ver quais{s.conversas > s.lista.length ? ` (as ${s.lista.length} maiores)` : ""}</summary>
              <ul className="armaz-lista">
                {s.lista.map((a) => (
                  <li key={`${a.provider}/${a.id}`}>
                    <span className="min-w-0">
                      <span className="armaz-titulo" title={a.id}>{a.titulo ?? a.id}</span>
                      <span className="armaz-sub">
                        <AgentIcon provider={a.provider} className="h-3 w-3" /> {nomeDaIa(a.provider)} · {a.contas.join(", ")} · último uso {dia(a.usada_ms)}
                      </span>
                    </span>
                    <span className="armaz-tamanho">{tamanho(a.bytes)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}
      {estado && (
        <SegmentedControl
          label="Limpar sozinho"
          description="Enquanto o OMNI está aberto, ele confere a cada 6 horas e apaga o que passou do prazo."
          options={[{ value: "off", label: "Desligado" }, ...PERIODOS.map((d) => ({ value: String(d), label: `Sem uso há ${d} dias` }))]}
          value={estado.ajuste.automatica ? String(estado.ajuste.dias) : "off"}
          onChange={(v) => void automatica(v)}
        />
      )}
      {feito && (
        <p role="status" className="text-xs text-success">
          {feito.conversas === 0 ? "Nada para apagar." : `${feito.conversas} ${feito.conversas === 1 ? "conversa apagada" : "conversas apagadas"}, ${tamanho(feito.bytes)} liberados.`}
          {feito.erros.length > 0 && ` ${feito.erros.length} arquivos ficaram (em uso ou sem permissão).`}
        </p>
      )}
      {estado?.ultima && !feito && (
        <p className="text-[11px] text-text-muted">
          Última limpeza{estado.ultima.automatica ? " automática" : ""}: {dia(estado.ultima.em_ms)}, {estado.ultima.conversas} conversas, {tamanho(estado.ultima.bytes)}.
        </p>
      )}
      {erro && <p role="alert" className="text-xs text-danger">{erro}</p>}
    </Card>
  );
}
