import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CloseIcon, SearchIcon } from "./ui/PixelIcon";

/**
 * O que a busca das Configurações acha. Cada item aponta para uma seção e para o título do cartão
 * (ou o rótulo do campo) que está na tela — é por esse texto que a busca rola até ele e o acende.
 * `termos` são os sinônimos que a pessoa digitaria sem saber o nome exato ("dark", "senha", "som").
 */
export interface ItemDeBusca { secao: string; titulo: string; termos: string; alvo?: string }

export const ITENS_DE_BUSCA: ItemDeBusca[] = [
  { secao: "geral", titulo: "Como ver os agentes", termos: "conversa terminal chat modo exibir visualizar" },
  { secao: "geral", titulo: "Salvar edições", termos: "arquivos salvar automatico manual ctrl+s editor" },
  { secao: "geral", titulo: "Agente pedindo atenção", termos: "avisos notificação notificar alerta som pergunta aprovação windows" },
  { secao: "geral", titulo: "Voz", termos: "microfone ditado falar whisper transcrição áudio" },
  { secao: "geral", titulo: "Corrigir o texto com IA", termos: "voz correção ditado revisar" },
  { secao: "geral", titulo: "Vocabulário da voz", termos: "palavras termos nomes microfone dicionário ditado" },
  { secao: "aparencia", titulo: "Tema", termos: "escuro claro sistema dark light modo noturno" },
  { secao: "aparencia", titulo: "Cor de destaque", termos: "accent paleta cor neon roxo verde azul" },
  { secao: "aparencia", titulo: "Relevo", termos: "vidro glass painéis transparência sombra" },
  { secao: "aparencia", titulo: "Animações", termos: "movimento motion reduzir desligar efeitos" },
  { secao: "aparencia", titulo: "Fundo do app", termos: "background papel de parede wallpaper aurora pixels poente maré" },
  { secao: "aparencia", titulo: "Imagem de fundo", termos: "foto wallpaper papel de parede personalizada" },
  { secao: "aparencia", titulo: "Desfoque", termos: "blur fundo embaçar" },
  { secao: "aparencia", titulo: "Opacidade dos terminais", termos: "transparência terminal fundo" },
  { secao: "aparencia", titulo: "Fundo da conversa", termos: "chat liso igual web" },
  { secao: "aparencia", titulo: "Opacidade das linhas", termos: "linhas grade transparência" },
  { secao: "agentes", titulo: "Contas dos agentes", termos: "login entrar claude codex gemini conta mestra perfil cli instalar instalação" },
  { secao: "agentes", titulo: "Acesso pelo celular", termos: "mobile telefone" },
  { secao: "agentes", titulo: "Compactação do contexto (Claude)", termos: "compact compactar contexto tokens memória" },
  { secao: "modelos", titulo: "Criar com IA", termos: "modelo agente qa revisor orquestrador subagente gerar" },
  { secao: "modelos", titulo: "Modelos salvos", termos: "subagentes agentes personalizados lista" },
  { secao: "extensoes", titulo: "Extensões", termos: "mcp plugins conectores servidores conta principal integrações", alvo: "" },
  { secao: "skills", titulo: "Skills", termos: "habilidades comandos claude projeto" },
  { secao: "mobile", titulo: "Acesso remoto: celular e outro computador", termos: "celular mobile qr code navegador web outro pc rede" },
  { secao: "mobile", titulo: "Código do Authy", termos: "2fa autenticação senha segurança parear token" },
  { secao: "mobile", titulo: "Trocar endereço (avançado)", termos: "porta ip rede host url" },
  { secao: "relatorios", titulo: "Relatório", termos: "uso tokens custo gasto commits gráfico estatísticas por dia" },
  { secao: "armazenamento", titulo: "Armazenamento das conversas", termos: "espaço disco tamanho gb mb" },
  { secao: "armazenamento", titulo: "Maiores conversas", termos: "pesadas grandes tamanho" },
  { secao: "armazenamento", titulo: "Conversas em mais de uma conta", termos: "duplicadas cópias mestra juntar" },
  { secao: "armazenamento", titulo: "Limpeza de conversas antigas", termos: "apagar excluir lixeira 30 60 dias automática" },
  { secao: "atalhos", titulo: "Atalhos do teclado", termos: "teclas shortcut combinação hotkey" },
  { secao: "sobre", titulo: "Atualização", termos: "versão atualizar update nova versão", alvo: "OMNI AGENTS" },
  { secao: "sobre", titulo: "Novidades", termos: "changelog o que mudou versões" },
  { secao: "sobre", titulo: "Dados do app", termos: "resetar restaurar padrão apagar configurações limpar" },
];

/** Minúsculo e sem acento: "notificacao" acha "Notificação". */
export const normalizar = (texto: string) => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Secao { id: string; label: string; desc: string; icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> }
export interface Achado { item: ItemDeBusca; secao: Secao; pontos: number }

/** Todas as palavras têm de aparecer; título vale mais que sinônimo, e começo de título mais ainda. */
export function buscar(consulta: string, secoes: Secao[]): Achado[] {
  const palavras = normalizar(consulta).split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return [];
  const doMenu: ItemDeBusca[] = secoes.map((s) => ({ secao: s.id, titulo: s.label, termos: s.desc, alvo: "" }));
  const achados: Achado[] = [];
  for (const item of [...doMenu, ...ITENS_DE_BUSCA]) {
    const secao = secoes.find((s) => s.id === item.secao);
    if (!secao) continue;
    const titulo = normalizar(item.titulo);
    const tudo = `${titulo} ${normalizar(item.termos)} ${normalizar(secao.label)}`;
    if (!palavras.every((p) => tudo.includes(p))) continue;
    const pontos = palavras.reduce((soma, p) => soma + (titulo.startsWith(p) ? 4 : titulo.includes(p) ? 2 : 0), 0);
    achados.push({ item, secao, pontos });
  }
  // Mesma seção e título (a seção "Extensões" e o item "Extensões"): fica um só.
  const vistos = new Set<string>();
  return achados.sort((a, b) => b.pontos - a.pontos)
    .filter((a) => { const k = `${a.secao.id}|${normalizar(a.item.titulo)}`; return !vistos.has(k) && Boolean(vistos.add(k)); })
    .slice(0, 12);
}

/** O trecho digitado aceso dentro do título. */
function Realce({ texto, consulta }: { texto: string; consulta: string }): ReactNode {
  const palavra = normalizar(consulta).split(/\s+/).filter(Boolean).find((p) => normalizar(texto).includes(p));
  if (!palavra) return texto;
  const i = normalizar(texto).indexOf(palavra);
  return <>{texto.slice(0, i)}<mark>{texto.slice(i, i + palavra.length)}</mark>{texto.slice(i + palavra.length)}</>;
}

/**
 * Barra de busca das Configurações: digita, vê o que existe (com a seção de cada um), ↑↓ e Enter
 * levam até lá. `Ctrl+F` ou `/` focam a busca com as Configurações abertas.
 */
export function SettingsSearch({ secoes, onIr, onConsulta }: {
  secoes: Secao[];
  onIr: (achado: Achado) => void;
  /** Avisa a consulta atual: o menu lateral apaga as seções sem resultado. */
  onConsulta?: (achados: Achado[] | null) => void;
}) {
  const [consulta, setConsulta] = useState("");
  const [aberta, setAberta] = useState(false);
  const [escolhido, setEscolhido] = useState(0);
  const campo = useRef<HTMLInputElement>(null);
  const achados = useMemo(() => buscar(consulta, secoes), [consulta, secoes]);

  useEffect(() => { setEscolhido(0); onConsulta?.(consulta.trim() ? achados : null); }, [achados, consulta, onConsulta]);

  useEffect(() => {
    function atalho(evento: KeyboardEvent) {
      const digitando = evento.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(evento.target.tagName);
      if ((evento.ctrlKey && evento.key.toLowerCase() === "f") || (evento.key === "/" && !digitando)) {
        evento.preventDefault();
        campo.current?.focus();
        campo.current?.select();
      }
    }
    window.addEventListener("keydown", atalho);
    return () => window.removeEventListener("keydown", atalho);
  }, []);

  function ir(achado: Achado) {
    onIr(achado);
    setAberta(false);
    campo.current?.blur();
  }

  const mostrar = aberta && consulta.trim().length > 0;
  return (
    <div className={`settings-busca${mostrar ? " is-aberta" : ""}`}>
      <SearchIcon aria-hidden className="settings-busca-lupa h-4 w-4" />
      <input ref={campo} type="search" value={consulta} placeholder="Buscar nas configurações…"
        aria-label="Buscar nas configurações" role="combobox" aria-expanded={mostrar} aria-controls="settings-busca-lista"
        aria-activedescendant={mostrar && achados[escolhido] ? `settings-achado-${escolhido}` : undefined}
        onChange={(e) => { setConsulta(e.target.value); setAberta(true); }}
        onFocus={() => setAberta(true)}
        onBlur={() => window.setTimeout(() => setAberta(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (achados.length) setEscolhido((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + achados.length) % achados.length);
          } else if (e.key === "Enter" && achados[escolhido]) {
            e.preventDefault();
            ir(achados[escolhido]);
          } else if (e.key === "Escape") {
            // Esc com texto limpa; vazio, solta o foco (o próximo Esc fecha as Configurações).
            e.preventDefault();
            if (consulta) setConsulta(""); else campo.current?.blur();
          }
        }} />
      {consulta
        ? <button type="button" className="settings-busca-limpar" aria-label="Limpar busca" onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setConsulta(""); campo.current?.focus(); }}><CloseIcon aria-hidden className="h-3 w-3" /></button>
        : <kbd className="settings-busca-tecla" aria-hidden>Ctrl F</kbd>}
      {mostrar && (
        <div className="settings-busca-painel glass glass-strong">
          {achados.length === 0 ? (
            <p className="settings-busca-vazio">Nada encontrado para <b>“{consulta.trim()}”</b>. Tente outra palavra, como “tema”, “voz” ou “celular”.</p>
          ) : (
            <ul id="settings-busca-lista" role="listbox" aria-label="Resultados">
              {achados.map((achado, i) => {
                const Icone = achado.secao.icon;
                const ehSecao = achado.item.alvo === "" && achado.item.titulo === achado.secao.label;
                return (
                  <li key={`${achado.secao.id}-${achado.item.titulo}`} id={`settings-achado-${i}`} role="option" aria-selected={i === escolhido}
                    className={`settings-busca-item${i === escolhido ? " is-ativo" : ""}`} style={{ animationDelay: `${i * 22}ms` }}
                    onMouseDown={(e) => { e.preventDefault(); ir(achado); }} onMouseEnter={() => setEscolhido(i)}>
                    <span className="settings-busca-icone" aria-hidden><Icone className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="settings-busca-titulo"><Realce texto={achado.item.titulo} consulta={consulta} /></span>
                      <span className="settings-busca-onde">{ehSecao ? achado.secao.desc : `${achado.secao.label} › ${achado.item.titulo}`}</span>
                    </span>
                    <span className="settings-busca-ir" aria-hidden>↵</span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="settings-busca-rodape" aria-hidden><kbd>↑</kbd><kbd>↓</kbd> navegar <kbd>Enter</kbd> abrir <kbd>Esc</kbd> limpar</p>
        </div>
      )}
    </div>
  );
}

/**
 * Depois de trocar de seção, acha na tela o cartão/campo do resultado, rola até ele e o acende.
 * Tenta por ~1,5s: seções como Armazenamento só desenham os cartões depois de ler os dados.
 */
export function acenderNaTela(raizDe: () => HTMLElement | null, alvo: string) {
  if (!alvo) return;
  const procurado = normalizar(alvo);
  let tentativas = 0;
  // A raiz é lida a cada tentativa: trocar de seção remonta o conteúdo (é outro elemento).
  const tentar = () => {
    const candidatos = [...(raizDe()?.querySelectorAll<HTMLElement>("h2, h3, label, legend") ?? [])];
    const achado = candidatos.find((el) => normalizar(el.textContent ?? "").trim() === procurado)
      ?? candidatos.find((el) => normalizar(el.textContent ?? "").includes(procurado));
    if (!achado) {
      if (++tentativas < 15) window.setTimeout(tentar, 100);
      return;
    }
    const cartao = achado.tagName === "H2" ? achado.closest<HTMLElement>("section") ?? achado : achado.parentElement ?? achado;
    cartao.scrollIntoView?.({ behavior: "smooth", block: "center" });
    cartao.classList.remove("settings-achado");
    void cartao.offsetWidth; // reinicia a animação se o mesmo cartão for buscado duas vezes
    cartao.classList.add("settings-achado");
    window.setTimeout(() => cartao.classList.remove("settings-achado"), 2600);
  };
  window.setTimeout(tentar, 60);
}
