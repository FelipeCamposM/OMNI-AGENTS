import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { arrastarParaOrdenar } from "../lib/ordenarArrastando";

function Lista({ aoSoltar }: { aoSoltar: (id: string, antes: string | null) => void }) {
  return (
    <ul>
      {["a", "b", "c"].map((id) => (
        <li key={id} data-ordem="teste" data-ordem-id={id} onPointerDown={(e) => arrastarParaOrdenar(e, "teste", id, aoSoltar)}>
          item {id}
        </li>
      ))}
    </ul>
  );
}

// jsdom não tem PointerEvent: sem ele o `fireEvent` nem repassa `button`/`clientX`.
class PointerEventFalso extends MouseEvent {
  pointerId: number;
  constructor(tipo: string, init: PointerEventInit = {}) { super(tipo, init); this.pointerId = init.pointerId ?? 1; }
}
beforeAll(() => { if (!window.PointerEvent) window.PointerEvent = PointerEventFalso as unknown as typeof PointerEvent; });

const fantasma = () => document.querySelector<HTMLElement>(".ordenar-fantasma");
const mover = (x: number, y: number) => window.dispatchEvent(new PointerEvent("pointermove", { clientX: x, clientY: y, cancelable: true }));
const soltar = () => window.dispatchEvent(new PointerEvent("pointerup", { clientX: 0, clientY: 0 }));

afterEach(() => { document.body.innerHTML = ""; });

it("um fantasma do item segue o ponteiro e some ao soltar; a ordem muda", () => {
  const aoSoltar = vi.fn();
  render(<Lista aoSoltar={aoSoltar} />);
  const c = screen.getByText("item c");
  document.elementFromPoint = vi.fn(() => c);
  fireEvent.pointerDown(screen.getByText("item a"), { button: 0, clientX: 10, clientY: 10 });
  mover(12, 12);
  expect(fantasma()).toBeNull(); // menos de 6 px ainda é clique

  mover(40, 90);
  const copia = fantasma()!;
  expect(copia.textContent).toBe("item a");
  expect(copia.hasAttribute("data-ordem")).toBe(false); // não entra na conta da lista
  expect(copia.style.transform).toBe("translate(30px, 80px)"); // pego em (10, 10): o fantasma mantém esse ponto sob o mouse
  mover(50, 120);
  expect(copia.style.transform).toBe("translate(40px, 110px)");

  soltar();
  expect(fantasma()).toBeNull();
  expect(aoSoltar).toHaveBeenCalledWith("a", null);
});

it("Esc cancela: fantasma sai e nada muda de lugar", () => {
  const aoSoltar = vi.fn();
  render(<Lista aoSoltar={aoSoltar} />);
  document.elementFromPoint = vi.fn(() => screen.getByText("item c"));
  fireEvent.pointerDown(screen.getByText("item a"), { button: 0, clientX: 10, clientY: 10 });
  mover(40, 90);
  expect(fantasma()).not.toBeNull();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(fantasma()).toBeNull();
  soltar();
  expect(aoSoltar).not.toHaveBeenCalled();
});
