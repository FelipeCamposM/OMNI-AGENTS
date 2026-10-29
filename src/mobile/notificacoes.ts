import { useEffect, useRef, useState } from "react";
import { chaveDeAtencao, type Conversation } from "./api";

/** O que avisar. Fica no aparelho (cada celular escolhe o seu); o PC não sabe disso. */
export interface PrefsDeAviso {
  ligadas: boolean;
  /** Agente parado pedindo aprovação. */
  aprovacao: boolean;
  /** Agente terminou o turno e espera a próxima mensagem. */
  terminou: boolean;
  vibrar: boolean;
  /** Avisa mesmo com a página na frente (sem isso, só com ela em segundo plano). */
  comAPaginaAberta: boolean;
}

const CHAVE = "omni-avisos";
export const PADRAO: PrefsDeAviso = { ligadas: false, aprovacao: true, terminou: true, vibrar: true, comAPaginaAberta: false };

export function lerPrefs(): PrefsDeAviso {
  try { return { ...PADRAO, ...JSON.parse(localStorage.getItem(CHAVE) ?? "{}") }; } catch { return PADRAO; }
}

export function gravarPrefs(prefs: PrefsDeAviso) {
  try { localStorage.setItem(CHAVE, JSON.stringify(prefs)); } catch { /* sem armazenamento: vale só agora */ }
  window.dispatchEvent(new Event(CHAVE));
}

export function usePrefsDeAviso(): [PrefsDeAviso, (mudanca: Partial<PrefsDeAviso>) => void] {
  const [prefs, setPrefs] = useState(lerPrefs);
  useEffect(() => {
    const reler = () => setPrefs(lerPrefs());
    window.addEventListener(CHAVE, reler);
    return () => window.removeEventListener(CHAVE, reler);
  }, []);
  return [prefs, (mudanca) => gravarPrefs({ ...lerPrefs(), ...mudanca })];
}

/** `inseguro`: o navegador só libera notificação em HTTPS — o modo "Seguro com HTTPS" do Acesso remoto. */
export type Suporte = "ok" | "inseguro" | "sem-suporte";
export function suporte(): Suporte {
  if (typeof window === "undefined" || !("Notification" in window)) return "sem-suporte";
  return window.isSecureContext ? "ok" : "inseguro";
}

export function permissao(): NotificationPermission | "indisponivel" {
  return suporte() === "ok" ? Notification.permission : "indisponivel";
}

let registro: Promise<ServiceWorkerRegistration | null> | null = null;
/** O service worker é o que deixa o Android mostrar o aviso e trazer a página de volta no toque. */
function trabalhador(): Promise<ServiceWorkerRegistration | null> {
  if (!registro) {
    registro = "serviceWorker" in navigator
      ? navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready).catch(() => null)
      : Promise.resolve(null);
  }
  return registro;
}

export async function pedirPermissao(): Promise<NotificationPermission | "indisponivel"> {
  if (suporte() !== "ok") return "indisponivel";
  const resposta = await Notification.requestPermission();
  if (resposta === "granted") void trabalhador();
  return resposta;
}

export async function notificar(titulo: string, corpo: string, opcoes: { tag: string; url: string; vibrar: boolean }) {
  if (permissao() !== "granted") return;
  const dados = { body: corpo, tag: opcoes.tag, icon: "/icon-192.png", badge: "/favicon.png", data: { url: opcoes.url },
    ...(opcoes.vibrar ? { vibrate: [120, 60, 120] } : {}) } as NotificationOptions;
  const sw = await trabalhador();
  // Android não aceita `new Notification` (só pelo service worker); o desktop aceita os dois.
  if (sw) { await sw.showNotification(titulo, dados); return; }
  try { new Notification(titulo, dados); } catch { /* navegador sem suporte fora do service worker */ }
}

/** Avisos que ainda não foram mostrados: a primeira leitura só marca o que já estava lá. */
export function novosAvisos(lista: readonly Conversation[], vistos: Set<string>, primeira: boolean): Conversation[] {
  const novos = lista.filter((item) => !vistos.has(`${item.id}#${chaveDeAtencao(item)}`));
  for (const item of lista) vistos.add(`${item.id}#${chaveDeAtencao(item)}`);
  return primeira ? [] : novos;
}

/** Notificação do sistema quando uma conversa passa a precisar de você (aprovar ou responder). */
export function useNotificacoes(atencao: readonly Conversation[], carregado: boolean, url: (id: string) => string) {
  const [prefs] = usePrefsDeAviso();
  const vistos = useRef(new Set<string>());
  const primeira = useRef(true);
  useEffect(() => {
    if (!carregado) return;
    const novos = novosAvisos(atencao, vistos.current, primeira.current);
    primeira.current = false;
    if (!prefs.ligadas || novos.length === 0) return;
    if (!prefs.comAPaginaAberta && document.visibilityState === "visible" && document.hasFocus()) return;
    for (const conversa of novos) {
      const aprovar = Boolean(conversa.capabilities?.approve);
      if (aprovar ? !prefs.aprovacao : !prefs.terminou) continue;
      void notificar(aprovar ? "Aprovação pendente" : "Agente terminou", conversa.title,
        { tag: conversa.id, url: url(conversa.id), vibrar: prefs.vibrar });
    }
  }, [atencao, carregado, prefs, url]);
}
