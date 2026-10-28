import { useEffect, useMemo, useState, type ReactNode } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { AgentIcon } from "../../components/ui/AgentIcon";
import { Button } from "../../components/ui";
import { CloudIcon, FolderIcon, PackageIcon, ReloadIcon, ServerIcon, StarFilledIcon, StarIcon } from "../../components/ui/PixelIcon";
import { IconeDaExtensao, type BuscarIcone } from "./IconeDaExtensao";
import { fonteDoApp, type ExtensoesDaConta, type FonteDeExtensoes, type Mcp, type Plugin } from "./extensoesService";

type Provider = "claude" | "codex" | "cursor";
type Tipo = "mcps" | "plugins" | "conectores";

const IAS: { id: Provider; nome: string }[] = [
  { id: "claude", nome: "Claude" },
  { id: "codex", nome: "Codex" },
  { id: "cursor", nome: "Cursor" },
];

/** O que cada IA tem — o Codex e o Cursor não têm conectores do claude.ai, o Cursor não lista plugins. */
const TIPOS: Record<Provider, Tipo[]> = {
  claude: ["mcps", "plugins", "conectores"],
  codex: ["mcps", "plugins"],
  cursor: ["mcps", "plugins"],
};

const ROTULO_TIPO: Record<Tipo, string> = { mcps: "MCPs", plugins: "Plugins", conectores: "Conectores" };

/** Como adicionar, quando a lista está vazia — cada IA tem o seu jeito. */
const COMO_ADICIONAR: Record<Provider, Partial<Record<Tipo, ReactNode>>> = {
  claude: {
    mcps: <>No terminal: <code>claude mcp add</code> (use <code>--scope user</code> para valer em todo projeto).</>,
    plugins: <>Dentro do Claude: <code>/plugin</code> abre a loja de plugins.</>,
    conectores: <>Em claude.ai → Configurações → Conectores. Valem para a conta inteira.</>,
  },
  codex: {
    mcps: <>No terminal: <code>codex mcp add</code>, ou a seção <code>[mcp_servers]</code> do <code>config.toml</code>.</>,
    plugins: <>Dentro do Codex: <code>/plugins</code>.</>,
  },
  cursor: {
    mcps: <>Edite <code>~/.cursor/mcp.json</code> (todo projeto) ou <code>.cursor/mcp.json</code> do projeto.</>,
    plugins: <>Plugins locais ficam em <code>~/.cursor/plugins/local</code>.</>,
  },
};

const nomeDaPasta = (caminho: string) => caminho.split(/[\\/]/).filter(Boolean).pop() ?? caminho;

function mostrar(caminho: string) {
  void revealItemInDir(caminho).catch(() => undefined);
}

/**
 * MCPs, plugins e conectores de cada IA, por conta. Só visualização: diz o que está instalado,
 * onde vale (todo projeto, uma pasta, o projeto) e em qual arquivo mora — para saber "cadê cada coisa".
 */
export function ExtensoesSettings({ projectPath, fonte: fonteRecebida }: {
  projectPath: string | null;
  /** Web: rotas do engine. Ausente no app (lê pelo Tauri). */
  fonte?: FonteDeExtensoes;
}) {
  const fonte = useMemo(() => fonteRecebida ?? fonteDoApp(projectPath), [fonteRecebida, projectPath]);
  const [contas, setContas] = useState<ExtensoesDaConta[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ia, setIa] = useState<Provider>("claude");
  const [tipo, setTipo] = useState<Tipo>("mcps");
  const [recarga, setRecarga] = useState(0);
  const [compartilhar, setCompartilhar] = useState<boolean | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    void fonte.lerCompartilhamento().then(setCompartilhar).catch(() => setCompartilhar(null));
  }, [fonte]);

  async function marcarPrincipal(conta: ExtensoesDaConta) {
    // Otimista: a estrela pula na hora; a lista relida confirma.
    setContas((atual) => atual?.map((c) => c.provider === conta.provider ? { ...c, principal: c.conta_id === conta.conta_id } : c) ?? atual);
    try {
      await fonte.definirPrincipal(conta.provider, conta.conta_id);
    } catch (motivo) {
      setErro(String(motivo));
    }
    setRecarga((n) => n + 1);
  }

  async function trocarCompartilhamento(ligado: boolean) {
    setSalvando(true);
    try {
      await fonte.definirCompartilhamento(ligado);
      setCompartilhar(ligado);
      setRecarga((n) => n + 1);
    } catch (motivo) {
      setErro(String(motivo));
    } finally {
      setSalvando(false);
    }
  }

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    fonte.listar()
      .then((lista) => { if (!cancelado) setContas(lista); })
      .catch((motivo) => { if (!cancelado) { setContas([]); setErro(String(motivo)); } });
    return () => { cancelado = true; };
  }, [fonte, recarga]);

  const daIa = useMemo(() => (contas ?? []).filter((conta) => conta.provider === ia), [contas, ia]);
  const tipos = TIPOS[ia];
  const tipoAtual = tipos.includes(tipo) ? tipo : tipos[0];
  const total = (provider: Provider, qual?: Tipo) =>
    (contas ?? []).filter((conta) => conta.provider === provider)
      .reduce((soma, conta) => soma + (qual ? conta[qual].length : conta.mcps.length + conta.plugins.length + conta.conectores.length), 0);
  const contaMuitas = daIa.length > 1;

  const temContaExtra = (contas ?? []).some((conta) => (contas ?? []).filter((c) => c.provider === conta.provider).length > 1);

  return (
    <div className="ext">
      {compartilhar !== null && (
        <section className="ext-compartilhar glass" aria-label="Mesmas extensões em todas as contas">
          <div className="min-w-0 flex-1">
            <p className="ext-compartilhar-titulo">Mesmas extensões em todas as contas</p>
            <p className="ext-compartilhar-texto">
              As outras contas da mesma IA recebem os MCPs, plugins e skills da conta principal (a da
              estrela ★ — clique na estrela de outra conta para trocar) sempre que uma sessão abre nelas — inclusive na troca de conta automática. O que a conta
              já tinha continua lá.
            </p>
            <p className="ext-compartilhar-texto">
              <strong>Conectores do claude.ai</strong> (Gmail, Drive, Notion…) não podem ser copiados: ficam
              autorizados na conta do claude.ai, na nuvem. Em cada conta, conecte em claude.ai → Configurações → Conectores.
            </p>
            {!temContaExtra && contas !== null && <p className="ext-compartilhar-texto">Você ainda não tem conta extra cadastrada.</p>}
          </div>
          <button type="button" role="switch" aria-checked={compartilhar} disabled={salvando}
            aria-label="Mesmas extensões em todas as contas" className="ext-chave"
            onClick={() => void trocarCompartilhamento(!compartilhar)}>
            <span className="ext-chave-bolinha" />
          </button>
        </section>
      )}

      <div className="ext-ias glass" role="tablist" aria-label="IA">
        {IAS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={ia === item.id} className="ext-ia" onClick={() => setIa(item.id)}>
            <AgentIcon provider={item.id} size={18} className="shrink-0" />
            <span className="ext-ia-nome">{item.nome}</span>
            <span className="ext-contagem">{contas === null ? "…" : total(item.id)}</span>
          </button>
        ))}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => setRecarga((n) => n + 1)} aria-label="Ler de novo" title="Ler os arquivos de novo">
          <ReloadIcon className={`h-3.5 w-3.5${contas === null ? " animate-spin" : ""}`} aria-hidden="true" />
        </Button>
      </div>

      <div className="ext-tipos" role="tablist" aria-label="Tipo de extensão">
        {tipos.map((item) => (
          <button key={item} type="button" role="tab" aria-selected={tipoAtual === item} className="ext-tipo" onClick={() => setTipo(item)}>
            {item === "mcps" ? <ServerIcon className="h-3.5 w-3.5" aria-hidden /> : item === "plugins" ? <PackageIcon className="h-3.5 w-3.5" aria-hidden /> : <CloudIcon className="h-3.5 w-3.5" aria-hidden />}
            {ROTULO_TIPO[item]}
            <span className="ext-contagem">{contas === null ? "…" : total(ia, item)}</span>
          </button>
        ))}
      </div>

      {erro && <p role="alert" className="border-l-2 border-danger pl-3 text-xs text-danger">Não deu para ler as configurações: {erro}</p>}

      {contas !== null && daIa.length === 0 && (
        <div className="ext-vazio glass">Nenhuma conta do {IAS.find((item) => item.id === ia)?.nome} cadastrada no OMNI.</div>
      )}

      <div key={`${ia}-${tipoAtual}`} className="ext-contas">
        {daIa.map((conta) => (
          <section key={conta.conta_id} className="ext-conta glass" aria-label={`Conta ${conta.conta_nome}`}>
            {(contaMuitas || tipoAtual !== "conectores") && (
              <header className="ext-conta-topo">
                <AgentIcon provider={conta.provider} size={14} className="shrink-0" />
                {contaMuitas && (
                  <button type="button" className={`ext-estrela${conta.principal ? " is-principal" : ""}`} aria-pressed={!!conta.principal}
                    aria-label={conta.principal ? `${conta.conta_nome} é a conta principal` : `Marcar ${conta.conta_nome} como principal`}
                    title={conta.principal ? "Conta principal: as outras recebem as extensões e os conectores dela"
                      : "Marcar como principal: as outras contas passam a receber as extensões e os conectores desta"}
                    onClick={() => { if (!conta.principal) void marcarPrincipal(conta); }}>
                    {conta.principal ? <StarFilledIcon aria-hidden className="h-4 w-4" /> : <StarIcon aria-hidden className="h-4 w-4" />}
                  </button>
                )}
                <span className="ext-conta-nome">{contaMuitas ? `Conta ${conta.conta_nome}` : conta.conta_nome}</span>
                {contaMuitas && compartilhar && tipoAtual !== "conectores" && (
                  <span className="ext-selo" title="Recebe as extensões da conta principal ao abrir uma sessão">
                    {conta.principal ? "Principal" : "Recebe da principal"}
                  </span>
                )}
                <span className="ext-contagem">{conta[tipoAtual].length}</span>
              </header>
            )}
            {tipoAtual === "mcps" && <ListaDeMcps mcps={conta.mcps} projectPath={projectPath} vazio={COMO_ADICIONAR[ia].mcps} buscar={fonte.icone} />}
            {tipoAtual === "plugins" && <ListaDePlugins plugins={conta.plugins} vazio={COMO_ADICIONAR[ia].plugins} buscar={fonte.icone} />}
            {tipoAtual === "conectores" && <ListaDeConectores conectores={conta.conectores} vazio={COMO_ADICIONAR[ia].conectores} buscar={fonte.icone} />}
            <OndeFica arquivos={conta.arquivos} explorer={fonte.explorer} />
          </section>
        ))}
      </div>
    </div>
  );
}

const ESCOPO: Record<Mcp["escopo"], string> = { global: "Todo projeto", pasta: "Só numa pasta", projeto: "Do projeto" };

function ListaDeMcps({ mcps, projectPath, vazio, buscar }: { mcps: Mcp[]; projectPath: string | null; vazio: ReactNode; buscar?: BuscarIcone }) {
  if (mcps.length === 0) return <Vazio icone={<ServerIcon className="h-5 w-5" />} texto="Nenhum MCP configurado." dica={vazio} />;
  // Os que valem no projeto aberto primeiro; depois os de outras pastas.
  const aqui = (mcp: Mcp) => mcp.escopo !== "pasta" || (projectPath && mesmaPasta(mcp.pasta, projectPath));
  const ordenados = [...mcps].sort((a, b) => Number(!aqui(a)) - Number(!aqui(b)) || a.nome.localeCompare(b.nome));
  return (
    <ul className="ext-lista">
      {ordenados.map((mcp, indice) => (
        <li key={`${mcp.nome}-${mcp.escopo}-${mcp.pasta ?? ""}-${indice}`}
          className={`ext-item${mcp.ativo ? "" : " is-desligado"}${projectPath && !aqui(mcp) ? " is-fora" : ""}`}>
          <div className="ext-item-linha">
            <IconeDaExtensao nome={mcp.nome} destino={mcp.destino} remoto={mcp.destino} buscar={buscar} />
            <span className={`ext-item-icone is-${mcp.tipo === "stdio" ? "local" : "remoto"}`} aria-hidden title={mcp.tipo === "stdio" ? "Local" : "Remoto"}>
              {mcp.tipo === "stdio" ? <ServerIcon className="h-3 w-3" /> : <CloudIcon className="h-3 w-3" />}
            </span>
            <span className="ext-item-nome">{mcp.nome}</span>
            <span className={`ext-selo is-${mcp.escopo}`} title={mcp.pasta ?? undefined}>
              {mcp.escopo === "pasta" && mcp.pasta ? `Só em ${nomeDaPasta(mcp.pasta)}` : ESCOPO[mcp.escopo]}
            </span>
            <span className="ext-selo">{mcp.tipo === "stdio" ? "Local · stdio" : `Remoto · ${mcp.tipo}`}</span>
            {!mcp.ativo && <span className="ext-selo is-off">Desligado</span>}
            {projectPath && !aqui(mcp) && <span className="ext-selo" title="Este MCP só carrega quando o agente abre naquela pasta">Não vale neste projeto</span>}
          </div>
          <code className="ext-destino" title={mcp.destino}>{mcp.destino || "—"}</code>
          {mcp.variaveis.length > 0 && (
            <p className="ext-variaveis">
              Usa {mcp.variaveis.slice(0, 6).map((nome) => <code key={nome}>{nome}</code>)}
              {mcp.variaveis.length > 6 && <span> +{mcp.variaveis.length - 6}</span>}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function ListaDePlugins({ plugins, vazio, buscar }: { plugins: Plugin[]; vazio: ReactNode; buscar?: BuscarIcone }) {
  if (plugins.length === 0) return <Vazio icone={<PackageIcon className="h-5 w-5" />} texto="Nenhum plugin instalado." dica={vazio} />;
  return (
    <ul className="ext-grade">
      {plugins.map((plugin) => (
        <li key={`${plugin.nome}@${plugin.origem ?? ""}`} className={`ext-plugin${plugin.ativo ? "" : " is-desligado"}`}>
          <IconeDaExtensao nome={plugin.nome} logo={plugin.logo} destino={plugin.origem ?? undefined}
            remoto={`pacote:${plugin.site ?? ""}`} buscar={buscar} />
          <span className="min-w-0 flex-1">
            <span className="ext-item-nome block truncate">{plugin.nome}</span>
            <span className="ext-plugin-meta">
              {[plugin.origem, plugin.versao && `v${plugin.versao.length > 10 ? plugin.versao.slice(0, 7) : plugin.versao}`,
                plugin.escopo === "project" ? "do projeto" : null].filter(Boolean).join(" · ") || "—"}
            </span>
          </span>
          <span className={`ext-estado${plugin.ativo ? " is-on" : ""}`}>{plugin.ativo ? "Ligado" : "Desligado"}</span>
        </li>
      ))}
    </ul>
  );
}

function ListaDeConectores({ conectores, vazio, buscar }: { conectores: string[]; vazio: ReactNode; buscar?: BuscarIcone }) {
  if (conectores.length === 0) return <Vazio icone={<CloudIcon className="h-5 w-5" />} texto="Nenhum conector do claude.ai conectado nesta conta." dica={vazio} />;
  return (
    <>
      <p className="ext-nota">
        Conectores do claude.ai que já conectaram nesta conta. Valem em qualquer projeto e são gerenciados em
        claude.ai → Configurações → Conectores.
      </p>
      <ul className="ext-conectores">
        {conectores.map((nome) => (
          <li key={nome} className="ext-conector"><IconeDaExtensao nome={nome} remoto={`conector:${nome}`} buscar={buscar} />{nome}</li>
        ))}
      </ul>
    </>
  );
}

function Vazio({ icone, texto, dica }: { icone: ReactNode; texto: string; dica: ReactNode }) {
  return (
    <div className="ext-vazio">
      <span className="ext-vazio-icone" aria-hidden>{icone}</span>
      <p className="text-xs text-text-secondary">{texto}</p>
      {dica && <p className="ext-dica">{dica}</p>}
    </div>
  );
}

function OndeFica({ arquivos, explorer }: { arquivos: string[]; explorer: boolean }) {
  const unicos = [...new Set(arquivos)];
  if (unicos.length === 0) return null;
  return (
    <details className="ext-onde">
      <summary><FolderIcon className="h-3 w-3" aria-hidden />Onde isso fica</summary>
      <ul>
        {unicos.map((arquivo) => (
          <li key={arquivo}>
            <code title={arquivo}>{arquivo}</code>
            {explorer && <button type="button" className="ext-mostrar" onClick={() => mostrar(arquivo)}>Mostrar no Explorer</button>}
          </li>
        ))}
      </ul>
    </details>
  );
}

function mesmaPasta(a: string | null, b: string) {
  if (!a) return false;
  const normal = (caminho: string) => caminho.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normal(a) === normal(b);
}

