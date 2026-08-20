import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { NOVIDADES, deveAvisar, novidadesDaVersao } from "../lib/changelog";
import type { Novidade } from "../lib/changelog";
import { Button } from "./ui";

/**
 * Versão instalada do aplicativo.
 *
 * Fora do Tauri (testes, `npm run dev:vite`) o módulo nem existe — o import é
 * dinâmico e a falha vira `null`, que é o mesmo que "não sei": sem versão não
 * há aviso, em vez de um aviso sobre uma versão inventada.
 */
export function useVersaoInstalada(): string | null {
  const [versao, setVersao] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    import("@tauri-apps/api/app")
      .then((m) => m.getVersion())
      .then((v) => vivo && setVersao(v))
      .catch(() => vivo && setVersao(null));
    return () => {
      vivo = false;
    };
  }, []);

  return versao;
}

/**
 * Aviso de "o que há de novo", mostrado no Início na primeira abertura depois
 * de atualizar.
 *
 * É um cartão dispensável e não um modal de propósito: novidade não é
 * pendência, e travar a tela de quem abriu o app para converter um arquivo
 * seria pior que não avisar. Some para sempre naquela versão assim que o
 * usuário fecha.
 */
export function NovidadesAviso({
  ultimaVista,
  onVisto,
}: {
  ultimaVista: string;
  onVisto: (versao: string) => void;
}) {
  const versao = useVersaoInstalada();
  if (!deveAvisar(versao, ultimaVista)) return null;

  const entrada = novidadesDaVersao(versao);
  if (!entrada) return null;

  return (
    <section className="glass glass-sheen !rounded-2xl p-5 space-y-3">
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className="w-10 h-10 shrink-0 rounded-xl flex items-center justify-center bg-selected/20 text-selected"
        >
          <Sparkles className="w-5 h-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-text-primary text-sm font-semibold">
            Novidades da versão {entrada.versao}
          </h2>
          <p className="text-text-muted text-[11px]">O que mudou desde a última vez.</p>
        </div>
      </div>

      <ListaDeItens entrada={entrada} />

      <div className="flex justify-end">
        <Button variant="glass" size="sm" onClick={() => onVisto(entrada.versao)}>
          Entendi
        </Button>
      </div>
    </section>
  );
}

/** Histórico completo — vive em Configurações → Sobre, sempre disponível. */
export function NovidadesLista() {
  return (
    <div className="space-y-4">
      {NOVIDADES.map((n) => (
        <div key={n.versao} className="space-y-1.5">
          <div className="flex items-baseline gap-2">
            <h3 className="text-text-primary text-xs font-semibold">Versão {n.versao}</h3>
            <span className="text-text-muted text-[11px]">{n.data}</span>
          </div>
          <ListaDeItens entrada={n} />
        </div>
      ))}
    </div>
  );
}

function ListaDeItens({ entrada }: { entrada: Novidade }) {
  return (
    <ul className="space-y-1.5">
      {entrada.itens.map((item) => (
        <li key={item} className="flex gap-2 text-text-secondary text-xs leading-snug">
          <span aria-hidden="true" className="text-selected shrink-0">
            •
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
