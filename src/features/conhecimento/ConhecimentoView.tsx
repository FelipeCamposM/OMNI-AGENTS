import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "../../components/ui";
import { BookIcon, CloseIcon, TrashIcon } from "../../components/ui/PixelIcon";
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

const INTERVALO_DA_IMPORTACAO_MS = 1500;
const ATRASO_DA_BUSCA_MS = 200;

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
    });
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

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4" aria-label="Base de conhecimento">
      <header className="flex items-center gap-3">
        <BookIcon className="h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h1 className="pixel-text text-sm text-text-primary">Conhecimento</h1>
          <p className="text-[11px] text-text-secondary">
            Fica só neste computador. O Claude só consulta quando você pedir, por exemplo: “olha na base como fizemos o deploy”.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Fechar conhecimento">
          <CloseIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Fechar
        </Button>
      </header>

      <div className={`border-2 border-dashed p-6 text-center ${arrastando ? "border-accent bg-accent/10" : "border-border-subtle"}`}>
        <p className="text-xs text-text-primary">Solte os arquivos aqui</p>
        <p className="mt-1 text-[11px] text-text-muted">.sql, .db, .backup, .pdf, .docx, .xlsx, .pptx, .md, .txt, .csv, .json, .html, .zip, .gz e código</p>
        <Button size="sm" className="mt-3" onClick={() => void escolher()}>Escolher arquivos</Button>
      </div>

      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input type="checkbox" checked={claude === true} disabled={claude === null || mudandoClaude} onChange={() => void alternarClaude()} />
        Deixar o Claude usar o OMNI quando eu pedir: esta base, o histórico, a memória e os fluxos
        {mudandoClaude && <span className="text-text-muted">aplicando…</span>}
      </label>
      {claude && <p className="text-[11px] text-text-muted">Vale para as conversas do Claude abertas pelo OMNI a partir de agora; as abertas precisam ser reiniciadas. Aprovar etapas de fluxo continua só na tela.</p>}

      <label className="flex items-center gap-2 text-xs text-text-secondary">
        <input type="checkbox" aria-label="Memória compartilhada" checked={memoria?.ligada === true} disabled={!memoria} onChange={() => void alternarMemoria()} />
        Memória compartilhada entre as conversas
        {memoria && <span className="text-text-muted">{memoria.notas.toLocaleString("pt-BR")} notas</span>}
      </label>
      <p className="text-[11px] text-text-muted">
        Cada conversa nova do Claude recebe as notas ligadas ao pedido e, ao fim do turno, um modelo rápido guarda o que vale lembrar. Isso consome um pouco da sua conta.
      </p>

      {erro && <p role="alert" className="border-l-2 border-danger px-2 py-1 text-[11px] text-danger">{erro}</p>}

      <Input size="sm" type="search" value={consulta} onChange={(evento) => setConsulta(evento.target.value)}
        placeholder="Testar uma busca…" aria-label="Buscar na base" />
      {consulta.trim() && resultados.length === 0 && <p className="text-[11px] text-text-muted">Nada encontrado.</p>}
      {resultados.length > 0 && (
        <ul className="space-y-2" aria-label="Resultados">
          {resultados.map((item) => (
            <li key={item.id} className="border border-border-subtle p-2">
              <p className="truncate text-[11px] text-text-muted">{item.fonte} · {item.titulo}</p>
              <p className="text-xs text-text-secondary">{item.resumo}</p>
            </li>
          ))}
        </ul>
      )}

      <h2 className="text-[10px] font-medium uppercase tracking-wider text-text-muted">
        {fontes === null ? "Carregando…" : `${fontes.length} arquivos · ${totalDeTrechos.toLocaleString("pt-BR")} trechos`}
      </h2>
      <ul className="space-y-1" aria-label="Arquivos da base">
        {fontes?.map((fonte) => (
          <li key={fonte.id} className="flex items-center gap-3 border border-border-subtle px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-text-primary" title={fonte.caminho}>{fonte.nome}</p>
              <p className={`truncate text-[11px] ${fonte.estado === "erro" ? "text-danger" : "text-text-muted"}`}>
                {fonte.estado === "erro" ? fonte.erro
                  : fonte.estado === "importando" ? `Importando… ${fonte.trechos.toLocaleString("pt-BR")} trechos`
                  : `${fonte.tipo} · ${tamanhoLegivel(fonte.tamanho)} · ${fonte.trechos.toLocaleString("pt-BR")} trechos`}
              </p>
            </div>
            <Button size="sm" variant="ghost" aria-label={`Remover ${fonte.nome}`} disabled={fonte.estado === "importando"}
              onClick={() => void removerFonte(fonte.id).then(recarregar).catch((motivo) => setErro(String(motivo)))}>
              <TrashIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
