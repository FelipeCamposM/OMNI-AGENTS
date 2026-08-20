import { Check, CircleAlert, Download, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  AppSettings,
  Background,
  GlassLevel,
  MotionLevel,
  Theme,
} from "../types/settings";
import { MAX_FILE_SIZE_LIMIT_MB } from "../types/settings";
import { MODULES, useModule } from "./ModuleGate";
import type { ModuleId } from "./ModuleGate";
import { UpdateCard } from "./UpdateCard";
import { NovidadesLista } from "./Novidades";
import { storageUsedBytes } from "../services/settingsService";
import { TOOLS } from "../tools/registry";
import { BACKGROUND_EFFECTS, isBackgroundEffect } from "./backgrounds/registry";
import { PALETAS } from "../lib/palettes";
import { Button, Field, Input, SegmentedControl, Select, Slider } from "./ui";

type SectionId =
  | "geral"
  | "aparencia"
  | "documentos"
  | "imagens"
  | "midia"
  | "utilitarios"
  | "modulos"
  | "armazenamento"
  | "sobre";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "geral", label: "Geral" },
  { id: "aparencia", label: "Aparência" },
  { id: "documentos", label: "Documentos" },
  { id: "imagens", label: "Imagens" },
  { id: "midia", label: "Mídia" },
  { id: "utilitarios", label: "Utilitários" },
  { id: "modulos", label: "Módulos" },
  { id: "armazenamento", label: "Armazenamento" },
  { id: "sobre", label: "Sobre" },
];

const THEMES: { value: Theme; label: string }[] = [
  { value: "escuro", label: "Escuro" },
  { value: "claro", label: "Claro" },
  { value: "sistema", label: "Sistema" },
];

/** Gradientes CSS + efeitos animados do registry + imagem do usuário. */
const BACKGROUNDS: { value: Background; label: string }[] = [
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
  historyCount: number;
  onClearHistory: () => void;
  /** Abre direto numa seção (usado pelo sino de notificações). */
  initialSection?: SectionId;
}

export function SettingsView({
  settings,
  onChange,
  onReset,
  historyCount,
  onClearHistory,
  initialSection,
}: SettingsViewProps) {
  const [section, setSection] = useState<SectionId>(initialSection ?? "geral");

  // Reabrir pelo sino noutra pendência tem de pular de seção mesmo com a
  // tela já montada — o estado inicial sozinho não faria nada.
  useEffect(() => {
    if (initialSection) setSection(initialSection);
  }, [initialSection]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-text-primary text-lg font-semibold">Configurações</h1>
        <p className="text-text-muted text-xs">
          Preferências da suíte. As ferramentas começam com estes valores — as mudanças salvam na hora.
        </p>
      </div>

      <div className="flex gap-5 items-start">
        <nav aria-label="Seções de configurações" className="w-40 shrink-0 space-y-0.5 sticky top-0">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              aria-current={section === s.id ? "page" : undefined}
              className={[
                "w-full text-left px-3 py-2 !rounded-lg text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
                section === s.id
                  ? "glass text-text-primary font-medium"
                  : "text-text-secondary hover:text-text-primary hover:bg-overlay/[0.07]",
              ].join(" ")}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0 space-y-4">
          {section === "geral" && <GeralSection settings={settings} onChange={onChange} />}
          {section === "aparencia" && <AparenciaSection settings={settings} onChange={onChange} />}
          {section === "documentos" && <DocumentosSection settings={settings} onChange={onChange} />}
          {section === "imagens" && <ImagensSection settings={settings} onChange={onChange} />}
          {section === "midia" && <MidiaSection settings={settings} onChange={onChange} />}
          {section === "utilitarios" && <UtilitariosSection settings={settings} onChange={onChange} />}
          {section === "modulos" && <ModulosSection />}
          {section === "armazenamento" && (
            <ArmazenamentoSection
              settings={settings}
              onChange={onChange}
              onReset={onReset}
              historyCount={historyCount}
              onClearHistory={onClearHistory}
            />
          )}
          {section === "sobre" && <SobreSection />}
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

function GeralSection({ settings, onChange }: SectionProps) {
  async function pickFolder() {
    const result = await open({ directory: true, multiple: false });
    if (typeof result === "string") onChange({ defaultOutputDir: result });
  }

  return (
    <Card title="Geral">
      <Field label="Pasta padrão de saída" htmlFor="output-dir" description="Usada como destino inicial nos diálogos de salvar.">
        <div className="flex gap-2">
          <Input
            id="output-dir"
            type="text"
            value={settings.defaultOutputDir}
            onChange={(e) => onChange({ defaultOutputDir: e.target.value })}
            placeholder="Mesma pasta do arquivo de origem"
            className="flex-1 min-w-0"
          />
          <Button onClick={pickFolder}>Procurar</Button>
        </div>
      </Field>

      <Toggle
        id="open-folder"
        label="Abrir pasta após salvar"
        description="Abre o Explorer na pasta do arquivo gerado."
        checked={settings.openFolderAfterSave}
        onChange={(v) => onChange({ openFolderAfterSave: v })}
      />

      <NumberField
        id="max-size"
        label="Tamanho máximo por arquivo (MB)"
        description="Arquivos maiores são recusados ao arrastar."
        value={settings.maxFileSizeMb}
        min={1}
        max={MAX_FILE_SIZE_LIMIT_MB}
        onChange={(v) => onChange({ maxFileSizeMb: v })}
      />
    </Card>
  );
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
    <>
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
          description="Vale para os ícones, a barra de rolagem, o item ativo do menu e os fundos animados (Ondas e Linhas flutuantes)."
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
                    "w-8 h-8 !rounded-full transition-transform focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
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

        <Divider />

        <Segmented
          label="Vidro"
          description="Quanto o fundo aparece através das superfícies. Menos vidro = menos GPU."
          options={GLASS_LEVELS}
          value={settings.glass}
          onChange={(v) => onChange({ glass: v })}
        />
      </Card>

      <Card title="Fundo">
        <Segmented
          label="Imagem de fundo"
          description="Aurora, Poente e Maré são gradientes gerados (custo zero). Ondas é um efeito animado em WebGL — mais bonito, mais GPU."
          options={BACKGROUNDS}
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

      <Card title="Movimento">
        <Segmented
          label="Animações"
          description='"Desligadas" corta todo movimento. Se o Windows estiver com "reduzir animações", isso vale sempre, independente da escolha aqui.'
          options={MOTION_LEVELS}
          value={settings.animations}
          onChange={(v) => onChange({ animations: v })}
        />
      </Card>
    </>
  );
}

function DocumentosSection({ settings, onChange }: SectionProps) {
  return (
    <Card title="PDF → Markdown / Markdown → PDF">
      <Toggle
        id="auto-save"
        label="Salvar o .md ao lado do PDF"
        description="Não pergunta o destino: grava na mesma pasta do PDF de origem."
        checked={settings.autoSaveNextToPdf}
        onChange={(v) => onChange({ autoSaveNextToPdf: v })}
      />
      <p className="text-text-muted text-[11px]">
        O módulo de OCR (Docling) é gerenciado na seção Armazenamento.
      </p>
    </Card>
  );
}

function ImagensSection({ settings, onChange }: SectionProps) {
  return (
    <Card title="Converter e redimensionar">
      <Segmented
        label="Formato padrão ao converter"
        options={[
          { value: "webp", label: "WebP" },
          { value: "png", label: "PNG" },
          { value: "jpg", label: "JPG" },
          { value: "ico", label: "ICO" },
        ]}
        value={settings.imageFormat}
        onChange={(v) => onChange({ imageFormat: v })}
      />

      <SliderField
        id="img-quality"
        label="Qualidade padrão (WebP/JPG)"
        value={settings.imageQuality}
        min={1}
        max={100}
        onChange={(v) => onChange({ imageQuality: v })}
      />

      <Divider />

      <Segmented
        label="Formato padrão ao redimensionar"
        options={[
          { value: "manter", label: "Manter" },
          { value: "webp", label: "WebP" },
          { value: "png", label: "PNG" },
          { value: "jpg", label: "JPG" },
        ]}
        value={settings.resizeFormat}
        onChange={(v) => onChange({ resizeFormat: v })}
      />

      <NumberField
        id="resize-max"
        label="Dimensão máxima padrão (px)"
        description="Lado maior da imagem redimensionada."
        value={settings.resizeMaxDim}
        min={16}
        max={10000}
        onChange={(v) => onChange({ resizeMaxDim: v })}
      />
    </Card>
  );
}

function MidiaSection({ settings, onChange }: SectionProps) {
  return (
    <>
      <Card title="Legenda automática">
        <Field
          label="Modelo do Whisper"
          htmlFor="whisper-model"
          description="Maior reconhece melhor e demora mais. O modelo baixa sozinho no primeiro uso; o tamanho indicado é o do download."
        >
          <Select
            id="whisper-model"
            value={settings.whisperModel}
            options={[
              { value: "tiny", label: "Tiny", hint: "Rascunho — ~75 MB" },
              { value: "base", label: "Base", hint: "Rápido — ~140 MB" },
              { value: "small", label: "Small", hint: "Equilibrado — ~460 MB" },
              { value: "medium", label: "Medium", hint: "Preciso — ~1,5 GB" },
              { value: "large-v3", label: "Large v3", hint: "Máximo — ~3 GB" },
            ]}
            onChange={(v) => onChange({ whisperModel: v as AppSettings["whisperModel"] })}
          />
        </Field>

        <Segmented
          label="Formato padrão da legenda"
          description="SRT abre em qualquer player; VTT é o formato da web."
          options={[
            { value: "srt" as const, label: "SRT" },
            { value: "vtt" as const, label: "VTT" },
          ]}
          value={settings.subtitleFormat}
          onChange={(v) => onChange({ subtitleFormat: v })}
        />
      </Card>

      <Card title="Áudio">
        <Segmented
          label="Formato padrão"
          options={[
            { value: "mp3", label: "MP3" },
            { value: "wav", label: "WAV" },
            { value: "flac", label: "FLAC" },
          ]}
          value={settings.audioFormat}
          onChange={(v) => onChange({ audioFormat: v })}
        />
        <SliderField
          id="audio-kbps"
          label="Bitrate padrão"
          unit=" kbps"
          value={settings.audioKbps}
          min={64}
          max={320}
          step={32}
          onChange={(v) => onChange({ audioKbps: v })}
        />
      </Card>

      <Card title="Vídeo">
        <Field label="Qualidade padrão do YouTube" htmlFor="yt-height">
          <Select
            id="yt-height"
            value={settings.videoMaxHeight}
            options={[
              { value: 0, label: "Melhor disponível" },
              ...[2160, 1440, 1080, 720, 480, 360].map((h) => ({ value: h, label: `${h}p` })),
            ]}
            onChange={(v) => onChange({ videoMaxHeight: v })}
          />
        </Field>

        <Segmented
          label="Nível padrão de compressão"
          description="CRF do H.264: menor = mais qualidade e arquivo maior."
          options={[
            { value: 23, label: "Leve" },
            { value: 28, label: "Médio" },
            { value: 32, label: "Forte" },
          ]}
          value={settings.videoCrf}
          onChange={(v) => onChange({ videoCrf: v })}
        />
      </Card>

      <Card title="Vídeo → GIF">
        <SliderField
          id="gif-fps"
          label="FPS padrão"
          value={settings.gifFps}
          min={5}
          max={30}
          onChange={(v) => onChange({ gifFps: v })}
        />
        <NumberField
          id="gif-width"
          label="Largura padrão (px)"
          value={settings.gifWidth}
          min={64}
          max={1920}
          onChange={(v) => onChange({ gifWidth: v })}
        />
      </Card>
    </>
  );
}

function UtilitariosSection({ settings, onChange }: SectionProps) {
  return (
    <Card title="Hash e QR code">
      <Segmented
        label="Algoritmo de hash padrão"
        options={[
          { value: "md5", label: "MD5" },
          { value: "sha1", label: "SHA-1" },
          { value: "sha256", label: "SHA-256" },
        ]}
        value={settings.hashAlgo}
        onChange={(v) => onChange({ hashAlgo: v })}
      />
      <NumberField
        id="qr-size"
        label="Tamanho padrão do QR (px)"
        value={settings.qrSize}
        min={128}
        max={2048}
        onChange={(v) => onChange({ qrSize: v })}
      />
    </Card>
  );
}

/**
 * Componentes pesados baixados sob demanda. Seção própria porque não são
 * "armazenamento" — são pré-requisitos de ferramentas, e é aqui que o sino de
 * notificações leva quando falta um (ver `useNotifications`).
 *
 * A lista sai do `MODULES` (ModuleGate.tsx), fonte única: módulo novo lá
 * aparece aqui sozinho, sem editar esta seção.
 */
function ModulosSection() {
  return (
    <>
      <Card title="Módulos">
        <p className="text-text-muted text-[11px]">
          São grandes demais para o instalador, então vêm na primeira vez que a ferramenta é usada.
          Ficam guardados na pasta de dados do app — baixa uma vez só.
        </p>
      </Card>

      {(Object.keys(MODULES) as ModuleId[]).map((id) => (
        <ModuleCard key={id} id={id} titulo={MODULES[id].titulo} detalhe={MODULES[id].descricao} />
      ))}
    </>
  );
}

function ArmazenamentoSection({
  settings,
  onChange,
  onReset,
  historyCount,
  onClearHistory,
}: SectionProps & {
  onReset: () => void;
  historyCount: number;
  onClearHistory: () => void;
}) {
  const usedKb = Math.round(storageUsedBytes() / 1024);

  return (
    <>
      <Card title="Histórico">
        <p className="text-text-muted text-[11px]">
          {historyCount} entrada(s) guardada(s) neste computador.
        </p>
        <NumberField
          id="history-limit"
          label="Máximo de entradas"
          description="As mais antigas são descartadas ao passar do limite."
          value={settings.historyLimit}
          min={5}
          max={500}
          onChange={(v) => onChange({ historyLimit: v })}
        />
        <Button variant="danger" onClick={onClearHistory}>
          Limpar histórico
        </Button>
      </Card>

      <Card title="Dados do app">
        <p className="text-text-muted text-[11px]">
          Preferências e histórico ocupam ~{usedKb} KB no armazenamento local.
        </p>
        <Button variant="danger" onClick={onReset}>
          Restaurar configurações padrão
        </Button>
      </Card>
    </>
  );
}

function SobreSection() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  return (
    <>
      <Card title="CAMPS-UTILS">
        <dl className="text-xs space-y-1.5">
          <Info label="Versão" value={version ?? "—"} />
          <Info label="Ferramentas" value={`${TOOLS.length} ativas`} />
          <Info label="Processamento" value="100% local — nada é enviado para a internet" />
          <Info label="Exceções" value="Downloads do YouTube e o módulo Docling usam a rede" />
        </dl>
      </Card>

      <UpdateCard />

      {/* Depois do card de atualização de propósito: quem chega aqui pelo sino
          veio atrás do botão de atualizar, não do histórico. */}
      <Card title="Novidades">
        <NovidadesLista />
      </Card>
    </>
  );
}

/**
 * Status + download de um módulo baixado sob demanda. A lógica mora no
 * `useModule` (compartilhado com o `<ModuleGate>` que bloqueia as tools), então
 * status aqui e status lá nunca divergem.
 */
function ModuleCard({ id, titulo, detalhe }: { id: ModuleId; titulo: string; detalhe: string }) {
  const { mod, pronto, baixando, progresso, erro, baixar } = useModule(id);
  const Icone = mod.icone;

  return (
    <section className="glass glass-sheen !rounded-2xl p-5 space-y-3">
      <div className="flex items-start gap-3.5">
        {/* Instalado tinge de verde; pendente fica no roxo do app. O ícone é a
            leitura mais rápida do estado — antes só havia uma linha de texto. */}
        <span
          aria-hidden="true"
          className={[
            "w-10 h-10 shrink-0 rounded-xl flex items-center justify-center transition-colors",
            pronto ? "bg-success/15 text-success" : "bg-selected/20 text-selected",
          ].join(" ")}
        >
          <Icone className="w-5 h-5" strokeWidth={1.75} />
        </span>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-text-primary text-sm font-semibold">{titulo}</h2>
            <span className="glass-inset text-text-muted text-[10px] font-medium px-1.5 py-0.5 tabular-nums">
              {mod.tamanho}
            </span>
            <StatusPill pronto={pronto} baixando={baixando} />
          </div>
          <p className="text-text-muted text-[11px] leading-relaxed">{detalhe}</p>
          <p className="text-text-muted text-[10px]">
            <span className="text-text-secondary">Usado por:</span> {mod.usadoPor}
          </p>
        </div>

        {!baixando && pronto === false && (
          <Button variant="primary" size="sm" className="shrink-0" onClick={baixar}>
            <Download aria-hidden="true" className="w-3.5 h-3.5" />
            Baixar
          </Button>
        )}
      </div>

      {erro && (
        <p role="alert" className="text-danger text-xs">
          {erro}
        </p>
      )}

      {baixando && (
        <div className="space-y-1">
          <div className="glass-inset h-2 rounded-full overflow-hidden">
            <div
              className="shimmer h-full bg-selected transition-all duration-300"
              style={{ width: `${progresso}%` }}
              role="progressbar"
              aria-valuenow={progresso}
            />
          </div>
          <p className="text-text-muted text-[11px] tabular-nums">Baixando… {progresso}%</p>
        </div>
      )}
    </section>
  );
}

function StatusPill({ pronto, baixando }: { pronto: boolean | null; baixando: boolean }) {
  if (baixando) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 !rounded-full bg-selected/15 text-selected">
        <LoaderCircle aria-hidden="true" className="w-3 h-3 animate-spin" />
        Baixando
      </span>
    );
  }
  if (pronto === null) {
    return <span className="text-text-muted text-[10px]">Status indisponível</span>;
  }
  return pronto ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 !rounded-full bg-success/15 text-success">
      <Check aria-hidden="true" className="w-3 h-3" strokeWidth={3} />
      Instalado
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 !rounded-full bg-warning/15 text-warning">
      <CircleAlert aria-hidden="true" className="w-3 h-3" />
      Não instalado
    </span>
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


function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass glass-sheen !rounded-2xl p-5 space-y-4">
      <h2 className="text-text-primary text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Divider() {
  return <hr className="border-border-subtle/60" />;
}

function NumberField({
  id,
  label,
  description,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} htmlFor={id} description={description}>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </Field>
  );
}

/** Aliases do kit — mantêm os call sites deste arquivo inalterados. */
const SliderField = Slider;
const Segmented = SegmentedControl;

function Toggle({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex gap-3 items-start">
      <button
        id={id}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={[
          "relative w-10 h-5 rounded-full transition-colors shrink-0 mt-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
          checked ? "bg-accent" : "bg-border",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200",
            checked ? "translate-x-5" : "translate-x-0",
          ].join(" ")}
        />
      </button>
      <label htmlFor={id} className="cursor-pointer space-y-0.5">
        <p className="text-text-primary text-sm">{label}</p>
        <p className="text-text-muted text-xs">{description}</p>
      </label>
    </div>
  );
}
