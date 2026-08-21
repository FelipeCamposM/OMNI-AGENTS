import type { SVGProps } from "react";

/**
 * Ícones pixel-art inline. `@nsmr/pixelart-react@2.0.0` (a origem destes
 * paths — pixelarticons, MIT) tem o barrel `index.js` quebrado nas duas
 * builds (cjs e esm: tentam importar um `./Icon` que não existe no pacote
 * publicado — confirmado tanto com `require()` direto quanto no resolvedor
 * do Vite/Vitest). Em vez de depender de um pacote que não importa, os 7
 * ícones que o app usa moram aqui: mesmos paths, sem runtime externo.
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

export const CheckIcon = makeIcon(
  "M18 6h2v2h-2V6zm-2 4V8h2v2h-2zm-2 2v-2h2v2h-2zm-2 2h2v-2h-2v2zm-2 2h2v-2h-2v2zm-2 0v2h2v-2H8zm-2-2h2v2H6v-2zm0 0H4v-2h2v2z"
);

export const ChevronDownIcon = makeIcon(
  "M7 8H5v2h2v2h2v2h2v2h2v-2h2v-2h2v-2h2V8h-2v2h-2v2h-2v2h-2v-2H9v-2H7V8z"
);

export const SearchIcon = makeIcon(
  "M6 2h8v2H6V2zM4 6V4h2v2H4zm0 8H2V6h2v8zm2 2H4v-2h2v2zm8 0v2H6v-2h8zm2-2h-2v2h2v2h2v2h2v2h2v-2h-2v-2h-2v-2h-2v-2zm0-8h2v8h-2V6zm0 0V4h-2v2h2z"
);

export const LoaderIcon = makeIcon(
  "M13 2h-2v6h2V2zm0 14h-2v6h2v-6zm9-5v2h-6v-2h6zM8 13v-2H2v2h6zm7-6h2v2h-2V7zm4-2h-2v2h2V5zM9 7H7v2h2V7zM5 5h2v2H5V5zm10 12h2v2h2v-2h-2v-2h-2v2zm-8 0v-2h2v2H7v2H5v-2h2z"
);

export const NotificationIcon = makeIcon(
  "M14 4V2h-4v2H5v2h14V4h-5zm5 12H5v-4H3v6h5v4h2v-4h4v2h-4v2h6v-4h5v-6h-2V6h-2v8h2v2zM5 6v8h2V6H5z"
);

export const SlidersIcon = makeIcon(
  "M17 4h2v10h-2V4zm0 12h-2v2h2v2h2v-2h2v-2h-4zm-4-6h-2v10h2V10zm-8 2H3v2h2v6h2v-6h2v-2H5zm8-8h-2v2H9v2h6V6h-2V4zM5 4h2v6H5V4z"
);

export const FolderPlusIcon = makeIcon(
  "M4 4h8v2h10v14H2V4h2zm16 4H10V6H4v12h16V8zm-6 2h2v2h2v2h-2v2h-2v2h-2v-2h-2v-2h2v-2z"
);
