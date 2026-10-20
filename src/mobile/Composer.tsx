import { useEffect, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { AttachmentIcon, CloseIcon, LoaderIcon, MicIcon, SendIcon, StopIcon, WarningIcon } from "../components/ui/PixelIcon";
import { iconForPath } from "../features/files/fileIcons";
import { tamanhoLegivel, type Anexo } from "./anexos";
import type { Comando } from "./api";
import { falaDoNavegador, gravar, navegadorGrava, ouvir, type Escuta, type Gravacao } from "./voz";

interface ComposerProps {
  texto: string;
  onTexto: (valor: string) => void;
  anexos: Anexo[];
  onAdicionar: (arquivos: File[]) => void;
  onRemover: (id: string) => void;
  onEnviar: () => void;
  podeEnviar: boolean;
  ocupado: boolean;
  placeholder: string;
  /** Acima do cartão (renomear a conversa, por exemplo). */
  toolbar?: ReactNode;
  /** Na barra de baixo, depois do anexo: conta, modelo, esforço. */
  chips?: ReactNode;
  /** Na barra de baixo, antes do enviar: o modo (plano/auto). */
  direita?: ReactNode;
  /** Agente trabalhando: o botão principal vira "Parar" (o Esc do terminal). */
  onParar?: () => void;
  parando?: boolean;
  /** Arquivos do projeto para o `@` (como no terminal). Sem isto, `@` é só texto. */
  buscarArquivos?: (busca: string) => Promise<string[]>;
  /** Fala → texto no PC. Sem isto (modelo de voz não baixado), o microfone não aparece. */
  voz?: Voz;
  /** Comandos `/` do agente (embutidos, seus, skills, plugins). Sem isto, `/` é só texto. */
  comandos?: () => Promise<Comando[]>;
}

/** O `/algo` digitado no começo da mensagem, enquanto o cursor ainda está nele. */
export function barraNoCursor(texto: string, cursor: number): string | null {
  return /^\/([^\s/]*)$/.exec(texto.slice(0, cursor))?.[1] ?? null;
}

/** Os que contêm a busca; os que começam com ela vêm primeiro, cada grupo na ordem da lista. */
export function filtrarComandos(lista: Comando[], busca: string): Comando[] {
  const b = busca.toLowerCase();
  const achados = lista.filter((c) => c.nome.toLowerCase().includes(b));
  return [...achados.filter((c) => c.nome.toLowerCase().startsWith(b)), ...achados.filter((c) => !c.nome.toLowerCase().startsWith(b))].slice(0, 60);
}

/** O `@algo` que está sendo digitado logo antes do cursor (precisa vir no começo ou após espaço). */
export function mencaoNoCursor(texto: string, cursor: number): { inicio: number; busca: string } | null {
  const antes = texto.slice(0, cursor);
  const achado = /(^|\s)@([^\s@"]*)$/.exec(antes);
  if (!achado) return null;
  return { inicio: antes.length - achado[2].length - 1, busca: achado[2] };
}

/** Caminho com espaço vai entre aspas, como a CLI aceita. */
export function textoDaMencao(caminho: string): string {
  return /\s/.test(caminho) ? `@"${caminho}" ` : `@${caminho} `;
}

const ALTURA_MAXIMA_PX = 160;

/** Teclado físico e mouse: Enter envia, como no terminal do PC. No celular o Enter do teclado
 *  virtual continua quebrando linha — lá o botão de enviar está sempre à mão. */
function enterEnvia(): boolean {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: fine)").matches);
}

function ChipAnexo({ anexo, onRemover, travado }: { anexo: Anexo; onRemover: () => void; travado: boolean }) {
  const Icone = iconForPath(anexo.arquivo.name);
  const meta = anexo.estado === "erro" ? anexo.erro ?? "Falhou"
    : anexo.estado === "enviando" ? "Enviando…"
    : anexo.estado === "enviado" ? "No PC"
    : tamanhoLegivel(anexo.arquivo.size);
  return (
    <li className="anexo-chip" data-estado={anexo.estado}>
      {anexo.previa
        ? <img src={anexo.previa} alt="" className="anexo-previa" />
        : <span className="anexo-tipo" aria-hidden><Icone className="h-5 w-5" /></span>}
      <span className="anexo-info">
        <span className="anexo-nome">{anexo.arquivo.name || "anexo"}</span>
        <span className="anexo-meta">
          {anexo.estado === "enviando" && <LoaderIcon aria-hidden className="anexo-girando h-3 w-3" />}
          {anexo.estado === "erro" && <WarningIcon aria-hidden className="h-3 w-3" />}
          {meta}
        </span>
      </span>
      <button type="button" className="anexo-remover" aria-label={`Remover ${anexo.arquivo.name || "anexo"}`}
        disabled={travado} onClick={onRemover}>
        <CloseIcon aria-hidden className="h-4 w-4" />
      </button>
    </li>
  );
}

export interface Voz {
  transcrever: (audio: Blob) => Promise<string>;
  corrigir: (texto: string) => Promise<string>;
}

/** Microfone: um toque grava, outro para. Cada pausa da fala vira um trecho transcrito na hora, e o
 *  texto vai entrando no campo enquanto a pessoa fala — para revisar, nunca envia sozinho. */
function BotaoDeVoz({ voz, texto, aoTexto, travado }: { voz: Voz; texto: () => string; aoTexto: (texto: string) => void; travado: boolean }) {
  const [fase, setFase] = useState<"parado" | "gravando" | "finalizando">("parado");
  const [erro, setErro] = useState<string | null>(null);
  const [segundos, setSegundos] = useState(0);
  const gravacao = useRef<Gravacao | null>(null);
  // Trechos transcritos em ordem, um por vez: o whisper não ganha nada rodando dois juntos.
  const fila = useRef<Promise<void>>(Promise.resolve());
  const falado = useRef("");

  useEffect(() => {
    if (fase !== "gravando") return;
    setSegundos(0);
    const relogio = window.setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => window.clearInterval(relogio);
  }, [fase]);
  // Saiu da conversa gravando: solta o microfone (a luz de gravação do sistema apaga).
  useEffect(() => () => gravacao.current?.cancelar(), []);
  useEffect(() => {
    if (!erro) return;
    const some = window.setTimeout(() => setErro(null), 6000);
    return () => window.clearTimeout(some);
  }, [erro]);

  function acrescentar(trecho: string) {
    const antes = texto().trimEnd();
    aoTexto(antes ? `${antes} ${trecho}` : trecho);
    falado.current = falado.current ? `${falado.current} ${trecho}` : trecho;
  }

  function aoTrecho(audio: Blob) {
    fila.current = fila.current.then(async () => {
      try {
        const t = (await voz.transcrever(audio)).trim();
        if (t) acrescentar(t);
      } catch (motivo) {
        setErro(motivo instanceof Error ? motivo.message : "Falha ao transcrever");
      }
    });
  }

  async function alternar() {
    if (fase === "parado") {
      // Erro de um trecho fica até o fim da gravação; só some ao começar outra.
      setErro(null);
      falado.current = "";
      try {
        gravacao.current = await gravar(aoTrecho);
        setFase("gravando");
      } catch {
        setErro("Sem acesso ao microfone. Libere a permissão do navegador e tente de novo.");
      }
      return;
    }
    if (fase !== "gravando" || !gravacao.current) return;
    gravacao.current.parar();
    gravacao.current = null;
    setFase("finalizando");
    try {
      await fila.current;
      const bruto = falado.current;
      if (!bruto) { setErro((atual) => atual ?? "Não entendi nada. Fale mais perto do microfone."); return; }
      const corrigido = (await voz.corrigir(bruto).catch(() => bruto)).trim();
      // Só troca se o fim do campo ainda é a fala crua — se a pessoa já mexeu, a edição dela vale.
      const atual = texto();
      if (corrigido && corrigido !== bruto && atual.endsWith(bruto)) aoTexto(atual.slice(0, atual.length - bruto.length) + corrigido);
    } finally {
      setFase("parado");
    }
  }

  const rotulo = fase === "gravando" ? "Parar de gravar" : fase === "finalizando" ? "Transcrevendo…" : "Falar o prompt";
  return (
    <>
      <button type="button" className={`composer-botao composer-voz${fase === "gravando" ? " is-gravando" : ""}`}
        aria-label={rotulo} title={erro ?? rotulo} aria-pressed={fase === "gravando"}
        disabled={fase === "finalizando" || (travado && fase === "parado")} onClick={() => void alternar()}>
        {fase === "finalizando" ? <LoaderIcon aria-hidden className="anexo-girando h-4 w-4" />
          : fase === "gravando" ? <StopIcon aria-hidden className="h-4 w-4" />
          : erro ? <WarningIcon aria-hidden className="h-4 w-4" />
          : <MicIcon aria-hidden className="h-4 w-4" />}
      </button>
      {fase === "gravando" && <span className="composer-voz-tempo" aria-live="polite">{Math.floor(segundos / 60)}:{String(segundos % 60).padStart(2, "0")}</span>}
      {erro && <span role="status" className="composer-voz-erro">{erro}</span>}
    </>
  );
}

/** Microfone pela fala do navegador: as palavras entram no campo enquanto a pessoa fala, sem modelo
 *  no PC. Nunca envia sozinho. */
function BotaoDeFala({ texto, aoTexto, travado }: { texto: () => string; aoTexto: (texto: string) => void; travado: boolean }) {
  const [ouvindo, setOuvindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const escuta = useRef<Escuta | null>(null);
  useEffect(() => () => escuta.current?.cancelar(), []);
  useEffect(() => {
    if (!erro) return;
    const some = window.setTimeout(() => setErro(null), 6000);
    return () => window.clearTimeout(some);
  }, [erro]);

  function alternar() {
    if (ouvindo) { escuta.current?.parar(); return; }
    setErro(null);
    const antes = texto().trimEnd();
    try {
      escuta.current = ouvir(
        (falado) => aoTexto(antes && falado ? `${antes} ${falado}` : antes || falado),
        (motivo) => { escuta.current = null; setOuvindo(false); if (motivo) setErro(motivo); },
      );
      setOuvindo(true);
    } catch (motivo) {
      setErro(motivo instanceof Error ? motivo.message : "Falha ao ouvir");
    }
  }

  const rotulo = ouvindo ? "Parar de ouvir" : "Falar o prompt";
  return (
    <>
      <button type="button" className={`composer-botao composer-voz${ouvindo ? " is-gravando" : ""}`}
        aria-label={rotulo} title={erro ?? rotulo} aria-pressed={ouvindo}
        disabled={travado && !ouvindo} onClick={alternar}>
        {ouvindo ? <StopIcon aria-hidden className="h-4 w-4" /> : erro ? <WarningIcon aria-hidden className="h-4 w-4" /> : <MicIcon aria-hidden className="h-4 w-4" />}
      </button>
      {erro && <span role="status" className="composer-voz-erro">{erro}</span>}
    </>
  );
}

/**
 * Barra de digitação do chat: texto, anexos por botão ou colados, e enviar.
 *
 * O botão de anexo é um `<label>` em volta do `<input type="file">`, não um `.click()` por código:
 * é o único jeito que abre o seletor em todo navegador de celular, inclusive o Safari antigo, que
 * ignora clique programático em input escondido. Sem `accept`: qualquer tipo de arquivo vale.
 */
export function Composer({ texto, onTexto, anexos, onAdicionar, onRemover, onEnviar, podeEnviar, ocupado, placeholder, toolbar, chips, direita, onParar, parando, buscarArquivos, voz, comandos }: ComposerProps) {
  const campo = useRef<HTMLTextAreaElement>(null);
  // O texto de agora, não o de quando a gravação começou: dá para digitar enquanto fala.
  const textoAtual = useRef(texto);
  textoAtual.current = texto;
  // Menção aberta: onde começa o `@`, o que foi digitado depois dele e o que achou.
  const [mencao, setMencao] = useState<{ inicio: number; busca: string } | null>(null);
  const [sugestoes, setSugestoes] = useState<string[]>([]);
  const [escolhida, setEscolhida] = useState(0);
  const ultimaLista = useRef<string[]>([]);
  // `/` no começo: o que vem depois dele, e os comandos do agente (relidos a cada abertura do menu,
  // para skill instalada agora já aparecer).
  const [barra, setBarra] = useState<string | null>(null);
  const [listaDeComandos, setListaDeComandos] = useState<Comando[]>([]);
  const barraAberta = barra !== null;
  useEffect(() => {
    if (!barraAberta || !comandos) return;
    let cancelado = false;
    comandos().then((lista) => { if (!cancelado) setListaDeComandos(Array.isArray(lista) ? lista : []); }).catch(() => undefined);
    return () => { cancelado = true; };
  }, [barraAberta, comandos]);
  const comandosVisiveis = barra === null ? [] : filtrarComandos(listaDeComandos, barra);

  // Busca com um respiro curto: digitar "@src/comp" não dispara uma consulta por letra.
  useEffect(() => {
    if (!mencao || !buscarArquivos) { ultimaLista.current = []; setSugestoes([]); return; }
    let cancelado = false;
    const espera = window.setTimeout(() => {
      buscarArquivos(mencao.busca).then((lista) => {
        if (cancelado) return;
        // Mesma lista de antes (resposta repetida ou atrasada): mantém a escolha feita nas setas.
        const atual = ultimaLista.current;
        if (atual.length === lista.length && atual.every((item, i) => item === lista[i])) return;
        ultimaLista.current = lista;
        setSugestoes(lista);
        setEscolhida(0);
      }).catch(() => { if (!cancelado) setSugestoes([]); });
    }, 120);
    return () => { cancelado = true; window.clearTimeout(espera); };
  }, [mencao, buscarArquivos]);

  function acompanharMencao(valor: string, cursor: number) {
    const achada = buscarArquivos ? mencaoNoCursor(valor, cursor) : null;
    setMencao((atual) => (atual?.inicio === achada?.inicio && atual?.busca === achada?.busca ? atual : achada));
    const busca = comandos ? barraNoCursor(valor, cursor) : null;
    if (busca !== barra) { setBarra(busca); setEscolhida(0); }
  }

  function escolherComando(comando: Comando) {
    // Troca só o `/termo` do começo: o que vier depois (argumentos já digitados) fica.
    const resto = texto.replace(/^\/\S*/, "").replace(/^ /, "");
    const inserido = `/${comando.nome} `;
    onTexto(inserido + resto);
    setBarra(null);
    requestAnimationFrame(() => {
      campo.current?.focus();
      campo.current?.setSelectionRange(inserido.length, inserido.length);
    });
  }

  function escolher(caminho: string) {
    if (!mencao) return;
    const fim = mencao.inicio + 1 + mencao.busca.length;
    const inserido = textoDaMencao(caminho);
    const novo = texto.slice(0, mencao.inicio) + inserido + texto.slice(fim);
    onTexto(novo);
    setMencao(null);
    setSugestoes([]);
    const cursor = mencao.inicio + inserido.length;
    requestAnimationFrame(() => {
      campo.current?.focus();
      campo.current?.setSelectionRange(cursor, cursor);
    });
  }

  // Cresce com o texto até um limite, como nos apps de mensagem.
  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, ALTURA_MAXIMA_PX)}px`;
    // Barra de rolagem só quando passa do limite; antes aparecia até com o campo vazio.
    el.style.overflowY = el.scrollHeight > ALTURA_MAXIMA_PX ? "auto" : "hidden";
  }, [texto]);

  function colar(event: ClipboardEvent<HTMLTextAreaElement>) {
    const arquivos = Array.from(event.clipboardData?.files ?? []);
    // Texto comum segue o caminho normal do campo; só arquivo (print, foto, documento) vira anexo.
    if (arquivos.length === 0) return;
    event.preventDefault();
    onAdicionar(arquivos);
  }

  function enviar(event: FormEvent) {
    event.preventDefault();
    if (podeEnviar) onEnviar();
  }

  function tecla(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Menu de `/` aberto: setas escolhem, Tab completa, Esc fecha. Enter completa — a não ser que o
    // digitado já seja o comando exato: aí envia, como no terminal (`/compact` + Enter).
    if (barra !== null && comandosVisiveis.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const passo = event.key === "ArrowDown" ? 1 : -1;
        setEscolhida((atual) => (atual + passo + comandosVisiveis.length) % comandosVisiveis.length);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setBarra(null);
        return;
      }
      const marcado = comandosVisiveis[escolhida] ?? comandosVisiveis[0];
      if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && marcado.nome !== barra)) {
        event.preventDefault();
        escolherComando(marcado);
        return;
      }
    }
    // Lista de arquivos aberta: setas escolhem, Enter/Tab inserem, Esc fecha — nada disso envia.
    if (mencao && sugestoes.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const passo = event.key === "ArrowDown" ? 1 : -1;
        setEscolhida((atual) => (atual + passo + sugestoes.length) % sugestoes.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        escolher(sugestoes[escolhida]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMencao(null);
        return;
      }
    }
    // `isComposing`: Enter que confirma acento/IME não pode disparar o envio.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || !enterEnvia()) return;
    event.preventDefault();
    if (podeEnviar) onEnviar();
  }

  // Com texto escrito, o principal continua sendo enviar (a mensagem entra na fila do agente).
  // Agente trabalhando: o Parar fica sempre à mão, e o Enviar aparece ao lado assim que há algo
  // escrito — a mensagem entra na fila da CLI, como digitar no terminal durante o turno.
  const parar = Boolean(onParar);
  const enviarJunto = !parar || texto.trim().length > 0 || anexos.length > 0;

  return (
    <div className="composer-faixa">
      {toolbar}
      <form onSubmit={enviar} className="composer">
        {anexos.length > 0 && (
          <ul className="anexos" aria-label="Anexos">
            {anexos.map((anexo) => (
              <ChipAnexo key={anexo.id} anexo={anexo} travado={ocupado} onRemover={() => onRemover(anexo.id)} />
            ))}
          </ul>
        )}
        <label htmlFor="reply" className="sr-only">Sua resposta</label>
        <textarea id="reply" ref={campo} rows={1} value={texto} maxLength={16000} placeholder={placeholder}
          className="composer-campo" onPaste={colar} onKeyDown={tecla}
          onChange={(event) => { onTexto(event.target.value); acompanharMencao(event.target.value, event.target.selectionStart ?? event.target.value.length); }}
          onClick={(event) => acompanharMencao(event.currentTarget.value, event.currentTarget.selectionStart ?? 0)}
          onBlur={() => window.setTimeout(() => { setMencao(null); setBarra(null); }, 150)}
          aria-autocomplete="list" aria-expanded={Boolean((mencao && sugestoes.length) || comandosVisiveis.length)}
          aria-controls={comandosVisiveis.length ? "comandos" : "mencoes"} />
        {comandosVisiveis.length > 0 && (
          <ul id="comandos" role="listbox" aria-label="Comandos do agente" className="composer-mencoes">
            {comandosVisiveis.map((comando, indice) => (
              <li key={comando.nome} role="option" aria-selected={indice === escolhida}
                className={`composer-mencao composer-comando${indice === escolhida ? " is-ativa" : ""}`}
                onMouseDown={(event) => { event.preventDefault(); escolherComando(comando); }}
                onMouseEnter={() => setEscolhida(indice)}>
                <span className="composer-mencao-nome">/{comando.nome}</span>
                <span className="composer-comando-descricao">{comando.descricao}</span>
                {comando.origem !== "cli" && <span className="composer-comando-origem">{comando.origem}</span>}
              </li>
            ))}
          </ul>
        )}
        {mencao && sugestoes.length > 0 && (
          <ul id="mencoes" role="listbox" aria-label="Arquivos do projeto" className="composer-mencoes">
            {sugestoes.map((caminho, indice) => {
              const barra = caminho.lastIndexOf("/");
              const Icone = iconForPath(caminho);
              return (
                <li key={caminho} role="option" aria-selected={indice === escolhida}
                  className={`composer-mencao${indice === escolhida ? " is-ativa" : ""}`}
                  onMouseDown={(event) => { event.preventDefault(); escolher(caminho); }}
                  onMouseEnter={() => setEscolhida(indice)}>
                  <Icone aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  <span className="composer-mencao-nome">{caminho.slice(barra + 1)}</span>
                  {barra > 0 && <span className="composer-mencao-pasta">{caminho.slice(0, barra)}</span>}
                </li>
              );
            })}
          </ul>
        )}
        <div className="composer-rodape">
          <div className="composer-chips">{chips}</div>
          <div className="composer-direita">
            {direita}
            {/* Anexar e falar ficam junto do enviar: são o mesmo grupo de ações da mensagem. */}
            <label className={`composer-botao${ocupado ? " is-disabled" : ""}`} title="Anexar arquivo">
              <AttachmentIcon aria-hidden className="h-4 w-4" />
              <input type="file" multiple className="sr-only" aria-label="Anexar arquivo" disabled={ocupado}
                onChange={(event) => {
                  onAdicionar(Array.from(event.target.files ?? []));
                  // Zera para escolher o mesmo arquivo de novo depois de removê-lo disparar `change`.
                  event.target.value = "";
                }} />
            </label>
            {/* Fala do navegador primeiro (tempo real, sem modelo); sem ela, o whisper do PC. */}
            {falaDoNavegador() ? (
              <BotaoDeFala travado={ocupado} texto={() => textoAtual.current} aoTexto={(novo) => {
                textoAtual.current = novo;
                onTexto(novo);
              }} />
            ) : voz && navegadorGrava() && (
              <BotaoDeVoz voz={voz} travado={ocupado} texto={() => textoAtual.current} aoTexto={(novo) => {
                // O ref já anda junto: o próximo trecho chega antes do React renderizar este.
                textoAtual.current = novo;
                onTexto(novo);
                requestAnimationFrame(() => campo.current?.focus());
              }} />
            )}
            {parar && (
              <button type="button" className="composer-parar" aria-label="Parar" title="Parar o agente (Esc no terminal)"
                disabled={parando} onClick={onParar}>
                <span className="composer-parar-icone" aria-hidden>
                  {parando ? <LoaderIcon className="anexo-girando h-3.5 w-3.5" /> : <StopIcon className="h-3.5 w-3.5" />}
                </span>
                <span className="composer-parar-texto">{parando ? "Parando…" : "Parar"}</span>
              </button>
            )}
            {enviarJunto && (
              <button type="submit" className="composer-enviar" aria-label={parar ? "Enviar para a fila" : "Enviar resposta"}
                title={parar ? "Entra na fila e o agente lê quando terminar (Enter)" : "Enviar (Enter)"} disabled={!podeEnviar}>
                {ocupado ? <LoaderIcon aria-hidden className="anexo-girando h-4 w-4" /> : <SendIcon aria-hidden className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
