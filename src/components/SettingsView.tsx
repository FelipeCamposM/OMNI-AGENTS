import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppSettings, Background, GlassLevel, MotionLevel, Theme } from "../types/settings";
import { UpdateCard } from "./UpdateCard";
import { acenderNaTela, SettingsSearch, type Achado } from "./SettingsSearch";
import { BACKGROUND_EFFECTS, isBackgroundEffect } from "./backgrounds/registry";
import { PALETAS } from "../lib/palettes";
import { CHANGELOG } from "../lib/changelog";
import { Button, Card, Field, Input, SegmentedControl, Select, Slider } from "./ui";
import { Modal } from "./ui/Modal";
import { AgentConnections } from "../features/terminal/AgentConnections";
import { CompactacaoCard } from "../features/compactacao/CompactacaoCard";
import { SkillsManager } from "../features/skills/SkillsManager";
import { ExtensoesSettings } from "../features/extensoes/ExtensoesSettings";
import { MobileSettings } from "../features/mobile/MobileSettings";
import { testarAviso } from "../features/terminal/useAttentionNotifier";
import { BlocksIcon, BookIcon, BrushIcon, ChartIcon, CloseIcon, DatabaseIcon, SparkleIcon, GearIcon, GlobeIcon, KeyboardIcon, RobotIcon, SlidersIcon, StarIcon } from "./ui/PixelIcon";
import { RelatoriosIa } from "../features/relatorios/RelatoriosIa";
import { Armazenamento } from "../features/armazenamento/Armazenamento";
import { ModelosDeAgentes } from "../features/agentes/ModelosDeAgentes";
import { request } from "../mobile/api";
import type { EstadoDaVoz } from "../mobile/voz";
import { VocabularioCard } from "../features/voz/VocabularioCard";
import { SHORTCUTS, comboFromEvent, setRecordingShortcut, shortcutFor, type ShortcutId } from "../lib/shortcuts";

type SectionId = "geral" | "aparencia" | "agentes" | "modelos" | "extensoes" | "skills" | "mobile" | "relatorios" | "armazenamento" | "atalhos" | "sobre";

type Icone = React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** Cada seção com ícone e uma linha do que tem dentro: o menu diz onde está cada coisa sem precisar
 *  abrir uma por uma. "Geral" saiu de "Aparência", que juntava sete cartões de assuntos diferentes. */
const SECTIONS: { id: SectionId; label: string; desc: string; icon: Icone; grupo: string }[] = [
  { id: "geral", label: "Geral", desc: "Conversa ou terminal, arquivos e avisos", icon: GearIcon, grupo: "Preferências" },
  { id: "aparencia", label: "Aparência", desc: "Tema, cor, fundo e animações", icon: BrushIcon, grupo: "Preferências" },
  { id: "atalhos", label: "Atalhos", desc: "Teclas do app", icon: KeyboardIcon, grupo: "Preferências" },
  { id: "agentes", label: "Agentes", desc: "CLIs instaladas e contas", icon: RobotIcon, grupo: "Inteligência artificial" },
  { id: "modelos", label: "Modelos de agentes", desc: "QA, revisor, orquestrador… criados com IA", icon: SparkleIcon, grupo: "Inteligência artificial" },
  { id: "extensoes", label: "Extensões", desc: "MCPs, plugins e conectores por IA", icon: BlocksIcon, grupo: "Inteligência artificial" },
  { id: "skills", label: "Skills", desc: "Skills do Claude e do projeto", icon: BookIcon, grupo: "Inteligência artificial" },
  { id: "mobile", label: "Acesso remoto", desc: "Celular e outro computador", icon: GlobeIcon, grupo: "Dados e acesso" },
  { id: "relatorios", label: "Relatórios", desc: "Uso de IA por dia, contas e commits", icon: ChartIcon, grupo: "Dados e acesso" },
  { id: "armazenamento", label: "Armazenamento", desc: "Espaço das conversas por IA e conta", icon: DatabaseIcon, grupo: "Dados e acesso" },
  { id: "sobre", label: "Sobre", desc: "Versão, novidades e atualização", icon: StarIcon, grupo: "App" },
];

const THEMES: { value: Theme; label: string }[] = [
  { value: "escuro", label: "Escuro" },
  { value: "claro", label: "Claro" },
  { value: "sistema", label: "Sistema" },
];

/** Gradientes CSS + efeitos animados do registry + imagem do usuário. */
const BACKGROUNDS: { value: Background; label: string }[] = [
  { value: "pixel-grid", label: "Pixels" },
  { value: "mesh-1", label: "Aurora" },
  { value: "mesh-2", label: "Poente" },
  { value: "mesh-3", label: "Maré" },
  ...BACKGROUND_EFFECTS.map((e) => ({ value: e.id as Background, label: e.label })),
  { value: "custom", label: "Imagem" },
  { value: "nenhum", label: "Nenhum" },
];

const GLASS_LEVELS: { value: GlassLevel; label: string }[] = [
  { value: "sutil", label: "Sutil" },
  { value: "medio", label: "Médio" },
  { value: "forte", label: "Forte" },
];

const MOTION_LEVELS: { value: MotionLevel; label: string }[] = [
  { value: "completas", label: "Completas" },
  { value: "reduzidas", label: "Reduzidas" },
  { value: "desligadas", label: "Desligadas" },
];

interface SettingsViewProps {
  settings: AppSettings;
  onChange: (updates: Partial<AppSettings>) => void;
  onReset: () => void;
  /** Abre direto numa seção (usado pelo sino de notificações). */
  initialSection?: SectionId;
  /** Projeto aberto — a aba de Skills lista o `.claude/skills` dele além dos escopos globais. */
  projectPath: string | null;
  /** Todos os projetos abertos nos workspaces: os Relatórios contam os commits deles. */
  projectPaths?: string[];
  /** Volta pra tela de antes de abrir as Configurações. */
  onClose: () => void;
}

export function SettingsView({ settings, onChange, onReset, initialSection, projectPath, projectPaths = [], onClose }: SettingsViewProps) {
  const [section, setSection] = useState<SectionId>(initialSection ?? "geral");
  const atual = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0];
  const conteudo = useRef<HTMLDivElement>(null);
  // Com busca digitada: quantos resultados cada seção tem (as sem nenhum apagam no menu).
  const [porSecao, setPorSecao] = useState<Map<string, number> | null>(null);
  const aoBuscar = useCallback((achados: Achado[] | null) => {
    setPorSecao(achados && new Map(achados.reduce((m, a) => m.set(a.secao.id, (m.get(a.secao.id) ?? 0) + 1), new Map<string, number>())));
  }, []);
  function irPara(achado: Achado) {
    setSection(achado.secao.id as SectionId);
    acenderNaTela(() => conteudo.current, achado.item.alvo ?? achado.item.titulo);
  }

  // Reabrir pelo sino noutra pendência tem de pular de seção mesmo com a
  // tela já montada — o estado inicial sozinho não faria nada.
  useEffect(() => {
    if (initialSection) setSection(initialSection);
  }, [initialSection]);

  return (
    <div className="settings">
      <header className="settings-topo glass">
        <span className="settings-topo-icone" aria-hidden>
          <SlidersIcon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="pixel-text text-text-primary text-base">Configurações</h1>
          <p className="text-text-secondary text-xs">Preferências do OMNI neste computador. Tudo salva na hora.</p>
        </div>
        <SettingsSearch secoes={SECTIONS} onIr={irPara} onConsulta={aoBuscar} />
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          aria-label="Fechar configurações"
          title={`Fechar configurações (${shortcutFor("closeSettings")})`}
        >
          <CloseIcon className="h-3.5 w-3.5" aria-hidden="true" />
          Fechar
        </Button>
      </header>

      <div className="settings-corpo">
        <nav aria-label="Seções de configurações" className="settings-menu glass">
          {SECTIONS.map((s, indice) => {
            const Icon = s.icon;
            const novoGrupo = SECTIONS[indice - 1]?.grupo !== s.grupo;
            return (
              <Fragment key={s.id}>
              {novoGrupo && <span className="settings-menu-grupo" aria-hidden>{s.grupo}</span>}
              <button
                type="button"
                onClick={() => setSection(s.id)}
                aria-current={section === s.id ? "page" : undefined}
                className={`settings-menu-item${porSecao && !porSecao.has(s.id) ? " is-apagado" : ""}`}
                style={{ animationDelay: `${SECTIONS.indexOf(s) * 28}ms` }}
              >
                <span className="settings-menu-icone" aria-hidden><Icon className="h-[18px] w-[18px]" /></span>
                <span className="min-w-0">
                  <span className="settings-menu-nome">{s.label}</span>
                  <span className="settings-menu-desc">{s.desc}</span>
                </span>
                {porSecao?.has(s.id) && <span className="settings-menu-achados" aria-label={`${porSecao.get(s.id)} resultado(s)`}>{porSecao.get(s.id)}</span>}
              </button>
              </Fragment>
            );
          })}
        </nav>

        {/* `key`: trocar de seção remonta o conteúdo, e a entrada anima de novo. */}
        <div key={section} ref={conteudo} className="settings-conteudo">
          <div className="settings-secao glass">
            <atual.icon className="h-4 w-4 text-accent" aria-hidden />
            <h2 className="pixel-text text-text-primary text-sm">{atual.label}</h2>
            <span className="text-text-muted text-[11px]">{atual.desc}</span>
          </div>
          {section === "geral" && <GeralSection settings={settings} onChange={onChange} />}
          {section === "aparencia" && <AparenciaSection settings={settings} onChange={onChange} />}
          {section === "agentes" && <div className="settings-grade"><AgentConnections /><div className="settings-largo"><CompactacaoCard /></div></div>}
          {section === "modelos" && <ModelosDeAgentes projectPath={projectPath} />}
          {section === "extensoes" && <ExtensoesSettings projectPath={projectPath} />}
          {section === "skills" && <SkillsManager projectPath={projectPath} />}
          {section === "mobile" && <MobileSettings accent={settings.accent} />}
          {section === "relatorios" && <RelatoriosIa projectPaths={projectPaths} />}
          {section === "armazenamento" && <Armazenamento />}
          {section === "atalhos" && <AtalhosSection settings={settings} onChange={onChange} />}
          {section === "sobre" && <SobreSection onReset={onReset} />}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- seções */

interface SectionProps {
  settings: AppSettings;
  onChange: (updates: Partial<AppSettings>) => void;
}

function AparenciaSection({ settings, onChange }: SectionProps) {
  async function pickImage() {
    const result = await open({
      multiple: false,
      filters: [{ name: "Imagem", extensions: ["jpg", "jpeg", "png", "webp", "bmp", "gif"] }],
    });
    if (typeof result === "string") {
      onChange({ background: "custom", backgroundPath: result });
    }
  }

  const custom = settings.background === "custom";
  const semFundo = settings.background === "nenhum";
  const efeito = isBackgroundEffect(settings.background);

  return (
    <div className="settings-grade settings-grade-par">
      <Card title="Tema">
        <Segmented
          label="Tema"
          description="Claro, escuro ou seguir o Windows."
          options={THEMES}
          value={settings.theme}
          onChange={(v) => onChange({ theme: v })}
        />

        <Divider />

        <Field
          label="Cor de destaque"
          description="Vale para os ícones, a barra de rolagem, o item ativo do menu e os fundos animados."
        >
          <div role="radiogroup" aria-label="Cor de destaque" className="flex flex-wrap gap-2">
            {PALETAS.map((p) => {
              const ativa = settings.accent === p.id;
              return (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={ativa}
                  aria-label={p.label}
                  title={p.label}
                  onClick={() => onChange({ accent: p.id })}
                  className={[
                    "w-8 h-8 rounded-none transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                    ativa
                      ? "ring-2 ring-offset-2 ring-offset-bg-surface ring-text-primary scale-110"
                      : "hover:scale-110",
                  ].join(" ")}
                  /* A amostra mostra as DUAS cores da paleta: o degradê é o que
                     o fundo animado vai desenhar, não só a cor do ícone. */
                  style={{ background: `linear-gradient(135deg, ${p.base}, ${p.deep})` }}
                />
              );
            })}
          </div>
        </Field>
      </Card>

      <Card title="Painéis e movimento">
        <Segmented
          label="Relevo"
          description="Espessura da borda e da sombra dos painéis — o quão 'chunky' o app fica."
          options={GLASS_LEVELS}
          value={settings.glass}
          onChange={(v) => onChange({ glass: v })}
        />

        <Divider />

        <Segmented
          label="Animações"
          description='"Desligadas" corta todo movimento. Se o Windows estiver com "reduzir animações", isso vale sempre, independente da escolha aqui.'
          options={MOTION_LEVELS}
          value={settings.animations}
          onChange={(v) => onChange({ animations: v })}
        />
      </Card>

      <Card title="Fundo do app">
        <Segmented
          label="Imagem de fundo"
          description="Pixels é a grade padrão do app. Aurora, Poente e Maré são gradientes suaves. Ondas é um efeito animado em WebGL — mais bonito, mais GPU."
          options={BACKGROUNDS}
          grow={false}
          value={settings.background}
          onChange={(v) => onChange({ background: v })}
        />

        {custom && (
          <Field
            label="Arquivo da imagem"
            htmlFor="bg-path"
            description="A imagem é lida direto do disco; nada é copiado nem enviado."
          >
            <div className="flex gap-2">
              <Input
                id="bg-path"
                type="text"
                value={settings.backgroundPath}
                onChange={(e) => onChange({ backgroundPath: e.target.value })}
                placeholder="Nenhuma imagem escolhida"
                className="flex-1 min-w-0"
              />
              <Button onClick={pickImage}>Procurar</Button>
            </div>
          </Field>
        )}

        {!semFundo && (
          <>
            <SliderField
              id="bg-opacity"
              label="Opacidade"
              unit="%"
              value={settings.backgroundOpacity}
              min={0}
              max={100}
              onChange={(v) => onChange({ backgroundOpacity: v })}
            />
            {/* Efeito animado não tem desfoque: borrar um canvas que repinta a
                60fps sairia caro e não melhora nada. */}
            {!efeito && (
              <SliderField
                id="bg-blur"
                label="Desfoque"
                unit="px"
                value={settings.backgroundBlur}
                min={0}
                max={40}
                onChange={(v) => onChange({ backgroundBlur: v })}
              />
            )}
          </>
        )}
      </Card>

      <Card title="Terminais e conversa">
        <SliderField
          id="terminal-opacity"
          label="Opacidade dos terminais"
          unit="%"
          value={settings.terminalOpacity}
          min={0}
          max={100}
          onChange={(v) => onChange({ terminalOpacity: v })}
        />

        <Divider />

        <Segmented
          label="Fundo da conversa"
          description="Igual à web pinta a conversa com a grade colorida da página do navegador, na cor do tema. Liso deixa o painel numa cor só."
          options={[
            { value: "web", label: "Igual à web" },
            { value: "liso", label: "Liso" },
          ]}
          value={settings.conversationBackground}
          onChange={(v) => onChange({ conversationBackground: v })}
        />
        {settings.conversationBackground === "web" && (
          <SliderField
            id="conversa-grade"
            label="Opacidade das linhas"
            unit="%"
            value={settings.conversationGridOpacity}
            min={0}
            max={100}
            onChange={(v) => onChange({ conversationGridOpacity: v })}
          />
        )}
      </Card>
    </div>
  );
}

/** O que muda o comportamento do app (não o visual): como os agentes aparecem, salvar e avisos. */
function GeralSection({ settings, onChange }: SectionProps) {
  return (
    <div className="settings-grade">
      <Card title="Agentes" className="settings-largo">
        <Segmented
          label="Como ver os agentes"
          description="Conversa mostra o agente como um chat, igual ao acesso pelo navegador: mensagens, o que ele está fazendo, aprovar e parar. O terminal continua a um clique em cada aba. Terminais sem IA (npm run dev, git…) são sempre terminal."
          options={[
            { value: "conversa", label: "Conversa" },
            { value: "terminal", label: "Terminal" },
          ]}
          value={settings.agentView}
          onChange={(v) => onChange({ agentView: v })}
        />
      </Card>

      <Card title="Arquivos">
        <Segmented
          label="Salvar edições"
          description="Automático salva sozinho pouco depois de parar de digitar. Manual só salva com Ctrl+S."
          options={[
            { value: "auto", label: "Automático" },
            { value: "manual", label: "Manual (Ctrl+S)" },
          ]}
          value={settings.fileSaveMode}
          onChange={(v) => onChange({ fileSaveMode: v })}
        />
      </Card>

      <Card title="Avisos">
        <Segmented
          label="Agente pedindo atenção"
          description="Notificação do Windows e piscada na barra de tarefas quando um agente termina, pede aprovação ou trava — só com o OMNI fora de foco. A seção ATENÇÃO na barra lateral funciona de qualquer jeito."
          options={[
            { value: "sim", label: "Notificar" },
            { value: "nao", label: "Só na barra lateral" },
          ]}
          value={settings.notifyAttention ? "sim" : "nao"}
          onChange={(v) => onChange({ notifyAttention: v === "sim" })}
        />
        <TesteDeAviso />
      </Card>

      <VozCard />
      <VocabularioCard />

    </div>
  );
}

/** Prompt por voz. Opcional de propósito: o modelo (~190 MB) só é baixado aqui, e sem ele o microfone
 *  não aparece em conversa nenhuma — nem no PC, nem no celular. */
function VozCard() {
  const [voz, setVoz] = useState<EstadoDaVoz | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const ler = () => request<EstadoDaVoz>("/voz").then((e) => { if (vivo) setVoz(e); }).catch(() => undefined);
    void ler();
    // Só acompanha de perto enquanto baixa: é a barra de progresso.
    const relogio = voz?.baixando ? window.setInterval(ler, 700) : undefined;
    return () => { vivo = false; window.clearInterval(relogio); };
  }, [voz?.baixando]);

  async function agir(caminho: string, corpo?: object) {
    setErro(null);
    try {
      setVoz(await request<EstadoDaVoz>(caminho, { method: "POST", body: JSON.stringify(corpo ?? {}), headers: { "Content-Type": "application/json" } }));
    } catch (motivo) {
      setErro(motivo instanceof Error ? motivo.message : "Falhou");
    }
  }

  const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;
  return (
    <Card title="Voz" className="settings-largo">
      <p className="text-xs text-text-secondary">
        Fale o prompt em vez de digitar: um microfone aparece ao lado do anexo, na conversa do PC e do celular. A fala vira texto
        aqui no PC (nada sai da máquina) e cai no campo para você revisar antes de enviar.
      </p>
      {!voz ? (
        <p className="text-xs text-text-muted">Lendo…</p>
      ) : voz.instalado ? (
        <>
          <Segmented
            label="Corrigir o texto com IA"
            description="Depois de transcrever, o Claude (modelo Haiku, na sua conta) arruma pontuação, acentos e palavras trocadas, sem mudar o sentido. Leva alguns segundos a mais; sem o Claude instalado, vem o texto como saiu."
            options={[
              { value: "nao", label: "Não" },
              { value: "sim", label: "Corrigir" },
            ]}
            value={voz.corrigir ? "sim" : "nao"}
            onChange={(v) => void agir("/voz/ajustes", { corrigir: v === "sim" })}
          />
          <Button size="sm" variant="ghost" onClick={() => void agir("/voz/remover")}>
            Remover o modelo de voz ({mb(voz.total)})
          </Button>
        </>
      ) : voz.baixando ? (
        <div role="status" className="space-y-2">
          <p className="text-xs text-text-secondary">Baixando o modelo… {mb(voz.baixado)} de {mb(voz.total)}</p>
          <div className="h-1.5 w-full bg-overlay/10">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.min(100, (voz.baixado / voz.total) * 100)}%` }} />
          </div>
        </div>
      ) : (
        <Button size="sm" onClick={() => void agir("/voz/baixar")}>
          Baixar o modelo de voz ({mb(voz.total)})
        </Button>
      )}
      <p className="text-[11px] text-text-muted">
        No celular, o navegador só libera o microfone em endereço seguro (https). Pelo endereço http do acesso remoto, use o
        microfone do próprio teclado do celular.
      </p>
      {(erro ?? voz?.erro) && (
        <p role="alert" className="border-l-2 border-danger pl-3 text-xs text-danger">{erro ?? voz?.erro}</p>
      )}
    </Card>
  );
}

/** Manda um aviso de mentira e diz o que deu errado. O toast do Windows falha em silêncio por
 *  várias razões diferentes (permissão, plugin, "não perturbe"), e sem isto não há como separá-las. */
function TesteDeAviso() {
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const [testando, setTestando] = useState(false);

  async function testar() {
    setTestando(true);
    setResultado(null);
    const erro = await testarAviso();
    setResultado(
      erro
        ? { ok: false, texto: erro }
        : { ok: true, texto: "Aviso enviado. Se nada apareceu, veja Windows → Configurações → Sistema → Notificações." }
    );
    setTestando(false);
  }

  return (
    <div className="mt-3">
      <Button size="sm" variant="ghost" loading={testando} onClick={() => void testar()}>
        Testar aviso
      </Button>
      <p className="mt-2 text-[11px] text-text-muted">
        O teste ignora a regra de foco — o aviso de verdade só aparece com o OMNI em segundo plano.
      </p>
      {resultado && (
        <p
          role="status"
          className={`mt-2 border-l-2 pl-3 text-xs ${resultado.ok ? "border-success text-success" : "border-danger text-danger"}`}
        >
          {resultado.texto}
        </p>
      )}
    </div>
  );
}

function AtalhosSection({ settings, onChange }: SectionProps) {
  const [gravando, setGravando] = useState<ShortcutId | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setRecordingShortcut(gravando !== null);
    return () => setRecordingShortcut(false);
  }, [gravando]);

  function salvar(id: ShortcutId, combo: string | undefined) {
    const { [id]: _, ...resto } = settings.shortcuts;
    const padrao = SHORTCUTS.find((s) => s.id === id)!.default;
    onChange({ shortcuts: combo && combo !== padrao ? { ...resto, [id]: combo } : resto });
  }

  function gravar(id: ShortcutId, event: React.KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      setGravando(null);
      return;
    }
    const combo = comboFromEvent(event.nativeEvent);
    if (!combo) return;
    const conflito = SHORTCUTS.find((s) => s.id !== id && shortcutFor(s.id) === combo);
    if (conflito) {
      setErro(`${combo} já é usado em "${conflito.label}".`);
      return;
    }
    setErro(null);
    salvar(id, combo);
    setGravando(null);
  }

  return (
    <Card title="Atalhos do teclado">
      <p className="text-text-muted text-[11px]">
        Clique num atalho e aperte a nova combinação. Esc cancela. Com o foco num terminal, só o atalho de busca e o de
        sair do terminal funcionam — o resto vai pro programa rodando nele.
      </p>
      <ul className="divide-y divide-border-subtle/60">
        {SHORTCUTS.map((s) => {
          const atual = shortcutFor(s.id);
          const trocado = settings.shortcuts[s.id] !== undefined;
          return (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <span className="text-text-secondary text-xs">{s.label}</span>
              <div className="flex items-center gap-2">
                {trocado && (
                  <Button size="sm" variant="ghost" onClick={() => salvar(s.id, undefined)} title={`Voltar para ${s.default}`}>
                    Padrão
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={gravando === s.id ? "primary" : "glass"}
                  aria-label={`Atalho de ${s.label}: ${atual}`}
                  onClick={() => {
                    setErro(null);
                    setGravando(s.id);
                  }}
                  onBlur={() => gravando === s.id && setGravando(null)}
                  onKeyDown={(event) => gravando === s.id && gravar(s.id, event)}
                  className="min-w-32 font-mono"
                >
                  {gravando === s.id ? "Aperte as teclas…" : atual}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      {erro && (
        <p role="alert" className="border-l-2 border-danger pl-3 text-xs text-danger">
          {erro}
        </p>
      )}
      {Object.keys(settings.shortcuts).length > 0 && (
        <Button size="sm" variant="ghost" onClick={() => onChange({ shortcuts: {} })}>
          Restaurar todos os atalhos
        </Button>
      )}
    </Card>
  );
}

function SobreSection({ onReset }: { onReset: () => void }) {
  const [version, setVersion] = useState<string | null>(null);
  const [confirmarReset, setConfirmarReset] = useState(false);
  const [escolhida, setEscolhida] = useState<string | null>(null);

  useEffect(() => {
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  // Só as notas de uma versão por vez: a instalada, ou a escolhida no seletor.
  const entrada = CHANGELOG.find((item) => item.version === (escolhida ?? version)) ?? CHANGELOG[0];

  return (
    <>
      <Card title="OMNI AGENTS">
        <dl className="text-xs space-y-1.5">
          <Info label="Versão" value={version ?? "—"} />
          <Info label="Processamento" value="100% local — nada é enviado para a internet" />
        </dl>
      </Card>

      <UpdateCard />

      <Card title="Novidades">
        <div className="space-y-4">
          <Field label="Ver notas de outra versão" htmlFor="sobre-versao">
            <Select id="sobre-versao" size="sm" value={entrada.version} searchable searchPlaceholder="Buscar versão ou data…"
              onChange={setEscolhida}
              options={CHANGELOG.map((item) => ({
                value: item.version,
                label: `Versão ${item.version}`,
                hint: `${item.date}${item.version === version ? " · instalada" : ""}${item.beta ? " · beta" : ""}`,
              }))} />
          </Field>
          <article key={entrada.version} className="sobre-nota space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="pixel-text text-sm text-text-primary">Versão {entrada.version}</h3>
              {entrada.version === version && <span className="remoto-chip is-ok">instalada</span>}
              {entrada.version === CHANGELOG[0].version && entrada.version !== version && <span className="remoto-chip">mais recente</span>}
              {entrada.beta && <span className="border border-warning px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-warning">Beta</span>}
              <span className="ml-auto text-[11px] text-text-muted">{entrada.date} · {entrada.changes.length} novidades</span>
            </div>
            {entrada.beta && (
              <p role="note" className="text-warning text-[11px] leading-relaxed">
                {entrada.beta}
              </p>
            )}
            <ul className="sobre-nota-lista">
              {entrada.changes.map((mudanca) => (
                <li key={mudanca}>{mudanca}</li>
              ))}
            </ul>
            {escolhida && escolhida !== version && version && CHANGELOG.some((item) => item.version === version) && (
              <button type="button" className="text-[11px] text-accent underline" onClick={() => setEscolhida(null)}>
                Voltar para a versão instalada
              </button>
            )}
          </article>
        </div>
      </Card>

      <Card title="Dados do app">
        <p className="text-text-muted text-[11px]">Preferências ficam salvas neste computador.</p>
        <Button variant="danger" onClick={() => setConfirmarReset(true)}>
          Restaurar configurações padrão
        </Button>
      </Card>

      {confirmarReset && (
        <Modal titulo="Restaurar configurações padrão?" largura="sm" onFechar={() => setConfirmarReset(false)}>
          <div className="modal-secao">
            <p className="text-sm text-text-primary">Todas as preferências voltam ao padrão. Isto não dá para desfazer.</p>
            <ul className="modal-explica">
              <li>Tema, cores, fundo, atalhos e as outras opções destas Configurações voltam ao que vem de fábrica.</li>
              <li>Projetos, workspaces, conversas e contas dos agentes não são apagados.</li>
            </ul>
            <div className="modal-acoes">
              <Button size="sm" variant="ghost" onClick={() => setConfirmarReset(false)}>Cancelar</Button>
              <Button size="sm" variant="danger" onClick={() => { onReset(); setConfirmarReset(false); }}>
                Restaurar padrão
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-text-muted w-24 shrink-0">{label}</dt>
      <dd className="text-text-secondary">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------- primitivas */

function Divider() {
  return <hr className="border-border-subtle/60" />;
}

/** Aliases do kit — mantêm os call sites deste arquivo inalterados. */
const SliderField = Slider;
const Segmented = SegmentedControl;
