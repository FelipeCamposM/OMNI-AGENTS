import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationBell } from "../components/NotificationBell";

// O plugin do updater não existe fora do Tauri; sem isto o import dinâmico
// rejeita e o teste não distinguiria "sem atualização" de "falhou".
const check = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => check() }));

beforeEach(() => {
  check.mockResolvedValue(null);
});

describe("NotificationBell", () => {
  it("sem pendências: nenhum contador e nada para instalar", async () => {
    render(<NotificationBell onOpenSettings={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /nenhuma pendência/i })).toBeInTheDocument()
    );

    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByText(/nada pendente/i)).toBeInTheDocument();
  });

  it("atualização aponta para a seção Sobre", async () => {
    check.mockResolvedValue({ version: "0.9.0", body: "" });
    const abrir = vi.fn();

    render(<NotificationBell onOpenSettings={abrir} />);
    await screen.findByRole("button", { name: /1 pendência/i });

    await userEvent.click(screen.getByRole("button", { name: /1 pendência/i }));
    await userEvent.click(screen.getByText(/versão 0.9.0 disponível/i));

    expect(abrir).toHaveBeenCalledWith("sobre");
  });

  it("a lista é renderizada fora do container do sino (portal)", async () => {
    // A `<aside>` da barra lateral é `.glass`, e `backdrop-filter` cria
    // contexto de empilhamento: filha dela, a lista fica presa atrás do
    // conteúdo da página por mais z-index que tenha. Só o portal resolve —
    // devolver a lista para dentro do sino traz o bug visual de volta.
    check.mockResolvedValue({ version: "0.9.0", body: "" });
    const { container } = render(<NotificationBell onOpenSettings={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: /1 pendência/i }));

    const lista = screen.getByRole("dialog", { name: /notificações/i });
    expect(container).not.toContainElement(lista);
    expect(document.body).toContainElement(lista);
  });

  it("clicar dentro da lista não a fecha", async () => {
    // Com o portal, a lista deixou de ser descendente do sino: olhar só o ref
    // do sino no clique-fora fecharia o popover ao clicar nele mesmo.
    check.mockResolvedValue({ version: "0.9.0", body: "" });
    render(<NotificationBell onOpenSettings={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: /1 pendência/i }));
    await userEvent.click(screen.getByRole("dialog", { name: /notificações/i }));

    expect(screen.getByRole("dialog", { name: /notificações/i })).toBeInTheDocument();
  });

  it("checagem que falha não vira pendência", async () => {
    // Sem internet o usuário não pode fazer nada — alerta permanente só irrita.
    check.mockRejectedValue(new Error("sem rede"));

    render(<NotificationBell onOpenSettings={vi.fn()} />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /nenhuma pendência/i })).toBeInTheDocument()
    );
  });
});
