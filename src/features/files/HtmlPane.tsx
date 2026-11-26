// Arquivo .html: o código (o mesmo editor dos outros arquivos) ou a página renderizada, lado a lado se quiser.
import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { CodeIcon, GlobeIcon, ReloadIcon } from "../../components/ui/PixelIcon";
import type { WorkspaceTab } from "../../types/workspace";
import { FilePane } from "./FilePane";
import { fileMtime } from "./filesService";

type Modo = "codigo" | "pagina" | "lado";
const MODOS: { valor: Modo; rotulo: string }[] = [
  { valor: "codigo", rotulo: "Código" },
  { valor: "pagina", rotulo: "Página" },
  { valor: "lado", rotulo: "Lado a lado" },
];

/**
 * A página roda num iframe pelo protocolo de arquivos do Tauri (CSS, JS e imagens relativos carregam
 * da pasta dela). `sandbox` sem `allow-same-origin`: o script da página não alcança o app nem o IPC.
 * Recarrega sozinha quando o arquivo muda (salvo aqui ou pelo agente).
 */
export function HtmlPane({ projectPath, tab, fileSaveMode, onDirtyChange }: {
  projectPath: string; tab: WorkspaceTab; fileSaveMode: "auto" | "manual"; onDirtyChange: (tabId: string, dirty: boolean) => void;
}) {
  const path = tab.resourceId ?? "";
  const [modo, setModo] = useState<Modo>("lado");
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    if (modo === "codigo") return;
    let vivo = true, ultimo = 0, timer: number | undefined;
    const olhar = async () => {
      const mtime = await fileMtime(path).catch(() => ultimo);
      if (!vivo) return;
      if (ultimo && mtime !== ultimo) setVersao((v) => v + 1);
      ultimo = mtime;
      timer = window.setTimeout(olhar, 1000);
    };
    void olhar();
    return () => { vivo = false; window.clearTimeout(timer); };
  }, [path, modo]);

  const pagina = (
    <iframe key={versao} src={convertFileSrc(path)} title={`Página: ${tab.title}`}
      sandbox="allow-scripts allow-forms allow-modals allow-popups" className="h-full w-full border-0 bg-white" />
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b-2 border-border-subtle bg-bg-elevated px-3 py-1.5">
        <div role="group" aria-label="Como ver o HTML" className="flex">
          {MODOS.map(({ valor, rotulo }) => (
            <button key={valor} type="button" aria-pressed={modo === valor} onClick={() => setModo(valor)}
              className={`flex items-center gap-1.5 border-2 px-2.5 py-1 text-[11px] font-semibold -ml-[2px] first:ml-0 transition-colors ${modo === valor
                ? "z-10 border-accent bg-accent/15 text-accent" : "border-border-subtle text-text-muted hover:text-text-primary"}`}>
              {valor === "codigo" ? <CodeIcon className="h-3.5 w-3.5" aria-hidden /> : <GlobeIcon className="h-3.5 w-3.5" aria-hidden />}
              {rotulo}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {modo !== "codigo" && (
          <button type="button" onClick={() => setVersao((v) => v + 1)} title="Recarregar a página"
            className="flex items-center gap-1.5 border-2 border-border-subtle px-2 py-1 text-[11px] text-text-muted hover:text-text-primary">
            <ReloadIcon className="h-3.5 w-3.5" aria-hidden />Recarregar
          </button>
        )}
      </div>
      {modo === "codigo" ? (
        <FilePane projectPath={projectPath} tab={tab} saveMode={fileSaveMode} onDirtyChange={onDirtyChange} />
      ) : modo === "pagina" ? (
        <div className="min-h-0 flex-1">{pagina}</div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-2">
          <div className="min-h-0 min-w-0 border-r-2 border-border-subtle">
            <FilePane projectPath={projectPath} tab={tab} saveMode={fileSaveMode} onDirtyChange={onDirtyChange} />
          </div>
          <div className="min-h-0 min-w-0">{pagina}</div>
        </div>
      )}
    </div>
  );
}
