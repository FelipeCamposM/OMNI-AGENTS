import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { lerApelidos, matarServidor, salvarApelido, servidoresLocais, type ServidorLocal } from "../features/servidores/servidoresService";
import { IconButton } from "./DockerPanel";
import { EditableLabel } from "./ui/EditableLabel";
import { CircleIcon, EditIcon, GlobeIcon, StopIcon } from "./ui/PixelIcon";

/** Servidores locais de projeto (`npm run dev` e afins) rodando no PC: de que pasta é cada
 *  localhost, apelido por projeto e o botão de derrubar (com confirmação). */
export function ServidoresPanel() {
  // undefined = carregando.
  const [servidores, setServidores] = useState<ServidorLocal[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [apelidos, setApelidos] = useState(lerApelidos);
  const [editando, setEditando] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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

  async function matar(servidor: ServidorLocal) {
    setBusy(servidor.pasta);
    setConfirmar(null);
    try {
      await matarServidor(servidor.pasta);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
      refresh();
    }
  }

  if (servidores === undefined) return <p className="px-6 py-1.5 text-xs text-text-muted">Procurando…</p>;

  return (
    <div className="space-y-1">
      {error && (
        <p role="alert" className="mx-3 border-l-2 border-danger pl-2 text-[11px] text-danger break-words [overflow-wrap:anywhere]" title={error}>
          {error.length > 160 ? `${error.slice(0, 160)}…` : error}
        </p>
      )}
      {!error && servidores.length === 0 && <p className="px-6 py-1.5 text-xs text-text-muted">Nenhum servidor de projeto rodando</p>}
      {servidores.map((servidor) => {
        const nome = apelidos[servidor.pasta] ?? servidor.nome;
        const [principal] = servidor.portas;
        return (
          <div key={servidor.pasta}>
            <div className="group flex items-center pl-6 pr-1">
              <span
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-xs text-text-secondary"
                title={`${servidor.pasta}\n${servidor.tipo} · ${servidor.portas.map((p) => `:${p}`).join(" ")}\n${servidor.comando}`}
              >
                <CircleIcon className="h-3 w-3 shrink-0 text-success" aria-hidden />
                <EditableLabel
                  value={nome}
                  label={`Apelido de ${servidor.nome}`}
                  editing={editando === servidor.pasta}
                  onEditingChange={(sim) => setEditando(sim ? servidor.pasta : null)}
                  onCommit={(apelido) => setApelidos(salvarApelido(servidor.pasta, apelido))}
                  className="min-w-0 truncate"
                />
                <span className="shrink-0 text-[10px] text-text-muted">:{principal}</span>
              </span>
              <IconButton label={`Dar apelido a ${nome}`} onClick={() => setEditando(servidor.pasta)}>
                <EditIcon className="h-3.5 w-3.5" aria-hidden />
              </IconButton>
              <IconButton label={`Abrir localhost:${principal} no navegador`} onClick={() => void openUrl(`http://localhost:${principal}/`).catch(() => undefined)}>
                <GlobeIcon className="h-3.5 w-3.5" aria-hidden />
              </IconButton>
              {!servidor.proprio && (
                <IconButton label={`Derrubar ${nome}`} danger disabled={busy === servidor.pasta} onClick={() => setConfirmar(servidor.pasta)}>
                  <StopIcon className="h-3.5 w-3.5" aria-hidden />
                </IconButton>
              )}
            </div>
            {confirmar === servidor.pasta && (
              <div className="flex items-center gap-2 pb-1 pl-11 text-[11px]">
                <span className="text-danger">Derrubar {servidor.tipo} :{servidor.portas.join(" :")}?</span>
                <button type="button" className="text-danger underline" onClick={() => void matar(servidor)}>Sim</button>
                <button type="button" className="text-text-muted underline" onClick={() => setConfirmar(null)}>Não</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
