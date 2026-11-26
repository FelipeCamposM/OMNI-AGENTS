import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { Divisor, TamanhoDoTexto, useTamanhoSalvo } from "../features/roadmaps/Divisor";
import { useTransicao } from "../features/roadmaps/useTransicao";
import { animarCascata, animarTroca } from "../features/roadmaps/animacoes";
import { setMotionLevel } from "../lib/motion";

// jsdom não tem PointerEvent: um mínimo com clientX/pointerId, como o do WebKit.
if (typeof window.PointerEvent === "undefined") {
  class PointerEventDeTeste extends MouseEvent {
    pointerId: number;
    constructor(tipo: string, init: PointerEventInit = {}) { super(tipo, init); this.pointerId = init.pointerId ?? 1; }
  }
  (window as unknown as { PointerEvent: typeof PointerEventDeTeste }).PointerEvent = PointerEventDeTeste;
}

const animadas: Keyframe[][] = [];
const original = HTMLElement.prototype.animate;
beforeEach(() => {
  localStorage.clear();
  animadas.length = 0;
  HTMLElement.prototype.animate = function (k: Keyframe[] | PropertyIndexedKeyframes | null) {
    animadas.push(k as Keyframe[]);
    return { cancel() {}, onfinish: null, oncancel: null } as unknown as Animation;
  } as typeof HTMLElement.prototype.animate;
  setMotionLevel("completas");
});
afterEach(() => { HTMLElement.prototype.animate = original; setMotionLevel("completas"); });

describe("redimensionar", () => {
  function Painel() {
    const [largura, setLargura] = useTamanhoSalvo("teste", 500, 320, 900);
    return <><Divisor valor={largura} min={320} max={900} onChange={setLargura} cresce="esquerda" rotulo="Largura do painel" /><span data-testid="largura">{largura}</span></>;
  }

  it("setas mudam a largura dentro dos limites e o tamanho fica salvo para a próxima vez", () => {
    const { unmount } = render(<Painel />);
    const divisor = screen.getByRole("separator", { name: "Largura do painel" });
    fireEvent.keyDown(divisor, { key: "ArrowLeft" });
    expect(screen.getByTestId("largura")).toHaveTextContent("516");
    fireEvent.keyDown(divisor, { key: "ArrowRight", shiftKey: true });
    expect(screen.getByTestId("largura")).toHaveTextContent("452");
    for (let i = 0; i < 20; i++) fireEvent.keyDown(divisor, { key: "ArrowRight", shiftKey: true });
    expect(screen.getByTestId("largura")).toHaveTextContent("320");
    fireEvent.doubleClick(divisor);
    expect(screen.getByTestId("largura")).toHaveTextContent("610");
    unmount();
    render(<Painel />);
    expect(screen.getByTestId("largura")).toHaveTextContent("610");
  });

  it("arrastar esconde a página nativa (classe no body) e devolve no fim", () => {
    render(<Painel />);
    const divisor = screen.getByRole("separator", { name: "Largura do painel" });
    fireEvent.pointerDown(divisor, { button: 0, clientX: 100, pointerId: 1 });
    expect(document.body).toHaveClass("lateral-arrastando");
    fireEvent.pointerMove(divisor, { clientX: 40, pointerId: 1 });
    expect(screen.getByTestId("largura")).toHaveTextContent("560");
    fireEvent.pointerUp(divisor, { pointerId: 1 });
    expect(document.body).not.toHaveClass("lateral-arrastando");
  });

  it("A− e A+ param nos limites", () => {
    function Texto() { const [e, setE] = useState(1.45); return <><TamanhoDoTexto escala={e} onChange={setE} /><span data-testid="e">{e}</span></>; }
    render(<Texto />);
    fireEvent.click(screen.getByRole("button", { name: "Aumentar o texto" }));
    expect(screen.getByTestId("e")).toHaveTextContent("1.55");
    expect(screen.getByRole("button", { name: "Aumentar o texto" })).toBeDisabled();
  });
});

describe("transições", () => {
  function Tela({ chave, naPrimeira }: { chave: string; naPrimeira: boolean }) {
    const ref = useTransicao<HTMLDivElement>(chave, "frente", naPrimeira);
    return <div ref={ref}>{chave}</div>;
  }

  it("anima a troca, pode pular a primeira montagem e só usa opacity/transform", () => {
    const { rerender } = render(<Tela chave="a" naPrimeira={false} />);
    expect(animadas).toHaveLength(0);
    rerender(<Tela chave="b" naPrimeira={false} />);
    expect(animadas).toHaveLength(1);
    for (const quadro of animadas.flat()) expect(Object.keys(quadro).every((p) => p === "opacity" || p === "transform" || p === "offset")).toBe(true);
    render(<Tela chave="x" naPrimeira />);
    expect(animadas).toHaveLength(2);
  });

  it("movimento desligado: nada anima (troca nem cascata)", () => {
    setMotionLevel("desligadas");
    const el = document.createElement("div");
    expect(animarTroca(el, "frente")).toBeNull();
    expect(animarCascata([el, el])).toEqual([]);
    const { rerender } = render(<Tela chave="a" naPrimeira />);
    rerender(<Tela chave="b" naPrimeira />);
    expect(animadas).toHaveLength(0);
  });

  it("cascata limita a quantidade e espera a vez sem deixar estado pendurado", () => {
    const itens = Array.from({ length: 30 }, () => document.createElement("div"));
    expect(animarCascata(itens, 20, 5)).toHaveLength(5);
  });
});
