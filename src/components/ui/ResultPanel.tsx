import { Check, Copy, File, FolderOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { openFolder } from "../../services/conversionService";
import { usePulse, useStagger } from "../../lib/motion";
import { Button } from "./Button";

export interface ResultPanelProps {
  /** Caminhos gerados. O primeiro é o que "Abrir pasta" revela. */
  paths: string[];
  /** Sobrescreve o título padrão "N arquivos gerados". */
  label?: string;
  /** Conteúdo extra entre o cabeçalho e a lista de caminhos. */
  children?: ReactNode;
  /** Oculta a lista de caminhos (quando o children já mostra o resultado). */
  hidePaths?: boolean;
}

const SEP = /[/\\]/;

function fileName(p: string) {
  return p.split(SEP).pop() || p;
}

function dirName(p: string) {
  const i = p.search(/[/\\][^/\\]*$/);
  return i > 0 ? p.slice(0, i) : "";
}

/**
 * Painel de sucesso — mesmo formato nas ferramentas que geram arquivo.
 *
 * Cada caminho vira uma linha com nome em destaque e pasta em segundo plano,
 * porque o caminho cru numa linha só truncava justo no fim, que é a parte que
 * interessa. A pasta sobe pro cabeçalho quando é a mesma para todos.
 */
export function ResultPanel({ paths, label, children, hidePaths }: ResultPanelProps) {
  const [copiado, setCopiado] = useState<string | null>(null);
  const badgeRef = useRef<HTMLSpanElement>(null);
  const pulse = usePulse();
  const listRef = useStagger<HTMLUListElement>("li", [paths.join("|")]);

  const vazio = paths.length === 0;

  // Confirma visualmente que a operação terminou.
  useEffect(() => {
    if (!vazio) pulse(badgeRef.current);
  }, [vazio, paths.length, pulse]);

  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(null), 1600);
    return () => clearTimeout(t);
  }, [copiado]);

  if (vazio) return null;

  const pastas = new Set(paths.map(dirName));
  const pastaComum = pastas.size === 1 ? [...pastas][0] : null;

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(texto);
    } catch {
      // Clipboard bloqueado: sem toast, o caminho segue visível pra copiar à mão.
    }
  }

  return (
    <section className="glass glass-success glass-sheen p-4 space-y-3">
      <div className="flex items-center gap-3">
        <span
          ref={badgeRef}
          aria-hidden="true"
          className="glass w-8 h-8 shrink-0 !rounded-full flex items-center justify-center text-success"
        >
          <Check className="w-4 h-4" strokeWidth={3} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-text-primary text-sm font-medium truncate">
            {label ?? `${paths.length} arquivo${paths.length !== 1 ? "s" : ""} gerado${paths.length !== 1 ? "s" : ""}`}
          </p>
          {pastaComum && (
            <p className="text-text-muted text-[11px] truncate" title={pastaComum}>
              {pastaComum}
            </p>
          )}
        </div>

        <Button variant="ghost" size="sm" onClick={() => openFolder(paths[0])}>
          <FolderOpen aria-hidden="true" className="w-3.5 h-3.5" />
          Abrir pasta
        </Button>
      </div>

      {children}

      {!hidePaths && (
        <ul ref={listRef} className="space-y-1.5 max-h-56 overflow-y-auto">
          {paths.map((p) => (
            <li
              key={p}
              className="glass-inset glass-hover group flex items-center gap-2.5 px-2.5 py-2"
            >
              <File aria-hidden="true" className="w-4 h-4 shrink-0 text-success" />

              <div className="min-w-0 flex-1">
                <p className="text-text-primary text-xs truncate" title={p}>
                  {fileName(p)}
                </p>
                {!pastaComum && (
                  <p className="text-text-muted text-[10px] truncate">{dirName(p)}</p>
                )}
              </div>

              {/* Aparecem no hover, mas seguem tabuláveis: focus-within revela. */}
              <span className="flex items-center gap-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Copiar caminho de ${fileName(p)}`}
                  onClick={() => copiar(p)}
                >
                  {copiado === p ? (
                    <Check aria-hidden="true" className="w-3.5 h-3.5 text-success" />
                  ) : (
                    <Copy aria-hidden="true" className="w-3.5 h-3.5" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Abrir pasta de ${fileName(p)}`}
                  onClick={() => openFolder(p)}
                >
                  <FolderOpen aria-hidden="true" className="w-3.5 h-3.5" />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
