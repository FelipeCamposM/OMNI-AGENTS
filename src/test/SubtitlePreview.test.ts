import { describe, it, expect } from "vitest";
import { ASS_ALTURA, escalaAss, medirQuadro } from "../components/SubtitlePreview";

/**
 * A escala é o que faz a prévia ser honesta: o ASS mede contra 1080 de altura e
 * o libass reescala para o vídeo real. Errar aqui faz o preview mentir em todo
 * vídeo que não seja 1080p — e o usuário só descobre depois de codificar.
 */
describe("medirQuadro", () => {
  it("vídeo mais largo que a caixa deixa barra em cima e embaixo", () => {
    // 16:9 dentro de uma caixa 4:3 → limita pela largura.
    const q = medirQuadro(1920, 1080, 800, 600)!;
    expect(q.w).toBe(800);
    expect(q.h).toBe(450);
    expect(q.top).toBe(75); // (600 - 450) / 2
  });

  it("vídeo vertical limita pela altura", () => {
    const q = medirQuadro(1080, 1920, 800, 600)!;
    expect(q.h).toBe(600);
    expect(q.w).toBeCloseTo(337.5);
    expect(q.top).toBe(0);
  });

  it("sem metadados ainda não mede", () => {
    // O <video> começa com videoWidth 0 — medir aí daria escala 0.
    expect(medirQuadro(0, 0, 800, 600)).toBeNull();
    expect(medirQuadro(1920, 1080, 0, 0)).toBeNull();
  });
});

describe("escalaAss", () => {
  it("quadro de 1080 é escala 1", () => {
    expect(escalaAss(ASS_ALTURA)).toBe(1);
  });

  it("quadro de 720 encolhe a fonte na mesma proporção", () => {
    const tamanhoNoAss = 64;
    expect(escalaAss(720)).toBeCloseTo(2 / 3);
    expect(tamanhoNoAss * escalaAss(720)).toBeCloseTo(42.67, 1);
  });

  it("a fonte na prévia acompanha o quadro medido", () => {
    // Ponta a ponta: vídeo 4K numa caixa de 800×600 → quadro de 450 de altura.
    const q = medirQuadro(3840, 2160, 800, 600)!;
    expect(64 * escalaAss(q.h)).toBeCloseTo(64 * (450 / 1080));
  });
});
