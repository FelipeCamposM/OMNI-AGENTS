import { useCallback, useEffect, useState } from "react";
import { Button } from "./ui";

type Fase = "ocioso" | "checando" | "disponivel" | "baixando" | "pronto" | "atual" | "erro";

interface Novidade {
  version: string;
  notes?: string;
}

/**
 * Atualização pelo app (plugin updater do Tauri).
 *
 * O download acontece no Rust, então o CSP da webview não entra na história —
 * e a assinatura minisign é conferida antes de instalar qualquer coisa. Sem a
 * chave privada correspondente à `pubkey` do tauri.conf.json, um pacote
 * adulterado é recusado.
 *
 * Imports do plugin são dinâmicos: fora do Tauri (`npm run dev:vite`, testes)
 * o módulo nem existe, e um import estático quebraria a tela inteira.
 */
export function UpdateCard() {
  const [fase, setFase] = useState<Fase>("ocioso");
  const [novidade, setNovidade] = useState<Novidade | null>(null);
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState<string | null>(null);

  const checar = useCallback(async (silencioso = false) => {
    if (!silencioso) setFase("checando");
    setErro(null);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const upd = await check();
      if (upd) {
        setNovidade({ version: upd.version, notes: upd.body });
        setFase("disponivel");
      } else if (!silencioso) {
        setFase("atual");
      }
    } catch (e) {
      if (silencioso) return; // sem internet no boot não é assunto do usuário
      setErro(String(e));
      setFase("erro");
    }
  }, []);

  // Checagem silenciosa ao abrir a tela: quem entra em Configurações quer
  // saber, e falhar calado é melhor que um erro de rede no rosto.
  useEffect(() => {
    void checar(true);
  }, [checar]);

  async function instalar() {
    setFase("baixando");
    setProgresso(0);
    setErro(null);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const upd = await check();
      if (!upd) {
        setFase("atual");
        return;
      }

      let total = 0;
      let baixado = 0;
      await upd.downloadAndInstall((e) => {
        if (e.event === "Started") {
          total = e.data.contentLength ?? 0;
        } else if (e.event === "Progress") {
          baixado += e.data.chunkLength;
          if (total > 0) setProgresso(Math.round((baixado / total) * 100));
        } else if (e.event === "Finished") {
          setProgresso(100);
        }
      });

      setFase("pronto");
    } catch (e) {
      setErro(String(e));
      setFase("erro");
    }
  }

  async function reiniciar() {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  }

  return (
    <Card>
      {fase === "disponivel" && novidade && (
        <>
          <p className="text-text-primary text-sm font-medium">
            Versão {novidade.version} disponível
          </p>
          {novidade.notes && (
            <p className="text-text-muted text-[11px] leading-relaxed whitespace-pre-line">
              {novidade.notes}
            </p>
          )}
          <Button variant="primary" onClick={instalar}>
            Baixar e instalar
          </Button>
        </>
      )}

      {fase === "baixando" && (
        <>
          <p className="text-text-primary text-sm font-medium">Baixando atualização…</p>
          <div className="glass-inset h-2 rounded-full overflow-hidden">
            <div
              className="shimmer h-full bg-accent transition-all duration-300"
              style={{ width: `${progresso}%` }}
              role="progressbar"
              aria-valuenow={progresso}
            />
          </div>
          <p className="text-text-muted text-[11px]">{progresso}%</p>
        </>
      )}

      {fase === "pronto" && (
        <>
          <p className="text-success text-sm font-medium">Atualização instalada</p>
          <p className="text-text-muted text-[11px]">
            Reinicie o app para usar a versão nova.
          </p>
          <Button variant="primary" onClick={reiniciar}>
            Reiniciar agora
          </Button>
        </>
      )}

      {(fase === "ocioso" || fase === "atual" || fase === "checando" || fase === "erro") && (
        <>
          <p className="text-xs">
            {fase === "atual" ? (
              <span className="text-success">✓ Você está na versão mais recente</span>
            ) : (
              <span className="text-text-muted">
                As atualizações são assinadas e verificadas antes de instalar.
              </span>
            )}
          </p>
          {erro && (
            <p role="alert" className="text-danger text-xs">
              {erro}
            </p>
          )}
          <Button onClick={() => checar()} loading={fase === "checando"}>
            {fase === "checando" ? "Procurando…" : "Procurar atualizações"}
          </Button>
        </>
      )}
    </Card>
  );
}

/** Mesma casca dos cards de Configurações, sem título próprio. */
function Card({ children }: { children: React.ReactNode }) {
  return <div className="glass glass-sheen !rounded-2xl p-5 space-y-3">{children}</div>;
}
