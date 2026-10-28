import { expect, it } from "vitest";
import { conversasDoProjeto } from "../features/fluxos/fluxosService";

it("base do fluxo: só conversas do projeto aberto, sem as ocultas, mais recentes primeiro", () => {
  const conversas = [
    { id: "a", title: "Velha", project_id: "p1", updated_at_ms: 1 },
    { id: "b", title: "Outro projeto", project_id: "p2", updated_at_ms: 9 },
    { id: "c", title: "Release", project_id: "p1", updated_at_ms: 5 },
    { id: "d", title: "Oculta", project_id: "p1", updated_at_ms: 7, hidden: true },
  ];
  const projetos = [{ id: "p1", path: "D:\\Proj\\App\\" }, { id: "p2", path: "D:/Outro" }];
  expect(conversasDoProjeto(conversas, projetos, "d:/proj/app").map((c) => c.id)).toEqual(["c", "a"]);
  expect(conversasDoProjeto(conversas, projetos, null).map((c) => c.id)).toEqual(["b", "c", "a"]);
  expect(conversasDoProjeto(conversas, projetos, "C:/sem-registro")).toEqual([]);
});
