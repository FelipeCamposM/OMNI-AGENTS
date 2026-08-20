/**
 * Fontes oferecidas na legenda.
 *
 * ⚠️ `familia` é o que vai dentro do `.ass` e é por onde o **libass** casa a
 * fonte — não é o nome do arquivo. `BebasNeue-Regular.ttf` tem família
 * "Bebas Neue"; errar isso faz o libass ignorar e cair no padrão sem avisar.
 *
 * As empacotadas vêm de `assets/fonts/` (baixadas por `npm run fonts`) e são as
 * únicas que saem iguais em qualquer máquina. As do Windows dependem do que o
 * usuário tem instalado — o mesmo projeto pode renderizar diferente noutro PC.
 */
export interface SubtitleFont {
  familia: string;
  rotulo: string;
  origem: "empacotada" | "windows";
  nota?: string;
}

export const FONTES_EMPACOTADAS: SubtitleFont[] = [
  { familia: "Bebas Neue", rotulo: "Bebas Neue", origem: "empacotada", nota: "Condensada, impacto" },
  { familia: "Anton", rotulo: "Anton", origem: "empacotada", nota: "Pesada, redes sociais" },
  { familia: "Montserrat", rotulo: "Montserrat", origem: "empacotada", nota: "Geométrica, limpa" },
  { familia: "Inter", rotulo: "Inter", origem: "empacotada", nota: "Neutra, altíssima leitura" },
];

/** Do Windows. Sem download, mas o resultado varia de máquina para máquina. */
export const FONTES_WINDOWS: SubtitleFont[] = [
  { familia: "Segoe UI", rotulo: "Segoe UI", origem: "windows" },
  { familia: "Arial", rotulo: "Arial", origem: "windows" },
  { familia: "Verdana", rotulo: "Verdana", origem: "windows" },
  { familia: "Impact", rotulo: "Impact", origem: "windows" },
  { familia: "Bahnschrift", rotulo: "Bahnschrift", origem: "windows" },
  { familia: "Georgia", rotulo: "Georgia", origem: "windows" },
];

export const FONTE_PADRAO = "Bebas Neue";

/** Pilha de CSS para o preview: a fonte pedida, com fallback legível. */
export function pilhaCss(familia: string): string {
  return `"${familia}", "Segoe UI", Arial, sans-serif`;
}
