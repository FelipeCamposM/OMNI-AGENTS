import { Field, SegmentedControl, Select } from "./ui";
import { SUBTITLE_RHYTHMS } from "../services/conversionService";
import type { SubtitleRhythm, WhisperModelSize } from "../services/conversionService";

const MODELOS: { value: WhisperModelSize; label: string; hint: string }[] = [
  { value: "tiny", label: "Tiny", hint: "Rascunho — ~75 MB" },
  { value: "base", label: "Base", hint: "Rápido — ~140 MB" },
  { value: "small", label: "Small", hint: "Equilibrado — ~460 MB" },
  { value: "medium", label: "Medium", hint: "Preciso — ~1,5 GB" },
  { value: "large-v3", label: "Large v3", hint: "Máximo — ~3 GB" },
];

const IDIOMAS = [
  { value: "pt", label: "Português" },
  { value: "en", label: "Inglês" },
  { value: "es", label: "Espanhol" },
  { value: "", label: "Detectar automaticamente" },
];

/** Idioma, modelo e ritmo — iguais nas duas abas, então moram aqui. */
export function CamposTranscricao({
  idioma,
  setIdioma,
  modelo,
  setModelo,
  ritmo,
  setRitmo,
  prefixo,
}: {
  idioma: string;
  setIdioma: (v: string) => void;
  modelo: WhisperModelSize;
  setModelo: (v: WhisperModelSize) => void;
  ritmo: SubtitleRhythm;
  setRitmo: (v: SubtitleRhythm) => void;
  /** As duas abas coexistem no DOM; sem prefixo os `id` colidiriam. */
  prefixo: string;
}) {
  return (
    <>
      <Field
        label="Idioma da fala"
        htmlFor={`${prefixo}-idioma`}
        description="Deixe em Português quando for o caso — a detecção automática confunde português com espanhol."
      >
        <Select id={`${prefixo}-idioma`} value={idioma} options={IDIOMAS} onChange={setIdioma} />
      </Field>

      <Field
        label="Modelo"
        htmlFor={`${prefixo}-modelo`}
        description="Maior reconhece melhor e demora mais. O modelo é baixado na primeira vez que for usado."
      >
        <Select
          id={`${prefixo}-modelo`}
          value={modelo}
          options={MODELOS}
          onChange={(v) => setModelo(v as WhisperModelSize)}
        />
      </Field>

      <SegmentedControl
        label="Ritmo"
        options={SUBTITLE_RHYTHMS.map((r) => ({ value: r.value, label: r.label }))}
        value={ritmo}
        onChange={setRitmo}
        description={SUBTITLE_RHYTHMS.find((r) => r.value === ritmo)?.descricao}
      />
    </>
  );
}
