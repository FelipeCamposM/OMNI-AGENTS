import { useEffect, useState } from "react";

export type SettingsSection = "sobre";

export interface Notificacao {
  id: string;
  titulo: string;
  detalhe: string;
  /** Seção das Configurações onde a ação de fato acontece. */
  secao: SettingsSection;
}

/**
 * Pendências que o usuário precisa ver: por enquanto, só versão nova do app.
 * O sino apenas avisa e leva até Configurações — instalar é o `UpdateCard`.
 */
export function useNotifications() {
  const [itens, setItens] = useState<Notificacao[]>([]);

  useEffect(() => {
    let cancelado = false;

    async function apurar() {
      const achados: Notificacao[] = [];

      // Falha de rede aqui não vira notificação — o usuário não pode fazer
      // nada a respeito e um alerta permanente só irrita.
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
