import { useEffect, useState } from "react";
import { AgentIcon } from "../components/ui/AgentIcon";
import { OmniLogo } from "../components/ui/OmniLogo";
import { Button } from "../components/ui/Button";
import { ReloadIcon } from "../components/ui/PixelIcon";
import { PairingScreen } from "../mobile/Chat";
import { ConversationDetail, ConversationList, NovaSessao } from "../mobile/MobileApp";
import { useDados } from "../mobile/useDados";
import type { Conversation } from "../mobile/api";

/**
 * A mesma coisa que o celular faz, num layout de computador.
 *
 * Tudo vem das **mesmas rotas** do engine que o celular usa — não há endpoint novo aqui. O que muda
 * é a forma: no celular é uma tela de cada vez (projetos → conversas → conversa); aqui projetos,
 * conversas e a conversa aberta ficam visíveis ao mesmo tempo, que é o que uma tela larga permite.
 *
 * Fora do escopo de propósito: editar arquivo, terminal ao vivo e painel de Git. Quem precisa disso
 * usa o app do PC; esta página é para acompanhar e conversar de outra máquina.
 */
export function WebApp() {
  const { conversations, attention, catalog, carregado, error, semAcesso, refresh, atualizar, parear } = useDados();
  const [projetoId, setProjetoId] = useState<string | null>(null);
  const [conversaId, setConversaId] = useState<string | null>(null);

  // Endereço guarda a conversa aberta: atualizar a página (ou deixar aberta o dia todo) volta para
  // onde estava, como no celular.
  useEffect(() => {
    const ler = () => {
      const match = /^#\/c\/([^/?#]+)$/.exec(location.hash);
      setConversaId(match ? decodeURIComponent(match[1]) : null);
    };
    ler();
    window.addEventListener("hashchange", ler);
    return () => window.removeEventListener("hashchange", ler);
  }, []);

  function abrirConversa(id: string) {
    history.pushState(null, "", `${location.pathname}#/c/${encodeURIComponent(id)}`);
    setConversaId(id);
  }

  if (semAcesso) {
    return (
      <main className="w-pareamento">
        <PairingScreen parear={parear} />
      </main>
    );
  }

  const conversa: Conversation | null = conversations.find((item) => item.id === conversaId) ?? null;
  // Projeto em foco: o da conversa aberta, ou o escolhido na lista, ou o primeiro que existir.
  const projetoAtivo =
    catalog?.projects.find((item) => item.id === (conversa?.project_id ?? projetoId)) ?? catalog?.projects[0] ?? null;
  const daLista = conversations.filter((item) => item.project_id === projetoAtivo?.id);

  return (
    <div className="w-tela">
      <header className="w-topo glass glass-strong">
        <OmniLogo className="neon-glow w-logo" />
        <span className="pixel-text w-marca">OMNI AGENTS</span>
        <span className="w-topo-espaco" />
        {error && <span className="w-erro">{error}</span>}
        <button type="button" className="btn btn-ghost w-atualizar" aria-label="Atualizar" onClick={atualizar}>
          <ReloadIcon aria-hidden className="h-4 w-4" />
        </button>
      </header>

      <div className="w-colunas">
        <aside className="w-coluna w-lateral" aria-label="Projetos e conversas">
          <h2 className="w-rotulo">Projetos</h2>
          {catalog && catalog.projects.length === 0 && (
            <p className="w-vazio">Nenhum projeto conhecido. Abra um projeto no OMNI do PC.</p>
          )}
          <ul className="w-projetos">
            {catalog?.projects.map((project) => {
              const doProjeto = conversations.filter((item) => item.project_id === project.id);
              const aguardando = doProjeto.filter((item) => item.capabilities?.approve).length;
              return (
                <li key={project.id}>
                  <button
                    type="button"
                    onClick={() => setProjetoId(project.id)}
                    aria-current={project.id === projetoAtivo?.id ? "true" : undefined}
                    className={`w-projeto${project.id === projetoAtivo?.id ? " w-projeto-ativo" : ""}`}
                    title={project.path}
                  >
                    <span className="w-projeto-nome">{project.name}</span>
                    {aguardando > 0 && <span className="m-badge m-badge-alerta">{aguardando}</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          <h2 className="w-rotulo">Conversas</h2>
          <div className="w-conversas">
            <ConversationList
              conversations={daLista}
              perfis={catalog?.profiles ?? []}
              abrir={abrirConversa}
              vazio={carregado ? "Nenhuma conversa neste projeto ainda." : "Carregando…"}
            />
          </div>
          {projetoAtivo && catalog && (
            <NovaSessao project={projetoAtivo} catalog={catalog} onCriada={refresh} />
          )}
        </aside>

        <main className="w-coluna w-centro" aria-label="Conversa">
          {conversa ? (
            <ConversationDetail key={conversa.id} conversation={conversa} refresh={refresh} />
          ) : (
            <p className="w-vazio">Escolha uma conversa à esquerda para acompanhar e responder.</p>
          )}
        </main>

        <aside className="w-coluna w-direita" aria-label="Precisa de você">
          <h2 className="w-rotulo">Precisa de você</h2>
          {attention.length === 0 ? (
            <p className="w-vazio">Nada pendente agora.</p>
          ) : (
            <ul className="w-atencao">
              {attention.map((item) => (
                <li key={item.id}>
                  <Button
                    variant={item.capabilities?.approve ? "primary" : "ghost"}
                    size="sm"
                    className="w-atencao-item"
                    onClick={() => abrirConversa(item.id)}
                  >
                    {item.provider && <AgentIcon provider={item.provider} size={12} className="shrink-0" />}
                    <span className="w-atencao-texto">{item.title}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
