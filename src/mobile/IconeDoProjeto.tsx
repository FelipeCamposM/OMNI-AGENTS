import { useEffect, useState, type ReactNode } from "react";
import { FolderIcon } from "../components/ui/PixelIcon";
import { request, type Projects } from "./api";

/** Um pedido por projeto por sessão da página: o ícone não muda enquanto ela está aberta. */
const lidos = new Map<string, Promise<string | null>>();
function lerIcone(id: string): Promise<string | null> {
  let lido = lidos.get(id);
  if (!lido) {
    lido = request<{ tipo: string; dados: string }>(`/projetos/${encodeURIComponent(id)}/icone`)
      .then(({ tipo, dados }) => `data:${tipo};base64,${dados}`, () => null);
    lidos.set(id, lido);
  }
  return lido;
}

/** O mesmo ícone de projeto que o app do PC mostra (escolhido ou o favicon achado), lido pelo
 *  engine. Sem ícone (ou PC antigo), `reserva` — a pasta por padrão. */
export function IconeDoProjeto({ projeto, className = "h-3.5 w-3.5", reserva }: {
  projeto: Pick<Projects["projects"][number], "id" | "icone"> | null | undefined; className?: string; reserva?: ReactNode;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const id = projeto?.icone ? projeto.id : null;
  useEffect(() => {
    setSrc(null);
    if (!id) return;
    let vivo = true;
    void lerIcone(id).then((url) => { if (vivo) setSrc(url); });
    return () => { vivo = false; };
  }, [id]);
  if (src) return <img src={src} alt="" draggable={false} className={`m-icone-projeto ${className}`} />;
  return <>{reserva ?? <FolderIcon aria-hidden className={`shrink-0 ${className}`} />}</>;
}
