import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { lerApelidos, matarServidor, salvarApelido, servidoresLocais, type ServidorLocal } from "../features/servidores/servidoresService";
import { useProjetoDaPasta } from "../features/projects/projetosContext";
import { SimboloDoProjeto } from "./EscolherIcone";
import { EditableLabel } from "./ui/EditableLabel";
import { Modal } from "./ui/Modal";
import { CheckIcon, EditIcon, GlobeIcon, StopIcon } from "./ui/PixelIcon";
import "./servidores.css";

const abrirNoNavegador = (porta: number) => void openUrl(`http://localhost:${porta}/`).catch(() => undefined);

/** Servidores locais de projeto (`npm run dev` e afins) rodando no PC: o favicon do projeto, a porta
 *  em destaque (clicar abre no navegador), apelido por projeto e o parar com confirmação. */
export function ServidoresPanel() {
  // undefined = carregando.
  const [servidores, setServidores] = useState<ServidorLocal[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [apelidos, setApelidos] = useState(lerApelidos);
  const [editando, setEditando] = useState<string | null>(null);
  const [parando, setParando] = useState<ServidorLocal | null>(null);

  const refresh = useCallback(() => {
    servidoresLocais()
      .then((lista) => { setServidores(Array.isArray(lista) ? lista : []); setError(null); })
      .catch((reason) => { setServidores([]); setError(reason instanceof Error ? reason.message : String(reason)); });
  }, []);

  // ponytail: poll de 10s com a aba aberta; cada leitura sobe um PowerShell (~1 s).
  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (servidores === undefined) return <p className="srv-vazio">Procurando servidores…</p>;

  return (
    <div className="srv-painel">
      {error && <p role="alert" className="srv-erro" title={error}>{error.length > 160 ? `${error.slice(0, 160)}…` : error}</p>}
      {!error && servidores.length === 0 && <p className="srv-vazio">Nenhum servidor de projeto rodando</p>}
      <ul className="srv-lista">
        {servidores.map((servidor) => (
          <CartaoDoServidor key={servidor.pasta} servidor={servidor} nome={apelidos[servidor.pasta] ?? servidor.nome}
            editando={editando === servidor.pasta} onEditando={(sim) => setEditando(sim ? servidor.pasta : null)}
            onApelido={(apelido) => setApelidos(salvarApelido(servidor.pasta, apelido))}
            onParar={() => setParando(servidor)} />
        ))}
      </ul>
      {parando && (
        <ConfirmarParada servidor={parando} nome={apelidos[parando.pasta] ?? parando.nome}
          onFechar={() => { setParando(null); refresh(); }} />
      )}
    </div>
  );
}

function CartaoDoServidor({ servidor, nome, editando, onEditando, onApelido, onParar }: {
  servidor: ServidorLocal; nome: string; editando: boolean;
  onEditando: (sim: boolean) => void; onApelido: (apelido: string) => void; onParar: () => void;
}) {
  const projeto = useProjetoDaPasta(servidor.pasta);
  const [principal, ...outras] = servidor.portas;
  return (
    <li className="srv" title={`${servidor.pasta}\n${servidor.comando}`}>
      <span className="srv-icone">
        <SimboloDoProjeto project={projeto ?? { path: servidor.pasta, icone: undefined }} className="h-5 w-5" />
        <span className="srv-vivo" aria-label="Rodando" />
      </span>
      <span className="srv-info">
        <EditableLabel value={nome} label={`Apelido de ${servidor.nome}`} editing={editando}
          onEditingChange={onEditando} onCommit={onApelido} className="srv-nome" />
        <span className="srv-tipo">{servidor.tipo}{outras.length > 0 && ` · também ${outras.map((p) => `:${p}`).join(" ")}`}</span>
      </span>
      <button type="button" className="srv-porta" onClick={() => abrirNoNavegador(principal)}
        aria-label={`Abrir localhost:${principal} no navegador`} title={`Abrir http://localhost:${principal}/`}>
        <span className="srv-porta-rotulo">porta</span>
        <span className="srv-porta-numero">{principal}</span>
      </button>
      <span className="srv-acoes">
        <button type="button" className="srv-acao" aria-label={`Dar apelido a ${nome}`} title="Dar apelido" onClick={() => onEditando(true)}>
          <EditIcon className="h-3.5 w-3.5" aria-hidden />
        </button>
        <button type="button" className="srv-acao" aria-label={`Abrir localhost:${principal}`} title="Abrir no navegador" onClick={() => abrirNoNavegador(principal)}>
          <GlobeIcon className="h-3.5 w-3.5" aria-hidden />
        </button>
        {!servidor.proprio && (
          <button type="button" className="srv-acao srv-acao-parar" aria-label={`Parar ${nome}`} title="Parar servidor" onClick={onParar}>
            <StopIcon className="h-3.5 w-3.5" aria-hidden />
          </button>
        )}
      </span>
    </li>
  );
}

type Etapa = "confirmar" | "parando" | "parado" | "erro";

/** Confirmação de parar: o servidor "respira" enquanto espera, gira enquanto para e vira um check
 *  quando a porta solta. Fecha sozinho depois do check. */
function ConfirmarParada({ servidor, nome, onFechar }: { servidor: ServidorLocal; nome: string; onFechar: () => void }) {
  const [etapa, setEtapa] = useState<Etapa>("confirmar");
  const [erro, setErro] = useState<string | null>(null);
  const portas = servidor.portas.map((p) => `:${p}`).join(" ");

  useEffect(() => {
    if (etapa !== "parado") return;
    const t = window.setTimeout(onFechar, 1100);
    return () => window.clearTimeout(t);
  }, [etapa, onFechar]);

  async function parar() {
    setEtapa("parando");
    try { await matarServidor(servidor.pasta); setEtapa("parado"); }
    catch (motivo) { setErro(motivo instanceof Error ? motivo.message : String(motivo)); setEtapa("erro"); }
  }

  return (
    <Modal titulo="Parar servidor" largura="sm" onFechar={() => { if (etapa !== "parando") onFechar(); }}>
      <div className={`srv-parar is-${etapa}`}>
        <div className="srv-parar-figura" aria-hidden>
          <span className="srv-parar-anel" />
          <span className="srv-parar-anel srv-parar-anel-2" />
          <span className="srv-parar-centro">
            {etapa === "parado" ? <CheckIcon className="h-6 w-6" /> : <StopIcon className="h-6 w-6" />}
          </span>
        </div>
        <p className="srv-parar-titulo" role="status">
          {etapa === "confirmar" && <>Parar <b>{nome}</b>?</>}
          {etapa === "parando" && "Parando…"}
          {etapa === "parado" && "Servidor parado"}
          {etapa === "erro" && "Não deu para parar"}
        </p>
        <p className="srv-parar-detalhe">
          {etapa === "erro" ? erro : <>{servidor.tipo} em <b className="srv-parar-porta">localhost{portas}</b></>}
        </p>
        <p className="srv-parar-pasta" title={servidor.pasta}>{servidor.pasta}</p>
        {(etapa === "confirmar" || etapa === "erro") && (
          <div className="srv-parar-botoes">
            <button type="button" className="srv-botao" onClick={onFechar}>Cancelar</button>
            <button type="button" className="srv-botao srv-botao-perigo" autoFocus onClick={() => void parar()}>
              {etapa === "erro" ? "Tentar de novo" : "Parar servidor"}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
