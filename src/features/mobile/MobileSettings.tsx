import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import QRCode from "qrcode";
import { Button, Field, Input } from "../../components/ui";

interface Settings {
  config: { enabled: boolean; bind: string; token: string; serve: boolean };
  listening: string | null;
  error: string | null;
  /** Link com o token no fragmento. Só existe quando há endereço público de pé. */
  qr: string | null;
  /** O que o celular abre de fato: o endereço do Serve quando ligado, senão o bind. */
  public_url: string | null;
  magic_dns: string | null;
  /** Link para habilitar o Serve na conta Tailscale, quando ainda não está habilitado. */
  serve_hint: string | null;
  totp_confirmed: boolean;
  /** `otpauth://` para o QR do Authy. Só vem enquanto o cadastro não foi confirmado. */
  totp_uri: string | null;
}

const PORTA_PADRAO = "47322";

/** Um passo da explicação. `feito` pinta o número de verde; é o que dá a sensação de progresso. */
function Passo({ n, titulo, feito, children }: { n: number; titulo: string; feito?: boolean; children?: React.ReactNode }) {
  return <li className="flex gap-3">
    <span aria-hidden className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
      feito ? "bg-success/20 text-success" : "bg-overlay/10 text-text-muted"}`}>{feito ? "✓" : n}</span>
    <div className="min-w-0 flex-1 space-y-2">
      <p className="text-xs font-medium text-text-primary">{titulo}</p>
      {children}
    </div>
  </li>;
}

export function MobileSettings() {
  const [status, setStatus] = useState<Settings | null>(null);
  const [bind, setBind] = useState(`127.0.0.1:${PORTA_PADRAO}`);
  const [serve, setServe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [teste, setTeste] = useState<{ ok: boolean; message: string } | null>(null);
  const [authyQr, setAuthyQr] = useState<string | null>(null);
  const [codigoAuthy, setCodigoAuthy] = useState("");
  const [erroAuthy, setErroAuthy] = useState<string | null>(null);
  const [confirmarRefazer, setConfirmarRefazer] = useState(false);
  const [falhouAbrir, setFalhouAbrir] = useState(false);
  const [falhouAbrirEndereco, setFalhouAbrirEndereco] = useState(false);

  const carregar = useCallback(async () => invoke<Settings>("mobile_settings", { config: null }), []);

  // Consulta enquanto algo ainda está a caminho: o servidor subindo, ou o Serve publicando — que roda
  // em segundo plano no engine e pode levar dezenas de segundos para devolver o endereço.
  const aguardando = Boolean(status?.config.enabled && !status.error && (
    !status.listening || (status.config.serve && !status.public_url && !status.serve_hint)));
  useEffect(() => {
    if (!aguardando) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void carregar().then(value => { if (!cancelled) setStatus(value); })
        .catch(reason => { if (!cancelled) setError(String(reason)); });
    }, 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [carregar, aguardando]);

  useEffect(() => {
    let cancelled = false;
    carregar().then(value => {
      if (cancelled) return;
      setStatus(value);
      setServe(value.config.serve);
      // Endereço só é sugerido depois que se sabe o modo: no Serve o bind fica em loopback.
      setBind(value.config.bind);
    }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [carregar]);

  // O QR é desenhado a partir do link que o engine monta — o desktop nunca inventa o token.
  useEffect(() => {
    let cancelled = false;
    if (!status?.qr) { setQrImage(null); return; }
    QRCode.toDataURL(status.qr, { margin: 1, width: 240 })
      .then(url => { if (!cancelled) setQrImage(url); })
      .catch(() => { if (!cancelled) setQrImage(null); });
    return () => { cancelled = true; };
  }, [status?.qr]);

  useEffect(() => {
    let cancelled = false;
    if (!status?.totp_uri) { setAuthyQr(null); return; }
    QRCode.toDataURL(status.totp_uri, { margin: 1, width: 200 })
      .then(url => { if (!cancelled) setAuthyQr(url); })
      .catch(() => { if (!cancelled) setAuthyQr(null); });
    return () => { cancelled = true; };
  }, [status?.totp_uri]);

  async function salvar(enabled: boolean, opcoes: { rotate?: boolean; serve?: boolean } = {}) {
    const modoServe = opcoes.serve ?? serve;
    // No modo Serve quem atende a rede é o Tailscale; o servidor fica só em loopback.
    const endereco = modoServe ? `127.0.0.1:${bind.split(":").pop() || PORTA_PADRAO}` : bind;
    setBusy(true); setError(null); setCopiado(false); setTeste(null);
    try {
      await invoke("mobile_settings", {
        config: { enabled, bind: endereco, token: "", serve: modoServe },
        rotate: opcoes.rotate ?? false,
      });
      await new Promise(resolve => window.setTimeout(resolve, 500));
      const novo = await carregar();
      setStatus(novo); setBind(novo.config.bind); setServe(novo.config.serve);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }

  async function abrirLiberacao(link: string) {
    setFalhouAbrir(false);
    // A chamada falhava calada (permissão de abrir URL faltando e erro engolido pelo `void`), e o
    // botão parecia simplesmente não fazer nada.
    try { await openUrl(link); } catch { setFalhouAbrir(true); }
  }

  async function authy(action: "reset" | "confirm") {
    setBusy(true); setErroAuthy(null);
    try {
      const novo = await invoke<Settings>("mobile_totp", { action, code: action === "confirm" ? codigoAuthy : null });
      setStatus(novo); setCodigoAuthy(""); setConfirmarRefazer(false);
    } catch (reason) { setErroAuthy(String(reason)); }
    finally { setBusy(false); }
  }

  async function testar() {
    setBusy(true); setTeste(null);
    try { setTeste(await invoke<{ ok: boolean; message: string }>("mobile_check")); }
    catch (reason) { setTeste({ ok: false, message: String(reason) }); }
    finally { setBusy(false); }
  }

  const ligado = Boolean(status?.config.enabled && status.listening);
  const pronto = Boolean(status?.public_url);
  // Só o link de liberação vira botão. Qualquer outra coisa no aviso é erro e aparece como texto —
  // antes a tela mandava "liberar na conta" até quando o problema era outro.
  const linkLiberar = status?.serve_hint?.startsWith("https://login.tailscale.com/") ? status.serve_hint : null;

  return <section className="space-y-5" aria-label="Acesso pelo celular">
    <div>
      <h2 className="text-sm font-semibold">Usar o OMNI pelo celular</h2>
      <p className="text-xs text-text-secondary mt-1">
        Você manda prompts do telefone e os agentes rodam aqui no PC. Funciona de qualquer lugar,
        inclusive no 4G — o PC precisa estar ligado. Fechar a janela do OMNI não desliga o acesso.
      </p>
    </div>

    <ol className="space-y-5">
      <Passo n={1} titulo="Instale o Tailscale no PC e no celular" feito={Boolean(status?.magic_dns)}>
        {status?.magic_dns
          ? <p className="text-xs text-text-muted">Detectado: <code>{status.magic_dns}</code></p>
          : <p className="text-xs text-text-secondary">
              É o que liga os dois aparelhos com segurança, sem abrir nada para a internet. Use a
              <strong> mesma conta</strong> nos dois. Depois de instalar, volte aqui.
            </p>}
      </Passo>

      <Passo n={2} titulo="Escolha como o celular chega até aqui" feito={ligado}>
        <div className="space-y-2">
          <label className="flex gap-2 items-start text-xs text-text-secondary">
            <input type="radio" name="modo" className="mt-0.5" checked={!serve} onChange={() => setServe(false)} />
            <span>
              <strong className="text-text-primary">Direto (funciona na hora).</strong> O OMNI usa o
              endereço do Tailscale deste PC automaticamente. Não precisa configurar nada.
            </span>
          </label>
          <label className="flex gap-2 items-start text-xs text-text-secondary">
            <input type="radio" name="modo" className="mt-0.5" checked={serve} onChange={() => setServe(true)} />
            <span>
              <strong className="text-text-primary">Seguro com HTTPS.</strong> O Tailscale publica com
              certificado e nome fixo. Pede para liberar uma vez na sua conta Tailscale.
            </span>
          </label>
        </div>

        {!serve && <details className="text-xs text-text-muted">
          <summary className="cursor-pointer">Endereço usado: {bind}</summary>
          {/* Preenchido pelo engine: com Tailscale no ar, loopback vira o IP do Tailscale sozinho. */}
          <Field label="Trocar endereço (avançado)" htmlFor="mobile-bind">
            <Input id="mobile-bind" value={bind} onChange={event => setBind(event.target.value)} placeholder={`100.x.x.x:${PORTA_PADRAO}`} />
          </Field>
        </details>}

        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void salvar(true)}>{ligado ? "Aplicar" : "Ativar"}</Button>
          {status?.config.enabled && <Button variant="ghost" disabled={busy} onClick={() => void salvar(false)}>Desativar</Button>}
          {ligado && <Button variant="ghost" disabled={busy} onClick={() => void testar()}>Testar</Button>}
        </div>

        {teste && <p role="status" className={`text-xs ${teste.ok ? "text-success" : "text-warning"}`}>{teste.message}</p>}

        {linkLiberar && <div className="border border-warning p-3 space-y-2">
          <p className="text-xs text-warning">
            Falta liberar o endereço seguro na sua conta Tailscale. É uma vez só, para a conta
            inteira — depois vale em qualquer PC seu.
          </p>
          <ol className="list-decimal pl-4 text-xs text-text-secondary space-y-1">
            <li>Clique no botão abaixo. Abre a página do Tailscale no navegador.</li>
            <li>Entre com a mesma conta do Tailscale deste PC, se pedir.</li>
            <li>Confirme a liberação na página.</li>
            <li>Volte aqui e clique em <strong>Aplicar</strong>.</li>
          </ol>
          <Button disabled={busy} onClick={() => void abrirLiberacao(linkLiberar)}>Liberar na conta Tailscale</Button>
          {/* Fallback visível: se o navegador não abrir, o link continua na tela para copiar. */}
          {falhouAbrir && <p className="text-[10px] text-text-muted break-all">
            Não consegui abrir o navegador. Copie e cole: <code>{linkLiberar}</code>
          </p>}
        </div>}
        {status?.serve_hint && !linkLiberar && <p role="alert" className="text-xs text-warning">{status.serve_hint}</p>}
      </Passo>

      <Passo n={3} titulo="Aponte a câmera do celular para o código" feito={pronto}>
        {pronto ? <div className="space-y-3">
          {qrImage && <img src={qrImage} alt="Código QR de acesso pelo celular"
            className="bg-white p-3" width={240} height={240} />}
          <p className="text-xs text-text-secondary">
            O código já leva o acesso junto — não precisa digitar senha. Abre em:{" "}
            {/* Botão com `openUrl`, não `<a target="_blank">`: dentro do Tauri o link comum não abre
                navegador nenhum, e o clique parecia simplesmente não fazer nada. */}
            <button type="button" className="text-accent underline break-all" onClick={() => {
              setFalhouAbrirEndereco(false);
              // Barra no fim: a permissão casa `https://*.ts.net/*` na string crua, e o engine manda
              // o endereço sem ela.
              const url = status!.public_url!;
              openUrl(url.endsWith("/") ? url : `${url}/`).catch(() => setFalhouAbrirEndereco(true));
            }}>{status!.public_url}</button>
          </p>
          {falhouAbrirEndereco && <p className="text-[10px] text-text-muted break-all">
            Não consegui abrir o navegador. Copie e cole: <code>{status!.public_url}</code>
          </p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => {
              void navigator.clipboard.writeText(status!.qr!).catch(() => undefined); setCopiado(true);
            }}>{copiado ? "Link copiado" : "Copiar link"}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => void salvar(true, { rotate: true })}>Trocar o código</Button>
            {status?.config.token && <span className="text-[10px] text-text-muted">acesso …{status.config.token.slice(-6)}</span>}
          </div>
          <p className="text-[10px] text-text-muted">
            Trocar o código desconecta os celulares já conectados. Faça isso se perder o telefone.
          </p>
        </div> : ligado && !serve ? <p className="text-xs text-warning">
          O Tailscale não foi encontrado neste PC, então o endereço atual ({bind}) só abre aqui mesmo.
          Instale e conecte o Tailscale e clique em Aplicar — o código aparece em seguida.
        </p> : ligado && serve && !status?.serve_hint ? <p className="text-xs text-text-secondary">
          Publicando pelo Tailscale… isso pode levar alguns segundos.
        </p> : <p className="text-xs text-text-secondary">O código aparece aqui quando o acesso estiver ligado.</p>}
      </Passo>

      <Passo n={4} titulo="Proteger com o Authy" feito={Boolean(status?.totp_confirmed)}>
        <p className="text-xs text-text-secondary">
          É o que libera o <strong>app da tela inicial do iPhone</strong>. Ele não enxerga o acesso que o QR
          acima guardou no Safari, então pede o código de 6 dígitos do Authy na primeira vez que abre.
        </p>
        {status?.totp_confirmed ? <div className="space-y-2">
          <p className="text-xs text-success">Authy configurado ✓ Qualquer aparelho pareia com o código atual.</p>
          {confirmarRefazer ? <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-warning">O cadastro atual do Authy para de funcionar. Continuar?</span>
            <Button variant="ghost" disabled={busy} onClick={() => void authy("reset")}>Sim, refazer</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmarRefazer(false)}>Cancelar</Button>
          </div> : <Button variant="ghost" disabled={busy} onClick={() => setConfirmarRefazer(true)}>Refazer cadastro</Button>}
        </div> : status?.totp_uri ? <div className="space-y-3">
          <ol className="list-decimal pl-4 text-xs text-text-secondary space-y-1">
            <li>No Authy, toque em <strong>+</strong> e leia este código.</li>
            <li>Digite abaixo o código de 6 dígitos que aparecer para <strong>OMNI AGENTS</strong>.</li>
          </ol>
          {authyQr && <img src={authyQr} alt="QR code para cadastrar no Authy" className="bg-white p-3" width={200} height={200} />}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Código do Authy" htmlFor="codigo-authy-pc">
              <Input id="codigo-authy-pc" inputMode="numeric" maxLength={6} value={codigoAuthy} placeholder="000000"
                onChange={event => setCodigoAuthy(event.target.value.replace(/\D/g, "").slice(0, 6))} />
            </Field>
            <Button disabled={busy || codigoAuthy.length !== 6} onClick={() => void authy("confirm")}>Confirmar</Button>
          </div>
        </div> : <Button disabled={busy} onClick={() => void authy("reset")}>Configurar Authy</Button>}
        {erroAuthy && <p role="alert" className="text-xs text-danger">{erroAuthy}</p>}
      </Passo>
    </ol>

    {(error || status?.error) && <div className="border border-danger p-3 space-y-1">
      <p role="alert" className="text-xs text-danger">{error || status?.error}</p>
      <p className="text-[10px] text-text-muted">
        Se a mensagem falar em engine desatualizado, feche o OMNI, encerre <code>omni-engine.exe</code> no
        Gerenciador de Tarefas e abra o app de novo.
      </p>
    </div>}
  </section>;
}
