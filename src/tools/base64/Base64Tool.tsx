import { useState } from "react";
import { useToolEnter } from "../../lib/motion";
import { Button, Field, Textarea } from "../../components/ui";

function encodeBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function decodeBase64(text: string): string {
  return decodeURIComponent(escape(atob(text.trim())));
}

export function Base64Tool() {
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(mode: "encode" | "decode") {
    setError(null);
    try {
      setOutput(mode === "encode" ? encodeBase64(input) : decodeBase64(input));
    } catch {
      setOutput("");
      setError(mode === "decode" ? "Base64 inválido." : "Não foi possível codificar.");
    }
  }

  async function copyOutput() {
    if (output) await navigator.clipboard.writeText(output);
  }

  const toolRef = useToolEnter();

  return (
    <div ref={toolRef} className="space-y-4">
      <Field label="Entrada" htmlFor="b64-input">
        <Textarea
          id="b64-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={5}
          placeholder="Cole o texto ou o Base64 aqui…"
        />
      </Field>

      <div className="flex gap-2">
        <Button variant="primary" className="flex-1" onClick={() => run("encode")}>
          Codificar
        </Button>
        <Button className="flex-1" onClick={() => run("decode")}>
          Decodificar
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-danger text-xs">{error}</p>
      )}

      {output && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="b64-output" className="text-text-secondary text-xs font-medium">
              Resultado
            </label>
            <Button variant="ghost" size="sm" onClick={copyOutput}>
              Copiar
            </Button>
          </div>
          <Textarea
            id="b64-output"
            aria-label="Resultado Base64"
            value={output}
            readOnly
            rows={5}
          />
        </div>
      )}
    </div>
  );
}
