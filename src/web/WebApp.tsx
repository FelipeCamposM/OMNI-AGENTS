import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { AgentIcon } from "../components/ui/AgentIcon";
import { OmniLogo } from "../components/ui/OmniLogo";
import { Input } from "../components/ui/Input";
import { ArrowLeftIcon, BlocksIcon, ChatIcon, FolderIcon, ReloadIcon, TerminalIcon } from "../components/ui/PixelIcon";
import { ExtensoesSettings } from "../features/extensoes/ExtensoesSettings";
import type { ExtensoesDaConta, FonteDeExtensoes } from "../features/extensoes/extensoesService";
import { PairingScreen } from "../mobile/Chat";
import { ConversationDetail, ConversasPorEstado, filterConversations, haQuanto, NovaSessao, Ocultas } from "../mobile/MobileApp";
import { useDados } from "../mobile/useDados";
import { usePoll } from "../mobile/usePoll";
import { NOME_DO_AGENTE, request, temConversa, type Conversation } from "../mobile/api";
import { UsoDasContas } from "./UsoDasContas";

/** O xterm só baixa quando alguém abre a aba Terminal: quem só conversa não paga por ele. */
const TerminalEspelho = lazy(() => import("./TerminalEspelho"));

const ESTADO: Record<string, string> = {
  working: "Trabalhando", answered: "Esperando você", approval_required: "Aprovação pendente",
  stopped: "Encerrado", orphan: "Sessão anterior", crashed: "Interrompido",
};

type Aba = "conversa" | "terminal";

/** Terminal sem agente aberto no PC (`GET /terminais`): o lugar de rodar um `npm run dev`. */
interface Shell { id: string; name: string; project_id: string; cwd: string; state: string; updated_at_ms: number }

/** Endereço da tela aberta: `#/c/<id>` é uma conversa, `#/t/<id>` um terminal sem agente. */
function lerEndereco(): { conversa: string | null; terminal: string | null; extensoes: boolean } {
  const conversa = /^#\/c\/([^/?#]+)$/.exec(location.hash);
  const terminal = /^#\/t\/([^/?#]+)$/.exec(location.hash);
  return {
    conversa: conversa ? decodeURIComponent(conversa[1]) : null,
    terminal: terminal ? decodeURIComponent(terminal[1]) : null,
    extensoes: location.hash === "#/extensoes",
  };
}

/** A aba Extensões do app, pelas rotas do engine. O projeto vai por id; o caminho só serve para a
 *  tela marcar "não vale neste projeto". */
const fontesDaWeb = new Map<string, FonteDeExtensoes>();
/** Uma por projeto: a página re-renderiza a cada leitura do PC, e uma fonte nova a cada render
 *  faria a aba reler tudo a cada poucos segundos. */
function fonteDaWeb(projetoId: string | null): FonteDeExtensoes {
  const chave = projetoId ?? "";
  const pronta = fontesDaWeb.get(chave);
  if (pronta) return pronta;
  const fonte = criarFonteDaWeb(projetoId);
  fontesDaWeb.set(chave, fonte);
  return fonte;
}
function criarFonteDaWeb(projetoId: string | null): FonteDeExtensoes {
  const ler = () => request<{ contas: ExtensoesDaConta[]; compartilhar: boolean }>(
    `/extensoes${projetoId ? `?projeto=${encodeURIComponent(projetoId)}` : ""}`);
  return {
    listar: async () => (await ler()).contas ?? [],
    lerCompartilhamento: async () => Boolean((await ler()).compartilhar),
    definirCompartilhamento: async (ligado) => {
      await request("/extensoes/compartilhar", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ligado }),
      });
    },
    definirPrincipal: async (provider, conta) => {
      await request("/extensoes/principal", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider, conta }),
      });
    },
    explorer: false,
  };
}
const CHAVE_ABA = "omni-web-aba";

function lerAba(): Aba {
  try { return sessionStorage.getItem(CHAVE_ABA) === "terminal" ? "terminal" : "conversa"; } catch { return "conversa"; }
}

function tomDoEstado(conversa: Conversation): string {
  if (conversa.capabilities?.approve || conversa.state === "approval_required") return "m-dot-alerta";
  if (conversa.state === "working") return "m-dot-ativo";
  if (conversa.state === "answered") return "m-dot-ok";
  if (conversa.state === "crashed") return "m-dot-erro";
  return "m-dot-parado";
}

/**
 * A mesma coisa que o celular faz, num layout de computador — e mais perto do app do PC: projetos e
 * conversas à esquerda, a conversa (ou o terminal dela, ao vivo) no centro, e o que precisa de você
 * à direita.
 *
 * Tudo vem das mesmas rotas do engine que o celular usa. Fora do escopo de propósito: editar
 * arquivo e painel de Git — isso continua sendo do app do PC.
 */
export function WebApp() {
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [verExtensoes, setVerExtensoes] = useState(false);
  const [shells, setShells] = useState<Shell[]>([]);
  const [abrindoTerminal, setAbrindoTerminal] = useState(false);
  const [erroTerminal, setErroTerminal] = useState<string | null>(null);
  const { conversations, attention, catalog, carregado, error, semAcesso, refresh, atualizar, parear } = useDados(conversaId);
  const [projetoId, setProjetoId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [aba, setAba] = useState<Aba>(lerAba);
  const [atualizando, setAtualizando] = useState(false);
  const busca = useRef<HTMLInputElement>(null);

  // Endereço guarda a conversa aberta: atualizar a página (ou deixar aberta o dia todo) volta para
  // onde estava, como no celular.
  useEffect(() => {
    const ler = () => {
      const endereco = lerEndereco();
      setConversaId(endereco.conversa);
      setTerminalId(endereco.terminal);
      setVerExtensoes(endereco.extensoes);
    };
    ler();
    window.addEventListener("hashchange", ler);
    window.addEventListener("popstate", ler);
    return () => {
      window.removeEventListener("hashchange", ler);
      window.removeEventListener("popstate", ler);
    };
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(CHAVE_ABA, aba); } catch { /* sem armazenamento: vale só agora */ }
  }, [aba]);

  // Contador no título da aba do navegador: com a página atrás de outras, dá para ver que algo
  // está esperando por você sem voltar a ela.
  useEffect(() => {
    document.title = attention.length > 0 ? `(${attention.length}) OMNI AGENTS` : "OMNI AGENTS";
  }, [attention.length]);

  // `/` ou Ctrl+K: vai para a busca, como nos apps de chat. Não rouba a tecla de quem está digitando.
  useEffect(() => {
    function tecla(evento: KeyboardEvent) {
      const alvo = evento.target as HTMLElement | null;
      const digitando = alvo?.closest?.("input, textarea, [contenteditable], .xterm");
      if ((evento.key === "/" && !digitando) || (evento.key.toLowerCase() === "k" && (evento.ctrlKey || evento.metaKey))) {
        evento.preventDefault();
        busca.current?.focus();
        busca.current?.select();
      }
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  // Terminais sem agente: lista curta e barata, lida no mesmo ritmo da lista de conversas.
  const lerShells = async () => {
    const lista = await request<Shell[]>("/terminais");
    setShells(Array.isArray(lista) ? lista : []);
  };
  usePoll(lerShells, () => undefined, []);

  function abrirTerminal(id: string) {
    history.pushState(null, "", `${location.pathname}${location.search}#/t/${encodeURIComponent(id)}`);
    setConversaId(null);
    setTerminalId(id);
  }

  async function novoTerminal(projectId: string) {
    setAbrindoTerminal(true);
    setErroTerminal(null);
    try {
      const criado = await request<{ id: string }>("/terminais", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId }),
      });
      await lerShells().catch(() => undefined);
      abrirTerminal(criado.id);
    } catch (motivo) {
      setErroTerminal(motivo instanceof Error ? motivo.message : String(motivo));
    } finally {
      setAbrindoTerminal(false);
    }
  }

  async function fecharTerminal(id: string) {
    try {
      await request(`/terminais/${encodeURIComponent(id)}/fechar`, { method: "POST" });
    } catch (motivo) {
      setErroTerminal(motivo instanceof Error ? motivo.message : String(motivo));
    }
    await lerShells().catch(() => undefined);
    fecharConversa();
  }

  function abrirConversa(id: string) {
    const escolhida = conversations.find((item) => item.id === id);
    if (escolhida) setProjetoId(escolhida.project_id);
    history.pushState(null, "", `${location.pathname}${location.search}#/c/${encodeURIComponent(id)}`);
    setTerminalId(null);
    setVerExtensoes(false);
    setConversaId(id);
  }

  function fecharConversa() {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
    setConversaId(null);
    setTerminalId(null);
  }

  function selecionarProjeto(id: string) {
    setProjetoId(id);
    setQuery("");
  }

  if (semAcesso) {
    return (
      <main className="w-pareamento">
        <PairingScreen parear={parear} />
      </main>
    );
  }

  const conversa: Conversation | null = conversations.find((item) => item.id === conversaId) ?? null;
  const perfis = catalog?.profiles ?? [];
  const projetos = catalog?.projects ?? [];
  // Uma escolha explícita na lateral vence a conversa aberta: assim é possível consultar outro
  // projeto sem precisar fechar antes o chat que está no centro. Sem escolha, abre no projeto da
  // conversa mais recente — a lista vem ordenada por atividade.
  const projetoAtivo =
    projetos.find((item) => item.id === projetoId)
    ?? projetos.find((item) => item.id === conversa?.project_id)
    ?? projetos.find((item) => item.id === conversations[0]?.project_id)
    ?? projetos[0]
    ?? null;
  // Ocultas saem da lista e da busca; ficam numa seção recolhida no fim.
  const visiveis = conversations.filter((item) => !item.hidden);
  const doProjeto = visiveis.filter((item) => item.project_id === projetoAtivo?.id);
  const daLista = filterConversations(query ? visiveis : doProjeto, query, perfis, projetos);
  const ocultasDoProjeto = conversations.filter((item) => item.hidden && item.project_id === projetoAtivo?.id);
  const trabalhando = conversations.filter((item) => item.state === "working");
  const naoVistas = new Set(attention.map((item) => item.id));
  // Agente sem visão de conversa (Cursor) abre direto no terminal ao vivo.
  const soTerminal = Boolean(conversa && !temConversa(conversa.provider));
  const abaVisivel: Aba = (aba === "terminal" || soTerminal) && conversa?.live ? "terminal" : "conversa";
  const conta = conversa?.profile_id ? perfis.find((perfil) => perfil.id === conversa.profile_id)?.name : null;
  const projetoDaConversa = conversa ? projetos.find((item) => item.id === conversa.project_id)?.name : null;
  const shell = shells.find((item) => item.id === terminalId) ?? null;
  const shellsDoProjeto = shells.filter((item) => item.project_id === projetoAtivo?.id);

  return (
    <div className="w-tela">
      <header className="w-topo glass glass-strong">
        <OmniLogo className="neon-glow w-logo" />
        <span className="pixel-text w-marca">OMNI AGENTS</span>
        {conversa ? (
          <div className="w-topo-conversa">
            <button type="button" className="btn btn-ghost w-voltar" aria-label="Fechar conversa" title="Fechar conversa" onClick={fecharConversa}>
              <ArrowLeftIcon aria-hidden className="h-4 w-4" />
            </button>
            {conversa.provider && <AgentIcon provider={conversa.provider} size={16} className="shrink-0" />}
            <div className="w-topo-texto">
              <span className="w-topo-titulo">{conversa.title}</span>
              <span className="w-topo-sub">
                <span className={`m-dot ${tomDoEstado(conversa)}`} aria-hidden />
                {[ESTADO[conversa.state ?? ""] ?? (conversa.historical ? "Histórico" : "Sem sessão aberta"),
                  NOME_DO_AGENTE[conversa.provider ?? ""] ?? conversa.provider, conta, projetoDaConversa]
                  .filter(Boolean).join(" · ")}
              </span>
            </div>
          </div>
        ) : <span className="w-topo-espaco" />}
        {error && <span className="w-erro" role="alert">Sem conexão com o PC: {error}</span>}
        <button type="button" className={`btn btn-ghost w-atualizar${verExtensoes ? " is-ativo" : ""}`} aria-label="Extensões"
          title="MCPs, plugins e conectores de cada IA" onClick={() => {
            history.pushState(null, "", `${location.pathname}${location.search}#/extensoes`);
            setVerExtensoes(true);
          }}>
          <BlocksIcon aria-hidden className="h-4 w-4" />
        </button>
        <button type="button" className="btn btn-ghost w-atualizar" aria-label="Atualizar" title="Atualizar" disabled={atualizando}
          onClick={() => { setAtualizando(true); void Promise.resolve(atualizar()).finally(() => setAtualizando(false)); }}>
          <ReloadIcon aria-hidden className={`h-4 w-4${atualizando ? " anexo-girando" : ""}`} />
        </button>
      </header>

      <div className="w-colunas">
        <aside className="w-coluna w-lateral" aria-label="Projetos e conversas">
          <Input ref={busca} type="search" size="sm" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Pesquisar conversas  ( / )" aria-label="Pesquisar conversas" className="w-busca" />
          {!query && (
            <div className="w-projetos-bloco">
              <h2 className="w-rotulo">Projetos</h2>
              {catalog && projetos.length === 0 && (
                <p className="w-vazio">Nenhum projeto conhecido. Abra um projeto no OMNI do PC.</p>
              )}
              <ul className="w-projetos">
                {projetos.map((project) => {
                  const lista = conversations.filter((item) => item.project_id === project.id);
                  const aguardando = lista.filter((item) => item.capabilities?.approve).length;
                  const ativos = lista.filter((item) => item.state === "working").length;
                  return (
                    <li key={project.id}>
                      <button
                        type="button"
                        onClick={() => selecionarProjeto(project.id)}
                        aria-current={project.id === projetoAtivo?.id ? "true" : undefined}
                        className={`w-projeto${project.id === projetoAtivo?.id ? " w-projeto-ativo" : ""}`}
                        title={project.path}
                        aria-label={project.name}
                      >
                        <FolderIcon aria-hidden className="h-3.5 w-3.5 shrink-0 w-projeto-icone" />
                        <span className="w-projeto-nome">{project.name}</span>
                        {ativos > 0 && <span className="m-dot m-dot-ativo" aria-label={`${ativos} trabalhando`} />}
                        {aguardando > 0 && <span className="m-badge m-badge-alerta">{aguardando}</span>}
                        <span className="w-projeto-total" aria-hidden>{lista.length}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <h2 className="w-rotulo">{query ? "Resultados" : `Conversas${projetoAtivo ? ` · ${projetoAtivo.name}` : ""}`}</h2>
          <div className="w-conversas">
            <ConversasPorEstado
              conversations={daLista}
              perfis={perfis}
              projetos={projetos}
              mostrarProjeto={Boolean(query)}
              abrir={abrirConversa}
              ativa={conversaId}
              naoVistas={naoVistas}
              vazio={carregado ? (query ? "Nenhuma conversa encontrada." : "Nenhuma conversa neste projeto ainda.") : "Carregando…"}
            />
            {!query && <Ocultas conversas={ocultasDoProjeto} perfis={perfis} abrir={abrirConversa} ativa={conversaId} />}
          </div>
          {projetoAtivo?.path && !query && shellsDoProjeto.length > 0 && (
            <div className="w-terminais-bloco">
              <h2 className="w-rotulo">Terminais</h2>
              <ul className="w-atencao">
                {shellsDoProjeto.map((item) => (
                  <li key={item.id}>
                    <button type="button" title={item.cwd} onClick={() => abrirTerminal(item.id)}
                      className={`w-atencao-item${item.id === terminalId ? " w-atencao-item-ativa" : ""}`}>
                      <span className={`m-dot ${item.state === "working" ? "m-dot-ativo" : "m-dot-parado"}`} aria-hidden />
                      <span className="w-atencao-texto">{item.name}</span>
                      {haQuanto(item.updated_at_ms) && <time className="w-atencao-tempo">{haQuanto(item.updated_at_ms)}</time>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {projetoAtivo?.path && !query && (
            <div className="w-rodape-lateral">
              {catalog && <NovaSessao project={projetoAtivo} catalog={catalog} onCriada={refresh} classeBotao="w-rodape-botao" />}
              <button type="button" className="btn btn-ghost w-rodape-botao" disabled={abrindoTerminal}
                title="Abre um terminal sem agente na pasta do projeto (npm run dev, git…)"
                onClick={() => void novoTerminal(projetoAtivo.id)}>
                <TerminalIcon aria-hidden className="h-4 w-4" />{abrindoTerminal ? "Abrindo…" : "Novo terminal"}
              </button>
              {erroTerminal && <p className="w-erro w-rodape-erro" role="alert">{erroTerminal}</p>}
            </div>
          )}
        </aside>

        <main className="w-coluna w-centro" aria-label="Conversa">
          {verExtensoes ? (
            <div className="w-painel-central w-extensoes">
              <div className="w-abas">
                <span className="w-aba w-aba-ativa"><BlocksIcon aria-hidden className="h-3.5 w-3.5" />Extensões</span>
                <span className="w-topo-espaco" />
                <button type="button" className="btn btn-ghost w-fechar-terminal" onClick={() => {
                  history.replaceState(null, "", `${location.pathname}${location.search}`);
                  setVerExtensoes(false);
                }}>Fechar</button>
              </div>
              <ExtensoesSettings key={projetoAtivo?.id ?? "-"} projectPath={projetoAtivo?.path ?? null} fonte={fonteDaWeb(projetoAtivo?.id ?? null)} />
            </div>
          ) : terminalId ? (
            <>
              <div className="w-abas">
                <span className="w-aba w-aba-ativa"><TerminalIcon aria-hidden className="h-3.5 w-3.5" />{shell?.name ?? "Terminal"}</span>
                <span className="w-topo-espaco" />
                <button type="button" className="btn btn-ghost w-fechar-terminal" onClick={() => void fecharTerminal(terminalId)}>
                  Fechar terminal
                </button>
              </div>
              <div className="w-painel-central">
                <Suspense fallback={<p className="w-vazio">Abrindo o terminal…</p>}>
                  <TerminalEspelho key={terminalId} saida={`/terminais/${encodeURIComponent(terminalId)}/saida`}
                    teclas={`/terminais/${encodeURIComponent(terminalId)}/teclas`}
                    rotulo="Terminal ao vivo — clique e digite como no PC (Ctrl+C para o comando)" />
                </Suspense>
              </div>
            </>
          ) : conversa ? (
            <>
              <div className="w-abas" role="tablist" aria-label="Visualização">
                <button type="button" role="tab" aria-selected={abaVisivel === "conversa"} disabled={soTerminal}
                  title={soTerminal ? "O OMNI ainda não lê as conversas deste agente — use o terminal" : undefined}
                  className={`w-aba${abaVisivel === "conversa" ? " w-aba-ativa" : ""}`} onClick={() => setAba("conversa")}>
                  <ChatIcon aria-hidden className="h-3.5 w-3.5" />Conversa
                </button>
                <button type="button" role="tab" aria-selected={abaVisivel === "terminal"} disabled={!conversa.live}
                  title={conversa.live ? "O terminal desta conversa, ao vivo" : "Sem terminal aberto no PC para esta conversa"}
                  className={`w-aba${abaVisivel === "terminal" ? " w-aba-ativa" : ""}`} onClick={() => setAba("terminal")}>
                  <TerminalIcon aria-hidden className="h-3.5 w-3.5" />Terminal
                </button>
              </div>
              <div className="w-painel-central">
                {abaVisivel === "terminal" ? (
                  <Suspense fallback={<p className="w-vazio">Abrindo o terminal…</p>}>
                    <TerminalEspelho key={conversa.id} saida={`/conversas/${encodeURIComponent(conversa.id)}/terminal`}
                      teclas={`/conversas/${encodeURIComponent(conversa.id)}/teclas`} />
                  </Suspense>
                ) : (
                  <ConversationDetail key={conversa.id} conversation={conversa} refresh={refresh} abrirConversa={abrirConversa} />
                )}
              </div>
            </>
          ) : (
            <div className="w-boas-vindas">
              <OmniLogo className="neon-glow w-boas-vindas-logo" />
              <p className="w-vazio">
                {conversaId && carregado ? "Essa conversa não existe mais no PC." : "Escolha uma conversa à esquerda para acompanhar e responder."}
              </p>
              <p className="w-dica">Dica: <kbd>/</kbd> busca conversas · <kbd>Enter</kbd> envia · <kbd>Shift</kbd>+<kbd>Enter</kbd> quebra linha</p>
            </div>
          )}
        </main>

        <aside className="w-coluna w-direita" aria-label="Precisa de você">
          <UsoDasContas contaAtiva={conversa?.profile_id ?? null} />
          <h2 className="w-rotulo">Precisa de você</h2>
          {attention.length === 0 ? (
            <p className="w-vazio">Nada pendente agora.</p>
          ) : (
            <ul className="w-atencao">
              {attention.map((item) => (
                <li key={item.id}>
                  <ItemLateral conversa={item} ativa={item.id === conversaId} abrir={abrirConversa} />
                </li>
              ))}
            </ul>
          )}
          {trabalhando.length > 0 && (
            <>
              <h2 className="w-rotulo">Trabalhando agora</h2>
              <ul className="w-atencao">
                {trabalhando.map((item) => (
                  <li key={item.id}>
                    <ItemLateral conversa={item} ativa={item.id === conversaId} abrir={abrirConversa} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function ItemLateral({ conversa, ativa, abrir }: { conversa: Conversation; ativa: boolean; abrir: (id: string) => void }) {
  const aprovar = Boolean(conversa.capabilities?.approve);
  return (
    <button type="button" className={`w-atencao-item${ativa ? " w-atencao-item-ativa" : ""}${aprovar ? " w-atencao-item-alerta" : ""}`}
      onClick={() => abrir(conversa.id)} title={conversa.title}>
      <span className={`m-dot ${tomDoEstado(conversa)}`} aria-hidden />
      {conversa.provider && <AgentIcon provider={conversa.provider} size={12} className="shrink-0" />}
      <span className="w-atencao-texto">{conversa.title}</span>
      {aprovar ? <span className="m-badge m-badge-alerta">Aprovar</span>
        : haQuanto(conversa.updated_at_ms) && <time className="w-atencao-tempo">{haQuanto(conversa.updated_at_ms)}</time>}
    </button>
  );
}
