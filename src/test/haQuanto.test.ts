import { expect, it } from "vitest";
import { haQuanto } from "../mobile/MobileApp";

it("data curta: agora, minutos, hora de hoje, ontem, dia da semana e data", () => {
  const agora = new Date(2026, 9, 29, 15, 0).getTime();
  expect(haQuanto(agora - 20_000, agora)).toBe("agora");
  expect(haQuanto(agora - 12 * 60_000, agora)).toBe("12 min");
  expect(haQuanto(new Date(2026, 9, 29, 9, 5).getTime(), agora)).toBe("09:05");
  expect(haQuanto(new Date(2026, 9, 28, 23, 0).getTime(), agora)).toBe("ontem");
  expect(haQuanto(new Date(2026, 9, 26, 10, 0).getTime(), agora)).toBe("seg");
  expect(haQuanto(new Date(2026, 9, 2, 10, 0).getTime(), agora)).toBe("2 out");
  expect(haQuanto(new Date(2025, 11, 20).getTime(), agora)).toBe("20 dez 2025");
});
