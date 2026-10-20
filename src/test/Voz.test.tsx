import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { Voz } from "../mobile/Composer";

// Dois trechos "falados" assim que a gravação começa — como se a pessoa tivesse pausado no meio.
vi.mock("../mobile/voz", async (original) => ({
  ...(await original<typeof import("../mobile/voz")>()),
  navegadorGrava: () => true,
  gravar: vi.fn(async (aoTrecho: (audio: Blob) => void) => {
    aoTrecho(new Blob(["1"]));
    aoTrecho(new Blob(["22"]));
    return { parar: vi.fn(), cancelar: vi.fn() };
  }),
}));

const { Composer } = await import("../mobile/Composer");
const { criarCortador } = await import("../mobile/voz");

function Teste({ voz }: { voz?: Voz }) {
  const [texto, setTexto] = useState("veja isso:");
  return <Composer texto={texto} onTexto={setTexto} anexos={[]} onAdicionar={vi.fn()} onRemover={vi.fn()}
    onEnviar={vi.fn()} podeEnviar ocupado={false} placeholder="msg" voz={voz} />;
}

const campo = () => (screen.getByLabelText("Sua resposta") as HTMLTextAreaElement).value;
const falar = async () => {
  await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Falar o prompt" })); });
  await act(async () => { await userEvent.click(screen.getByRole("button", { name: "Parar de gravar" })); });
};

describe("prompt por voz", () => {
  it("sem o modelo de voz baixado, o microfone não aparece", () => {
    render(<Teste />);
    expect(screen.queryByRole("button", { name: "Falar o prompt" })).not.toBeInTheDocument();
  });

  it("cada trecho entra no campo em ordem, e a correção troca só a fala — sem enviar", async () => {
    const transcrever = vi.fn(async (audio: Blob) => audio.size === 1 ? "abre o rudemap" : "e marca a tarefa");
    const corrigir = vi.fn(async (t: string) => t.replace("rudemap", "roadmap"));
    render(<Teste voz={{ transcrever, corrigir }} />);
    await falar();
    expect(transcrever).toHaveBeenCalledTimes(2);
    expect(corrigir).toHaveBeenCalledWith("abre o rudemap e marca a tarefa");
    expect(campo()).toBe("veja isso: abre o roadmap e marca a tarefa");
    expect(screen.getByRole("button", { name: "Falar o prompt" })).toBeInTheDocument();
  });

  it("falha na transcrição aparece e não mexe no texto", async () => {
    render(<Teste voz={{ transcrever: async () => { throw new Error("O modelo de voz não está baixado"); }, corrigir: async (t) => t }} />);
    await falar();
    expect(screen.getByRole("status")).toHaveTextContent("O modelo de voz não está baixado");
    expect(campo()).toBe("veja isso:");
  });
});

describe("corte da fala nas pausas", () => {
  const bloco = (volume: number, segundos: number) => new Float32Array(16_000 * segundos).fill(volume);

  it("silêncio puro nunca vira trecho", () => {
    const trechos: Float32Array[] = [];
    const c = criarCortador((t) => trechos.push(t));
    for (let i = 0; i < 10; i += 1) c.empurrar(bloco(0, 1));
    c.fim();
    expect(trechos).toHaveLength(0);
  });

  it("corta na pausa depois de falar, e o fim solta o resto", () => {
    const trechos: Float32Array[] = [];
    const c = criarCortador((t) => trechos.push(t));
    c.empurrar(bloco(0.2, 3));
    expect(trechos).toHaveLength(0);
    c.empurrar(bloco(0, 1)); // pausa de 1 s
    expect(trechos).toHaveLength(1);
    c.empurrar(bloco(0.2, 1));
    c.fim();
    expect(trechos).toHaveLength(2);
  });

  it("fala sem pausa é cortada em 20 s", () => {
    const trechos: Float32Array[] = [];
    const c = criarCortador((t) => trechos.push(t));
    for (let i = 0; i < 21; i += 1) c.empurrar(bloco(0.2, 1));
    expect(trechos).toHaveLength(1);
  });
});
