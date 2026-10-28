import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CheckIcon, ClockIcon, CloseIcon, CopyIcon } from "../../components/ui/PixelIcon";
import { motionOn } from "../../lib/motion";
import { SeletorDePrazo } from "./SeletorDePrazo";
import { request } from "../../mobile/api";

/** Uma tarefa sua — não do agente (essas moram no Kanban). */
export interface Todo {
  id: string;
  texto: string;
  feita: boolean;
  /** Prazo em ms (epoch). Ausente nas tarefas salvas antes de existir prazo. */
  prazo?: number | null;
}

const CHAVE = "omni-todo";

function lerTodos(): Todo[] {
  try {
    const salvos = JSON.parse(localStorage.getItem(CHAVE) ?? "[]");
    return Array.isArray(salvos) ? salvos : [];
  } catch {
    return [];
  }
}

/** "Agora", relido a cada 30 s: o que vence muda de grupo e de cor sem ninguém mexer. */
export function useAgora(intervalo = 30_000) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const relogio = window.setInterval(() => setAgora(Date.now()), intervalo);
    return () => window.clearInterval(relogio);
  }, [intervalo]);
  return agora;
}

const atrasada = (todo: Todo, agora: number) => !todo.feita && todo.prazo != null && todo.prazo < agora;

/** A lista do app ia só no localStorage dele; na primeira leitura do engine ela sobe uma vez. */
const CHAVE_LEVADA = "omni-todo-no-engine";
const RELER_MS = 5_000;

/**
 * Lista de tarefas pessoal, a mesma em todos os workspaces e projetos — e no app, na web e no celular:
 * mora no engine (`/tarefas`); o localStorage é só o cache para abrir sem esperar.
 */
export function useTodos() {
  const [todos, setTodosLocal] = useState<Todo[]>(lerTodos);
  const atuais = useRef(todos);
  // Mudança daqui ainda gravando: a releitura não pode trazer a lista velha de volta por cima.
  const gravando = useRef(0);
  const agora = useAgora();
  useEffect(() => {
    try { localStorage.setItem(CHAVE, JSON.stringify(todos)); } catch { /* sem armazenamento: vale só nesta sessão */ }
  }, [todos]);

  const gravar = (lista: Todo[]) => {
    gravando.current += 1;
    void request("/tarefas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(lista) })
      .catch(() => undefined)
      .finally(() => { gravando.current -= 1; });
  };

  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      if (gravando.current) return;
      try {
        const doEngine = await request<Todo[]>("/tarefas");
        if (!vivo || gravando.current || !Array.isArray(doEngine)
          || !doEngine.every((t) => typeof t?.id === "string" && typeof t?.texto === "string")) return;
        let levada = true;
        try { levada = localStorage.getItem(CHAVE_LEVADA) === "1"; localStorage.setItem(CHAVE_LEVADA, "1"); } catch { /* segue */ }
        if (!levada && doEngine.length === 0 && atuais.current.length > 0) { gravar(atuais.current); return; }
        if (JSON.stringify(doEngine) !== JSON.stringify(atuais.current)) { atuais.current = doEngine; setTodosLocal(doEngine); }
      } catch { /* engine fora: segue com o cache */ }
    };
    void ler();
    const relogio = window.setInterval(() => void ler(), RELER_MS);
    return () => { vivo = false; window.clearInterval(relogio); };
  }, []);

  const setTodos = (mudar: (atual: Todo[]) => Todo[]) => {
    const nova = mudar(atuais.current);
    atuais.current = nova;
    setTodosLocal(nova);
    gravar(nova);
  };
  return {
    todos,
    agora,
    pendentes: todos.filter((todo) => !todo.feita).length,
    atrasadas: todos.filter((todo) => atrasada(todo, agora)).length,
    adicionar: (texto: string, prazo: number | null = null) =>
      setTodos((atual) => [...atual, { id: `todo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, texto, feita: false, prazo }]),
    alternar: (id: string) => setTodos((atual) => atual.map((todo) => (todo.id === id ? { ...todo, feita: !todo.feita } : todo))),
    definirPrazo: (id: string, prazo: number | null) => setTodos((atual) => atual.map((todo) => (todo.id === id ? { ...todo, prazo } : todo))),
    remover: (id: string) => setTodos((atual) => atual.filter((todo) => todo.id !== id)),
    limparFeitas: () => setTodos((atual) => atual.filter((todo) => !todo.feita)),
  };
}

const DIA_MS = 24 * 60 * 60 * 1000;
const inicioDoDia = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const hora = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** "hoje 18:00", "amanhã 09:00", "qua, 23/10 09:00"; atrasada diz há quanto tempo. */
export function rotuloDoPrazo(prazo: number, agora: number): { texto: string; tom: "atrasada" | "hoje" | "futuro" } {
  const dias = Math.round((inicioDoDia(prazo) - inicioDoDia(agora)) / DIA_MS);
  if (prazo < agora) {
    const min = Math.floor((agora - prazo) / 60_000);
    const ha = min < 60 ? `${Math.max(1, min)} min` : min < 24 * 60 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / (24 * 60))} d`;
    return { texto: `atrasada há ${ha}`, tom: "atrasada" };
  }
  if (dias === 0) return { texto: `hoje ${hora(prazo)}`, tom: "hoje" };
  if (dias === 1) return { texto: `amanhã ${hora(prazo)}`, tom: "futuro" };
  const data = new Date(prazo).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
  return { texto: `${data} ${hora(prazo)}`, tom: "futuro" };
}

type Grupo = { chave: string; titulo: string; itens: Todo[] };

/** Atrasadas, hoje, próximas (por prazo), sem prazo, concluídas. */
function agrupar(todos: Todo[], agora: number): Grupo[] {
  const fimDeHoje = inicioDoDia(agora) + DIA_MS;
  const pendentes = todos.filter((t) => !t.feita);
  const porPrazo = (a: Todo, b: Todo) => (a.prazo ?? 0) - (b.prazo ?? 0);
  return [
    { chave: "atrasadas", titulo: "Atrasadas", itens: pendentes.filter((t) => atrasada(t, agora)).sort(porPrazo) },
    { chave: "hoje", titulo: "Hoje", itens: pendentes.filter((t) => t.prazo != null && t.prazo >= agora && t.prazo < fimDeHoje).sort(porPrazo) },
    { chave: "proximas", titulo: "Próximas", itens: pendentes.filter((t) => t.prazo != null && t.prazo >= fimDeHoje).sort(porPrazo) },
    { chave: "sem-prazo", titulo: "Sem prazo", itens: pendentes.filter((t) => t.prazo == null) },
    { chave: "feitas", titulo: "Concluídas", itens: todos.filter((t) => t.feita) },
  ].filter((g) => g.itens.length > 0);
}

/**
 * FLIP: cada tarefa que muda de lugar (concluiu, ganhou prazo, outra saiu de cima) desliza da posição
 * antiga para a nova em vez de saltar. Mede depois do render, compara com a medida anterior.
 */
function useDeslizarAoReordenar(container: React.RefObject<HTMLElement>, chave: unknown) {
  const antes = useRef(new Map<string, DOMRect>());
  useLayoutEffect(() => {
    const raiz = container.current;
    if (!raiz) return;
    const agora = new Map<string, DOMRect>();
    raiz.querySelectorAll<HTMLElement>("[data-tarefa]").forEach((el) => {
      const rect = el.getBoundingClientRect();
      agora.set(el.dataset.tarefa!, rect);
      const antiga = antes.current.get(el.dataset.tarefa!);
      if (!antiga || !motionOn() || !el.animate) return;
      const dy = antiga.top - rect.top;
      if (Math.abs(dy) < 1) return;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 260, easing: "cubic-bezier(.2, .8, .3, 1)" });
    });
    antes.current = agora;
  }, [container, chave]);
}

export function TodoList({ todos, agora, adicionar, alternar, definirPrazo, remover, limparFeitas }: ReturnType<typeof useTodos>) {
  const [texto, setTexto] = useState("");
  const [prazoNovo, setPrazoNovo] = useState<number | null>(null);
  /** Qual seletor de prazo está aberto: `"nova"` (o do campo) ou o id de uma tarefa. */
  const [seletor, setSeletor] = useState<string | null>(null);
  /** Tarefas apagadas ainda em animação de saída. */
  const [saindo, setSaindo] = useState<Set<string>>(new Set());
  const listaRef = useRef<HTMLDivElement>(null);
  const grupos = agrupar(todos, agora);
  const feitas = todos.filter((t) => t.feita).length;
  useDeslizarAoReordenar(listaRef, grupos.map((g) => `${g.chave}:${g.itens.map((t) => t.id).join(",")}`).join("|"));

  /** Tarefa cujo texto acabou de ir para a área de transferência: o ícone vira ✓ por 1,2 s. */
  const [copiada, setCopiada] = useState<string | null>(null);
  async function copiar(todo: Todo) {
    try { await navigator.clipboard.writeText(todo.texto); } catch { return; }
    setCopiada(todo.id);
    window.setTimeout(() => setCopiada((atual) => (atual === todo.id ? null : atual)), 1200);
  }

  function apagar(id: string) {
    if (!motionOn()) { remover(id); return; }
    setSaindo((atual) => new Set(atual).add(id));
    window.setTimeout(() => {
      remover(id);
      setSaindo((atual) => { const resto = new Set(atual); resto.delete(id); return resto; });
    }, 200);
  }

  return (
    <div className="tarefas-corpo">
      <form
        className="tarefas-nova"
        onSubmit={(evento) => {
          evento.preventDefault();
          const limpo = texto.trim();
          if (!limpo) return;
          adicionar(limpo, prazoNovo);
          setTexto("");
          setPrazoNovo(null);
        }}
      >
        <input
          type="text"
          value={texto}
          onChange={(evento) => setTexto(evento.target.value)}
          placeholder="Nova tarefa… (Enter)"
          aria-label="Nova tarefa"
          className="tarefas-campo"
        />
        <span className="relative">
          <button type="button" className={`tarefas-prazo-botao${prazoNovo != null ? " tarefas-prazo-botao-ativo" : ""}`}
            aria-label={prazoNovo != null ? `Prazo: ${rotuloDoPrazo(prazoNovo, agora).texto}` : "Definir prazo"}
            aria-expanded={seletor === "nova"} onClick={() => setSeletor(seletor === "nova" ? null : "nova")}>
            <ClockIcon className="h-3.5 w-3.5" aria-hidden />
            {prazoNovo != null && <span>{rotuloDoPrazo(prazoNovo, agora).texto}</span>}
          </button>
          {seletor === "nova" && (
            <SeletorDePrazo valor={prazoNovo} agora={agora} onFechar={() => setSeletor(null)}
              onEscolher={(prazo) => { setPrazoNovo(prazo); setSeletor(null); }} />
          )}
        </span>
      </form>

      <div ref={listaRef} className="tarefas-lista">
        {grupos.length === 0 && <p className="tarefas-vazio">Nenhuma tarefa. Escreva acima e aperte Enter.</p>}
        {grupos.map((grupo) => (
          <section key={grupo.chave} className="tarefas-grupo" data-grupo={grupo.chave} aria-label={grupo.titulo}>
            <header className="tarefas-grupo-titulo">
              <span>{grupo.titulo}</span>
              <span className="tarefas-grupo-conta">{grupo.itens.length}</span>
              {grupo.chave === "feitas" && (
                <button type="button" onClick={limparFeitas} className="tarefas-limpar">
                  Limpar {feitas} {feitas === 1 ? "concluída" : "concluídas"}
                </button>
              )}
            </header>
            <ul>
              {grupo.itens.map((todo) => {
                const prazo = todo.prazo != null ? rotuloDoPrazo(todo.prazo, agora) : null;
                return (
                  <li key={todo.id} data-tarefa={todo.id}
                    className={`tarefa${todo.feita ? " tarefa-feita" : ""}${saindo.has(todo.id) ? " tarefa-saindo" : ""}`}
                    data-tom={todo.feita ? undefined : prazo?.tom}>
                    <label className="tarefa-marca">
                      <input type="checkbox" checked={todo.feita} onChange={() => alternar(todo.id)} className="peer sr-only" />
                      <span aria-hidden className="tarefa-caixa"><CheckIcon className="h-2.5 w-2.5" /></span>
                      <span className="tarefa-texto">{todo.texto}</span>
                    </label>
                    {!todo.feita && (
                      <span className="relative shrink-0">
                        <button type="button" className={`tarefa-prazo${prazo ? "" : " tarefa-prazo-vazio"}`}
                          aria-label={prazo ? `Prazo de ${todo.texto}: ${prazo.texto}. Alterar` : `Definir prazo de ${todo.texto}`}
                          aria-expanded={seletor === todo.id} onClick={() => setSeletor(seletor === todo.id ? null : todo.id)}>
                          <ClockIcon className="h-3 w-3" aria-hidden />
                          {prazo && <span>{prazo.texto}</span>}
                        </button>
                        {seletor === todo.id && (
                          <SeletorDePrazo valor={todo.prazo ?? null} agora={agora} onFechar={() => setSeletor(null)}
                            onEscolher={(novo) => { definirPrazo(todo.id, novo); setSeletor(null); }} />
                        )}
                      </span>
                    )}
                    <button type="button" aria-label={copiada === todo.id ? "Copiado" : `Copiar texto da tarefa ${todo.texto}`}
                      title={copiada === todo.id ? "Copiado" : "Copiar texto"} onClick={() => void copiar(todo)}
                      className={`tarefa-copiar${copiada === todo.id ? " tarefa-copiada" : ""}`}>
                      {copiada === todo.id ? <CheckIcon className="h-3 w-3" aria-hidden /> : <CopyIcon className="h-3 w-3" aria-hidden />}
                    </button>
                    <button type="button" aria-label={`Apagar tarefa ${todo.texto}`} title="Apagar" onClick={() => apagar(todo.id)} className="tarefa-apagar">
                      <CloseIcon className="h-3 w-3" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
