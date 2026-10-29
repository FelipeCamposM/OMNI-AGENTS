import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc } from "@tauri-apps/api/core";
import { BoxIcon, CheckIcon, EditIcon, FolderIcon, ImageIcon } from "./ui/PixelIcon";
import { abrirPopover, entrarEmCascata, fecharPopover } from "../lib/motion";
import { iconeEfetivo, useIconeDoProjeto, useIconeDoWorkspace, useIconesDoProjeto } from "../features/projects/iconesDoProjeto";
import type { Project, WorkspaceState } from "../types/workspace";

/** Imagem de um arquivo local; se não carregar (ico corrompido, arquivo apagado), mostra `reserva`. */
export function ImagemDeIcone({ caminho, reserva, className = "" }: { caminho: string | null; reserva: ReactNode; className?: string }) {
  const [falhou, setFalhou] = useState(false);
  useEffect(() => setFalhou(false), [caminho]);
  if (!caminho || falhou) return <>{reserva}</>;
  return <img src={convertFileSrc(caminho)} alt="" draggable={false} onError={() => setFalhou(true)} className={`icone-img ${className}`} />;
}

export interface OpcaoBase {
  /** `undefined` = automático (projeto); `null` = sem favicon. */
  valor: string | null | undefined;
  rotulo: string;
  dica: string;
  icone: ReactNode;
}

/** Projeto cujos favicons entram na grade. */
export interface GrupoDeIcones {
  id: string;
  nome: string;
  raiz: string;
}

/**
 * Popover para escolher o símbolo de um projeto ou workspace: opções fixas no topo (automático, pasta,
 * padrão) e a grade de favicons achados em cada projeto, com o atual marcado.
 */
export function EscolherIcone({ ancora, titulo, subtitulo, opcoes, grupos, atual, onEscolher, onFechar }: {
  ancora: HTMLElement;
  titulo: string;
  subtitulo: string;
  opcoes: OpcaoBase[];
  grupos: GrupoDeIcones[];
  atual: string | null | undefined;
  onEscolher: (valor: string | null | undefined) => void;
  onFechar: () => void;
}) {
  const painel = useRef<HTMLDivElement>(null);
  const fechando = useRef(false);
  const [posicao, setPosicao] = useState<{ left: number; top: number } | null>(null);

  const fechar = (depois?: () => void) => {
    if (fechando.current) return;
    fechando.current = true;
    fecharPopover(painel.current, () => { depois?.(); onFechar(); });
  };
  const fecharRef = useRef(fechar);
  fecharRef.current = fechar;

  // Abre ao lado da lateral (sem cobrir as linhas), na altura do avatar; perto da borda de baixo, sobe o que faltar.
  useLayoutEffect(() => {
    const caixa = ancora.getBoundingClientRect();
    const lateral = ancora.closest("aside")?.getBoundingClientRect().right ?? caixa.right;
    const altura = Math.min(window.innerHeight - 16, 520);
    setPosicao({
      left: Math.min(lateral + 8, window.innerWidth - 368),
      top: Math.max(8, Math.min(caixa.top - 8, window.innerHeight - altura - 8)),
    });
  }, [ancora]);
  useLayoutEffect(() => {
    if (posicao) abrirPopover(painel.current, "top left");
  }, [posicao !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const fora = (evento: MouseEvent) => {
      const alvo = evento.target as Node;
      if (!painel.current?.contains(alvo) && !ancora.contains(alvo)) fecharRef.current();
    };
    const esc = (evento: KeyboardEvent) => { if (evento.key === "Escape") fecharRef.current(); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [ancora]);

  const escolher = (valor: string | null | undefined) => fechar(() => onEscolher(valor));
  let ordem = 0;

  if (!posicao) return null;
  return createPortal(
    <div ref={painel} role="dialog" aria-label={titulo} className="icone-painel" style={{ left: posicao.left, top: posicao.top }}>
      <header className="icone-cabeca">
        <span className="icone-cabeca-icone"><ImageIcon aria-hidden className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="icone-titulo">{titulo}</span>
          <span className="icone-sub">{subtitulo}</span>
        </span>
      </header>
      <div className="icone-corpo">
        <div className="icone-opcoes">
          {opcoes.map((opcao) => {
            const marcada = opcao.valor === atual;
            return (
              <button key={String(opcao.valor)} type="button" ref={entrarEmCascata} data-ordem={ordem++}
                aria-pressed={marcada} onClick={() => escolher(opcao.valor)} className={`icone-opcao${marcada ? " is-marcada" : ""}`}>
                <span className="icone-opcao-simbolo">{opcao.icone}</span>
                <span className="min-w-0 flex-1">
                  <span className="icone-opcao-rotulo">{opcao.rotulo}</span>
                  <span className="icone-opcao-dica">{opcao.dica}</span>
                </span>
                {marcada && <CheckIcon aria-hidden className="icone-check h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
        {grupos.map((grupo) => (
          <GradeDoProjeto key={grupo.id} grupo={grupo} atual={atual} mostrarNome={grupos.length > 1}
            ordem={(ordem += 2)} onEscolher={escolher} />
        ))}
      </div>
    </div>,
    document.body,
  );
}

function GradeDoProjeto({ grupo, atual, mostrarNome, ordem, onEscolher }: {
  grupo: GrupoDeIcones; atual: string | null | undefined; mostrarNome: boolean; ordem: number;
  onEscolher: (valor: string) => void;
}) {
  const icones = useIconesDoProjeto(grupo.raiz);
  const relativo = (caminho: string) => caminho.slice(grupo.raiz.length).replace(/^[\\/]/, "").replace(/\\/g, "/");
  return (
    <section aria-label={`Favicons de ${grupo.nome}`} className="icone-grupo">
      <p className="icone-grupo-titulo">
        {mostrarNome ? grupo.nome : "Favicons do projeto"}
        <span className="icone-grupo-linha" />
        <span className="icone-grupo-qtd">{icones === null ? "procurando…" : icones.length === 1 ? "1 achado" : `${icones.length} achados`}</span>
      </p>
      {icones !== null && icones.length === 0 && <p className="icone-vazio">Nenhum favicon, ícone ou logo nesta pasta.</p>}
      {icones && icones.length > 0 && (
        <ul className="icone-grade">
          {icones.map((caminho, indice) => {
            const marcado = caminho === atual;
            const nome = relativo(caminho);
            return (
              <li key={caminho} ref={entrarEmCascata} data-ordem={ordem + Math.min(indice, 8)}>
                <button type="button" aria-pressed={marcado} aria-label={`Usar ${nome}`} title={nome}
                  onClick={() => onEscolher(caminho)} className={`icone-ladrilho${marcado ? " is-marcado" : ""}`}>
                  <span className="icone-ladrilho-fundo">
                    <ImagemDeIcone caminho={caminho} reserva={<ImageIcon aria-hidden className="h-4 w-4 text-text-muted" />} />
                  </span>
                  <span className="icone-ladrilho-nome">{nome.split("/").pop()}</span>
                  <span className="icone-ladrilho-pasta">{nome.includes("/") ? nome.slice(0, nome.lastIndexOf("/")) : "raiz"}</span>
                  {marcado && <span className="icone-ladrilho-check"><CheckIcon aria-hidden className="h-3 w-3" /></span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Abre o seletor quando `pedido` muda depois da montagem. O valor que já vem na montagem é ignorado: o
 *  contador fica guardado na lateral, e trocar de aba e voltar remontava o avatar e reabria o seletor sozinho. */
function useAbrirAoPedir(pedido: number, abrir: () => void) {
  const visto = useRef(pedido);
  useEffect(() => {
    if (pedido === visto.current) return;
    visto.current = pedido;
    abrir();
  }, [pedido]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Avatar do projeto na lateral: o favicon (escolhido ou o primeiro achado) ou a pasta. Clicar abre a escolha. */
export function AvatarDoProjeto({ project, onEscolher, vizinhos = [], pedido = 0 }: {
  project: Project;
  onEscolher: (projectId: string, icone: string | null | undefined) => void;
  /** Os outros projetos do workspace: os favicons deles também servem, como no workspace. */
  vizinhos?: Project[];
  /** Muda para abrir o seletor de fora (o botão "Trocar ícone" da linha). */
  pedido?: number;
}) {
  const achados = useIconesDoProjeto(project.path);
  const efetivo = iconeEfetivo(project.icone, achados);
  const [ancora, setAncora] = useState<HTMLElement | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  useAbrirAoPedir(pedido, () => setAncora(botao.current));
  const pasta = <FolderIcon className="h-3.5 w-3.5 text-accent" aria-hidden />;
  return (
    <>
      <BotaoDoAvatar botaoRef={botao} rotulo={`Trocar ícone do projeto ${project.name}`} aberto={ancora !== null}
        onClick={(el) => setAncora((atual) => (atual ? null : el))}>
        <ImagemDeIcone caminho={efetivo} reserva={pasta} />
      </BotaoDoAvatar>
      {ancora && (
        <EscolherIcone ancora={ancora} titulo={`Ícone de ${project.name}`} subtitulo="O símbolo do projeto na lateral"
          atual={project.icone} grupos={[project, ...vizinhos.filter((outro) => outro.id !== project.id)]
            .map((item) => ({ id: item.id, nome: item.name, raiz: item.path }))}
          opcoes={[
            { valor: undefined, rotulo: "Automático", dica: achados?.[0] ? "O primeiro favicon da pasta" : "Usa um favicon quando aparecer um",
              icone: <ImagemDeIcone caminho={achados?.[0] ?? null} reserva={<ImageIcon aria-hidden className="h-4 w-4" />} /> },
            { valor: null, rotulo: "Ícone de pasta", dica: "Sem favicon", icone: <FolderIcon aria-hidden className="h-4 w-4" /> },
          ]}
          onEscolher={(valor) => onEscolher(project.id, valor)} onFechar={() => setAncora(null)} />
      )}
    </>
  );
}

/** Símbolo do projeto só para mostrar (listas e janelas): favicon ou pasta. */
export function SimboloDoProjeto({ project, className = "h-3.5 w-3.5" }: { project: Pick<Project, "path" | "icone">; className?: string }) {
  const icone = useIconeDoProjeto(project);
  return <span className={`grid shrink-0 place-items-center ${className}`}><ImagemDeIcone caminho={icone} reserva={<FolderIcon className="h-full w-full text-accent" aria-hidden />} /></span>;
}

/** Símbolo do workspace só para mostrar: favicon (escolhido ou automático) ou a caixa. */
export function SimboloDoWorkspace({ workspace, className = "h-3.5 w-3.5" }: { workspace: Pick<WorkspaceState, "icone" | "projects">; className?: string }) {
  const icone = useIconeDoWorkspace(workspace);
  return <span className={`grid shrink-0 place-items-center ${className}`}><ImagemDeIcone caminho={icone} reserva={<BoxIcon className="h-full w-full text-accent" aria-hidden />} /></span>;
}

/** Avatar do workspace: sem escolha, o favicon do primeiro projeto que tiver um; ou um escolhido; ou a caixa. */
export function AvatarDoWorkspace({ workspace, onEscolher, pedido = 0 }: {
  workspace: WorkspaceState;
  onEscolher: (workspaceId: string, icone: string | null | undefined) => void;
  /** Muda para abrir o seletor de fora (o botão "Trocar ícone" da linha). */
  pedido?: number;
}) {
  const [ancora, setAncora] = useState<HTMLElement | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  useAbrirAoPedir(pedido, () => setAncora(botao.current));
  const efetivo = useIconeDoWorkspace(workspace);
  const caixa = <BoxIcon className="h-3.5 w-3.5 text-accent" aria-hidden />;
  return (
    <>
      <BotaoDoAvatar botaoRef={botao} rotulo={`Trocar ícone do workspace ${workspace.name}`} aberto={ancora !== null}
        onClick={(el) => setAncora((atual) => (atual ? null : el))}>
        <ImagemDeIcone caminho={efetivo} reserva={caixa} />
      </BotaoDoAvatar>
      {ancora && (
        <EscolherIcone ancora={ancora} titulo={`Ícone de ${workspace.name}`}
          subtitulo={workspace.projects.length ? "Use o favicon de um dos projetos deste workspace" : "Adicione projetos para usar os favicons deles"}
          atual={workspace.icone}
          grupos={workspace.projects.map((project) => ({ id: project.id, nome: project.name, raiz: project.path }))}
          opcoes={[
            { valor: undefined, rotulo: "Automático", dica: "O favicon do primeiro projeto que tiver um",
              icone: <SimboloDoWorkspace workspace={{ projects: workspace.projects }} className="h-full w-full" /> },
            { valor: null, rotulo: "Caixa padrão", dica: "O símbolo de workspace do OMNI", icone: <BoxIcon aria-hidden className="h-4 w-4" /> },
          ]}
          onEscolher={(valor) => onEscolher(workspace.id, valor)} onFechar={() => setAncora(null)} />
      )}
    </>
  );
}

/** Botão do avatar: mesma caixa da lateral, com um lápis no hover. Não deixa o arrastar da linha começar nele. */
function BotaoDoAvatar({ rotulo, aberto, onClick, children, botaoRef }: {
  rotulo: string; aberto: boolean; onClick: (el: HTMLElement) => void; children: ReactNode;
  botaoRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button ref={botaoRef} type="button" aria-label={rotulo} title={rotulo} aria-haspopup="dialog" aria-expanded={aberto}
      onPointerDown={(evento) => evento.stopPropagation()}
      onClick={(evento) => { evento.stopPropagation(); onClick(evento.currentTarget); }}
      className={`lateral-avatar icone-avatar grid h-8 w-8 shrink-0 place-items-center self-center border border-border-subtle${aberto ? " is-aberto" : ""}`}>
      {children}
      <span aria-hidden className="icone-avatar-lapis"><EditIcon className="h-2.5 w-2.5" /></span>
    </button>
  );
}
