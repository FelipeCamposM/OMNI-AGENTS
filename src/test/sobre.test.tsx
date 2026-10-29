import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SettingsView } from "../components/SettingsView";
import { DEFAULT_SETTINGS } from "../types/settings";
import { CHANGELOG } from "../lib/changelog";

/** "O restaurar configurações padrão tem um modal de confirmação? Se não tiver, coloque." */
it("restaurar configurações padrão pede confirmação antes", async () => {
  const onReset = vi.fn();
  render(<SettingsView settings={{ ...DEFAULT_SETTINGS }} onChange={vi.fn()} onReset={onReset} initialSection="sobre" onClose={vi.fn()} />);

  fireEvent.click(await screen.findByRole("button", { name: "Restaurar configurações padrão" }));
  expect(screen.getByRole("dialog", { name: "Restaurar configurações padrão?" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(onReset).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Restaurar configurações padrão" }));
  fireEvent.click(screen.getByRole("button", { name: "Restaurar padrão" }));
  expect(onReset).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
});

/** "Deixe exibido apenas as notas da versão vigente; se quiser, seleciona noutra num select com pesquisa." */
it("Sobre mostra uma versão por vez e troca pelo seletor com busca", async () => {
  render(<SettingsView settings={{ ...DEFAULT_SETTINGS }} onChange={vi.fn()} onReset={vi.fn()} initialSection="sobre" onClose={vi.fn()} />);
  const [atual, antiga] = CHANGELOG;
  expect(await screen.findByRole("heading", { name: `Versão ${atual.version}` })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: `Versão ${antiga.version}` })).toBeNull();

  fireEvent.click(screen.getByRole("combobox", { name: "Ver notas de outra versão" }));
  fireEvent.change(screen.getByPlaceholderText("Buscar versão ou data…"), { target: { value: antiga.version } });
  fireEvent.click(screen.getByRole("option", { name: (nome) => nome.startsWith(`Versão ${antiga.version}`) }));
  expect(screen.getByRole("heading", { name: `Versão ${antiga.version}` })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: `Versão ${atual.version}` })).toBeNull();
});
