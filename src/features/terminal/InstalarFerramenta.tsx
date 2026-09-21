import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "../../components/ui";

/** O que o Rust responde sobre instalar uma ferramenta neste sistema (`src-tauri/src/instalacao.rs`). */
interface Instalacao {
  comando: string;
  docs: string;
  automatico: boolean;
}

interface InstalarFerramentaProps {
  /** `claude`, `codex`, `cursor` ou `tailscale`. O comando em si mora no Rust. */
  id: string;
  nome: string;
  /** Texto curto que explica por que este bloco apareceu. */
  motivo: string;
}

/**
 * Como instalar uma ferramenta que falta, sem sair do app.
 *
 * O comando vem do Rust e é o oficial de cada projeto — a tela manda só o id, então nada que o
 * front monte vira linha de comando. "Instalar agora" abre um terminal **visível**: instalar mexe
 * na máquina, e quem clicou acompanha a saída e responde ao que o instalador perguntar.
 */
export function InstalarFerramenta({ id, nome, motivo }: InstalarFerramentaProps) {
  const [instalacao, setInstalacao] = useState<Instalacao | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);

  useEffect(() => {
    let cancelado = false;
    invoke<Instalacao | null>("install_hint", { id })
      .then((valor) => { if (!cancelado) setInstalacao(valor); })
      .catch(() => { if (!cancelado) setInstalacao(null); });
    return () => { cancelado = true; };
  }, [id]);

  if (!instalacao) return null;

  function falhou(reason: unknown) {
    setErro(reason instanceof Error ? reason.message : String(reason));
  }

  async function instalar() {
    setErro(null);
    setAbrindo(true);
    try { await invoke("install_agent_cli", { id }); }
    catch (reason) { falhou(reason); }
    finally { setAbrindo(false); }
  }

  function copiar() {
    void navigator.clipboard?.writeText(instalacao!.comando).then(() => {
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 1500);
    }).catch(falhou);
  }

  return (
    <div className="mt-2 space-y-2 border-l-2 border-accent/50 pl-3">
      <p className="text-[11px] text-text-muted">{motivo}</p>
      {instalacao.automatico && (
        <code className="block break-all bg-bg-primary px-2 py-1 text-[10px] text-text-secondary">{instalacao.comando}</code>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {instalacao.automatico ? (
          <>
            <Button size="sm" disabled={abrindo} onClick={() => void instalar()}>
              {abrindo ? "Abrindo terminal…" : `Instalar ${nome}`}
            </Button>
            <Button size="sm" variant="ghost" onClick={copiar}>{copiado ? "Copiado" : "Copiar comando"}</Button>
          </>
        ) : (
          <Button size="sm" onClick={() => void openUrl(instalacao.docs).catch(falhou)}>Baixar {nome}</Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => void openUrl(instalacao.docs).catch(falhou)}>
          Instruções oficiais
        </Button>
      </div>
      {instalacao.automatico && (
        <p className="text-[10px] text-text-muted">
          Abre um terminal e roda o instalador oficial. Quando terminar, clique em “Verificar novamente”
          aqui embaixo — e, se ainda não aparecer, feche e abra o OMNI.
        </p>
      )}
      {erro && <p role="alert" className="text-[11px] text-danger">{erro}</p>}
    </div>
  );
}
