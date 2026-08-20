import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";

/**
 * Progresso e etapa vindos do backend (`tool-progress` / `tool-step`).
 *
 * Os eventos são da **janela**, não de um componente — montar dois ouvintes ao
 * mesmo tempo faria as duas telas reagirem ao progresso uma da outra. Cada
 * ferramenta monta um só.
 */
export function useToolProgress() {
  const [progresso, setProgresso] = useState(0);
  const [etapa, setEtapa] = useState<string | null>(null);

  useEffect(() => {
    const uns = [
      listen<number>("tool-progress", (e) => setProgresso(e.payload)),
      listen<string>("tool-step", (e) => setEtapa(e.payload)),
    ];
    return () => {
      uns.forEach((u) => u.then((fn) => fn()));
    };
  }, []);

  const zerar = useCallback(() => {
    setProgresso(0);
    setEtapa("Iniciando…");
  }, []);

  return { progresso, etapa, zerar };
}
