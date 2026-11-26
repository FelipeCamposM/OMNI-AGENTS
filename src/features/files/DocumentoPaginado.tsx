// Markdown "estilo PDF": folhas A4 de verdade. Os blocos renderizados são medidos numa folha escondida e
// repartidos por altura; bloco maior que uma folha fica sozinho nela (cortado no fim, como numa impressão).
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { useLayoutEffect, useRef, useState } from "react";
import "./documentoPaginado.css";

/** A4 a 96 dpi e a margem da folha: iguais a `documentoPaginado.css` e ao `@page` da impressão. */
const ALTURA = 1123;
const MARGEM = 72;
const UTIL = ALTURA - 2 * MARGEM;

/** Agrupa blocos (topo e altura, em px) em folhas de `util` px. */
export function repartir(blocos: { topo: number; altura: number }[], util = UTIL): number[][] {
  const folhas: number[][] = [];
  let inicio = 0;
  blocos.forEach((b, i) => {
    const atual = folhas[folhas.length - 1];
    if (!atual || (atual.length > 0 && b.topo + b.altura - inicio > util)) {
      folhas.push([i]);
      inicio = b.topo;
    } else atual.push(i);
  });
  return folhas.length ? folhas : [[]];
}

export function DocumentoPaginado({ conteudo }: { conteudo: string }) {
  const medida = useRef<HTMLElement>(null);
  const [folhas, setFolhas] = useState<string[]>([]);

  useLayoutEffect(() => {
    const el = medida.current;
    if (!el) return;
    const filhos = [...el.children] as HTMLElement[];
    const grupos = repartir(filhos.map((f) => ({ topo: f.offsetTop, altura: f.offsetHeight })));
    // HTML já passou pelo rehype-sanitize ao renderizar a folha de medida.
    setFolhas(grupos.map((g) => g.map((i) => filhos[i].outerHTML).join("")));
  }, [conteudo]);

  return (
    <div className="md-paginas" data-md-paginas>
      <article ref={medida} className="md-folha-conteudo prose prose-neutral md-medida" aria-hidden="true">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{conteudo}</ReactMarkdown>
      </article>
      {folhas.map((html, i) => (
        <section key={i} className="md-folha" aria-label={`Página ${i + 1} de ${folhas.length}`}>
          <article className="md-folha-conteudo prose prose-neutral" dangerouslySetInnerHTML={{ __html: html }} />
          <span className="md-folha-numero">{i + 1} / {folhas.length}</span>
        </section>
      ))}
    </div>
  );
}
