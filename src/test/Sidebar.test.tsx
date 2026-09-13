import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "../components/Sidebar";
import type { AttentionItem } from "../features/terminal/useAttention";
import type { WorkspaceState } from "../types/workspace";

vi.mock("../components/FileTree", () => ({ FileTree: () => null }));
vi.mock("../components/GitPanel", () => ({ GitPanel: () => null }));
vi.mock("../components/SkillsList", () => ({ SkillsList: () => null }));
vi.mock("../components/KanbanPanel", () => ({ KanbanPanel: () => null }));
vi.mock("../hooks/useNotifications", () => ({ useNotifications: () => [] }));

function workspace(id: string, name: string): WorkspaceState {
  return { version: 1, id, name, projects: [], activeProjectId: null, updatedAt: "" };
}

const item: AttentionItem = {
  sessionId: "s1",
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
    onCloseWorkspace: vi.fn(),
    onRenameWorkspace: vi.fn(),
    attention: [item],
    attentionByWorkspace: { "ws-a": 1 },
    onFocusSession: vi.fn(),
    projects: [],
    activeProjectId: null,
    activeProjectPath: null,
    onOpenFile: vi.fn(),
    onFileRenamed: vi.fn(),
    onPathDeleted: vi.fn(),
    terminalSessions: [],
    showSettings: false,
    onHome: vi.fn(),
    onAddProject: vi.fn(),
    onSelectProject: vi.fn(),
    onCloseProject: vi.fn(),
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
  it("mostra o agente pendente de outro workspace e pula pra ele no clique", async () => {
    const props = renderSidebar();

    const aviso = screen.getByRole("button", { name: /cliente x · api · aprovação pendente/i });
    expect(aviso).toBeInTheDocument();

    await userEvent.click(aviso);
    expect(props.onFocusSession).toHaveBeenCalledWith(item);
  });

  it("marca o workspace inativo com a contagem de pendências", () => {
    renderSidebar();
    expect(screen.getByLabelText("1 agente esperando em Cliente X")).toBeInTheDocument();
    expect(screen.getByLabelText("1 agente esperando no total")).toBeInTheDocument();
  });

  it("lista os workspaces sem precisar abrir dropdown", () => {
    renderSidebar({ attention: [], attentionByWorkspace: {} });

    expect(screen.getByRole("button", { name: "Cliente X" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Estudos" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(/aprovação pendente/i)).not.toBeInTheDocument();
  });
});
