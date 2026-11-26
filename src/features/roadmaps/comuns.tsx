// Fork (Roadmaps): peças usadas por mais de uma tela (ícone do roadmap, escolha da IA, pedido em andamento).
import { openUrl } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState, type ComponentType, type MouseEvent, type SVGProps } from "react";
import { Button, SegmentedControl, Select } from "../../components/ui";
import { AgentIcon } from "../../components/ui/AgentIcon";
import {
  BookIcon, BrushIcon, CalculatorIcon, ChartLineIcon, CheckIcon, CodeIcon, FlagIcon, GlobeIcon, LoaderIcon, MoneyIcon, MusicIcon,
  PresentationIcon, StarIcon, TestTubeIcon,
} from "../../components/ui/PixelIcon";
import { listProfiles, type Profile } from "../terminal/terminalService";
import { cancelar } from "./ia";
import { mudarMeta, tarefaEmAndamento, useLoja } from "./loja";
import { CORES, ICONES, type CliDaIa, type IaEscolhida, type IconeDoRoadmap, type MetaDoRoadmap } from "./tipos";

type Icone = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

export const ICONE: Record<IconeDoRoadmap, Icone> = {
  livro: BookIcon, dinheiro: MoneyIcon, grafico: ChartLineIcon, codigo: CodeIcon, globo: GlobeIcon, musica: MusicIcon,
  pincel: BrushIcon, calculadora: CalculatorIcon, estrela: StarIcon, frasco: TestTubeIcon, apresentacao: PresentationIcon, bandeira: FlagIcon,
};

export function IconeDoRoadmap({ icone, cor, tamanho = 40 }: { icone: string; cor: string; tamanho?: number }) {
  const Componente = ICONE[icone as IconeDoRoadmap] ?? BookIcon;
  return (
    <span className="roadmap-icone" style={{ width: tamanho, height: tamanho, background: `${cor}2e`, color: cor, borderColor: cor, boxShadow: `3px 3px 0 ${cor}55` }} aria-hidden="true">
      <Componente size={Math.round(tamanho * 0.55)} />
    </span>
  );
}

export function EscolhaDeCorEIcone({ cor, icone, onCor, onIcone }: { cor: string; icone: string; onCor: (c: string) => void; onIcone: (i: string) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Cor">
        {CORES.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={c === cor} aria-label={`Cor ${c}`} onClick={() => onCor(c)}
            className="roadmap-cor" style={{ background: c, ["--cor" as string]: c }}>
            {c === cor && <CheckIcon size={14} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Ícone">
        {ICONES.map((i) => {
          const Componente = ICONE[i];
          return (
            <button key={i} type="button" role="radio" aria-checked={i === icone} aria-label={`Ícone ${i}`} onClick={() => onIcone(i)}
              className={`roadmap-escolha-icone ${i === icone ? "is-ativo" : ""}`} style={i === icone ? { color: cor, borderColor: cor } : undefined}>
              <Componente size={18} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface ModeloDaCli { id: string; label: string }

/** Catálogo de modelos lido uma vez por execução (é o mesmo da criação de agentes). */
let catalogo: Promise<Record<string, ModeloDaCli[]>> | null = null;
function lerCatalogo() {
  catalogo ??= invoke<Record<string, ModeloDaCli[]>>("agentes_modelos").then((m) => m ?? {}).catch(() => { catalogo = null; return {}; });
  return catalogo;
}

/** CLI, conta e modelo da IA do roadmap. Só contas com login aparecem habilitadas. */
export function EscolhaDaIa({ valor, onChange }: { valor: IaEscolhida; onChange: (ia: IaEscolhida) => void }) {
  const [contas, setContas] = useState<Profile[]>([]);
  const [modelos, setModelos] = useState<Record<string, ModeloDaCli[]>>({});
  useEffect(() => {
    let vivo = true;
    void listProfiles().then((p) => { if (vivo) setContas(p); }).catch(() => undefined);
    void lerCatalogo().then((m) => { if (vivo) setModelos(m); });
    return () => { vivo = false; };
  }, []);
  const daCli = contas.filter((c) => c.provider === valor.cli);
  const semLogin = daCli.length > 0 && !daCli.some((c) => c.authenticated);
  return (
    <div className="space-y-2">
      <SegmentedControl<CliDaIa> label="IA" value={valor.cli} onChange={(cli) => onChange({ cli })}
        options={[{ value: "claude", label: "Claude", icon: <AgentIcon provider="claude" size={14} /> }, { value: "codex", label: "Codex", icon: <AgentIcon provider="codex" size={14} /> }]} />
      <div className="grid grid-cols-2 gap-2">
        <Select<string> value={valor.conta ?? ""} onChange={(conta) => onChange({ ...valor, conta: conta || undefined })} size="sm"
          options={[{ value: "", label: "Primeira conta com login" }, ...daCli.map((c) => ({ value: c.id, label: c.name, disabled: !c.authenticated, hint: c.authenticated ? undefined : "sem login" }))]} />
        <Select<string> value={valor.modelo ?? ""} onChange={(modelo) => onChange({ ...valor, modelo: modelo || undefined })} size="sm"
          options={[{ value: "", label: "Modelo padrão da conta" }, ...(modelos[valor.cli] ?? []).map((m) => ({ value: m.id, label: m.label }))]} />
      </div>
      {semLogin && <p className="text-xs text-warning">Nenhuma conta do {valor.cli === "claude" ? "Claude" : "Codex"} com login. Entre numa conta em Configurações → Contas.</p>}
      <p className="text-xs text-text-muted">Usa a CLI oficial na sua conta, só com busca na web. As perguntas não entram no histórico de conversas.</p>
    </div>
  );
}

/** "Pesquisando…" com o botão de cancelar, enquanto o pedido daquela chave roda. */
export function PedidoEmAndamento({ chave }: { chave: string }) {
  useLoja();
  const rotulo = tarefaEmAndamento(chave);
  if (!rotulo) return null;
  return (
    <div className="roadmap-andamento" role="status">
      <LoaderIcon size={16} className="animate-spin" aria-hidden="true" />
      <span className="flex-1">{rotulo}</span>
      <Button size="sm" variant="ghost" onClick={() => cancelar(chave)}>Cancelar</Button>
    </div>
  );
}

export function textoDoErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

/** Fonte ou link do roadmap: abre no navegador do sistema (só http/https). */
export function abrirNoNavegador(url: string) {
  if (/^https?:\/\//i.test(url)) void openUrl(url).catch(() => undefined);
}

/**
 * Clique num link dentro do roadmap: abre no navegador do sistema.
 * Vai em `onClickCapture` de um elemento com `data-links-proprios` (o App não intercepta esses).
 */
export function linksNoRoadmap(abrir: (url: string) => void) {
  return (evento: MouseEvent) => {
    const link = (evento.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!link || !/^https?:\/\//i.test(link.href)) return;
    evento.preventDefault();
    evento.stopPropagation();
    abrir(link.href);
  };
}

/** "Claude · Sonnet": qual IA o roadmap usa, e clicar troca CLI, conta e modelo. */
export function ChipDaIa({ meta, onAberto }: { meta: MetaDoRoadmap; onAberto?: (aberto: boolean) => void }) {
  const [aberto, setAberto] = useState(false);
  const [ia, setIa] = useState<IaEscolhida>(meta.ia);
  const [contas, setContas] = useState<Profile[]>([]);
  const [modelos, setModelos] = useState<Record<string, ModeloDaCli[]>>({});
  const [erro, setErro] = useState("");
  useEffect(() => {
    let vivo = true;
    void lerCatalogo().then((m) => { if (vivo) setModelos(m); });
    void listProfiles().then((p) => { if (vivo) setContas(p); }).catch(() => undefined);
    return () => { vivo = false; };
  }, []);
  const abrir = (valor: boolean) => { setAberto(valor); onAberto?.(valor); if (valor) { setIa(meta.ia); setErro(""); } };
  const nomeDoModelo = meta.ia.modelo ? (modelos[meta.ia.cli]?.find((m) => m.id === meta.ia.modelo)?.label ?? meta.ia.modelo) : "modelo padrão";
  const conta = meta.ia.conta ? contas.find((c) => c.id === meta.ia.conta)?.name : undefined;
  return (
    <div className="roadmap-chip-ia">
      <button type="button" className="roadmap-chip" aria-expanded={aberto} onClick={() => abrir(!aberto)}
        aria-label={`IA do roadmap: ${meta.ia.cli === "codex" ? "Codex" : "Claude"}, ${nomeDoModelo}. Trocar`}
        title={conta ? `Conta: ${conta}` : "Primeira conta com login"}>
        <AgentIcon provider={meta.ia.cli} size={14} />
        <span>{meta.ia.cli === "codex" ? "Codex" : "Claude"} · {nomeDoModelo}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {aberto && (
        <div className="roadmap-chip-painel glass" role="dialog" aria-label="Trocar a IA do roadmap" onKeyDown={(e) => { if (e.key === "Escape") abrir(false); }}>
          <EscolhaDaIa valor={ia} onChange={setIa} />
          {erro && <p role="alert" className="text-xs text-danger">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => abrir(false)}>Cancelar</Button>
            <Button size="sm" variant="primary" onClick={() => void mudarMeta(meta.id, { ia }).then(() => abrir(false)).catch((e) => setErro(textoDoErro(e)))}>Usar esta IA</Button>
          </div>
        </div>
      )}
    </div>
  );
}
