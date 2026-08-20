import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationBell } from "../components/NotificationBell";

const doclingInstalled = vi.fn();
const ffmpegInstalled = vi.fn();
const whisperInstalled = vi.fn();
const depthInstalled = vi.fn();
const realesrganInstalled = vi.fn();
const rembgInstalled = vi.fn();
const webcaptureInstalled = vi.fn();

// Módulo novo aqui exige entrada nova neste mock — o ModuleGate importa todos
// os `checar` de uma vez, e um export faltando derruba a suíte inteira no load.
vi.mock("../services/conversionService", () => ({
  doclingInstalled: () => doclingInstalled(),
  ensureDocling: vi.fn(),
  ffmpegInstalled: () => ffmpegInstalled(),
  ensureFfmpeg: vi.fn(),
  whisperInstalled: () => whisperInstalled(),
  ensureWhisper: vi.fn(),
  depthInstalled: () => depthInstalled(),
  ensureDepth: vi.fn(),
  realesrganInstalled: () => realesrganInstalled(),
  ensureRealesrgan: vi.fn(),
  rembgInstalled: () => rembgInstalled(),
  ensureRembg: vi.fn(),
  webcaptureInstalled: () => webcaptureInstalled(),
  ensureWebcapture: vi.fn(),
}));

// O plugin do updater não existe fora do Tauri; sem isto o import dinâmico
// rejeita e o teste não distinguiria "sem atualização" de "falhou".
const check = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => check() }));

beforeEach(() => {
  doclingInstalled.mockResolvedValue(true);
  ffmpegInstalled.mockResolvedValue(true);
  whisperInstalled.mockResolvedValue(true);
  depthInstalled.mockResolvedValue(true);
  realesrganInstalled.mockResolvedValue(true);
  rembgInstalled.mockResolvedValue(true);
  webcaptureInstalled.mockResolvedValue(true);
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

  it("conta módulo faltando + versão nova", async () => {
    ffmpegInstalled.mockResolvedValue(false);
    check.mockResolvedValue({ version: "0.2.0", body: "notas" });

    render(<NotificationBell onOpenSettings={vi.fn()} />);

    const sino = await screen.findByRole("button", { name: /2 pendências/i });
    expect(sino).toHaveTextContent("2");
  });

  it("leva para a seção certa das Configurações", async () => {
    ffmpegInstalled.mockResolvedValue(false);
    const abrir = vi.fn();

    render(<NotificationBell onOpenSettings={abrir} />);
    await screen.findByRole("button", { name: /1 pendência/i });

    await userEvent.click(screen.getByRole("button", { name: /1 pendência/i }));
    await userEvent.click(screen.getByText(/módulo de mídia/i));

    // Os módulos saíram de "Armazenamento" e ganharam seção própria.
    expect(abrir).toHaveBeenCalledWith("modulos");
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
    ffmpegInstalled.mockResolvedValue(false);
    const { container } = render(<NotificationBell onOpenSettings={vi.fn()} />);

    await userEvent.click(await screen.findByRole("button", { name: /1 pendência/i }));

    const lista = screen.getByRole("dialog", { name: /notificações/i });
    expect(container).not.toContainElement(lista);
    expect(document.body).toContainElement(lista);
  });

  it("clicar dentro da lista não a fecha", async () => {
    // Com o portal, a lista deixou de ser descendente do sino: olhar só o ref
    // do sino no clique-fora fecharia o popover ao clicar nele mesmo.
    ffmpegInstalled.mockResolvedValue(false);
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
