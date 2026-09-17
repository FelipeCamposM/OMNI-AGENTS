import { useEffect, useRef, type ClipboardEvent, type FormEvent } from "react";
import { Button } from "../components/ui/Button";
import { AttachmentIcon, CloseIcon, LoaderIcon, SendIcon, WarningIcon } from "../components/ui/PixelIcon";
import { iconForPath } from "../features/files/fileIcons";
import { tamanhoLegivel, type Anexo } from "./anexos";

interface ComposerProps {
  texto: string;
  onTexto: (valor: string) => void;
  anexos: Anexo[];
  onAdicionar: (arquivos: File[]) => void;
  onRemover: (id: string) => void;
  onEnviar: () => void;
  podeEnviar: boolean;
  ocupado: boolean;
  placeholder: string;
}

const ALTURA_MAXIMA_PX = 160;

function ChipAnexo({ anexo, onRemover, travado }: { anexo: Anexo; onRemover: () => void; travado: boolean }) {
  const Icone = iconForPath(anexo.arquivo.name);
  const meta = anexo.estado === "erro" ? anexo.erro ?? "Falhou"
    : anexo.estado === "enviando" ? "Enviando…"
    : anexo.estado === "enviado" ? "No PC"
    : tamanhoLegivel(anexo.arquivo.size);
  return (
    <li className="anexo-chip" data-estado={anexo.estado}>
      {anexo.previa
        ? <img src={anexo.previa} alt="" className="anexo-previa" />
        : <span className="anexo-tipo" aria-hidden><Icone className="h-5 w-5" /></span>}
      <span className="anexo-info">
        <span className="anexo-nome">{anexo.arquivo.name || "anexo"}</span>
        <span className="anexo-meta">
          {anexo.estado === "enviando" && <LoaderIcon aria-hidden className="anexo-girando h-3 w-3" />}
          {anexo.estado === "erro" && <WarningIcon aria-hidden className="h-3 w-3" />}
          {meta}
        </span>
      </span>
      <button type="button" className="anexo-remover" aria-label={`Remover ${anexo.arquivo.name || "anexo"}`}
        disabled={travado} onClick={onRemover}>
        <CloseIcon aria-hidden className="h-4 w-4" />
      </button>
    </li>
  );
}

/**
 * Barra de digitação do chat: texto, anexos por botão ou colados, e enviar.
 *
 * O botão de anexo é um `<label>` em volta do `<input type="file">`, não um `.click()` por código:
 * é o único jeito que abre o seletor em todo navegador de celular, inclusive o Safari antigo, que
 * ignora clique programático em input escondido. Sem `accept`: qualquer tipo de arquivo vale.
 */
export function Composer({ texto, onTexto, anexos, onAdicionar, onRemover, onEnviar, podeEnviar, ocupado, placeholder }: ComposerProps) {
  const campo = useRef<HTMLTextAreaElement>(null);

  // Cresce com o texto até um limite, como nos apps de mensagem.
  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, ALTURA_MAXIMA_PX)}px`;
    // Barra de rolagem só quando passa do limite; antes aparecia até com o campo vazio.
    el.style.overflowY = el.scrollHeight > ALTURA_MAXIMA_PX ? "auto" : "hidden";
  }, [texto]);

  function colar(event: ClipboardEvent<HTMLTextAreaElement>) {
    const arquivos = Array.from(event.clipboardData?.files ?? []);
    // Texto comum segue o caminho normal do campo; só arquivo (print, foto, documento) vira anexo.
    if (arquivos.length === 0) return;
    event.preventDefault();
    onAdicionar(arquivos);
  }

  function enviar(event: FormEvent) {
    event.preventDefault();
    if (podeEnviar) onEnviar();
  }

  return (
    <div className="composer-faixa">
      <form onSubmit={enviar} className="composer glass">
        {anexos.length > 0 && (
          <ul className="anexos" aria-label="Anexos">
            {anexos.map((anexo) => (
              <ChipAnexo key={anexo.id} anexo={anexo} travado={ocupado} onRemover={() => onRemover(anexo.id)} />
            ))}
          </ul>
        )}
        <div className="composer-linha">
          <label className={`btn btn-ghost composer-icone${ocupado ? " is-disabled" : ""}`} title="Anexar arquivo">
            <AttachmentIcon aria-hidden className="h-5 w-5" />
            <input type="file" multiple className="sr-only" aria-label="Anexar arquivo" disabled={ocupado}
              onChange={(event) => {
                onAdicionar(Array.from(event.target.files ?? []));
                // Zera para escolher o mesmo arquivo de novo depois de removê-lo disparar `change`.
                event.target.value = "";
              }} />
          </label>
          <label htmlFor="reply" className="sr-only">Sua resposta</label>
          <textarea id="reply" ref={campo} rows={1} value={texto} maxLength={16000} placeholder={placeholder}
            className="composer-campo" onPaste={colar} onChange={(event) => onTexto(event.target.value)} />
          <Button type="submit" variant="primary" className="composer-icone" aria-label="Enviar resposta" disabled={!podeEnviar}>
            {ocupado ? <LoaderIcon aria-hidden className="anexo-girando h-5 w-5" /> : <SendIcon aria-hidden className="h-5 w-5" />}
          </Button>
        </div>
      </form>
    </div>
  );
}
