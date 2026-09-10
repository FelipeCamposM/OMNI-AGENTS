/**
 * Gera src/components/ui/PixelIcon.tsx a partir dos SVGs do pacote `pixelarticons`.
 *
 * Por que gerar em vez de importar em runtime: o barrel do `@nsmr/pixelart-react` é quebrado nas
 * duas builds publicadas, e trazer um pacote de ícones inteiro (1036 SVGs) para usar ~25 é peso
 * morto no bundle. Por que gerar em vez de copiar na mão: path de pixel-art é geometria pura —
 * um caractere errado no meio vira um ícone torto que ninguém revisa. Aqui o que se mantém é uma
 * lista de nomes; a arte vem do pacote, versionada.
 *
 * `pixelarticons` é devDependency: só este script precisa dele, e só na hora de regerar.
 *
 * Uso: node scripts/gen-pixel-icons.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svgDir = join(root, "node_modules", "pixelarticons", "svg");
const output = join(root, "src", "components", "ui", "PixelIcon.tsx");
const { version } = JSON.parse(
  readFileSync(join(root, "node_modules", "pixelarticons", "package.json"), "utf8")
);

/** Nome exportado -> arquivo em pixelarticons/svg. Adicionar ícone = adicionar linha e rodar. */
const ICONS = {
  // Controles de formulário e chrome geral
  CheckIcon: "check",
  ChevronDownIcon: "chevron-down",
  SearchIcon: "search",
  LoaderIcon: "loader",
  NotificationIcon: "bell",
  SlidersIcon: "sliders",
  EditIcon: "pencil",
  // Seções da barra lateral (spec 7.3)
  ChatIcon: "message",
  TerminalIcon: "terminal",
  ListIcon: "list-box",
  DockerIcon: "docker",
  FolderIcon: "folder",
  FolderPlusIcon: "folder-plus",
  BookIcon: "book-open",
  GitBranchIcon: "git-branch",
  KanbanIcon: "layout",
  BoxIcon: "box",
  // Ações por item (fechar projeto, duplicar/reiniciar/encerrar sessão)
  CloseIcon: "close",
  CopyIcon: "copy",
  ReloadIcon: "reload",
  // Estado das sessões
  PlayIcon: "play",
  AlertIcon: "square-alert",
  WarningIcon: "warning-diamond",
  CircleIcon: "circle",
  ZapOffIcon: "zap-off",
};

/**
 * Alguns SVGs do pacote trazem mais de um `<path>` (o `reload`, por exemplo, tem três). Todos são
 * retângulos preenchidos e disjuntos, então concatenar os `d` num só path dá exatamente o mesmo
 * desenho — nenhum depende de fill-rule para se recortar.
 */
function extractPath(name) {
  const svg = readFileSync(join(svgDir, `${name}.svg`), "utf8");
  const paths = [...svg.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1].trim());
  if (paths.length === 0) throw new Error(`${name}.svg não tem nenhum path`);
  return paths.join("");
}

const body = Object.entries(ICONS)
  .map(([exportName, file]) => `export const ${exportName} = makeIcon(\n  "${extractPath(file)}"\n);`)
  .join("\n\n");

const file = `import type { SVGProps } from "react";

/**
 * ARQUIVO GERADO — não editar à mão.
 * Rode \`node scripts/gen-pixel-icons.mjs\` depois de mexer na lista ICONS do script.
 *
 * Ícones pixel-art de \`pixelarticons\` v${version} (MIT), inlineados: o app usa ~${
   Object.keys(ICONS).length
 } dos
 * 1036 do pacote, e nenhum runtime externo entra no bundle por causa disso.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number | string };

function makeIcon(path: string) {
  return function Icon({ size = 24, ...props }: IconProps) {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" {...props}>
        <path d={path} fill="currentColor" />
      </svg>
    );
  };
}

${body}
`;

writeFileSync(output, file, "utf8");
console.log(`PixelIcon.tsx gerado: ${Object.keys(ICONS).length} ícones (pixelarticons ${version}).`);
