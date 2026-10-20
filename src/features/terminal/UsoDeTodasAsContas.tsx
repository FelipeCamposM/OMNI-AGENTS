import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { ChartIcon, ReloadIcon } from "../../components/ui/PixelIcon";
import { AgentIcon } from "../../components/ui/AgentIcon";
import { resetShort, usageTone } from "../../lib/uso";
import type { Usage, UsageWindow } from "./AccountUsage";
import { listProfiles, type Profile } from "./terminalService";
import { timeAgo } from "./AgentUsageStatus";
import { AGENTES_COM_USO, NOME_DO_AGENTE } from "../../mobile/api";

/** Blocos do medidor: 5% cada, no passo do pixel do resto do app. */
const BLOCOS = 20;

/** Medidor em blocos: quantos estão acesos diz o consumo, a cor diz a faixa (verde/amarelo/vermelho). */
export function Medidor({ rotulo, janela }: { rotulo: string; janela: UsageWindow | null }) {
  const usado = janela ? Math.min(100, Math.max(0, janela.used_percent)) : 0;
  const tom = janela ? usageTone(janela.used_percent) : null;
  const acesos = janela ? Math.ceil(usado / (100 / BLOCOS)) : 0;
  const reset = resetShort(janela);
  return (
    <span className="uso-janela" title={reset ? `${rotulo}: reseta ${reset}` : undefined}>
      <span className="uso-rotulo">{rotulo}</span>
      <span role="progressbar" aria-label={`${rotulo} consumido`} aria-valuenow={Math.round(usado)} aria-valuemin={0} aria-valuemax={100}
        className="uso-blocos">
        {Array.from({ length: BLOCOS }, (_, i) => <span key={i} className={i < acesos ? tom?.bar : undefined} />)}
      </span>
      <span className={`uso-pct ${tom?.text ?? "text-text-muted"}`}>
        {janela ? `${Math.round(janela.used_percent)}%` : "—"}
      </span>
      <span className="uso-reset">{reset ? `↻ ${reset}` : ""}</span>
    </span>
  );
}

/** Agentes na ordem fixa das listas; um provider desconhecido entra no fim. */
function ordenar(contas: Profile[]): string[] {
  const conhecidos = Object.keys(NOME_DO_AGENTE);
  const presentes = new Set<string>(contas.map((conta) => conta.provider));
  return [...conhecidos.filter((p) => presentes.has(p)), ...[...presentes].filter((p) => !conhecidos.includes(p))];
}

/**
 * Botão do rodapé, à esquerda do agente em foco, que abre (para cima) o uso de todas as contas de
 * todas as IAs. Abrir só lê o cache do engine; o botão de cada conta é que consulta o `/usage`.
 * O Cursor entra na lista, mas a CLI dele não informa consumo — a conta aparece sem medidor.
 */
export function UsoDeTodasAsContas({ engineOnline, contaAtiva }: { engineOnline: boolean; contaAtiva: string | null }) {
  const [aberto, setAberto] = useState(false);
  const [contas, setContas] = useState<Profile[]>([]);
  const [usos, setUsos] = useState<Record<string, Usage>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [atualizando, setAtualizando] = useState<Set<string>>(new Set());
  const [posicao, setPosicao] = useState<{ left: number; bottom: number } | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const painel = useRef<HTMLDivElement>(null);
  const mensuraveis = contas.filter((conta) => AGENTES_COM_USO.includes(conta.provider));

  // Cada abertura relê a lista e o cache: conta nova ou um /usage feito em outro lugar já aparecem.
  useEffect(() => {
    if (!aberto || !engineOnline) return;
    let cancelado = false;
    void listProfiles().then((lista) => {
      if (cancelado) return;
      setContas(lista);
      for (const conta of lista.filter((c) => AGENTES_COM_USO.includes(c.provider))) {
        invoke<Usage>("account_usage", { profileId: conta.id, refresh: false })
          .then((uso) => { if (!cancelado) setUsos((atual) => ({ ...atual, [conta.id]: uso })); })
          .catch(() => undefined);
      }
    }).catch(() => undefined);
    return () => { cancelado = true; };
  }, [aberto, engineOnline]);

  // O rodapé corta o que passa dele (`overflow-hidden`): o painel vai para o `body`, ancorado no botão.
  useLayoutEffect(() => {
    if (!aberto) return;
    const ancorar = () => {
      const caixa = botao.current?.getBoundingClientRect();
      if (!caixa) return;
      const largura = 416;
      setPosicao({
        left: Math.max(8, Math.min(caixa.left, window.innerWidth - largura - 8)),
        bottom: window.innerHeight - caixa.top + 6,
      });
    };
    ancorar();
    window.addEventListener("resize", ancorar);
    return () => window.removeEventListener("resize", ancorar);
  }, [aberto]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (evento: MouseEvent) => {
      const alvo = evento.target as Node;
      if (!painel.current?.contains(alvo) && !botao.current?.contains(alvo)) setAberto(false);
    };
    const esc = (evento: KeyboardEvent) => { if (evento.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto]);

  async function atualizarTodas() {
    await Promise.all(mensuraveis.map((conta) => atualizar(conta.id)));
  }

  async function atualizar(id: string) {
    setAtualizando((atual) => new Set(atual).add(id));
    setErros(({ [id]: _, ...resto }) => resto);
    try {
      const uso = await invoke<Usage>("account_usage", { profileId: id, refresh: true });
      setUsos((atual) => ({ ...atual, [id]: uso }));
    } catch (motivo) {
      setErros((atual) => ({ ...atual, [id]: String(motivo) }));
    } finally {
      setAtualizando((atual) => { const novo = new Set(atual); novo.delete(id); return novo; });
    }
  }

  return (
    <>
      <button ref={botao} type="button" aria-label="Uso de todas as contas" aria-expanded={aberto} aria-haspopup="dialog"
        title="Uso de todas as IAs" disabled={!engineOnline} onClick={() => setAberto((atual) => !atual)}
        className={`shrink-0 disabled:opacity-50 ${aberto ? "text-accent" : "text-text-secondary hover:text-accent"}`}>
        <ChartIcon aria-hidden className="h-3.5 w-3.5" />
      </button>
      {aberto && posicao && createPortal(
        <div ref={painel} role="dialog" aria-label="Uso das contas" style={{ left: posicao.left, bottom: posicao.bottom }}
          className="uso-painel fixed z-[200] flex max-h-[72vh] w-[26rem] flex-col border-2 border-border-subtle bg-bg-elevated text-[11px] text-text-primary shadow-[0_12px_28px_rgb(0_0_0/0.35)]">
          <div className="flex items-center gap-2 border-b-2 border-border-subtle px-3 py-2">
            <ChartIcon aria-hidden className="h-3.5 w-3.5 text-accent" />
            <p className="flex-1 text-[10px] font-bold uppercase tracking-wider text-text-secondary">Uso das IAs</p>
            <button type="button" onClick={() => void atualizarTodas()} disabled={mensuraveis.length === 0 || atualizando.size > 0}
              title="Consultar o uso de todas as contas agora"
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-text-secondary hover:text-accent disabled:opacity-50">
              <ReloadIcon aria-hidden className={`h-3 w-3${atualizando.size > 0 ? " animate-spin" : ""}`} />Atualizar todas
            </button>
          </div>
          <div className="flex flex-col gap-3 overflow-y-auto p-2.5">
            {contas.length === 0 && <p className="px-1 py-2 text-text-secondary">Nenhuma conta de IA cadastrada.</p>}
            {ordenar(contas).map((provider) => {
              const doAgente = contas.filter((conta) => conta.provider === provider);
              const nome = NOME_DO_AGENTE[provider] ?? provider;
              const mede = AGENTES_COM_USO.includes(provider);
              return (
                <section key={provider} aria-label={nome} className="flex flex-col gap-1.5">
                  <p className="uso-agente">
                    <AgentIcon provider={provider} size={12} className="shrink-0" />
                    {nome}
                    <span className="h-px flex-1 bg-border-subtle" />
                    <span className="font-normal normal-case tracking-normal">{doAgente.length} {doAgente.length === 1 ? "conta" : "contas"}</span>
                  </p>
                  <ul className="flex flex-col gap-1.5">
                    {doAgente.map((conta) => {
                      const uso = usos[conta.id];
                      const girando = atualizando.has(conta.id);
                      const motivo = erros[conta.id] ?? (uso && uso.status === "unavailable" ? uso.reason : null);
                      const emUso = conta.id === contaAtiva;
                      return (
                        <li key={conta.id} className={`uso-conta${emUso ? " is-ativa" : ""}`}>
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="min-w-0 flex-1">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate text-[12px] font-bold">{conta.name}</span>
                                {emUso && <span className="uso-selo">em uso</span>}
                              </span>
                              {conta.email && <span className="block truncate text-[10px] text-text-muted">{conta.email}</span>}
                            </span>
                            {uso?.observed_at_ms ? <span className="shrink-0 text-[10px] text-text-muted">{timeAgo(uso.observed_at_ms, Date.now())}</span> : null}
                            {mede && (
                              <button type="button" aria-label={`Atualizar uso de ${conta.name} (${nome})`} title="Consultar o uso agora"
                                disabled={girando} onClick={() => void atualizar(conta.id)} className="uso-atualizar">
                                <ReloadIcon aria-hidden className={`h-3.5 w-3.5${girando ? " animate-spin" : ""}`} />
                              </button>
                            )}
                          </span>
                          {!mede ? (
                            <span className="text-text-muted">A CLI do {nome} não informa o consumo do plano.</span>
                          ) : uso && uso.status !== "unavailable" ? (
                            <span className="flex flex-col gap-1">
                              <Medidor rotulo="5H" janela={uso.primary} />
                              <Medidor rotulo="Semana" janela={uso.secondary} />
                            </span>
                          ) : !motivo && <span className="text-text-muted">{uso ? "Sem leitura de uso ainda" : "Lendo…"}</span>}
                          {motivo && <span role="alert" className="text-warning">{motivo}</span>}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
