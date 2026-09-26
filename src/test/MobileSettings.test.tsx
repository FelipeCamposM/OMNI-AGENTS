import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { corDoQr, linkDoPc, MobileSettings } from "../features/mobile/MobileSettings";
import { PALETAS } from "../lib/palettes";

const invoke = vi.mocked((await import("@tauri-apps/api/core")).invoke);
const openUrl = vi.mocked((await import("@tauri-apps/plugin-opener")).openUrl);

function status(extra: Record<string, unknown> = {}) {
  return {
    config: { enabled: true, bind: "100.64.0.10:47322", token: "abc123", serve: false },
    listening: "http://100.64.0.10:47322", error: null, qr: "http://100.64.0.10:47322/#t=abc123",
    public_url: "http://100.64.0.10:47322", magic_dns: "pc.tail.ts.net", serve_hint: null,
    totp_confirmed: false, totp_uri: null, ...extra,
  };
}

describe("aba Celular: cadastro do Authy", () => {
  beforeEach(() => invoke.mockReset());

  it("configura, confirma com o código e mostra configurado", async () => {
    invoke.mockImplementation(async (comando: string, args?: Record<string, unknown>) => {
      if (comando === "mobile_settings") return status();
      if (comando === "mobile_totp" && args?.action === "reset") {
        return status({ totp_uri: "otpauth://totp/OMNI%20AGENTS:pc?secret=ABC&issuer=OMNI%20AGENTS" });
      }
      if (comando === "mobile_totp" && args?.action === "confirm") {
        expect(args.code).toBe("287082");
        return status({ totp_confirmed: true });
      }
      return null;
    });
    render(<MobileSettings />);

    // `findBy*` fora do `act`: esperar dentro dele impede o React de aplicar o estado que mostra o botão.
    const configurar = await screen.findByRole("button", { name: "Configurar Authy" });
    await act(async () => { await userEvent.click(configurar); });
    const campo = await screen.findByLabelText("Código do Authy");
    await act(async () => {
      await userEvent.type(campo, "287082");
      await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    });

    expect(await screen.findByText(/Authy configurado/)).toBeInTheDocument();
  });

  it("refazer pede confirmação antes de invalidar o cadastro", async () => {
    invoke.mockImplementation(async (comando: string) =>
      comando === "mobile_settings" ? status({ totp_confirmed: true }) : status({ totp_uri: "otpauth://totp/x?secret=A" }));
    render(<MobileSettings />);

    const refazer = await screen.findByRole("button", { name: "Refazer cadastro" });
    await act(async () => { await userEvent.click(refazer); });
    expect(invoke).not.toHaveBeenCalledWith("mobile_totp", expect.anything());
    expect(screen.getByText(/para de funcionar/)).toBeInTheDocument();
  });
});

describe("aba Celular: endereço do QR", () => {
  beforeEach(() => { invoke.mockReset(); openUrl.mockReset(); });

  it("abre o endereço pelo navegador do sistema, com barra no fim para casar a permissão", async () => {
    // `<a target="_blank">` não abre nada dentro do Tauri — era o clique que "não fazia nada".
    openUrl.mockResolvedValue(undefined);
    invoke.mockResolvedValue(status({ config: { enabled: true, bind: "127.0.0.1:47322", token: "abc123", serve: true },
      public_url: "https://pc.tail.ts.net", qr: "https://pc.tail.ts.net/#t=abc123" }));
    render(<MobileSettings />);

    const link = await screen.findByRole("button", { name: "https://pc.tail.ts.net" });
    await act(async () => { await userEvent.click(link); });
    expect(openUrl).toHaveBeenCalledWith("https://pc.tail.ts.net/");
    // O token nunca vai para o navegador do PC: ele é a credencial do celular.
    expect(openUrl).not.toHaveBeenCalledWith(expect.stringContaining("abc123"));
  });

  it("se o navegador não abrir, mostra o endereço para copiar", async () => {
    openUrl.mockRejectedValue(new Error("forbidden"));
    invoke.mockResolvedValue(status());
    render(<MobileSettings />);

    const link = await screen.findByRole("button", { name: "http://100.64.0.10:47322" });
    await act(async () => { await userEvent.click(link); });
    expect(await screen.findByText(/Não consegui abrir o navegador/)).toBeInTheDocument();
  });
});

describe("aba Celular: acesso pelo computador", () => {
  beforeEach(() => invoke.mockReset());

  it("deriva o link /pc do link do QR, com o mesmo token", () => {
    expect(linkDoPc("https://pc.tail.ts.net/#t=abc123")).toBe("https://pc.tail.ts.net/pc/#t=abc123");
    expect(linkDoPc("http://100.64.0.10:47322#t=abc")).toBe("http://100.64.0.10:47322/pc/#t=abc");
    expect(linkDoPc(null)).toBeNull();
    expect(linkDoPc("https://pc.tail.ts.net/?x=1")).toBeNull();
  });

  it("mostra o endereço do computador e copia o link com o acesso", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    invoke.mockImplementation(async (comando: string) => comando === "mobile_settings" ? status() : undefined);

    render(<MobileSettings />);

    expect(await screen.findByText("No notebook ou em outro computador")).toBeInTheDocument();
    // Na tela vai só o endereço; o token fica no que é copiado.
    expect(screen.getByText("http://100.64.0.10:47322/pc/")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copiar link do computador" }));
    expect(writeText).toHaveBeenCalledWith("http://100.64.0.10:47322/pc/#t=abc123");
    expect(screen.getByRole("button", { name: "Link do computador copiado" })).toBeInTheDocument();
  });
});

describe("aba Celular: QR com a cor do app", () => {
  /** Contraste WCAG entre duas cores hex. */
  function contraste(a: string, b: string) {
    const lum = (hex: string) => {
      const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [claro, escuro] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (claro + 0.05) / (escuro + 0.05);
  }

  it("toda paleta gera módulos legíveis para a câmera no fundo branco", () => {
    for (const paleta of PALETAS) {
      expect(contraste(corDoQr(paleta.id), "#FFFFFF"), paleta.id).toBeGreaterThanOrEqual(4.5);
    }
  });
});
