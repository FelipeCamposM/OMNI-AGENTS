import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppSettings, Background, GlassLevel, MotionLevel, Theme } from "../types/settings";
import { UpdateCard } from "./UpdateCard";
import { BACKGROUND_EFFECTS, isBackgroundEffect } from "./backgrounds/registry";
import { PALETAS } from "../lib/palettes";
import { Button, Field, Input, SegmentedControl, Slider } from "./ui";

type SectionId = "aparencia" | "sobre";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "aparencia", label: "Aparência" },
  { id: "sobre", label: "Sobre" },
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
}

export function SettingsView({ settings, onChange, onReset, initialSection }: SettingsViewProps) {
  const [section, setSection] = useState<SectionId>(initialSection ?? "aparencia");

  // Reabrir pelo sino noutra pendência tem de pular de seção mesmo com a
  // tela já montada — o estado inicial sozinho não faria nada.
  useEffect(() => {
    if (initialSection) setSection(initialSection);
  }, [initialSection]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="pixel-text text-text-primary text-lg">Configurações</h1>
        <p className="text-text-muted text-xs">Preferências do workspace. Salvam na hora.</p>
      </div>

      <div className="flex gap-5 items-start">
        <nav aria-label="Seções de configurações" className="w-40 shrink-0 space-y-0.5 sticky top-0">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              aria-current={section === s.id ? "page" : undefined}
              className={[
                "w-full text-left px-3 py-2 rounded-none text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
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
          {section === "aparencia" && <AparenciaSection settings={settings} onChange={onChange} />}
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

        <Divider />

        <Segmented
          label="Relevo"
          description="Espessura da borda e da sombra dos painéis — o quão 'chunky' o app fica."
          options={GLASS_LEVELS}
          value={settings.glass}
          onChange={(v) => onChange({ glass: v })}
        />
      </Card>

      <Card title="Fundo">
        <Segmented
          label="Imagem de fundo"
          description="Pixels é a grade padrão do app. Aurora, Poente e Maré são gradientes suaves. Ondas é um efeito animado em WebGL — mais bonito, mais GPU."
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

function SobreSection({ onReset }: { onReset: () => void }) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  return (
    <>
      <Card title="OMNI AGENTS">
        <dl className="text-xs space-y-1.5">
          <Info label="Versão" value={version ?? "—"} />
          <Info label="Processamento" value="100% local — nada é enviado para a internet" />
        </dl>
      </Card>

      <UpdateCard />

      <Card title="Dados do app">
        <p className="text-text-muted text-[11px]">Preferências ficam salvas neste computador.</p>
        <Button variant="danger" onClick={onReset}>
          Restaurar configurações padrão
        </Button>
      </Card>
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass rounded-none p-5 space-y-4">
      <h2 className="pixel-text text-text-primary text-sm">{title}</h2>
      {children}
    </section>
  );
}

function Divider() {
  return <hr className="border-border-subtle/60" />;
}

/** Aliases do kit — mantêm os call sites deste arquivo inalterados. */
const SliderField = Slider;
const Segmented = SegmentedControl;
