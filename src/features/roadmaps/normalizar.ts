/**
 * Fork (Roadmaps): tudo que entra (resposta da IA ou arquivo lido do disco) passa por aqui e sai no
 * formato de `tipos.ts`. Campo estranho é descartado, faltando vira padrão, id inválido é refeito.
 * Nunca lança: arquivo meio quebrado ainda mostra o que dá para mostrar.
 */
import {
  CORES, CORES_ANTIGAS, ICONES, VERSAO_DOS_ARQUIVOS,
  type CardDeRevisao, type Cards, type EntrevistaSalva, type Etapa, type FaseDoRoadmap, type Fonte, type IaEscolhida,
  type MensagemDaEntrevista, type MensagemDoPainel, type MetaDoRoadmap, type Modulo, type Plano, type Progresso,
  type RevisaoFeita, type TarefaExtra, type TipoDeFonte,
} from "./tipos";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texto = (v: unknown, max = 4000): string => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
const numero = (v: unknown, padrao: number, min: number, max: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : padrao;
};
const real = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const iso = (v: unknown, padrao: string): string => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : padrao);

/** Mesmo critério do Rust (`armazenamento::id_valido`): vira nome de arquivo `etapas/<id>.md`. */
export function idValido(id: unknown): id is string {
  return typeof id === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

function slug(base: string): string {
  return base.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/** Id único: o que veio (se válido e livre), senão um derivado do título. */
function idUnico(pedido: unknown, titulo: string, prefixo: string, usados: Set<string>): string {
  let id = idValido(pedido) && !usados.has(pedido) ? pedido : `${prefixo}-${slug(titulo) || "x"}`.slice(0, 56);
  if (usados.has(id)) { let n = 2; while (usados.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
  usados.add(id);
  return id;
}

const TIPOS: Record<string, TipoDeFonte> = {
  artigo: "artigo", article: "artigo", blog: "artigo", texto: "artigo", documentacao: "artigo", docs: "artigo",
  video: "video", "vídeo": "video", youtube: "video", curso: "curso", course: "curso", livro: "livro", book: "livro",
  podcast: "podcast", ferramenta: "ferramenta", tool: "ferramenta", app: "ferramenta",
};

export function urlSegura(v: unknown): string | null {
  const bruto = texto(v, 2000);
  try {
    const url = new URL(bruto);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch { return null; }
}

export function normalizarFonte(v: unknown): Fonte | null {
  const o = obj(v);
  const url = urlSegura(o.url ?? o.link);
  const titulo = texto(o.titulo ?? o.title, 200);
  if (!url || !titulo) return null;
  const tipo = TIPOS[texto(o.tipo ?? o.type).toLowerCase()] ?? "outro";
  const pago = o.gratis === false || o.pago === true || o.paid === true || texto(o.preco ?? o.custo).toLowerCase().startsWith("pago");
  const fonte: Fonte = { titulo, url, tipo, gratis: !pago };
  const autor = texto(o.autor ?? o.author, 120); if (autor) fonte.autor = autor;
  const nota = texto(o.nota ?? o.porque ?? o.note, 300); if (nota) fonte.nota = nota;
  return fonte;
}

export function normalizarTarefas(v: unknown, usados = new Set<string>()): TarefaExtra[] {
  return lista(v).map((t) => {
    const o = typeof t === "string" ? { texto: t } : obj(t);
    const conteudo = texto(o.texto ?? o.tarefa ?? o.text, 600);
    if (!conteudo) return null;
    return { id: idUnico(o.id, conteudo, "t", usados), texto: conteudo, feita: o.feita === true };
  }).filter((t): t is TarefaExtra => t !== null).slice(0, 40);
}

function normalizarEtapa(v: unknown, usados: Set<string>): Etapa | null {
  const o = obj(v);
  const titulo = texto(o.titulo ?? o.title, 140);
  if (!titulo) return null;
  const etapa: Etapa = {
    id: idUnico(o.id, titulo, "e", usados),
    titulo,
    objetivo: texto(o.objetivo ?? o.descricao, 600),
    minutos: numero(o.minutos, 20, 5, 240),
    tarefa: texto(o.tarefa, 1200),
    fontes: lista(o.fontes).map(normalizarFonte).filter((f): f is Fonte => f !== null).slice(0, 12),
    tarefas: normalizarTarefas(o.tarefas),
  };
  if (o.preparada === true) etapa.preparada = true;
  return etapa;
}

/** Plano da IA ou de `plano.json`. `null` se não sobrar nenhuma etapa. */
export function normalizarPlano(v: unknown): Plano | null {
  const o = obj(obj(v).plano && !obj(v).modulos ? obj(v).plano : v);
  const usados = new Set<string>();
  const modulos: Modulo[] = lista(o.modulos).map((m) => {
    const mo = obj(m);
    const titulo = texto(mo.titulo ?? mo.title, 140);
    const etapas = lista(mo.etapas).map((e) => normalizarEtapa(e, usados)).filter((e): e is Etapa => e !== null).slice(0, 60);
    if (!titulo || etapas.length === 0) return null;
    return { id: idUnico(mo.id, titulo, "m", usados), titulo, descricao: texto(mo.descricao, 600), etapas };
  }).filter((m): m is Modulo => m !== null).slice(0, 30);
  if (modulos.length === 0) return null;
  const plano: Plano = { versao: VERSAO_DOS_ARQUIVOS, objetivo: texto(o.objetivo, 400), visao: texto(o.visao ?? o.resumo, 800), modulos };
  const prazo = texto(o.prazo, 120); if (prazo) plano.prazo = prazo;
  if (o.minutosPorDia !== undefined) plano.minutosPorDia = numero(o.minutosPorDia, 30, 5, 480);
  return plano;
}

const ESTADOS = new Set(["andamento", "concluida"]);
const DIA = /^\d{4}-\d{2}-\d{2}$/;

export function normalizarProgresso(v: unknown): Progresso {
  const o = obj(v);
  const etapas: Progresso["etapas"] = {};
  for (const [id, bruto] of Object.entries(obj(o.etapas))) {
    const e = obj(bruto);
    if (!idValido(id) || !ESTADOS.has(e.estado as string)) continue;
    etapas[id] = { estado: e.estado as "andamento" | "concluida" };
    if (typeof e.inicio === "string") etapas[id].inicio = e.inicio;
    if (typeof e.fim === "string") etapas[id].fim = e.fim;
  }
  const dias = [...new Set(lista(o.dias).filter((d): d is string => typeof d === "string" && DIA.test(d)))].sort();
  return { versao: VERSAO_DOS_ARQUIVOS, etapas, dias };
}

export function normalizarCards(v: unknown): Cards {
  const o = obj(v);
  const usados = new Set<string>();
  const cards = lista(o.cards).map((c): CardDeRevisao | null => {
    const co = obj(c);
    const frente = texto(co.frente, 2000), verso = texto(co.verso, 4000);
    const f = obj(co.fsrs);
    if (!frente || !verso || typeof f.due !== "string" || Number.isNaN(Date.parse(f.due))) return null;
    return {
      id: idUnico(co.id, frente, "c", usados),
      etapaId: idValido(co.etapaId) ? co.etapaId : "",
      frente, verso,
      criadoEm: iso(co.criadoEm, f.due),
      fsrs: {
        due: f.due,
        stability: real(f.stability),
        difficulty: real(f.difficulty),
        elapsed_days: real(f.elapsed_days),
        scheduled_days: real(f.scheduled_days),
        learning_steps: real(f.learning_steps),
        reps: numero(f.reps, 0, 0, 1e6),
        lapses: numero(f.lapses, 0, 0, 1e6),
        state: numero(f.state, 0, 0, 3),
        last_review: typeof f.last_review === "string" ? f.last_review : null,
      },
    };
  }).filter((c): c is CardDeRevisao => c !== null);
  const revisoes = lista(o.revisoes).map((r): RevisaoFeita | null => {
    const ro = obj(r);
    const nota = ro.nota;
    if (typeof ro.cardId !== "string" || (nota !== 1 && nota !== 2 && nota !== 3 && nota !== 4) || typeof ro.em !== "string") return null;
    return { cardId: ro.cardId, nota, em: ro.em };
  }).filter((r): r is RevisaoFeita => r !== null);
  return { versao: VERSAO_DOS_ARQUIVOS, cards, revisoes };
}

const FASES = new Set<FaseDoRoadmap>(["entrevista", "plano", "ativo"]);

export function normalizarIa(v: unknown): IaEscolhida {
  const o = obj(v);
  const ia: IaEscolhida = { cli: o.cli === "codex" ? "codex" : "claude" };
  if (typeof o.conta === "string" && o.conta) ia.conta = o.conta;
  if (typeof o.modelo === "string" && o.modelo) ia.modelo = o.modelo;
  return ia;
}

function corViva(v: unknown): string {
  if (typeof v !== "string" || !/^#[0-9a-f]{6}$/i.test(v)) return CORES[0];
  const antiga = (CORES_ANTIGAS as readonly string[]).indexOf(v.toLowerCase());
  return antiga >= 0 ? CORES[antiga] : v;
}

export function normalizarMeta(id: string, v: unknown, agora = new Date().toISOString()): MetaDoRoadmap {
  const o = obj(v);
  const r = obj(o.resumo);
  return {
    versao: typeof o.versao === "number" ? o.versao : VERSAO_DOS_ARQUIVOS,
    id,
    nome: texto(o.nome, 80) || "Roadmap sem nome",
    cor: corViva(o.cor),
    icone: (ICONES as readonly string[]).includes(o.icone as string) ? (o.icone as string) : "livro",
    arquivado: o.arquivado === true,
    fase: FASES.has(o.fase as FaseDoRoadmap) ? (o.fase as FaseDoRoadmap) : "entrevista",
    criadoEm: iso(o.criadoEm, agora),
    atualizadoEm: iso(o.atualizadoEm, agora),
    ia: normalizarIa(o.ia),
    resumo: {
      etapas: numero(r.etapas, 0, 0, 1e5),
      concluidas: numero(r.concluidas, 0, 0, 1e5),
      sequencia: numero(r.sequencia, 0, 0, 1e5),
      cardsParaHoje: numero(r.cardsParaHoje, 0, 0, 1e6),
      ...(typeof r.ultimoDia === "string" && DIA.test(r.ultimoDia) ? { ultimoDia: r.ultimoDia } : {}),
      ...(typeof r.proximaEtapa === "string" ? { proximaEtapa: texto(r.proximaEtapa, 140) } : {}),
    },
  };
}

function normalizarMensagem(v: unknown): MensagemDaEntrevista | null {
  const o = obj(v);
  const conteudo = texto(o.texto, 8000);
  if (!conteudo || (o.de !== "ia" && o.de !== "eu")) return null;
  const m: MensagemDaEntrevista = { de: o.de, texto: conteudo, em: iso(o.em, new Date(0).toISOString()) };
  const opcoes = lista(o.opcoes).map((x) => texto(x, 120)).filter(Boolean).slice(0, 6);
  if (opcoes.length) m.opcoes = opcoes;
  return m;
}

export function normalizarEntrevista(v: unknown): EntrevistaSalva {
  const o = obj(v);
  const e: EntrevistaSalva = {
    versao: VERSAO_DOS_ARQUIVOS,
    pedido: texto(o.pedido, 2000),
    mensagens: lista(o.mensagens).map(normalizarMensagem).filter((m): m is MensagemDaEntrevista => m !== null),
  };
  const proposta = o.proposta ? normalizarPlano(o.proposta) : null;
  if (proposta) e.proposta = proposta;
  return e;
}

/** `conversa.jsonl`: uma mensagem por linha; linha quebrada (fim cortado) é pulada. */
export function lerConversa(conteudo: string | null): MensagemDoPainel[] {
  if (!conteudo) return [];
  const mensagens: MensagemDoPainel[] = [];
  for (const linha of conteudo.split("\n")) {
    if (!linha.trim()) continue;
    try {
      const o = obj(JSON.parse(linha));
      const t = texto(o.texto, 20000);
      if (!t || (o.de !== "ia" && o.de !== "eu")) continue;
      const m: MensagemDoPainel = { de: o.de, texto: t, em: iso(o.em, new Date(0).toISOString()) };
      if (idValido(o.etapaId)) m.etapaId = o.etapaId;
      mensagens.push(m);
    } catch { /* linha cortada: segue com as outras */ }
  }
  return mensagens;
}
