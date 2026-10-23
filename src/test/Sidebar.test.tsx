import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "../components/Sidebar";
import type { AttentionItem } from "../features/terminal/useAttention";
import type { WorkspaceState } from "../types/workspace";
import type { TerminalSession } from "../features/terminal/terminalService";

vi.mock("../components/FileTree", () => ({ FileTree: () => null }));
vi.mock("../components/GitPanel", () => ({ GitPanel: () => null }));
vi.mock("../components/SkillsList", () => ({ SkillsList: () => null }));
vi.mock("../components/KanbanPanel", () => ({ KanbanPanel: () => null }));
vi.mock("../components/DockerPanel", () => ({ DockerPanel: () => null }));
vi.mock("../hooks/useNotifications", () => ({ useNotifications: () => [] }));

function workspace(id: string, name: string): WorkspaceState {
  return { version: 1, id, name, projects: [], activeProjectId: null, updatedAt: "" };
}

const item: AttentionItem = {
  sessionId: "s1",
  conversationKey: "conv-1",
  sessionName: "Claude · api",
  reason: "approval_required",
  projectId: "api",
  projectName: "api",
  workspaceId: "ws-a",
  workspaceName: "Cliente X",
};

function renderSidebar(overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) {
  const props: React.ComponentProps<typeof Sidebar> = {
    workspaces: [workspace("ws-a", "Cliente X"), workspace("ws-b", "Estudos")],
    activeWorkspaceId: "ws-b",
    onSelectWorkspace: vi.fn(),
    onCreateWorkspace: vi.fn(),
    onHideWorkspace: vi.fn(),
    onShowWorkspace: vi.fn(),
    onDeleteWorkspace: vi.fn(),
    onMoveWorkspace: vi.fn(),
    onRemoveProjectFromWorkspace: vi.fn(),
    onRenameWorkspace: vi.fn(),
    attention: [item],
    onFocusSession: vi.fn(),
    onDismissAttention: vi.fn(),
    onRunInTerminal: vi.fn(),
    projects: [],
    activeProjectId: null,
    activeProjectPath: null,
    onOpenFile: vi.fn(),
    onFileRenamed: vi.fn(),
    onPathDeleted: vi.fn(),
    terminalSessions: [],
    showSettings: false,
    showHistory: false,
    onOpenHistory: vi.fn(),
    onHome: vi.fn(),
    onAddProject: vi.fn(),
    onSelectProject: vi.fn(),
    onCloseProject: vi.fn(),
    onMoveProject: vi.fn(),
    onAttachTerminal: vi.fn(),
    onCloseTerminal: vi.fn(),
    onDuplicateTerminal: vi.fn(),
    onRestartTerminal: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenGitDiff: vi.fn(),
    onOpenGitGraph: vi.fn(),
    kanban: {
      version: 1,
      tasks: [],
      agentByProject: {},
      dispatcherEnabled: false,
      failureTimestamps: [],
      pausedUntil: null,
    },
    onOpenKanban: vi.fn(),
    ...overrides,
  };
  render(<Sidebar {...props} />);
  return props;
}

describe("Sidebar", () => {
  it("fechar workspace só esconde; o + reabre um escondido ou cria um novo", async () => {
    const escondido = { ...workspace("ws-c", "Antigo"), hidden: true };
    const props = renderSidebar({ workspaces: [workspace("ws-a", "Cliente X"), workspace("ws-b", "Estudos"), escondido] });
    expect(screen.queryByText("Antigo")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Fechar workspace Cliente X" }));
    expect(props.onHideWorkspace).toHaveBeenCalledWith("ws-a");

    await userEvent.click(screen.getByRole("button", { name: "Abrir workspace" }));
    const modal = screen.getByRole("dialog", { name: "Abrir workspace" });
    await userEvent.click(within(modal).getByRole("button", { name: /Antigo/ }));
    expect(props.onShowWorkspace).toHaveBeenCalledWith("ws-c");

    await userEvent.click(screen.getByRole("button", { name: "Abrir workspace" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Nome do workspace novo" }), "Cliente Y");
    await userEvent.click(screen.getByRole("button", { name: "Criar" }));
    expect(props.onCreateWorkspace).toHaveBeenCalledWith("Cliente Y");
  });

  it("gerenciar exclui só depois da confirmação que explica o que acontece, e remove projeto", async () => {
    const comProjeto: WorkspaceState = { ...workspace("ws-a", "Cliente X"), projects: [
      { id: "p1", name: "api", path: "C:/dev/api", gitRoot: null, branch: null, composeFile: null, lastOpenedAt: "",
        layout: { type: "pane", id: "pane", tabs: [], activeTabId: null }, activePaneId: "pane", maximizedPaneId: null },
    ] } as WorkspaceState;
    const props = renderSidebar({ workspaces: [comProjeto, workspace("ws-b", "Estudos")] });

    await userEvent.click(screen.getByRole("button", { name: "Gerenciar workspaces" }));
    const gerenciar = screen.getByRole("dialog", { name: "Gerenciar workspaces" });
    await userEvent.click(within(gerenciar).getByRole("button", { name: /^Cliente X/ }));
    await userEvent.click(within(gerenciar).getByRole("button", { name: "Remover" }));
    expect(props.onRemoveProjectFromWorkspace).toHaveBeenCalledWith("ws-a", "p1");

    await userEvent.click(within(gerenciar).getByRole("button", { name: "Excluir workspace Cliente X" }));
    const confirmar = screen.getByRole("dialog", { name: "Excluir workspace?" });
    expect(confirmar).toHaveTextContent("não dá para desfazer");
    expect(confirmar).toHaveTextContent("continuam no Histórico");
    expect(props.onDeleteWorkspace).not.toHaveBeenCalled();
    await userEvent.click(within(confirmar).getByRole("button", { name: "Excluir workspace" }));
    expect(props.onDeleteWorkspace).toHaveBeenCalledWith("ws-a");
  });

  it("mostra o agente pendente de outro workspace e pula pra ele no clique", async () => {
    const props = renderSidebar();

    const aviso = screen.getByRole("button", { name: /claude · api aprovar cliente x · api/i });
    expect(aviso).toBeInTheDocument();

    await userEvent.click(aviso);
    expect(props.onFocusSession).toHaveBeenCalledWith(item);
  });

  it("aviso diz o tipo e há quanto tempo aconteceu", () => {
    renderSidebar({ attention: [{ ...item, provider: "codex", aconteceuEm: Date.now() - 5 * 60_000 }] });
    expect(screen.getByText("há 5 min")).toBeInTheDocument();
    // Só a marca na linha; o nome do agente fica no tooltip.
    expect(screen.getByTitle(/^Codex · Cliente X/)).toBeInTheDocument();
    // Topo da Atenção e o workspace Cliente X: o mesmo selo de aprovação com a contagem.
    expect(screen.getAllByTitle("aprovar").map((selo) => selo.textContent)).toEqual(["1", "1"]);
  });

  it("dispensa o aviso pelo X sem abrir o agente", async () => {
    const props = renderSidebar();
    await userEvent.click(screen.getByRole("button", { name: /dispensar aviso de/i }));
    expect(props.onDismissAttention).toHaveBeenCalledWith(item);
    expect(props.onFocusSession).not.toHaveBeenCalled();
  });

  it("marca o workspace inativo com a contagem de pendências", () => {
    renderSidebar();
    expect(screen.getByLabelText("1 agente esperando em Cliente X")).toBeInTheDocument();
    expect(screen.getByLabelText("1 agente esperando no total")).toBeInTheDocument();
  });

  it("lista os workspaces sem precisar abrir dropdown", () => {
    renderSidebar({ attention: [] });

    expect(screen.getByRole("button", { name: "Cliente X" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Estudos" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("aprovar")).not.toBeInTheDocument();
  });
  /** Conversas com IA ficam em CHATS; shells sem IA (npm run dev, git) em TERMINALS. */
  it("separa as conversas com agente dos terminais", () => {
    const sessao = (id: string, name: string, provider: string | null): TerminalSession => ({
      id, name, provider, project_id: "p", cwd: "C:/p", shell: "bash", state: "answered", pid: 1, output_seq: 0, rows: 24, cols: 80,
    });
    renderSidebar({
      attention: [],
      activeProjectId: "p",
      activeProjectPath: "C:/p",
      terminalSessions: [sessao("s1", "Corrigir o login", "claude"), sessao("s2", "npm run dev", null)],
    });

    const chats = screen.getByRole("button", { name: "CHATS" }).parentElement!;
    const terminais = screen.getByRole("button", { name: "TERMINALS" }).parentElement!;
    expect(within(chats).getByText("Corrigir o login")).toBeInTheDocument();
    expect(within(chats).queryByText("npm run dev")).not.toBeInTheDocument();
    expect(within(terminais).getByText("npm run dev")).toBeInTheDocument();
    expect(within(terminais).queryByText("Corrigir o login")).not.toBeInTheDocument();
  });

  it("conversas: a mexida por último aparece primeiro", () => {
    const sessao = (id: string, name: string, quando: number): TerminalSession => ({
      id, name, provider: "claude", project_id: "p", cwd: "C:/p", shell: "bash", state: "answered", pid: 1, output_seq: 0, rows: 24, cols: 80,
      last_activity_at_ms: quando,
    });
    renderSidebar({
      attention: [], activeProjectId: "p", activeProjectPath: "C:/p",
      terminalSessions: [sessao("s1", "Antiga", 1_000), sessao("s2", "Recente", 9_000), sessao("s3", "Meio", 5_000)],
    });
    const chats = screen.getByRole("button", { name: "CHATS" }).parentElement!;
    const nomes = ["Antiga", "Recente", "Meio"].map((nome) => within(chats).getByText(nome));
    const ordem = [...nomes].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)).map((n) => n.textContent);
    expect(ordem).toEqual(["Recente", "Meio", "Antiga"]);
  });

  it("abas no topo: a das conversas avisa atenção e agente trabalhando; trocar mostra a outra", async () => {
    const trabalhando: TerminalSession = {
      id: "s9", name: "Refatorar", provider: "claude", project_id: "p", cwd: "C:/p", shell: "bash", state: "working", pid: 1, output_seq: 0, rows: 24, cols: 80,
    };
    renderSidebar({ agentSessions: [trabalhando] });

    const conversas = screen.getByRole("button", { name: "Conversas · 1 pedindo atenção · agente trabalhando" });
    expect(conversas).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("navigation", { name: "Conversas" })).toHaveTextContent("Cliente X");

    await userEvent.click(screen.getByRole("button", { name: "Git" }));
    expect(screen.getByRole("button", { name: "Git" })).toHaveAttribute("aria-pressed", "true");
    expect(conversas).toHaveAttribute("aria-pressed", "false");
    // Sem projeto aberto a aba explica em vez de ficar vazia.
    expect(await screen.findByText("Abra um projeto para ver git.")).toBeInTheDocument();
  });
});
