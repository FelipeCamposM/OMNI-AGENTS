import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { buscar, SettingsSearch } from "../components/SettingsSearch";
import { GearIcon } from "../components/ui/PixelIcon";

const SECOES = [
  { id: "geral", label: "Geral", desc: "Conversa ou terminal, arquivos e avisos", icon: GearIcon },
  { id: "aparencia", label: "Aparência", desc: "Tema, cor, fundo e animações", icon: GearIcon },
];

it("acha por sinônimo, sem acento, e o título vem antes do sinônimo", () => {
  expect(buscar("notificacao", SECOES).map((a) => a.item.titulo)).toContain("Agente pedindo atenção");
  expect(buscar("dark", SECOES)[0].item.titulo).toBe("Tema");
  expect(buscar("fundo", SECOES)[0].item.titulo).toMatch(/^Fundo/);
  expect(buscar("", SECOES)).toEqual([]);
  // Item de seção que não está no menu não aparece.
  expect(buscar("authy", SECOES)).toEqual([]);
});

it("setas e Enter levam ao resultado; sem resultado mostra o aviso", () => {
  const onIr = vi.fn();
  render(<SettingsSearch secoes={SECOES} onIr={onIr} />);
  const campo = screen.getByRole("combobox", { name: "Buscar nas configurações" });
  fireEvent.change(campo, { target: { value: "xyzw" } });
  expect(screen.getByText(/Nada encontrado/)).toBeInTheDocument();

  fireEvent.change(campo, { target: { value: "tema" } });
  expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
  fireEvent.keyDown(campo, { key: "Enter" });
  expect(onIr).toHaveBeenCalledWith(expect.objectContaining({ item: expect.objectContaining({ titulo: "Tema" }) }));
});
