import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readDir } from "@tauri-apps/plugin-fs";
import { iconeEfetivo, procurarIcones } from "../features/projects/iconesDoProjeto";
import { workspaceReducer, createProject } from "../features/workspace/workspaceReducer";
import { AvatarDoProjeto, AvatarDoWorkspace } from "../components/EscolherIcone";
import type { WorkspaceState } from "../types/workspace";

/** Árvore falsa: pasta → entradas. */
const ARVORE: Record<string, [string, boolean][]> = {
  "C:/p": [["public", true], ["node_modules", true], [".git", true], ["src", true], ["logo.png", false], ["README.md", false]],
  "C:/p/public": [["favicon.ico", false], ["favicon.svg", false], ["robots.txt", false]],
  "C:/p/node_modules": [["favicon.ico", false]],
  "C:/p/.git": [["icon.png", false]],
  "C:/p/src": [["app", true]],
  "C:/p/src/app": [["icon.png", false], ["page.tsx", false]],
};

beforeEach(() => {
  vi.mocked(readDir).mockImplementation(async (pasta) =>
    (ARVORE[String(pasta)] ?? []).map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory, isSymlink: false })));
});

describe("procurarIcones", () => {
  it("acha favicons e logos, pula build/ocultas e põe favicon (svg primeiro) na frente", async () => {
    expect(await procurarIcones("C:/p")).toEqual([
      "C:/p/public/favicon.svg",
      "C:/p/public/favicon.ico",
      "C:/p/src/app/icon.png",
      "C:/p/logo.png",
    ]);
  });

  it("escolhido vale; null é pasta; sem escolha usa o primeiro achado", () => {
    expect(iconeEfetivo("C:/x.png", ["C:/a.ico"])).toBe("C:/x.png");
    expect(iconeEfetivo(null, ["C:/a.ico"])).toBeNull();
    expect(iconeEfetivo(undefined, ["C:/a.ico"])).toBe("C:/a.ico");
    expect(iconeEfetivo(undefined, [])).toBeNull();
  });
});

describe("SET_PROJECT_ICON", () => {
  it("grava, zera para pasta e volta ao automático tirando o campo", () => {
    const projeto = createProject("C:/p", "p1");
    let estado: WorkspaceState = { version: 1, id: "w", name: "W", projects: [projeto], activeProjectId: "p1", updatedAt: "" };
    estado = workspaceReducer(estado, { type: "SET_PROJECT_ICON", projectId: "p1", icone: "C:/p/public/favicon.svg" });
    expect(estado.projects[0].icone).toBe("C:/p/public/favicon.svg");
    estado = workspaceReducer(estado, { type: "SET_PROJECT_ICON", projectId: "p1", icone: null });
    expect(estado.projects[0].icone).toBeNull();
    estado = workspaceReducer(estado, { type: "SET_PROJECT_ICON", projectId: "p1", icone: undefined });
    expect("icone" in estado.projects[0]).toBe(false);
  });
});

describe("AvatarDoProjeto", () => {
  it("mostra o favicon achado e troca pelo escolhido na grade", async () => {
    const onEscolher = vi.fn();
    render(<AvatarDoProjeto project={createProject("C:/p", "p1")} onEscolher={onEscolher} />);

    const avatar = screen.getByRole("button", { name: "Trocar ícone do projeto p" });
    await vi.waitFor(() => expect(avatar.querySelector("img")).toHaveAttribute("src", "C:/p/public/favicon.svg"));

    await userEvent.click(avatar);
    const painel = await screen.findByRole("dialog", { name: "Ícone de p" });
    expect(within(painel).getByRole("button", { name: /Automático/ })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(await within(painel).findByRole("button", { name: "Usar src/app/icon.png" }));
    await vi.waitFor(() => expect(onEscolher).toHaveBeenCalledWith("p1", "C:/p/src/app/icon.png"));
  });

  /** "Tenho que poder mudar os ícones dos projetos também, igual ao do workspace." */
  it("abre pelo botão da linha e oferece o favicon dos outros projetos do workspace", async () => {
    const onEscolher = vi.fn();
    const semIcone = createProject("C:/q", "q1");
    const { rerender } = render(<AvatarDoProjeto project={semIcone} onEscolher={onEscolher} vizinhos={[semIcone, createProject("C:/p", "p1")]} />);
    rerender(<AvatarDoProjeto project={semIcone} onEscolher={onEscolher} vizinhos={[semIcone, createProject("C:/p", "p1")]} pedido={1} />);
    const painel = await screen.findByRole("dialog", { name: "Ícone de q" });
    await userEvent.click(await within(painel).findByRole("button", { name: "Usar public/favicon.svg" }));
    await vi.waitFor(() => expect(onEscolher).toHaveBeenCalledWith("q1", "C:/p/public/favicon.svg"));
  });

  /** "Ao entrar em uma aba e voltar para a de conversas, está abrindo o dropdown de mudar o ícone sozinho." */
  it("remontar com um pedido antigo não reabre o seletor", async () => {
    render(<AvatarDoProjeto project={createProject("C:/q", "q1")} onEscolher={vi.fn()} pedido={3} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("AvatarDoWorkspace", () => {
  it("sem escolha usa o favicon do primeiro projeto que tiver um; a caixa só quando escolhida", async () => {
    const semIcone = { ...createProject("C:/vazio", "p0"), icone: null };
    const workspace: WorkspaceState = { version: 1, id: "w", name: "Clientes", projects: [semIcone, createProject("C:/p", "p1")], activeProjectId: "p1", updatedAt: "" };
    const { rerender } = render(<AvatarDoWorkspace workspace={workspace} onEscolher={vi.fn()} />);
    const avatar = screen.getByRole("button", { name: "Trocar ícone do workspace Clientes" });
    await vi.waitFor(() => expect(avatar.querySelector("img")).toHaveAttribute("src", "C:/p/public/favicon.svg"));

    rerender(<AvatarDoWorkspace workspace={{ ...workspace, icone: null }} onEscolher={vi.fn()} />);
    expect(avatar.querySelector("img")).toBeNull();
  });
});
