import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { generateQr } from "../../services/conversionService";
import type { ToolProps } from "../registry";
import { useToolEnter } from "../../lib/motion";
import { Button, Field, ResultPanel, Slider, Textarea } from "../../components/ui";

export function QrCodeTool({ settings }: ToolProps) {
  const [text, setText] = useState("");
  const [size, setSize] = useState(settings.qrSize);
  const [busy, setBusy] = useState(false);
  const [resultPath, setResultPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!text.trim() || busy) return;
    setError(null);
    setResultPath(null);

    const outPath = await save({
      filters: [{ name: "PNG", extensions: ["png"] }],
      defaultPath: "qrcode.png",
    });
    if (!outPath) return;

    setBusy(true);
    try {
      const path = await generateQr(text, outPath, size);
      setResultPath(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const toolRef = useToolEnter();

  return (
    <div ref={toolRef} className="space-y-4">
      <Field label="Texto ou URL" htmlFor="qr-text">
        <Textarea
          id="qr-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="https://exemplo.com"
        />
      </Field>

      <div className="glass rounded-glass p-4">
        <Slider
          inline
          size="sm"
          id="qr-size"
          label="Tamanho"
          unit="px"
          min={128}
          max={1024}
          step={64}
          value={size}
          onChange={setSize}
        />
      </div>

      <Button
        variant="primary"
        className="w-full"
        onClick={handleGenerate}
        disabled={!text.trim()}
        loading={busy}
      >
        {busy ? "Gerando…" : "Gerar QR code e salvar…"}
      </Button>

      {error && <p role="alert" className="text-danger text-xs">{error}</p>}

      {resultPath && <ResultPanel paths={[resultPath]} />}
    </div>
  );
}
