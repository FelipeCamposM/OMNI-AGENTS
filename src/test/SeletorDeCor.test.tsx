import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SeletorDeCor, hexParaHsv, hsvParaHex } from "../components/ui/SeletorDeCor";

describe("SeletorDeCor", () => {
  it("hex ↔ hsv ida e volta", () => {
    for (const c of ["#F97316", "#000000", "#FFFFFF", "#12AB34", "#A855F7"]) expect(hsvParaHex(hexParaHsv(c))).toBe(c);
  });

  it("abre o painel, aceita hex digitado (só hex) e fecha no Esc", () => {
    const mudou = vi.fn();
    render(<SeletorDeCor value="#F97316" onChange={mudou} rotulo="Outra cor" />);
    fireEvent.click(screen.getByRole("button", { name: "Outra cor" }));
    const campo = screen.getByLabelText("Cor em hexadecimal");
    fireEvent.change(campo, { target: { value: "#12zab34" } });
    expect(mudou).toHaveBeenLastCalledWith("#12AB34");
    fireEvent.keyDown(screen.getByRole("slider", { name: "Matiz" }), { key: "ArrowRight" });
    expect(mudou).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
