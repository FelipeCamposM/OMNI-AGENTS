import { expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ConversationDetail } from "../mobile/MobileApp";
import type { Conversation, Mensagem } from "../mobile/api";

const CONVERSA: Conversation = {
  id: "c", title: "Conversa", project_id: "p", provider: "claude", profile_id: "p", state: "answered", mode: "auto", live: true,
  capabilities: { prompt: true, approve: false, revision: '"r"', approval_text: null, reason: null },
};
const fala = (n: number, role: string, text: string): Mensagem => ({ id: `c:${n}`, role, text, provider: "claude" });

it("só a mensagem que chega com a conversa aberta entra animada", async () => {
  let mensagens = [fala(0, "assistant", "Já estava aqui")];
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    timeline: { messages: mensagens, next_cursor: null, prev_cursor: null, unavailable_segments: [] }, actions: [], conversation: CONVERSA,
  }))));
  window.HTMLElement.prototype.scrollTo = vi.fn() as never;
  render(<ConversationDetail conversation={CONVERSA} refresh={async () => undefined} />);
  expect((await screen.findByText("Já estava aqui")).closest(".bubble")).not.toHaveClass("entra");

  mensagens = [...mensagens, fala(1, "user", "Meu prompt"), fala(2, "assistant", "Resposta nova")];
  const nova = await screen.findByText((_, el) => el?.tagName === "P" && el.textContent === "Resposta nova", undefined, { timeout: 5000 });
  expect(nova.closest(".bubble")).toHaveClass("entra");
  // "Digitada": uma palavra por span, com atraso crescente, e o cursor no fim.
  const palavras = [...nova.closest(".bubble")!.querySelectorAll<HTMLElement>(".palavra")];
  expect(palavras.map((p) => p.textContent)).toEqual(["Resposta", "nova"]);
  expect(palavras[1].style.animationDelay).not.toBe(palavras[0].style.animationDelay);
  expect(nova.closest(".bubble")!.querySelector("p .digitando-cursor")).not.toBeNull();
  expect(screen.getByText("Já estava aqui").closest(".bubble")!.querySelector(".palavra")).toBeNull();
  // A fala do usuário troca o balão otimista, que já entrou: não anima de novo.
  expect(screen.getByText("Meu prompt").closest(".bubble")).not.toHaveClass("entra");
  await waitFor(() => expect(screen.getByText("Já estava aqui").closest(".bubble")).not.toHaveClass("entra"));
}, 8000);
