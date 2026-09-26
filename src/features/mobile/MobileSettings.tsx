import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import QRCode from "qrcode";
import { Button, Field, Input } from "../../components/ui";
import { OmniLogo } from "../../components/ui/OmniLogo";
import { coresDaPaleta } from "../../lib/palettes";
import { InstalarFerramenta } from "../terminal/InstalarFerramenta";

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

/** Link da versão de computador (`/pc`), derivado do link do QR que o engine monta: mesmo endereço,
 *  mesmo token no fragmento. `null` se o formato do link mudar — melhor sumir que mandar errado. */
export function linkDoPc(qr: string | null | undefined): string | null {
  if (!qr) return null;
  const pc = qr.replace(/\/?#t=/, "/pc/#t=");
  return pc === qr ? null : pc;
}

/** Cor dos módulos do QR: o tom escuro da paleta **clara**, que em toda paleta passa de 4,5:1 no
 *  branco. O tom do tema escuro (ex.: ciano #22D3EE) ficaria bonito e ilegível para a câmera. */
export function corDoQr(accent: string | undefined): string {
  return coresDaPaleta(accent, true).deep;
}

/** QR com a cor do app: moldura em degradê da paleta, fundo branco (a câmera precisa do contraste) e
 *  a logo no centro. A logo tampa módulos de propósito — o QR sai com correção "H" (30%) para isso. */
function QrPersonalizado({ src, alt, tamanho }: { src: string; alt: string; tamanho: number }) {
  return <div className="inline-block shrink-0 p-1 shadow-glow"
    style={{ background: "linear-gradient(135deg, rgb(var(--c-accent)), rgb(var(--c-accent-hover)))" }}>
    <div className="relative bg-white p-2">
      <img src={src} alt={alt} width={tamanho} height={tamanho} className="block [image-rendering:pixelated]" />
      <span aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white p-1">
        <OmniLogo size={Math.round(tamanho * 0.16)} />
      </span>
    </div>
  </div>;
}

/** Um passo da configuração, no mesmo painel `glass` das outras abas. O número vira ✓ verde quando o
 *  passo está feito — é o que dá a sensação de progresso. */
function Passo({ n, titulo, feito, children }: { n: number; titulo: string; feito?: boolean; children?: React.ReactNode }) {
  return <li className="glass rounded-none p-5">
    <div className="flex items-center gap-3">
      <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center text-xs font-bold ${
        feito ? "bg-success/20 text-success" : "bg-accent/15 text-accent"}`}>{feito ? "✓" : n}</span>
      <h3 className="pixel-text min-w-0 flex-1 text-sm text-text-primary">{titulo}</h3>
      {feito && <span className="text-[10px] uppercase tracking-wide text-success">pronto</span>}
    </div>
    <div className="mt-4 space-y-3 md:pl-10">{children}</div>
  </li>;
}

/** Opção de modo como cartão clicável. O `<input type="radio">` continua lá para teclado e leitor
 *  de tela; o cartão é só a área de clique maior. */
function OpcaoModo({ ativo, titulo, selo, children, onSelect }: {
  ativo: boolean; titulo: string; selo: string; children: React.ReactNode; onSelect: () => void;
}) {
  return <label className={`flex cursor-pointer gap-3 border p-3 transition-colors ${
    ativo ? "border-accent bg-accent/10" : "border-border-subtle/60 hover:border-accent/50"}`}>
    <input type="radio" name="modo" className="mt-0.5 accent-[rgb(var(--c-accent))]" checked={ativo} onChange={onSelect} />
    <span className="min-w-0 space-y-1">
      <span className="flex flex-wrap items-center gap-2">
        <strong className="text-xs text-text-primary">{titulo}</strong>
        <span className={`px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${ativo ? "bg-accent/20 text-accent" : "bg-overlay/10 text-text-muted"}`}>{selo}</span>
      </span>
      <span className="block text-xs text-text-secondary">{children}</span>
    </span>
  </label>;
}

export function MobileSettings({ accent }: { accent?: string } = {}) {
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
  const [copiadoPc, setCopiadoPc] = useState(false);

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
    QRCode.toDataURL(status.qr, { margin: 1, width: 480, errorCorrectionLevel: "H", color: { dark: corDoQr(accent), light: "#FFFFFF" } })
      .then(url => { if (!cancelled) setQrImage(url); })
      .catch(() => { if (!cancelled) setQrImage(null); });
    return () => { cancelled = true; };
  }, [status?.qr, accent]);

  useEffect(() => {
    let cancelled = false;
    if (!status?.totp_uri) { setAuthyQr(null); return; }
    QRCode.toDataURL(status.totp_uri, { margin: 1, width: 400, errorCorrectionLevel: "H", color: { dark: corDoQr(accent), light: "#FFFFFF" } })
      .then(url => { if (!cancelled) setAuthyQr(url); })
      .catch(() => { if (!cancelled) setAuthyQr(null); });
    return () => { cancelled = true; };
  }, [status?.totp_uri, accent]);

  async function salvar(enabled: boolean, opcoes: { rotate?: boolean; serve?: boolean } = {}) {
    const modoServe = opcoes.serve ?? serve;
    // No modo Serve quem atende a rede é o Tailscale; o servidor fica só em loopback.
    const endereco = modoServe ? `127.0.0.1:${bind.split(":").pop() || PORTA_PADRAO}` : bind;
    setBusy(true); setError(null); setCopiado(false); setCopiadoPc(false); setTeste(null);
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

  const passosFeitos = [Boolean(status?.magic_dns), ligado, pronto, Boolean(status?.totp_confirmed)];
  const estado = !status ? { texto: "carregando…", cor: "text-text-muted", ponto: "bg-text-muted" }
    : status.error ? { texto: "com erro", cor: "text-danger", ponto: "bg-danger" }
    : pronto ? { texto: "no ar", cor: "text-success", ponto: "bg-success" }
    : aguardando ? { texto: "ligando…", cor: "text-warning", ponto: "bg-warning animate-pulse" }
    : ligado ? { texto: "só neste PC", cor: "text-warning", ponto: "bg-warning" }
    : { texto: "desligado", cor: "text-text-muted", ponto: "bg-text-muted" };
  const enderecoPc = status?.public_url ? `${status.public_url.replace(/\/$/, "")}/pc/` : null;

  return <section className="space-y-4" aria-label="Acesso pelo celular">
    <div className="glass rounded-none p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center bg-accent/10">
          <OmniLogo size={36} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="pixel-text text-sm text-text-primary">Usar o OMNI pelo celular</h2>
          <p className="mt-1 text-xs text-text-secondary">
            Você manda prompts do telefone (ou de outro computador) e os agentes rodam aqui no PC. Funciona
            de qualquer lugar, inclusive no 4G — o PC precisa estar ligado. Fechar a janela do OMNI não
            desliga o acesso.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className={`flex items-center gap-2 border border-border-subtle/60 px-2 py-1 text-[10px] uppercase tracking-wide ${estado.cor}`}>
            <span aria-hidden className={`h-2 w-2 ${estado.ponto}`} />{estado.texto}
          </span>
          <span className="flex items-center gap-1" title={`${passosFeitos.filter(Boolean).length} de 4 passos prontos`}>
            {passosFeitos.map((feito, i) => <span key={i} aria-hidden className={`h-1.5 w-5 ${feito ? "bg-success" : "bg-overlay/15"}`} />)}
          </span>
        </div>
      </div>
    </div>

    <ol className="space-y-4">
      <Passo n={1} titulo="Instale o Tailscale no PC e no celular" feito={Boolean(status?.magic_dns)}>
        {status?.magic_dns
          ? <p className="text-xs text-text-secondary">Detectado neste PC: <code className="text-accent">{status.magic_dns}</code></p>
          : <>
              <p className="text-xs text-text-secondary">
                É o que liga os dois aparelhos com segurança, sem abrir nada para a internet. Use a
                <strong> mesma conta</strong> nos dois. Depois de instalar, volte aqui.
              </p>
              <InstalarFerramenta id="tailscale" nome="Tailscale"
                motivo="O Tailscale ainda não foi detectado neste PC." />
            </>}
      </Passo>

      <Passo n={2} titulo="Escolha como o celular chega até aqui" feito={ligado}>
        <div className="grid gap-2 md:grid-cols-2">
          <OpcaoModo ativo={!serve} titulo="Direto" selo="funciona na hora" onSelect={() => setServe(false)}>
            O OMNI usa o endereço do Tailscale deste PC automaticamente. Não precisa configurar nada.
          </OpcaoModo>
          <OpcaoModo ativo={serve} titulo="Seguro com HTTPS" selo="recomendado" onSelect={() => setServe(true)}>
            O Tailscale publica com certificado e nome fixo. Pede para liberar uma vez na sua conta Tailscale.
          </OpcaoModo>
        </div>

        {!serve && <details className="text-xs text-text-muted">
          <summary className="cursor-pointer">Endereço usado: <code>{bind}</code></summary>
          {/* Preenchido pelo engine: com Tailscale no ar, loopback vira o IP do Tailscale sozinho. */}
          <div className="mt-2">
            <Field label="Trocar endereço (avançado)" htmlFor="mobile-bind">
              <Input id="mobile-bind" value={bind} onChange={event => setBind(event.target.value)} placeholder={`100.x.x.x:${PORTA_PADRAO}`} />
            </Field>
          </div>
        </details>}

        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void salvar(true)}>{ligado ? "Aplicar" : "Ativar"}</Button>
          {status?.config.enabled && <Button variant="ghost" disabled={busy} onClick={() => void salvar(false)}>Desativar</Button>}
          {ligado && <Button variant="ghost" disabled={busy} onClick={() => void testar()}>Testar</Button>}
        </div>

        {teste && <p role="status" className={`border-l-2 pl-3 text-xs ${teste.ok ? "border-success text-success" : "border-warning text-warning"}`}>{teste.message}</p>}

        {linkLiberar && <div className="space-y-2 border border-warning/60 bg-warning/5 p-3">
          <p className="text-xs text-warning">
            Falta liberar o endereço seguro na sua conta Tailscale. É uma vez só, para a conta
            inteira — depois vale em qualquer PC seu.
          </p>
          <ol className="list-decimal space-y-1 pl-4 text-xs text-text-secondary">
            <li>Clique no botão abaixo. Abre a página do Tailscale no navegador.</li>
            <li>Entre com a mesma conta do Tailscale deste PC, se pedir.</li>
            <li>Confirme a liberação na página.</li>
            <li>Volte aqui e clique em <strong>Aplicar</strong>.</li>
          </ol>
          <Button disabled={busy} onClick={() => void abrirLiberacao(linkLiberar)}>Liberar na conta Tailscale</Button>
          {/* Fallback visível: se o navegador não abrir, o link continua na tela para copiar. */}
          {falhouAbrir && <p className="break-all text-[10px] text-text-muted">
            Não consegui abrir o navegador. Copie e cole: <code>{linkLiberar}</code>
          </p>}
        </div>}
        {status?.serve_hint && !linkLiberar && <p role="alert" className="border-l-2 border-warning pl-3 text-xs text-warning">{status.serve_hint}</p>}
      </Passo>

      <Passo n={3} titulo="Aponte a câmera do celular para o código" feito={pronto}>
        {pronto ? <div className="space-y-4">
          <div className="flex flex-wrap items-start gap-5">
            {qrImage && <QrPersonalizado src={qrImage} alt="Código QR de acesso pelo celular" tamanho={216} />}
            <div className="min-w-0 flex-1 space-y-3">
              <p className="text-xs text-text-secondary">
                O código já leva o acesso junto — não precisa digitar senha.
              </p>
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wide text-text-muted">Abre em</p>
                {/* Botão com `openUrl`, não `<a target="_blank">`: dentro do Tauri o link comum não abre
                    navegador nenhum, e o clique parecia simplesmente não fazer nada. */}
                <button type="button" className="break-all text-left text-xs text-accent underline" onClick={() => {
                  setFalhouAbrirEndereco(false);
                  // Barra no fim: a permissão casa `https://*.ts.net/*` na string crua, e o engine manda
                  // o endereço sem ela.
                  const url = status!.public_url!;
                  openUrl(url.endsWith("/") ? url : `${url}/`).catch(() => setFalhouAbrirEndereco(true));
                }}>{status!.public_url}</button>
                {falhouAbrirEndereco && <p className="break-all text-[10px] text-text-muted">
                  Não consegui abrir o navegador. Copie e cole: <code>{status!.public_url}</code>
                </p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => {
                  void navigator.clipboard.writeText(status!.qr!).catch(() => undefined); setCopiado(true);
                }}>{copiado ? "Link copiado" : "Copiar link"}</Button>
                <Button variant="ghost" disabled={busy} onClick={() => void salvar(true, { rotate: true })}>Trocar o código</Button>
              </div>
              <p className="text-[10px] text-text-muted">
                Trocar o código desconecta os aparelhos já conectados. Faça isso se perder o telefone.
                {status?.config.token && <> Acesso atual <code>…{status.config.token.slice(-6)}</code>.</>}
              </p>
            </div>
          </div>

          {linkDoPc(status?.qr) && enderecoPc && <div className="space-y-2 border border-border-subtle/60 bg-overlay/5 p-3">
            <p className="text-xs font-medium text-text-primary">No notebook ou em outro computador</p>
            <p className="text-xs text-text-secondary">
              Mesma coisa, em tela de computador. Mande este link para você (e-mail, WhatsApp) e abra no
              navegador do notebook — ele também precisa estar no Tailscale, com a mesma conta. O link
              já leva o acesso junto: trate como senha.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all bg-overlay/10 px-2 py-1.5 text-[11px] text-accent">{enderecoPc}</code>
              <Button variant="ghost" disabled={busy} onClick={() => {
                void navigator.clipboard.writeText(linkDoPc(status?.qr)!).catch(() => undefined); setCopiadoPc(true);
              }}>{copiadoPc ? "Link do computador copiado" : "Copiar link do computador"}</Button>
            </div>
          </div>}
        </div> : ligado && !serve ? <p className="border-l-2 border-warning pl-3 text-xs text-warning">
          O Tailscale não foi encontrado neste PC, então o endereço atual ({bind}) só abre aqui mesmo.
          Instale e conecte o Tailscale e clique em Aplicar — o código aparece em seguida.
        </p> : ligado && serve && !status?.serve_hint ? <p className="text-xs text-text-secondary">
          Publicando pelo Tailscale… isso pode levar alguns segundos.
        </p> : <p className="text-xs text-text-muted">O código aparece aqui quando o acesso estiver ligado.</p>}
      </Passo>

      <Passo n={4} titulo="Proteger com o Authy" feito={Boolean(status?.totp_confirmed)}>
        <p className="text-xs text-text-secondary">
          É o que libera o <strong>app da tela inicial do iPhone</strong>. Ele não enxerga o acesso que o QR
          acima guardou no Safari, então pede o código de 6 dígitos do Authy na primeira vez que abre.
        </p>
        {status?.totp_confirmed ? <div className="space-y-2">
          <p className="text-xs text-success">Authy configurado ✓ Qualquer aparelho pareia com o código atual.</p>
          {confirmarRefazer ? <div className="flex flex-wrap items-center gap-2 border border-warning/60 bg-warning/5 p-2">
            <span className="text-xs text-warning">O cadastro atual do Authy para de funcionar. Continuar?</span>
            <Button variant="ghost" disabled={busy} onClick={() => void authy("reset")}>Sim, refazer</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmarRefazer(false)}>Cancelar</Button>
          </div> : <Button variant="ghost" disabled={busy} onClick={() => setConfirmarRefazer(true)}>Refazer cadastro</Button>}
        </div> : status?.totp_uri ? <div className="flex flex-wrap items-start gap-5">
          {authyQr && <QrPersonalizado src={authyQr} alt="QR code para cadastrar no Authy" tamanho={176} />}
          <div className="min-w-0 flex-1 space-y-3">
            <ol className="list-decimal space-y-1 pl-4 text-xs text-text-secondary">
              <li>No Authy, toque em <strong>+</strong> e leia este código.</li>
              <li>Digite abaixo o código de 6 dígitos que aparecer para <strong>OMNI AGENTS</strong>.</li>
            </ol>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Código do Authy" htmlFor="codigo-authy-pc">
                <Input id="codigo-authy-pc" inputMode="numeric" maxLength={6} value={codigoAuthy} placeholder="000000"
                  className="tracking-[0.4em]"
                  onChange={event => setCodigoAuthy(event.target.value.replace(/\D/g, "").slice(0, 6))} />
              </Field>
              <Button disabled={busy || codigoAuthy.length !== 6} onClick={() => void authy("confirm")}>Confirmar</Button>
            </div>
          </div>
        </div> : <Button disabled={busy} onClick={() => void authy("reset")}>Configurar Authy</Button>}
        {erroAuthy && <p role="alert" className="border-l-2 border-danger pl-3 text-xs text-danger">{erroAuthy}</p>}
      </Passo>
    </ol>

    {(error || status?.error) && <div className="glass space-y-1 rounded-none border-l-2 border-danger p-4">
      <p role="alert" className="text-xs text-danger">{error || status?.error}</p>
      <p className="text-[10px] text-text-muted">
        Se a mensagem falar em engine desatualizado, feche o OMNI, encerre <code>omni-engine.exe</code> no
        Gerenciador de Tarefas e abra o app de novo.
      </p>
    </div>}
  </section>;
}
