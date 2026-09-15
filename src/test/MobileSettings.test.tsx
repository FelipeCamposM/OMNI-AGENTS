import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileSettings } from "../features/mobile/MobileSettings";

const invoke = vi.mocked((await import("@tauri-apps/api/core")).invoke);

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
