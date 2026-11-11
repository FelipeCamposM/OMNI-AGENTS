import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BookIcon, CloseIcon, RobotIcon, SearchIcon, SparkleIcon, TrashIcon } from "../../components/ui/PixelIcon";
import { iconForPath, iconStyle } from "../files/fileIcons";
import {
  adicionarArquivos,
  buscarConhecimento,
  claudeUsaABase,
  estadoDaMemoria,
  ligarBaseNoClaude,
  ligarMemoria,
  listarFontes,
  removerFonte,
  tamanhoLegivel,
  type EstadoDaMemoria,
  type FonteDeConhecimento,
  type ResultadoDeBusca,
} from "./conhecimentoService";
import "./conhecimento.css";

const INTERVALO_DA_IMPORTACAO_MS = 1500;
const ATRASO_DA_BUSCA_MS = 200;
const TIPOS = [".pdf", ".docx", ".xlsx", ".pptx", ".md", ".txt", ".csv", ".json", ".html", ".sql", ".db", ".backup", ".zip", ".gz", "código"];

/** Base de conhecimento: solte arquivos aqui e o Claude consulta quando você mandar. */
export function ConhecimentoView({ onClose }: { onClose: () => void }) {
  const [fontes, setFontes] = useState<FonteDeConhecimento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [claude, setClaude] = useState<boolean | null>(null);
  const [mudandoClaude, setMudandoClaude] = useState(false);
  const [memoria, setMemoria] = useState<EstadoDaMemoria | null>(null);
  const [consulta, setConsulta] = useState("");
  const [resultados, setResultados] = useState<ResultadoDeBusca[]>([]);

  const recarregar = useCallback(() => listarFontes().then(setFontes).catch((motivo) => setErro(String(motivo))), []);
  const importar = useCallback(async (caminhos: string[]) => {
    if (caminhos.length === 0) return;
    setErro(null);
    await adicionarArquivos(caminhos).catch((motivo) => setErro(String(motivo)));
    await recarregar();
  }, [recarregar]);

  useEffect(() => {
    void recarregar();
    claudeUsaABase().then(setClaude).catch(() => setClaude(false));
    estadoDaMemoria().then(setMemoria).catch(() => setMemoria(null));
  }, [recarregar]);

  // A importação roda em segundo plano, um arquivo por vez: a lista é a fonte do progresso.
  useEffect(() => {
    const relogio = setInterval(() => void recarregar(), INTERVALO_DA_IMPORTACAO_MS);
    return () => clearInterval(relogio);
  }, [recarregar]);

  useEffect(() => {
    let parar: (() => void) | undefined;
    let vivo = true;
    void import("@tauri-apps/api/webviewWindow").then(async ({ getCurrentWebviewWindow }) => {
      const cancelar = await getCurrentWebviewWindow().onDragDropEvent((evento) => {
        const dados = evento.payload;
        if (dados.type === "enter" || dados.type === "over") setArrastando(true);
        else setArrastando(false);
        if (dados.type === "drop") void importar(dados.paths);
      });
      if (vivo) parar = cancelar; else cancelar();
    }).catch(() => undefined);
    return () => { vivo = false; parar?.(); };
  }, [importar]);

  useEffect(() => {
    if (!consulta.trim()) { setResultados([]); return; }
    const espera = setTimeout(() => {
      buscarConhecimento(consulta).then(setResultados).catch((motivo) => setErro(String(motivo)));
    }, ATRASO_DA_BUSCA_MS);
    return () => clearTimeout(espera);
  }, [consulta]);

  async function escolher() {
    const escolhidos = await open({ multiple: true, title: "Arquivos para a base de conhecimento" });
    await importar(Array.isArray(escolhidos) ? escolhidos : escolhidos ? [escolhidos] : []);
  }

  async function alternarClaude() {
    setMudandoClaude(true); setErro(null);
    try { await ligarBaseNoClaude(!claude); setClaude(!claude); }
    catch (motivo) { setErro(String(motivo)); }
    finally { setMudandoClaude(false); }
  }

  async function alternarMemoria() {
    if (!memoria) return;
    setErro(null);
    try { await ligarMemoria(!memoria.ligada); setMemoria({ ...memoria, ligada: !memoria.ligada }); }
    catch (motivo) { setErro(String(motivo)); }
  }

  const totalDeTrechos = fontes?.reduce((soma, fonte) => soma + fonte.trechos, 0) ?? 0;
  const numero = (n: number) => n.toLocaleString("pt-BR");

  return (
    <section className="kb" aria-label="Base de conhecimento">
      <div className="kb-miolo">
        <header className="kb-topo">
          <span className="kb-selo" aria-hidden><BookIcon className="h-6 w-6" /></span>
          <div className="kb-titulo">
            <h1 className="pixel-text">Conhecimento</h1>
            <p>Fica só neste computador. O Claude só consulta quando você pedir, por exemplo: “olha na base como fizemos o deploy”.</p>
          </div>
          <button type="button" className="kb-fechar" onClick={onClose} aria-label="Fechar conhecimento">
            <CloseIcon className="h-3.5 w-3.5" aria-hidden />
          </button>
        </header>

        <dl className="kb-numeros">
          <div><dt>arquivos</dt><dd>{fontes === null ? "–" : numero(fontes.length)}</dd></div>
          <div><dt>trechos</dt><dd>{numero(totalDeTrechos)}</dd></div>
          <div><dt>notas na memória</dt><dd>{memoria ? numero(memoria.notas) : "–"}</dd></div>
        </dl>

        <div className="kb-chaves">
          <Interruptor icone={<RobotIcon className="h-4 w-4" />} titulo="Claude usa o OMNI"
            rotulo="Deixar o Claude usar o OMNI quando eu pedir: esta base, o histórico, a memória e os fluxos"
            ligado={claude === true} desabilitado={claude === null || mudandoClaude} onAlternar={() => void alternarClaude()}
            detalhe={mudandoClaude ? "Aplicando…" : claude
              ? "Vale para as conversas abertas a partir de agora; as abertas precisam ser reiniciadas. Aprovar etapas de fluxo continua só na tela."
              : "Quando ligado, o Claude consulta esta base, o histórico, a memória e os fluxos se você pedir."} />
          <Interruptor icone={<SparkleIcon className="h-4 w-4" />} titulo="Memória compartilhada"
            rotulo="Memória compartilhada" ligado={memoria?.ligada === true} desabilitado={!memoria} onAlternar={() => void alternarMemoria()}
            detalhe={<>{memoria && <b>{numero(memoria.notas)} notas · </b>}Cada conversa nova recebe as notas ligadas ao pedido; ao fim do turno, um modelo rápido guarda o que vale lembrar. Consome um pouco da sua conta.</>} />
        </div>

        <div className={`kb-soltar${arrastando ? " is-arrastando" : ""}`}>
          <span className="kb-soltar-icone" aria-hidden><BookIcon className="h-7 w-7" /></span>
          <p className="kb-soltar-titulo">{arrastando ? "Pode soltar" : "Solte os arquivos aqui"}</p>
          <ul className="kb-tipos" aria-label="Tipos aceitos">{TIPOS.map((tipo) => <li key={tipo}>{tipo}</li>)}</ul>
          <button type="button" className="kb-botao" onClick={() => void escolher()}>Escolher arquivos</button>
        </div>

        {erro && <p role="alert" className="kb-erro">{erro}</p>}

        <div className="kb-busca">
          <SearchIcon className="kb-busca-icone h-4 w-4" aria-hidden />
          <input type="search" value={consulta} onChange={(evento) => setConsulta(evento.target.value)}
            placeholder="Testar uma busca na base…" aria-label="Buscar na base" />
        </div>
        {consulta.trim() && resultados.length === 0 && <p className="kb-dica">Nada encontrado.</p>}
        {resultados.length > 0 && (
          <ul className="kb-resultados" aria-label="Resultados">
            {resultados.map((item) => (
              <li key={item.id}>
                <p className="kb-resultado-fonte">{item.fonte}{item.titulo !== item.fonte && ` · ${item.titulo}`}</p>
                <p className="kb-resultado-texto">{item.resumo}</p>
              </li>
            ))}
          </ul>
        )}

        <h2 className="kb-secao">
          {fontes === null ? "Carregando…" : `${fontes.length} arquivos · ${numero(totalDeTrechos)} trechos`}
        </h2>
        {fontes?.length === 0 && <p className="kb-dica">Nenhum arquivo ainda. Solte documentos acima para começar.</p>}
        <ul className="kb-arquivos" aria-label="Arquivos da base">
          {fontes?.map((fonte) => {
            const Icone = iconForPath(fonte.nome);
            return (
              <li key={fonte.id} className={`kb-arquivo is-${fonte.estado}`}>
                <span className="kb-arquivo-icone" aria-hidden><Icone className="h-5 w-5" style={iconStyle(fonte.nome)} /></span>
                <div className="kb-arquivo-info">
                  <p className="kb-arquivo-nome" title={fonte.caminho}>{fonte.nome}</p>
                  <p className="kb-arquivo-meta">
                    {fonte.estado === "erro" ? fonte.erro
                      : fonte.estado === "importando" ? `Importando… ${numero(fonte.trechos)} trechos`
                      : `${fonte.tipo} · ${tamanhoLegivel(fonte.tamanho)} · ${numero(fonte.trechos)} trechos`}
                  </p>
                </div>
                <button type="button" className="kb-remover" aria-label={`Remover ${fonte.nome}`} title="Remover da base"
                  disabled={fonte.estado === "importando"}
                  onClick={() => void removerFonte(fonte.id).then(recarregar).catch((motivo) => setErro(String(motivo)))}>
                  <TrashIcon className="h-3.5 w-3.5" aria-hidden />
                </button>
                {fonte.estado === "importando" && <span className="kb-arquivo-progresso" aria-hidden />}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** Cartão com interruptor. O checkbox nativo fica por baixo (teclado e leitor de tela continuam). */
function Interruptor({ icone, titulo, rotulo, detalhe, ligado, desabilitado, onAlternar }: {
  icone: ReactNode; titulo: string; rotulo: string; detalhe: ReactNode; ligado: boolean; desabilitado: boolean; onAlternar: () => void;
}) {
  return (
    <label className={`kb-chave${ligado ? " is-ligada" : ""}${desabilitado ? " is-travada" : ""}`}>
      <span className="kb-chave-topo">
        <span className="kb-chave-icone" aria-hidden>{icone}</span>
        <span className="kb-chave-titulo">{titulo}</span>
        <input type="checkbox" className="kb-chave-input" aria-label={rotulo} checked={ligado} disabled={desabilitado} onChange={onAlternar} />
        <span className="kb-chave-trilho" aria-hidden><span className="kb-chave-bolinha" /></span>
      </span>
      <span className="kb-chave-detalhe">{detalhe}</span>
    </label>
  );
}
