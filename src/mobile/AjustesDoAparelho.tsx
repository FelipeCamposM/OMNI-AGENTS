import { useState, type ComponentType, type ReactNode } from "react";
import { AlertIcon, CheckIcon, NotificationIcon, LinkIcon, LockIcon, MonitorIcon, PlayIcon, StopIcon } from "../components/ui/PixelIcon";
import { esquecerToken } from "./api";
import { notificar, pedirPermissao, permissao, suporte, usePrefsDeAviso, type PrefsDeAviso } from "./notificacoes";

type Icone = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

function Chave({ ligada, rotulo, descricao, icone: Icone, disabled, onChange }: {
  ligada: boolean; rotulo: string; descricao?: ReactNode; icone: Icone; disabled?: boolean; onChange: (ligada: boolean) => void;
}) {
  return (
    <div className={`m-ajuste${disabled ? " is-desligado" : ""}`}>
      <span className="m-ajuste-icone" aria-hidden><Icone className="h-4 w-4" /></span>
      <span className="m-ajuste-texto">
        <span className="m-ajuste-rotulo">{rotulo}</span>
        {descricao && <span className="m-ajuste-descricao">{descricao}</span>}
      </span>
      <button type="button" role="switch" aria-checked={ligada} aria-label={rotulo} disabled={disabled}
        className="ext-chave" onClick={() => onChange(!ligada)}>
        <span className="ext-chave-bolinha" />
      </button>
    </div>
  );
}

const ESTADO_DA_PERMISSAO: Record<string, { texto: string; tom: string }> = {
  granted: { texto: "permitido", tom: "ok" },
  denied: { texto: "bloqueado", tom: "alerta" },
  default: { texto: "não pedido", tom: "neutro" },
  indisponivel: { texto: "indisponível", tom: "alerta" },
};

/** Ajustes deste aparelho: avisos, conexão e saída. O resto (contas, tema) vem do PC. */
export function AjustesDoAparelho({ pagina = "celular", children }: {
  /** Qual página está aberta: o link de baixo leva para a outra. */
  pagina?: "celular" | "computador";
  /** Grupos só desta página (a web põe os layouts aqui). */
  children?: ReactNode;
}) {
  const [prefs, mudar] = usePrefsDeAviso();
  const [estado, setEstado] = useState(permissao);
  const [testado, setTestado] = useState(false);
  const [sair, setSair] = useState(false);
  const tipo = suporte();
  const pode = tipo === "ok" && estado !== "denied";
  const selo = ESTADO_DA_PERMISSAO[estado] ?? ESTADO_DA_PERMISSAO.default;

  async function ligar(ligada: boolean) {
    if (!ligada) { mudar({ ligadas: false }); return; }
    const resposta = estado === "granted" ? "granted" : await pedirPermissao();
    setEstado(resposta);
    mudar({ ligadas: resposta === "granted" });
  }

  async function testar() {
    await notificar("OMNI AGENTS", "Os avisos estão funcionando neste aparelho.", { tag: "teste", url: location.href, vibrar: prefs.vibrar });
    setTestado(true);
    window.setTimeout(() => setTestado(false), 2500);
  }

  const sub = (chave: keyof PrefsDeAviso) => ({ ligada: prefs[chave], disabled: !prefs.ligadas, onChange: (valor: boolean) => mudar({ [chave]: valor }) });

  return (
    <div className="m-ajustes">
      <section className="m-ajustes-hero glass" aria-label="Este aparelho">
        <span className="m-ajustes-hero-icone" aria-hidden><NotificationIcon className="h-6 w-6" /></span>
        <div className="min-w-0">
          <h2 className="m-ajustes-hero-titulo">Ajustes deste aparelho</h2>
          <p className="m-ajustes-hero-texto">Valem só aqui. Contas, projetos e tema vêm do PC.</p>
        </div>
      </section>

      <section className="m-ajustes-grupo glass" aria-labelledby="ajustes-avisos">
        <header className="m-ajustes-cabeca">
          <h3 id="ajustes-avisos" className="m-ajustes-titulo"><NotificationIcon aria-hidden className="h-3.5 w-3.5" />Notificações</h3>
          <span className="m-ajustes-selo" data-tom={selo.tom}>{selo.texto}</span>
        </header>
        {tipo === "inseguro" && (
          <p className="m-ajustes-aviso" role="note">
            <LockIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />
            O navegador só libera avisos em HTTPS. No PC, em Configurações → Acesso remoto, use o modo
            <strong> Seguro com HTTPS</strong> e abra o link novo aqui.
          </p>
        )}
        {tipo === "sem-suporte" && <p className="m-ajustes-aviso" role="note"><AlertIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />Este navegador não mostra notificações. No iPhone, adicione o OMNI à tela inicial primeiro.</p>}
        {estado === "denied" && <p className="m-ajustes-aviso" role="note"><AlertIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />Os avisos foram bloqueados. Libere nas permissões do site, no navegador, e volte aqui.</p>}
        <Chave icone={NotificationIcon} rotulo="Avisar quando precisar de mim" ligada={prefs.ligadas && estado === "granted"} disabled={!pode}
          descricao="Notificação do sistema quando um agente para esperando você." onChange={(valor) => void ligar(valor)} />
        <Chave icone={AlertIcon} rotulo="Pedidos de aprovação" descricao="O agente quer rodar algo e espera o seu sim." {...sub("aprovacao")} />
        <Chave icone={CheckIcon} rotulo="Agente terminou" descricao="Fim do turno: a resposta está pronta." {...sub("terminou")} />
        <Chave icone={PlayIcon} rotulo="Vibrar" descricao="Onde o aparelho deixar." {...sub("vibrar")} />
        <Chave icone={MonitorIcon} rotulo="Avisar com o OMNI na tela" descricao="Sem isto, só avisa com a página em segundo plano." {...sub("comAPaginaAberta")} />
        <button type="button" className="m-ajustes-botao" disabled={!prefs.ligadas || estado !== "granted"} onClick={() => void testar()}>
          {testado ? <CheckIcon aria-hidden className="h-4 w-4" /> : <NotificationIcon aria-hidden className="h-4 w-4" />}
          {testado ? "Aviso enviado" : "Mandar um aviso de teste"}
        </button>
        <p className="m-ajustes-nota">Os avisos chegam enquanto o OMNI está aberto no navegador (mesmo em segundo plano). Fechado de vez, o celular não recebe.</p>
      </section>

      {children}

      <section className="m-ajustes-grupo glass" aria-labelledby="ajustes-conexao">
        <header className="m-ajustes-cabeca">
          <h3 id="ajustes-conexao" className="m-ajustes-titulo"><LinkIcon aria-hidden className="h-3.5 w-3.5" />Conexão</h3>
          <span className="m-ajustes-selo" data-tom={window.isSecureContext ? "ok" : "neutro"}>{window.isSecureContext ? "HTTPS" : "direta"}</span>
        </header>
        <dl className="m-ajustes-dados">
          <div><dt>PC</dt><dd>{location.host}</dd></div>
          <div><dt>Versão</dt><dd>v{__APP_VERSION__}</dd></div>
        </dl>
        <a className="m-ajustes-botao" href={pagina === "celular" ? "/pc" : "/"}><MonitorIcon aria-hidden className="h-4 w-4" />
          {pagina === "celular" ? "Abrir a versão de computador" : "Abrir a versão de celular"}</a>
        {sair ? (
          <div className="m-ajustes-confirmar" role="alert">
            <p>Desconectar este aparelho? Para voltar, leia o QR de novo no PC.</p>
            <div className="m-ajustes-confirmar-acoes">
              <button type="button" className="m-ajustes-botao" onClick={() => setSair(false)}>Cancelar</button>
              <button type="button" className="m-ajustes-botao is-perigo" onClick={() => { esquecerToken(); location.replace("/"); }}>
                <StopIcon aria-hidden className="h-4 w-4" />Desconectar
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="m-ajustes-botao is-perigo" onClick={() => setSair(true)}>
            <StopIcon aria-hidden className="h-4 w-4" />Desconectar este aparelho
          </button>
        )}
      </section>
    </div>
  );
}
