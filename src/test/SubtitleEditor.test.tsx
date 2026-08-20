import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubtitleEditor } from "../components/SubtitleEditor";
import type { SubtitleSegment } from "../services/conversionService";

const BLOCOS: SubtitleSegment[] = [
  { start: 0, end: 2, text: "A transclica roda local" },
  { start: 2.5, end: 4, text: "sem enviar nada" },
];

describe("SubtitleEditor", () => {
  it("não renderiza nada sem blocos", () => {
    const { container } = render(<SubtitleEditor segments={[]} onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("mostra um campo por bloco com o texto atual", () => {
    render(<SubtitleEditor segments={BLOCOS} onChange={vi.fn()} />);
    expect(screen.getByText(/2 bloco\(s\)/)).toBeInTheDocument();
    expect(screen.getByLabelText("Texto do bloco 1")).toHaveValue("A transclica roda local");
    expect(screen.getByLabelText("Texto do bloco 2")).toHaveValue("sem enviar nada");
  });

  it("corrigir a grafia devolve o bloco alterado e preserva os demais", async () => {
    const onChange = vi.fn();
    render(<SubtitleEditor segments={BLOCOS} onChange={onChange} />);

    // userEvent digita caractere a caractere; o componente é controlado, então
    // cada tecla emite um onChange. Interessa a última chamada.
    await userEvent.type(screen.getByLabelText("Texto do bloco 1"), "!");

    const ultimo = onChange.mock.calls.at(-1)![0] as SubtitleSegment[];
    expect(ultimo[0].text).toBe("A transclica roda local!");
    expect(ultimo[1]).toEqual(BLOCOS[1]);
  });

  it("deslocar move início e fim juntos, mantendo a duração", async () => {
    const onChange = vi.fn();
    render(<SubtitleEditor segments={BLOCOS} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText("Atrasar o bloco 1"));

    const [novo] = onChange.mock.calls.at(-1)! as [SubtitleSegment[]];
    expect(novo[0].start).toBeCloseTo(0.1);
    expect(novo[0].end).toBeCloseTo(2.1);
  });

  it("não deixa o bloco começar antes de zero", async () => {
    const onChange = vi.fn();
    render(<SubtitleEditor segments={BLOCOS} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText("Adiantar o bloco 1"));

    const [novo] = onChange.mock.calls.at(-1)! as [SubtitleSegment[]];
    expect(novo[0].start).toBe(0);
  });

  it("respeita a duração da mídia ao atrasar", async () => {
    const onChange = vi.fn();
    render(<SubtitleEditor segments={BLOCOS} onChange={onChange} duracao={2.05} />);

    await userEvent.click(screen.getByLabelText("Atrasar o bloco 1"));

    const [novo] = onChange.mock.calls.at(-1)! as [SubtitleSegment[]];
    expect(novo[0].end).toBeLessThanOrEqual(2.05);
  });

  it("remover tira só o bloco escolhido", async () => {
    const onChange = vi.fn();
    render(<SubtitleEditor segments={BLOCOS} onChange={onChange} />);

    await userEvent.click(screen.getByLabelText("Remover o bloco 1"));

    const [novo] = onChange.mock.calls.at(-1)! as [SubtitleSegment[]];
    expect(novo).toHaveLength(1);
    expect(novo[0].text).toBe("sem enviar nada");
  });

  it("ouvir leva o vídeo ao início do bloco", async () => {
    const onSeek = vi.fn();
    render(<SubtitleEditor segments={BLOCOS} onChange={vi.fn()} onSeek={onSeek} />);

    await userEvent.click(screen.getByLabelText("Ouvir o bloco 2"));

    expect(onSeek).toHaveBeenCalledWith(2.5);
  });

  it("avisa quando o texto editado invalida o tempo por palavra", () => {
    // Contagem de palavras diferente da lista de `words` = karaokê aproximado.
    render(
      <SubtitleEditor
        segments={[
          {
            start: 0,
            end: 2,
            text: "a transcrição roda",
            words: [{ start: 0, end: 2, word: "transclica" }],
          },
        ]}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText(/recalculado a partir do texto novo/i)).toBeInTheDocument();
  });

  it("não avisa quando a contagem de palavras ainda casa", () => {
    render(
      <SubtitleEditor
        segments={[
          {
            start: 0,
            end: 2,
            text: "transcrição",
            words: [{ start: 0, end: 2, word: "transclica" }],
          },
        ]}
        onChange={vi.fn()}
      />
    );
    expect(screen.queryByText(/recalculado a partir do texto novo/i)).not.toBeInTheDocument();
  });
});
