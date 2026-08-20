import { useEffect, useState } from "react";
import { MODULES } from "../components/ModuleGate";
import type { ModuleId } from "../components/ModuleGate";

export type SettingsSection = "modulos" | "sobre";

export interface Notificacao {
  id: string;
  titulo: string;
  detalhe: string;
  /** Seção das Configurações onde a ação de fato acontece. */
  secao: SettingsSection;
}

/**
 * Pendências que o usuário precisa ver: módulos ainda não baixados e versão
 * nova do app.
 *
 * O sino apenas **avisa e leva** até Configurações — instalar continua sendo
 * responsabilidade do `ModuleCard`/`UpdateCard`. Duplicar o fluxo de download
 * aqui daria dois caminhos para o mesmo bug.
 */
export function useNotifications() {
  const [itens, setItens] = useState<Notificacao[]>([]);

  useEffect(() => {
    let cancelado = false;

    async function apurar() {
      const achados: Notificacao[] = [];

      // Módulos sob demanda (ffmpeg, Docling).
      const ids = Object.keys(MODULES) as ModuleId[];
      const estados = await Promise.all(
        ids.map(async (id) => {
          try {
            // Só `false` explícito conta como faltando — fora do Tauri o
            // invoke devolve undefined e o sino não deve inventar pendência.
            return (await MODULES[id].checar()) === false;
          } catch {
            return false;
          }
        })
      );
      ids.forEach((id, i) => {
        if (!estados[i]) return;
        achados.push({
          id: `modulo:${id}`,
          titulo: MODULES[id].titulo,
          detalhe: "Ainda não instalado. Necessário para as ferramentas que dependem dele.",
          secao: "modulos",
        });
      });

      // Versão nova. Falha de rede aqui não vira notificação — o usuário não
      // pode fazer nada a respeito e um alerta permanente só irrita.
      try {
        const { check } = await import("@tauri-apps/plugin-updater");
        const upd = await check();
        if (upd) {
          achados.push({
            id: `update:${upd.version}`,
            titulo: `Versão ${upd.version} disponível`,
            detalhe: "Atualize sem reinstalar o aplicativo.",
            secao: "sobre",
          });
        }
      } catch {
        /* sem internet ou fora do Tauri */
      }

      if (!cancelado) setItens(achados);
    }

    void apurar();
    return () => {
      cancelado = true;
    };
  }, []);

  return itens;
}
