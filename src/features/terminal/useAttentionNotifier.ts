import { useEffect, useRef } from "react";
import { ATTENTION_LABEL, type AttentionItem } from "./useAttention";

/** Chave de um aviso: mesma sessão com motivo novo volta a notificar; repetir o mesmo motivo não. */
function keyOf(item: AttentionItem): string {
  return `${item.sessionId}:${item.reason}`;
}

/**
 * Toast do Windows + piscar na barra de tarefas quando um agente pede atenção com o app fora de
 * foco. Dois mecanismos porque resolvem coisas diferentes: o toast conta **o que** aconteceu e
 * some, o piscar da barra fica lá até você olhar.
 *
 * Só dispara com a janela sem foco de propósito — se o app está na sua frente, a seção ATENÇÃO da
 * sidebar já mostra tudo, e um toast por cima disso é barulho.
 *
 * Fora do Tauri (testes, `dev:vite`) os imports dinâmicos falham: notificação é aviso, nunca pode
 * derrubar a tela. Mas falha **sempre loga** — um catch mudo aqui torna "não apareceu nada"
 * impossível de diagnosticar, que foi exatamente o que aconteceu na primeira versão disto.
 */
export function useAttentionNotifier(items: AttentionItem[], enabled: boolean) {
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    const current = new Set(items.map(keyOf));
    // Um aviso que sumiu (usuário viu, agente voltou a trabalhar) pode notificar de novo depois.
    for (const key of notified.current) {
      if (!current.has(key)) notified.current.delete(key);
    }

    if (!enabled) return;
    const novos = items.filter((item) => !notified.current.has(keyOf(item)));
    if (novos.length === 0) return;

    let cancelado = false;

    void (async () => {
      try {
        const { getCurrentWindow, UserAttentionType } = await import("@tauri-apps/api/window");
        const janela = getCurrentWindow();
        if (await janela.isFocused()) {
          // eslint-disable-next-line no-console
          console.debug("[atenção] toast suprimido: a janela do OMNI está em foco", novos.map(keyOf));
          return;
        }
        if (cancelado) return;

        // Marca só depois de confirmar que vai notificar — senão um aviso que chegou com a janela
        // em foco nunca mais notificaria.
        for (const item of novos) notified.current.add(keyOf(item));

        const { isPermissionGranted, requestPermission, sendNotification } = await import(
          "@tauri-apps/plugin-notification"
        );
        let permitido = await isPermissionGranted();
        if (!permitido) permitido = (await requestPermission()) === "granted";

        if (permitido) {
          // Um toast por agente até três; acima disso vira resumo — dez toasts empilhados no
          // Windows são dez cliques pra limpar.
          if (novos.length <= 3) {
            for (const item of novos) {
              sendNotification({
                title: `${item.workspaceName} · ${item.projectName}`,
                body: `${item.sessionName} — ${ATTENTION_LABEL[item.reason]}`,
              });
            }
          } else {
            sendNotification({
              title: "OMNI AGENTS",
              body: `${novos.length} agentes precisam de você`,
            });
          }
        }

        // Pisca o botão na barra de tarefas e para quando a janela ganha foco.
        await janela.requestUserAttention(UserAttentionType.Informational);
      } catch (motivo) {
        // Fora do Tauri, plugin ausente no binário em execução, ou toast bloqueado no Windows.
        // O aviso na sidebar continua valendo — mas o motivo real precisa aparecer em algum lugar.
        // eslint-disable-next-line no-console
        console.error("[atenção] falha ao notificar:", motivo);
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [items, enabled]);
}

/**
 * Dispara um aviso de mentira agora, **ignorando a regra de foco**, e devolve o erro real em vez
 * de engolir. É o que o botão "Testar aviso" das Configurações usa: sem isso, "não apareceu nada"
 * tem cinco causas possíveis (plugin fora do binário, permissão negada, toast desligado no
 * Windows, janela em foco, app rodando fora do Tauri) e nenhuma forma de distinguir.
 */
export async function testarAviso(): Promise<string | null> {
  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    );
    let permitido = await isPermissionGranted();
    if (!permitido) permitido = (await requestPermission()) === "granted";
    if (!permitido) return "O Windows negou permissão de notificação para o OMNI AGENTS.";

    sendNotification({ title: "OMNI AGENTS", body: "Teste de aviso — é assim que um agente te chama." });

    const { getCurrentWindow, UserAttentionType } = await import("@tauri-apps/api/window");
    await getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
    return null;
  } catch (motivo) {
    return motivo instanceof Error ? motivo.message : String(motivo);
  }
}
