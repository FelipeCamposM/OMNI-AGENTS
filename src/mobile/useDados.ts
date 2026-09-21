import { useCallback, useEffect, useState } from "react";
import { ApiError, request, salvarToken, type Conversation, type Projects } from "./api";
import { aplicarTema, guardarTema, temaGuardado, type TemaPublicado } from "./tema";
import { usePoll } from "./usePoll";

/**
 * Estado que vem do PC: conversas, o que pede atenção, o catálogo de projetos e o tema.
 *
 * Extraído do `MobileApp` porque a página de computador (`src/web`) precisa exatamente do mesmo
 * carregamento — mesma API, mesmo poll, mesmo pareamento. O que muda entre as duas é só o layout.
 */
export function useDados() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [attention, setAttention] = useState<Conversation[]>([]);
  const [catalog, setCatalog] = useState<Projects | null>(null);
  const [carregado, setCarregado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sem acesso = o servidor respondeu 401. Acontece sempre na primeira abertura do app da tela
  // inicial do iPhone, que não enxerga o token que o QR gravou no Safari.
  const [semAcesso, setSemAcesso] = useState(false);
  // Começa pelo último tema recebido: a tela de pareamento e o primeiro quadro já saem com a cara do PC.
  const [tema, setTema] = useState<TemaPublicado | null>(() => temaGuardado());

  useEffect(() => aplicarTema(tema), [tema]);

  const refresh = useCallback(async () => {
    const [all, waiting, projetos] = await Promise.all([
      request<Conversation[]>("/conversas"),
      request<Conversation[]>("/atencao"),
      request<Projects>("/projetos"),
    ]);
    // Normaliza na entrada: um engine mais antigo (sem `/projetos`) ou uma resposta truncada
    // deixava `projects` indefinido, e um `.find` adiante derrubava a tela inteira — sem lista,
    // sem conversa, sem mensagem de erro. Confiar no formato aqui é o que deixa o resto simples.
    const novoTema = projetos?.theme && typeof projetos.theme === "object" ? projetos.theme : null;
    setCatalog({
      published_at_ms: Number(projetos?.published_at_ms) || 0,
      projects: Array.isArray(projetos?.projects) ? projetos.projects : [],
      agents: Array.isArray(projetos?.agents) ? projetos.agents : [],
      profiles: Array.isArray(projetos?.profiles) ? projetos.profiles : [],
      theme: novoTema,
    });
    if (novoTema) {
      guardarTema(novoTema);
      // Compara por valor: objeto novo a cada poll reaplicaria o tema (e o `matchMedia`) à toa.
      setTema((atual) => (JSON.stringify(atual) === JSON.stringify(novoTema) ? atual : novoTema));
    }
    setConversations(Array.isArray(all) ? all : []);
    setAttention(Array.isArray(waiting) ? waiting : []);
    setCarregado(true);
    setError(null);
  }, []);

  usePoll(
    refresh,
    (reason) => {
      if (reason instanceof ApiError && reason.status === 401) {
        setSemAcesso(true);
        return;
      }
      setError(String(reason));
    },
    [refresh]
  );

  const parear = useCallback(
    async (codigo: string) => {
      const { token } = await request<{ token: string }>("/parear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo }),
      });
      salvarToken(token);
      setSemAcesso(false);
      setError(null);
      await refresh();
    },
    [refresh]
  );

  const atualizar = useCallback(() => refresh().catch((reason) => setError(String(reason))), [refresh]);

  return { conversations, attention, catalog, carregado, error, semAcesso, refresh, atualizar, parear, setError };
}
