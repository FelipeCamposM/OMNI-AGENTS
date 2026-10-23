import { act, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { expect, it } from "vitest";
import { CursorNeon } from "../mobile/CursorNeon";

function Campo() {
  const campo = useRef<HTMLTextAreaElement>(null);
  return <><textarea ref={campo} defaultValue="olá mundo" /><CursorNeon campo={campo} valor="" /></>;
}

const quadro = () => act(() => new Promise((r) => requestAnimationFrame(() => r(undefined))));

it("aparece com o foco, some com seleção e ao sair do campo", async () => {
  const { container } = render(<Campo />);
  const campo = container.querySelector("textarea")!;
  expect(container.querySelector(".cursor-neon")).toBeNull();

  act(() => { campo.focus(); campo.setSelectionRange(3, 3); });
  fireEvent.keyUp(campo);
  await quadro();
  expect(container.querySelector(".cursor-neon")).not.toBeNull();

  act(() => campo.setSelectionRange(0, 3));
  fireEvent.select(campo);
  await quadro();
  expect(container.querySelector(".cursor-neon")).toBeNull();

  act(() => campo.blur());
  await quadro();
  expect(container.querySelector(".cursor-neon")).toBeNull();
});
