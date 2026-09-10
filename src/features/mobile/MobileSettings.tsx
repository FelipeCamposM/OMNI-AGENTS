import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button, Field, Input } from "../../components/ui";

interface Settings { config: { enabled: boolean; bind: string }; listening: string | null; error: string | null }
export function MobileSettings() {
  const [status, setStatus] = useState<Settings | null>(null);
  const [bind, setBind] = useState("127.0.0.1:47322");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!status?.config.enabled || status.listening || status.error) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void invoke<Settings>("mobile_settings", { config: null }).then(value => {
        if (!cancelled) setStatus(value);
      }).catch(reason => { if (!cancelled) setError(String(reason)); });
    }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [status?.config.enabled, status?.listening, status?.error]);
  useEffect(() => {
    let cancelled = false;
    invoke<Settings>("mobile_settings", { config: null }).then(value => {
      if (!cancelled) { setStatus(value); setBind(value.config.bind); }
    }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, []);
  async function save(enabled: boolean) {
    setBusy(true); setError(null);
    try {
      await invoke("mobile_settings", { config: { enabled, bind } });
      await new Promise(resolve => window.setTimeout(resolve, 500));
      setStatus(await invoke<Settings>("mobile_settings", { config: null }));
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4" aria-label="Acesso pelo celular">
    <h2 className="text-sm font-semibold">Acesso pelo celular · Tailscale</h2>
    <p className="text-xs text-text-secondary">Instale o Tailscale no PC e no celular com a mesma conta. Informe abaixo o IP do PC mostrado no Tailscale e a porta 47322. O acesso continua com a janela do OMNI fechada, enquanto o PC e o engine estiverem ligados.</p>
    <Field label="Endereço HTTP" htmlFor="mobile-bind"><Input id="mobile-bind" value={bind} onChange={event => setBind(event.target.value)} placeholder="100.x.x.x:47322" /></Field>
    <p className="text-xs text-text-muted">127.0.0.1 permite testar somente neste PC.</p>
    <div className="flex gap-2"><Button disabled={busy} onClick={() => void save(true)}>Ativar / aplicar</Button><Button variant="ghost" disabled={busy || !status?.config.enabled} onClick={() => void save(false)}>Desativar</Button></div>
    {status?.listening && <p className="text-sm">Abra no celular: <a className="text-accent underline" href={status.listening} target="_blank" rel="noreferrer">{status.listening}</a></p>}
    {(error || status?.error) && <p role="alert" className="text-xs text-danger">{error || status?.error}</p>}
    {status && !status.config.enabled && <p className="text-xs text-text-muted">Acesso mobile desativado.</p>}
  </section>;
}
