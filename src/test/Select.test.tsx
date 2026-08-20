import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Select } from "../components/ui/Select";

const OPCOES = [
  { value: "pt", label: "Português" },
  { value: "en", label: "Inglês" },
  { value: "es", label: "Espanhol", disabled: true },
  { value: "fr", label: "Francês" },
];

/** Envolve com estado para o valor realmente mudar, como no app. */
function Controlado({ onChange }: { onChange?: (v: string) => void }) {
  const [valor, setValor] = useState("pt");
  return (
    <Select
      value={valor}
      options={OPCOES}
      onChange={(v) => {
        setValor(v);
        onChange?.(v);
      }}
    />
  );
}

describe("Select", () => {
  it("mostra o rótulo do valor atual e abre a lista no clique", async () => {
    render(<Controlado />);
    const gatilho = screen.getByRole("combobox");

    expect(gatilho).toHaveTextContent("Português");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await userEvent.click(gatilho);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(gatilho).toHaveAttribute("aria-expanded", "true");
  });

  it("escolher uma opção troca o valor e fecha", async () => {
    const onChange = vi.fn();
    render(<Controlado onChange={onChange} />);

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByRole("option", { name: /inglês/i }));

    expect(onChange).toHaveBeenCalledWith("en");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveTextContent("Inglês");
  });

  it("navega e seleciona pelo teclado, pulando as desabilitadas", async () => {
    const onChange = vi.fn();
    render(<Controlado onChange={onChange} />);

    screen.getByRole("combobox").focus();
    await userEvent.keyboard("{ArrowDown}"); // abre, ativo = pt (selecionado)
    await userEvent.keyboard("{ArrowDown}"); // en
    await userEvent.keyboard("{ArrowDown}"); // pula "es" (disabled) → fr
    await userEvent.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("fr");
  });

  it("Esc fecha sem escolher", async () => {
    const onChange = vi.fn();
    render(<Controlado onChange={onChange} />);

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("marca a opção atual com aria-selected", async () => {
    render(<Controlado />);
    await userEvent.click(screen.getByRole("combobox"));

    expect(screen.getByRole("option", { name: /português/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByRole("option", { name: /inglês/i })).toHaveAttribute(
      "aria-selected",
      "false"
    );
  });
});

describe("Select com busca", () => {
  const FONTES = [
    { value: "Bebas Neue", label: "Bebas Neue", hint: "Condensada" },
    { value: "Anton", label: "Anton" },
    { value: "Segoe UI", label: "Segoe UI", hint: "Do sistema" },
    { value: "Verdana", label: "Verdana", hint: "Do sistema" },
  ];

  function Buscavel() {
    const [valor, setValor] = useState("Anton");
    return <Select searchable value={valor} options={FONTES} onChange={setValor} />;
  }

  it("filtra pelo rótulo", async () => {
    render(<Buscavel />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.type(screen.getByRole("textbox"), "seg");

    expect(screen.getByRole("option", { name: /segoe/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /anton/i })).not.toBeInTheDocument();
  });

  it("filtra também pela dica", async () => {
    render(<Buscavel />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.type(screen.getByRole("textbox"), "sistema");
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("Enter escolhe o primeiro resultado filtrado", async () => {
    render(<Buscavel />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.type(screen.getByRole("textbox"), "verd");
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("combobox")).toHaveTextContent("Verdana");
  });

  it("avisa quando nada casa", async () => {
    render(<Buscavel />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.type(screen.getByRole("textbox"), "zzzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/nada encontrado/i)).toBeInTheDocument();
  });

  it("reabrir começa com a lista inteira", async () => {
    // Reabrir com o filtro anterior esconderia a opção marcada e pareceria bug.
    render(<Buscavel />);
    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.type(screen.getByRole("textbox"), "verd");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.getAllByRole("option")).toHaveLength(FONTES.length);
  });

  it("sem `searchable` não existe campo de busca", async () => {
    render(<Controlado />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
