import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { Armazenamento, tamanho } from "../features/armazenamento/Armazenamento";
import { request } from "../mobile/api";

vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn(async () => undefined) }));
vi.mock("../mobile/api", async (original) => ({ ...(await original<typeof import("../mobile/api")>()), request: vi.fn() }));

const limpezaVazia = { ajuste: { automatica: false, dias: 60 }, sugestoes: [], ultima: null };
beforeEach(() => { vi.mocked(request).mockReset().mockResolvedValue(limpezaVazia); });

const MB = 1024 * 1024;
const conversa = (titulo: string | null, arquivo: string, bytes: number) => ({ titulo, arquivo, caminho: `C:/x/${arquivo}`, bytes, modificado_ms: 0 });

it("mostra total, por IA, por conta e as maiores conversas, avisando a cópia em outra conta", async () => {
  vi.mocked(invoke).mockReset().mockImplementation(async (comando) => {
    if (comando !== "armazenamento") return null;
    return {
      bytes: 700 * MB,
      contas: [
        { provider: "claude", conta_id: "e", conta_nome: "EmailUber", caminho: "C:/e", bytes: 400 * MB, conversas: 2,
          partes: [{ nome: "Conversas", bytes: 380 * MB, arquivos: 9 }, { nome: "Histórico de edições", bytes: 20 * MB, arquivos: 3 }],
          maiores: [conversa("PRINCIPAL", "9fa.jsonl", 299 * MB)] },
        { provider: "claude", conta_id: "p", conta_nome: "Padrão", caminho: "C:/p", bytes: 297 * MB, conversas: 1,
          partes: [{ nome: "Conversas", bytes: 297 * MB, arquivos: 1 }], maiores: [conversa("PRINCIPAL", "9fa.jsonl", 297 * MB)] },
        { provider: "codex", conta_id: "c", conta_nome: "Padrão", caminho: "C:/c", bytes: 3 * MB, conversas: 1,
          partes: [{ nome: "Conversas", bytes: 3 * MB, arquivos: 1 }], maiores: [conversa(null, "rollout-1.jsonl", 3 * MB)] },
      ],
    };
  });
  render(<Armazenamento />);

  expect(await screen.findByText("700 MB")).toBeInTheDocument();
  expect(screen.getByText("697 MB")).toBeInTheDocument(); // Claude somando as duas contas
  expect(screen.getAllByText("PRINCIPAL")).toHaveLength(2);
  expect(screen.getByText(/também em Padrão/)).toBeInTheDocument();
  expect(screen.getByText("rollout-1.jsonl")).toBeInTheDocument(); // sem nome no OMNI: o arquivo
  expect(screen.getByText("Histórico de edições")).toBeInTheDocument();
});

it("sugere limpar as paradas há 30 e 60 dias, pede confirmação e liga a limpeza automática", async () => {
  vi.mocked(invoke).mockReset().mockResolvedValue({ bytes: 0, contas: [] });
  const antiga = { provider: "codex", id: "019a", titulo: "Revisão velha", contas: ["Padrão"], bytes: 18 * MB, usada_ms: 0 };
  vi.mocked(request).mockImplementation(async (caminho, init) => {
    if (caminho === "/limpeza/agora") return { conversas: 1, bytes: 18 * MB, erros: [] };
    if (caminho === "/limpeza" && init?.method === "POST") return JSON.parse(String(init.body));
    return { ajuste: { automatica: false, dias: 60 }, ultima: null, sugestoes: [
      { dias: 30, conversas: 1, bytes: 18 * MB, lista: [antiga] },
      { dias: 60, conversas: 0, bytes: 0, lista: [] },
      { dias: 90, conversas: 0, bytes: 0, lista: [] },
    ] };
  });
  render(<Armazenamento />);

  expect(await screen.findByText("Revisão velha")).toBeInTheDocument();
  expect(screen.getByText(/nenhuma conversa/)).toBeInTheDocument(); // 60 dias
  expect(screen.queryByText(/90 dias/)).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /Limpar 18 MB/ }));
  expect(request).not.toHaveBeenCalledWith("/limpeza/agora", expect.anything()); // só depois de confirmar
  await userEvent.click(screen.getByRole("button", { name: "Apagar" }));
  expect(request).toHaveBeenCalledWith("/limpeza/agora", expect.objectContaining({ body: JSON.stringify({ dias: 30 }) }));
  expect(await screen.findByText(/1 conversa apagada, 18 MB liberados/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Sem uso há 30 dias" }));
  expect(request).toHaveBeenCalledWith("/limpeza", expect.objectContaining({ body: JSON.stringify({ automatica: true, dias: 30 }) }));
});

it("formata tamanhos em pt-BR", () => {
  expect(tamanho(512)).toBe("512 B");
  expect(tamanho(1536)).toBe("1,5 KB");
  expect(tamanho(1.77 * 1024 ** 3)).toBe("1,8 GB");
});
