import type { SVGProps } from "react";

/**
 * ARQUIVO GERADO — não editar à mão.
 * Rode `node scripts/gen-pixel-icons.mjs` depois de mexer na lista ICONS do script.
 *
 * Ícones pixel-art de `pixelarticons` v2.4.1 (MIT), inlineados: o app usa ~101 dos
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

export const CheckIcon = makeIcon(
  "M10 18H8v-2h2v2Zm-2-2H6v-2h2v2Zm4-2v2h-2v-2h2Zm-6 0H4v-2h2v2Zm8 0h-2v-2h2v2Zm2-2h-2v-2h2v2Zm2-2h-2V8h2v2Zm2-2h-2V6h2v2Z"
);

export const ChevronDownIcon = makeIcon(
  "M13 16h-2v-2h2v2Zm-2-2H9v-2h2v2Zm4 0h-2v-2h2v2Zm-6-2H7v-2h2v2Zm8 0h-2v-2h2v2ZM7 10H5V8h2v2Zm12 0h-2V8h2v2Z"
);

export const SearchIcon = makeIcon(
  "M22 22h-2v-2h2v2Zm-2-2h-2v-2h2v2Zm-6-2H6v-2h8v2Zm4 0h-2v-2h2v2ZM6 16H4v-2h2v2Zm10 0h-2v-2h2v2ZM4 14H2V6h2v8Zm14 0h-2V6h2v8ZM6 6H4V4h2v2Zm10 0h-2V4h2v2Zm-2-2H6V2h8v2Z"
);

export const LoaderIcon = makeIcon(
  "M13 22h-2v-6h2v6Zm-6-3H5v-2h2v2Zm12 0h-2v-2h2v2ZM9 17H7v-2h2v2Zm8 0h-2v-2h2v2Zm-9-4H2v-2h6v2Zm14 0h-6v-2h6v2ZM9 9H7V7h2v2Zm8 0h-2V7h2v2Zm-4-1h-2V2h2v6ZM7 7H5V5h2v2Zm12 0h-2V5h2v2Z"
);

export const NotificationIcon = makeIcon(
  "M9 2h6v2H9zM7 4h2v2H7zm8 0h2v2h-2zM5 6h2v7H5zm12 0h2v7h-2zM3 13h2v4H3zm16 0h2v4h-2zM3 15h18v2H3zm5 3h2v2H8zm6 0h2v2h-2zm-4 2h4v2h-4z"
);

export const SlidersIcon = makeIcon(
  "M8 14H7v6H5v-6H2v-2h6v2Zm5 6h-2V10h2v10Zm9-2h-3v2h-2v-2h-1v-2h6v2Zm-3-4h-2V4h2v10ZM7 10H5V4h2v6Zm6-4h2v2H9V6h2V4h2v2Z"
);

export const EditIcon = makeIcon(
  "M4 16H6V18H8V20H10V22H2V14H4V16ZM12 20H10V18H12V20ZM14 18H12V16H14V18ZM10 16H8V14H10V16ZM16 16H14V14H16V16ZM6 14H4V12H6V14ZM12 14H10V12H12V14ZM18 14H16V12H18V14ZM8 12H6V10H8V12ZM14 12H12V10H14V12ZM20 12H18V10H20V12ZM10 10H8V8H10V10ZM18 10H16V8H18V10ZM22 10H20V8H22V10ZM12 8H10V6H12V8ZM16 8H14V6H16V8ZM20 8H18V6H20V8ZM14 6H12V4H14V6ZM18 6H16V4H18V6ZM16 4H14V2H16V4Z"
);

export const ChatIcon = makeIcon(
  "M20 2H4v2h16zm0 14H6v2h14zm2-12h-2v12h2zM4 4H2v18h2zm2 14H4v2h2z"
);

export const TerminalIcon = makeIcon(
  "M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zM6 16h2v2H6zm2-2h2v2H8zm-2-2h2v2H6z"
);

export const ListIcon = makeIcon(
  "M4 2h16v2H4zm2 5h2v2H6zm4 0h8v2h-8zm-4 4h2v2H6zm4 0h8v2h-8zm-4 4h2v2H6zm4 0h8v2h-8zm-6 5h16v2H4zM2 4h2v16H2zm18 0h2v16h-2z"
);

export const DockerIcon = makeIcon(
  "M16 20H6v-2h10v2ZM6 18H4v-2h2v2Zm12 0h-2v-2h2v2Zm2-2h-2v-4H4v4H2v-6h16V8h2v8ZM9 15H7v-2h2v2ZM6 8H4V6h2v2Zm3 0H7V6h2v2Zm3 0h-2V6h2v2Zm6 0h-2V6h2v2Zm4 0h-2V6h2v2ZM9 5H7V3h2v2Zm3 0h-2V3h2v2Z"
);

export const FolderIcon = makeIcon(
  "M4 4h6v2H4zm0 14h16v2H4zM20 8h2v10h-2zM2 6h2v12H2zm8 0h10v2H10z"
);

export const FolderPlusIcon = makeIcon(
  "M4 4h6v2H4zm0 14h10v2H4zM20 8h2v6h-2zM2 6h2v12H2zm8 0h10v2H10zm12 12v2h-6v-2zM18 16h2v6h-2z"
);

export const BookIcon = makeIcon(
  "M2 3h9v2H2zM0 19h11v2H0zM13 3h9v2h-9zm0 16h11v2H13zM11 5h2v18h-2zM0 5h2v14H0zm22 0h2v14h-2zm-7 2h5v2h-5zm0 4h5v2h-5zm0 4h2v2h-2z"
);

export const GitBranchIcon = makeIcon(
  "M4 14h4v2H4zm0 6h4v2H4zm-2-4h2v4H2zm6 0h2v4H8zm8-14h4v2h-4zm0 6h4v2h-4zm-2-4h2v4h-2zm6 0h2v4h-2zm-8 13h5v2h-5zm5-5h2v5h-2zM5 2h2v10H5z"
);

export const KanbanIcon = makeIcon(
  "M20 20H4v-2h4v-8H4v8H2V6h2v2h16V6h2v12h-2v-8H10v8h10v2Zm0-14H4V4h16v2Z"
);

export const BoxIcon = makeIcon(
  "M14 4h4v2h-4zm-4-2h4v2h-4zM6 8h4v2H6zm0 10h4v2H6zm4-8h4v2h-4zm0 10h4v2h-4zm4-12h4v2h-4zm0 10h4v2h-4zM6 4h4v2H6zM2 6h4v2H2zm0 10h4v2H2zM18 6h4v2h-4zm0 10h4v2h-4zM2 6h2v12H2zm18 0h2v12h-2zm-8 6h2v8h-2z"
);

export const CloseIcon = makeIcon(
  "M7 19H5V17H7V19ZM19 19H17V17H19V19ZM9 15V17H7V15H9ZM17 17H15V15H17V17ZM11 15H9V13H11V15ZM15 15H13V13H15V15ZM13 13H11V11H13V13ZM11 11H9V9H11V11ZM15 11H13V9H15V11ZM9 9H7V7H9V9ZM17 9H15V7H17V9ZM7 7H5V5H7V7ZM19 7H17V5H19V7Z"
);

export const CopyIcon = makeIcon(
  "M8 6h12v2H8zM4 2h12v2H4zm2 6h2v12H6zM2 4h2v12H2zm6 16h12v2H8zM20 8h2v12h-2zm-4-4h2v2h-2zM4 16h2v2H4z"
);

export const ReloadIcon = makeIcon(
  "M16 4h2v6h-2zm-2-2h2v2h-2zm0 2h2v8h-2zM4 8H2v5h2zM4 6h16v2H4zm4 14H6v-6h2zm2 2H8v-2h2zm0-2H8v-8h2zm10-4h2v-5h-2zM20 18H4v-2h16z"
);

export const PlayIcon = makeIcon(
  "M15 11h-2V9h2zm0 4h-2v-2h2zm-2 2h-2v-2h2zm0-8h-2V7h2zm-2-2H9V5h2zM9 21H7V3h2zm6-8h2v-2h-2zm-6 4h2v2H9z"
);

export const AlertIcon = makeIcon(
  "M4 2h16v2H4zm0 18h16v2H4zM20 4h2v16h-2zM2 4h2v16H2zm9 2h2v8h-2zm0 10h2v2h-2z"
);

export const WarningIcon = makeIcon(
  "M2 10h2v2H2zm0 4h2v-2H2zm20-4h-2v2h2zm0 4h-2v-2h2zM4 8h2v2H4zm0 8h2v-2H4zm16-8h-2v2h2zm0 8h-2v-2h2zM6 6h2v2H6zm0 12h2v-2H6zM18 6h-2v2h2zm0 12h-2v-2h2zM8 4h2v2H8zm0 16h2v-2H8zm8-16h-2v2h2zm0 16h-2v-2h2zM10 2h2v2h-2zm0 20h2v-2h-2zm4-20h-2v2h2zm0 20h-2v-2h2zm-3-5h2v-2h-2zm0-4h2V7h-2z"
);

export const CircleIcon = makeIcon(
  "M6 2h12v2H6zm0 18h12v2H6zM2 6h2v12H2zm18 0h2v12h-2zm-2-2h2v2h-2zm0 14h2v2h-2zM4 4h2v2H4zm0 14h2v2H4z"
);

export const ZapOffIcon = makeIcon(
  "M10 13h2v10h-2zM2 13h10v2H2zM12 1h2v6h-2zm4 8h6v2h-6zm4 2h2v2h-2zm-4 4h2v2h-2zm-2 2h2v2h-2zm-2 2h2v2h-2zM2 11h2v2H2zm2-2h2v2H4zm2-2h2v2H6zm4-4h2v2h-2zM2 1h2v2H2zm2 2h2v2H4zm2 2h2v2H6zm2 2h2v2H8zm2 2h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zM16 15h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2z"
);

export const FileIcon = makeIcon(
  "M6 4H4v16h2zm10-2H6v2h10zm4 4h-2v14h2zm-2 14H6v2h12zM16 4h2v2h-2zm-4 0h2v6h-2zM12 8h6v2h-6z"
);

export const FileTextIcon = makeIcon(
  "M6 4H4v16h2zm10-2H6v2h10zm4 4h-2v14h2zm-2 14H6v2h12zM16 4h2v2h-2zm-4 0h2v6h-2zM12 8h6v2h-6zm-4 8h8v2H8zm0-4h8v2H8zm0-4h2v2H8z"
);

export const ArchiveIcon = makeIcon(
  "M3 2h18v2H3zm0 5h18v2H3zM1 4h2v3H1zm20 0h2v3h-2zm-2 5h2v11h-2zM3 9h2v11H3zm2 11h14v2H5zm4-9h6v2H9z"
);

export const PackageIcon = makeIcon(
  "M10 20h4v2h-4zm0-16h4V2h-4zm0 6h4v2h-4zm4 8h4v2h-4zm0-12h4V4h-4zm0 2h4v2h-4zm4 8h4v2h-4zm0-8h4V6h-4zM6 18h4v2H6zM6 6h4V4H6zm0 2h4v2H6zm-4 8h4v2H2zm0-8h4V6H2zM2 6h2v12H2zm18 0h2v12h-2zm-8 6h2v8h-2zm-2-6h4v2h-4z"
);

export const ImageIcon = makeIcon(
  "M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zm-4 8h2v2h-2zm-2 2h2v2h-2zm4 0h2v2h-2zm-8 0h2v2h-2zm2 2h2v2h-2zm2 2h2v2h-2zM20 16h2v2h-2zM8 16h2v2H8zm-2 2h2v2H6zM8 6h2v2H8zM6 8h2v2H6zm2 2h2v2H8zm2-2h2v2h-2z"
);

export const VideoIcon = makeIcon(
  "M20 17V7h2v10zm-2-2V9h2v6zM2 7h2v10H2zm14 0h2v10h-2zM4 5h12v2H4zm0 12h12v2H4z"
);

export const ClapperboardIcon = makeIcon(
  "M4 3h16v2H4zm0 6h16v2H4zM2 5h2v14H2zm18 0h2v14h-2zM4 19h16v2H4zM18 7h-2v2h2zm-8 0H8v2h2zm6-2h-2v2h2zM8 5H6v2h2z"
);

export const MusicIcon = makeIcon(
  "M4 12h4v2H4zm-2 2h2v4H2zm2 4h4v2H4zM8 6h2v12H8zm10 0h2v12h-2zm-6 8h2v4h-2zm2-2h4v2h-4zm0 6h4v2h-4zM10 4h8v2h-8z"
);

export const WaveformIcon = makeIcon(
  "M3 7h2v5H3zm4 0h2v13H7zm4-3h2v16h-2zm4 0h2v13h-2zM5 5h2v2H5zm4 15h2v2H9zm4-18h2v2h-2zm4 15h2v2h-2zm2-5h2v5h-2zm2-2h2v2h-2zM1 12h2v2H1z"
);

export const HeadphoneIcon = makeIcon(
  "M14 13h7v2h-7zm2 6h3v2h-3zM14 13h2v8h-2zm5-6h2v12h-2zM3 13h7v2H3zm2 6h3v2H5zM3 7h2v12H3zm5 6h2v8H8zM7 3h10v2H7zM5 5h2v2H5zm12 0h2v2h-2z"
);

export const CodeIcon = makeIcon(
  "M11 18H9v-4h2v4Zm-4-1H5v-2h2v2Zm12-2v2h-2v-2h2ZM5 15H3v-2h2v2Zm16 0h-2v-2h2v2Zm-8-1h-2v-4h2v4ZM3 13H1v-2h2v2Zm20 0h-2v-2h2v2ZM5 11H3V9h2v2Zm16 0h-2V9h2v2Zm-6-1h-2V6h2v4ZM7 9H5V7h2v2Zm12 0h-2V7h2v2Z"
);

export const ScriptIcon = makeIcon(
  "M16 19h2v2H4v-2h10v-2h2v2ZM6 15h8v2H4v2H2v-4h2V5h2v10ZM20 5h2v6h-2v8h-2V5H6V3h14v2Z"
);

export const BracesIcon = makeIcon(
  "M6 4h4v2H6zm12 0h-4v2h4zM6 20h4v-2H6zm12 0h-4v-2h4zM4 6h2v5H4zm16 0h-2v5h2zM4 18h2v-5H4zm16 0h-2v-5h2zM2 11h2v2H2zm20 0h-2v2h2z"
);

export const BracketsIcon = makeIcon(
  "M5 4h4v2H5zm14 0h-4v2h4zM5 20h4v-2H5zm14 0h-4v-2h4zM3 6h2v12H3zm18 0h-2v12h2z"
);

export const BracketsAngleIcon = makeIcon(
  "M8 5h2v2H8V5ZM6 7h2v2H6V7ZM4 9h2v2H4V9Zm-2 2h2v2H2v-2Zm2 2h2v2H4v-2Zm2 2h2v2H6v-2Zm2 2h2v2H8v-2Zm8-12h-2v2h2V5Zm2 2h-2v2h2V7Zm2 2h-2v2h2V9Zm2 2h-2v2h2v-2Zm-2 2h-2v2h2v-2Zm-2 2h-2v2h2v-2Zm-2 2h-2v2h2v-2Z"
);

export const BinaryIcon = makeIcon(
  "M7 3h2v2H7zm8 10h2v2h-2zM5 5h2v4H5zm8 10h2v4h-2zM9 5h2v4H9zm8 10h2v4h-2zM7 9h2v2H7zm8 10h2v2h-2zM13 3h4v2h-4zM5 13h4v2H5zm10-8h2v4h-2zM7 15h2v4H7zm6-6h6v2h-6zM5 19h6v2H5z"
);

export const AlgorithmIcon = makeIcon(
  "M11 16h4v2h-4zm-8 0h4v2H3zm16 0h4v2h-4zM9 16h2v6H9zm-8 0h2v6H1zm16 0h2v6h-2zM9 20h6v2H9zm-8 0h6v2H1zm16 0h6v2h-6zM13 16h2v6h-2zm-8 0h2v6H5zm16 0h2v6h-2zM8 8h8v2H8zM8 2h2v8H8zM8 2h8v2H8zM14 2h2v8h-2zM3 14h2v3H3zm2-2h14v2H5zm14 2h2v3h-2zM11 9h2v9h-2zm5-4h2v2h-2zm-5-5h2v2h-2zM6 5h2v2H6z"
);

export const HashIcon = makeIcon(
  "M9 3h2v5H9zm6 0h2v5h-2zm-7 7h2v4H8zm6 0h2v4h-2zm-7 6h2v5H7zm6 0h2v5h-2zM3 8h18v2H3zm0 6h18v2H3z"
);

export const GearIcon = makeIcon(
  "M18 22H13V24H11V22H6V20H18V22ZM4 22H2V20H4V22ZM22 22H20V20H22V22ZM6 20H4V18H6V20ZM20 20H18V18H20V20ZM4 18H2V13H0V11H2V6H4V18ZM8 18H6V16H8V18ZM22 11H24V13H22V18H20V13H16V16H8V8H16V11H20V6H22V11ZM10 10V14H14V10H10ZM8 8H6V6H8V8ZM6 6H4V4H6V6ZM20 6H18V4H20V6ZM4 4H2V2H4V4ZM13 2H18V4H6V2H11V0H13V2ZM22 4H20V2H22V4Z"
);

export const DatabaseIcon = makeIcon(
  "M2 6h2v4H2zm0 4h2v4H2zm0 4h2v4H2zm18-8h2v4h-2zm0 4h2v4h-2zm0 4h2v4h-2zM4 4h4v2H4zm0 8h4v-2H4zm0 4h4v-2H4zm0 4h4v-2H4zM16 4h4v2h-4zm0 8h4v-2h-4zm0 4h4v-2h-4zm0 4h4v-2h-4zM8 2h8v2H8zm0 12h8v-2H8zm0 4h8v-2H8zm0 4h8v-2H8z"
);

export const ServerIcon = makeIcon(
  "M6 7h4v2H6zm0 8h4v2H6zM2 5h2v14H2zm18 0h2v14h-2zM4 19h16v2H4zM4 3h16v2H4zm0 8h16v2H4z"
);

export const CloudIcon = makeIcon(
  "M22 10h-4v2h4v-2Zm2 2h-2v6h2v-6Zm-2 6H2v2h20v-2ZM2 12H0v6h2v-6Zm2-2H2v2h2v-2Zm4-2H4v2h4V8Zm8-4h-6v2h6V4Zm-6 2H8v2h2V6Zm0 4H8v2h2v-2Zm8-4h-2v2h2V6ZM20 8h-2v4h2V8Zm-2 4h-2v2h2v-2Z"
);

export const GlobeIcon = makeIcon(
  "M6 2h12v2H6zm0 18h12v2H6zM4 4h2v2H4zm5 0h2v2H9zm0 14h2v2H9zm4 0h2v2h-2zM7 6h2v12H7zm8 0h2v12h-2zm-2-2h2v2h-2zm7 0h-2v2h2zM2 6h2v12H2zm20 0h-2v12h2zM4 18h2v2H4zm16 0h-2v2h2zM3 11h18v2H3z"
);

export const LockIcon = makeIcon(
  "M5 8h14v2H5zm0 12h14v2H5zM3 10h2v10H3zm16 0h2v10h-2zM7 4h2v4H7zm2-2h6v2H9zm6 2h2v4h-2z"
);

export const KeyIcon = makeIcon(
  "M11 18H3V16H11V18ZM23 15H21V18H17V16H19V13H21V11H11V8H13V9H23V15ZM3 16H1V8H3V16ZM17 16H15V15H13V16H11V13H17V16ZM9 14H5V10H9V14ZM11 8H3V6H11V8Z"
);

export const ShieldIcon = makeIcon(
  "M4 2h16v2H4zM2 4h2v10H2zm18 0h2v10h-2zM4 14h2v2H4zm2 2h2v2H6zm4 4h4v2h-4zm10-6h-2v2h2zm-2 2h-2v2h2zm-2 2h-2v2h2zm-6 0H8v2h2z"
);

export const NpmIcon = makeIcon(
  "M24 16H12v2H6v-2H0V7h24v9ZM8 16h2v-2h3V9H8v7Zm-6-2h1v-4h2v4h1V9H2v5Zm13 0h1v-4h2v4h1v-4h2v4h1V9h-7v5Zm-3-1h-2v-3h2v3Z"
);

export const PnpmIcon = makeIcon(
  "M8 22H2v-6h6v6Zm7 0H9v-6h6v6Zm7 0h-6v-6h6v6ZM4 20h2v-2H4v2Zm7 0h2v-2h-2v2Zm7 0h2v-2h-2v2Zm-7-9v2h2v-2h-2Zm11 4h-6V9h6v6Zm-4-2h2v-2h-2v2ZM8 8H2V2h6v6Zm7 0H9V2h6v6Zm7 0h-6V2h6v6ZM4 6h2V4H4v2Zm7 0h2V4h-2v2Zm7 0h2V4h-2v2Zm-3 9H9V9h6v6Z"
);

export const DenoIcon = makeIcon(
  "M14 20h4v2H6v-2h6v-3h2v3Zm-8 0H4v-2h2v2Zm16-2h-2v2h-2v-4h2V6h2v12ZM4 18H2V6h2v12Zm8-1H8v-2h4v2Zm6-1h-2v-6h2v6ZM8 15H6v-5h2v5Zm5-2h-2v-2h2v2Zm3-3H8V8h8v2ZM6 6H4V4h2v2Zm14 0h-2V4h2v2Zm-2-2H6V2h12v2Z"
);

export const ReactIcon = makeIcon(
  "M8 22H4V20H8V22ZM20 22H16V20H20V22ZM4 20H2V16H4V20ZM10 20H8V18H10V20ZM16 20H14V18H16V20ZM22 20H20V16H22V20ZM10 10V14H14V10H10ZM6 16H4V14H6V16ZM20 16H18V14H20V16ZM4 14H2V10H4V14ZM22 14H20V10H22V14ZM6 10H4V8H6V10ZM20 10H18V8H20V10ZM4 8H2V4H4V8ZM22 8H20V4H22V8ZM10 6H8V4H10V6ZM16 6H14V4H16V6ZM8 4H4V2H8V4ZM20 4H16V2H20V4ZM18 10V14H16V16H14V18H10V16H8V14H6V10H8V8H10V6H14V8H16V10H18Z"
);

export const GithubIcon = makeIcon(
  "M5 2h4v2H7v2H5V2Zm0 10H3V6h2v6Zm2 2H5v-2h2v2Zm2 2v-2H7v2H3v-2H1v2h2v2h4v4h2v-4h2v-2H9Zm0 0v2H7v-2h2Zm6-12v2H9V4h6Zm4 2h-2V4h-2V2h4v4Zm0 6V6h2v6h-2Zm-2 2v-2h2v2h-2Zm-2 2v-2h2v2h-2Zm0 2h-2v-2h2v2Zm0 0h2v4h-2v-4Z"
);

export const VercelIcon = makeIcon(
  "M3 18h18v-1h2v3H1v-3h2v1Zm2-1H3v-3h2v3Zm16 0h-2v-3h2v3ZM7 14H5v-3h2v3Zm12 0h-2v-3h2v3ZM9 11H7V8h2v3Zm8 0h-2V8h2v3Zm-6-3H9V5h2v3Zm4 0h-2V5h2v3Zm-2-3h-2V3h2v2Z"
);

export const AppleIcon = makeIcon(
  "M11 8h3v2h-3zm3-2h4v2h-4zm4 2h2v3h-2zm-2 3h2v4h-2zm2 4h2v5h-2zm-4 5h4v2h-4zm-3-2h3v2h-3zm-4 2h4v2H7zm-2-2h2v2H5zm-2-8h2v8H3zm2-2h2v2H5zm2-2h4v2H7zm5-3h2v2h-2zm2-2h2v2h-2z"
);

export const AndroidIcon = makeIcon(
  "M2 12h2v6H2zm18 0h2v6h-2zM4 10h2v2H4zm4 2h2v4H8zm6 0h2v4h-2zm6-2h-2v2h2zM6 8h2v2H6zM4 6h2v2H4zM2 4h2v2H2zm16 4h-2v2h2zm2-2h-2v2h2zm2-2h-2v2h2zM8 6h8v2H8zM2 18h20v2H2z"
);

export const LinuxIcon = makeIcon(
  "M15 22H9v-2h6v2Zm-6-2H7v-2h2v2Zm8 0h-2v-2h2v2ZM3 14h4v4H5v-2H1v-4h2v2Zm20 2h-4v2h-2v-4h4v-2h2v4Zm-10-3h-2v-2H9V9h6v2h-2v2Zm-8-1H3v-2h2v2Zm16 0h-2v-2h2v2ZM7 10H5V8h2v2Zm12 0h-2V8h2v2ZM9 8H7V4h2v4Zm8 0h-2V4h2v4Zm-2-4H9V2h6v2Z"
);

export const NoteIcon = makeIcon(
  "M2 4h2v16H2zm18 0h2v12h-2zM4 2h16v2H4zm14 14h2v2h-2zm-2 2h2v2h-2zM4 20h12v2H4zm10-8h6v2h-6zm-2 2h2v6h-2z"
);

export const NotesIcon = makeIcon(
  "M6 8h2v12H6zM2 4h2v12H2zm18 4h2v8h-2zM8 6h12v2H8zM4 2h12v2H4zm14 14h2v2h-2zm-2 2h2v2h-2zm-8 2h8v2H8zm6-6h6v2h-6zM14 14h2v6h-2zm2-10h2v2h-2zM4 16h2v2H4z"
);

export const NotebookIcon = makeIcon(
  "M6 2h14v2H6zm0 18h14v2H6zM20 4h2v16h-2zM4 4h2v16H4zM2 7h6v2H2zm0 4h6v2H2zm0 4h6v2H2zM16 4h2v16h-2z"
);

export const ArticleIcon = makeIcon(
  "M8 2h12v2H8zM6 4h2v16H6zm14 0h2v16h-2zM4 20h16v2H4zm-2-9h2v9H2zm2-2h2v2H4zm6-3h8v2h-8zm0 4h8v2h-8zm0-2h2v2h-2zm6 0h2v2h-2zm-6 5h8v2h-8zm0 3h4v2h-4z"
);

export const BookmarkIcon = makeIcon(
  "M6 2h12v2H6zM4 4h2v18H4zm14 0h2v18h-2zm-2 16h2v2h-2zm-2-2h2v2h-2zm-8 2h2v2H6zm2-2h2v2H8zm2-2h4v2h-4z"
);

export const ClipboardNoteIcon = makeIcon(
  "M20 12h2v8h-2zm-8-2h8v2h-8zm0 10h8v2h-8zm-2-8h2v8h-2zM6 2h8v2H6zm0 4h8v2H6zm0-2h2v2H6zm6 0h2v2h-2zm2 0h2v2h-2zM16 6h2v5h-2zM4 4h2v2H4zM2 6h2v12H2zm2 12h6v2H4zm2-8h4v2H6zm0 4h2v2H6zm11 2h5v2h-5zM16 16h2v6h-2z"
);

export const PresentationIcon = makeIcon(
  "M1 3h22v2H1zm1 2h2v11H2zm2 11h16v2H4zM20 5h2v11h-2zM9 18h2v2H9zm-2 2h2v2H7zm6-2h2v2h-2zm2 2h2v2h-2z"
);

export const ChartIcon = makeIcon(
  "M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zM7 11h2v6H7zm4-4h2v10h-2zm4 6h2v4h-2z"
);

export const ChartLineIcon = makeIcon(
  "M22 22H4v-2h18v2ZM4 20H2V2h2v18Zm4-6H6v-2h2v2Zm8 0h-2v-2h2v2Zm-6-2H8v-2h2v2Zm4 0h-2v-2h2v2Zm4 0h-2v-2h2v2Zm-6-2h-2V8h2v2Zm8 0h-2V8h2v2Zm2-2h-2V6h2v2Z"
);

export const CalculatorIcon = makeIcon(
  "M5 2h14v2H5zm0 18h14v2H5zM3 4h2v16H3zm16 0h2v16h-2zM7 6h10v4H7zm0 6h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2zm-8 4h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"
);

export const BlocksIcon = makeIcon(
  "M15 1h6v2h-6zm-2 2h2v6h-2zm2 6h6v2h-6zm6-6h2v6h-2zM3 5h6v2H3zM1 7h2v14H1zm2 14h14v2H3zm14-6h2v6h-2zM3 13h14v2H3zM9 7h2v14H9z"
);

export const CpuIcon = makeIcon(
  "M5 3h14v2H5zm0 16h14v2H5zM3 5h2v14H3zm16 0h2v14h-2zM9 7h6v2H9zm0 8h6v2H9zM7 9h2v6H7zm8 0h2v6h-2zm-4-8h2v2h-2zm0 20h2v2h-2zM1 11h2v2H1zm20 0h2v2h-2zm0-4h2v2h-2zm0 8h2v2h-2zM1 15h2v2H1zm0-8h2v2H1zm6-6h2v2H7zm8 0h2v2h-2zm0 20h2v2h-2zm-8 0h2v2H7z"
);

export const GpuIcon = makeIcon(
  "M1 2h2v20H1zm2 2h18v2H3zm18 2h2v10h-2zM3 16h18v2H3zm4 2h2v2H7zm2 2h6v2H9zm6-2h2v2h-2zM7 8h2v2H7zm8 0h2v2h-2zM5 10h2v2H5zm8 0h2v2h-2zm-6 2h2v2H7zm8 0h2v2h-2zm-6-2h2v2H9zm8 0h2v2h-2z"
);

export const CircuitIcon = makeIcon(
  "M4 2h16v2H4zm0 18h16v2H4zM2 4h2v16H2zm18 0h2v16h-2zM8 6h2v2H8zm8 12h-2v-2h2zM6 8h2v2H6zm12 8h-2v-2h2zM8 10h2v2H8zm8 4h-2v-2h2zm-6-6h6v2h-6zm4 8H8v-2h6zm2-12h2v4h-2zM8 20H6v-4h2z"
);

export const TestTubeIcon = makeIcon(
  "M7 2h10v2H7zm1 2h2v16H8zm2 16h4v2h-4zm4-16h2v16h-2zM8 13h8v2H8z"
);

export const BugIcon = makeIcon(
  "M2 5h2v4H2zm20 0h-2v4h2zM4 9h2v2H4zm16 0h-2v2h2zM2 13h4v2H2zm20 0h-4v2h4zM4 17h2v2H4zm16 0h-2v2h2zM2 19h2v2H2zm20 0h-2v2h2zM6 11h12v2H6zM6 7h2v12H6zm10 0h2v12h-2zM8 19h8v2H8zM8 5h8v2H8zM11 15h2v6h-2zM8 1h2v6H8zm6 0h2v6h-2z"
);

export const ToolsIcon = makeIcon(
  "M9 22H7v-2h2v2Zm12-6h2v6h-6v-6h2v-6h2v6Zm-2 2v2h2v-2h-2ZM7 20H5v-8h2v8Zm4 0H9v-8h2v8Zm-6-8H3v-2h2v2Zm8 0h-2v-2h2v2ZM3 10H1V4h2v6Zm12 0h-2V4h2v6Zm4 0h-2V4h2v6Zm4 0h-2V4h2v6ZM7 6h2V2h4v2h-2v4H5V4H3V2h4v4Zm14-2h-2V2h2v2Z"
);

export const LabelIcon = makeIcon(
  "M16 22h-4v-2h4v2Zm-4-2h-2v-2h2v2Zm6 0h-2v-2h2v2Zm-8-2H8v-2h2v2Zm10 0h-2v-2h2v2ZM8 16H6v-2h2v2Zm14 0h-2v-4h2v4ZM6 14H4v-2h2v2Zm-2-2H2V4h2v8Zm16 0h-2v-2h2v2Zm-2-2h-2V8h2v2ZM8 8H6V6h2v2Zm8 0h-2V6h2v2Zm-2-2h-2V4h2v2Zm-2-2H4V2h8v2Z"
);

export const FlagIcon = makeIcon(
  "M4 2h2v20H4zM4 4h16v2H4zm12 2h2v2h-2zm-2 2h2v2h-2zm2 2h2v2h-2zM4 12h16v2H4z"
);

export const MailIcon = makeIcon(
  "M6 8h2v2H6zm2 2h2v2H8zm10-2h-2v2h2zm-2 2h-2v2h2zm-6 2h4v2h-4zM2 6h2v12H2zm18 0h2v12h-2zM4 4h16v2H4zm0 14h16v2H4z"
);

export const LinkIcon = makeIcon(
  "M4 6h7v2H4zm0 10h7v2H4zM2 8h2v8H2zm18-2h-7v2h7zm0 10h-7v2h7zm2-8h-2v8h2zM7 11h10v2H7z"
);

export const CameraIcon = makeIcon(
  "M4 5h4v2H4zm4-2h8v2H8zm8 2h4v2h-4zM2 7h2v12H2zm2 12h16v2H4zM20 7h2v12h-2zM10 8h4v2h-4zm0 6h4v2h-4zm-2-4h2v4H8zm6 0h2v4h-2z"
);

export const BrushIcon = makeIcon(
  "M7 2h10v2H7zM5 4h2v10H5zm12-2h2v12h-2zM13 2h2v6h-2zM9 2h2v4H9zm-4 8h14v2H5zm2 4h10v2H7zm2 2h2v4H9zm4 0h2v4h-2zm-4 4h6v2H9z"
);

export const SwatchIcon = makeIcon(
  "M14 2h6v2h-6zm0 18h6v2h-6zM4 20h10v2H4zm8-16h2v16h-2zm8 0h2v16h-2zM2 16h2v4H2zm2-2h8v2H4zm12 2h2v2h-2zM6 12h2v2H6zM4 8h2v4H4zm2-2h4v2H6zm4 2h2v2h-2z"
);

export const ShapesIcon = makeIcon(
  "M2 13h9v2H2zm0 2h2v5H2zm0 5h9v2H2zm7-5h2v5H9zm6-2h5v2h-5zm-2 2h2v5h-2zm2 5h5v2h-5zm5-5h2v5h-2zM7 9h10v2H7zm0-2h2v2H7zm2-3h2v3H9zm2-2h2v2h-2zm2 2h2v3h-2zm2 3h2v2h-2z"
);

export const MonitorIcon = makeIcon(
  "M4 2h16v2H4zm0 14h16v2H4zM2 4h2v12H2zm18 0h2v12h-2zm-9 14h2v2h-2zm-3 2h8v2H8z"
);

export const KeyboardIcon = makeIcon(
  "M21 21H3v-2h18v2ZM3 19H1V5h2v14Zm20 0h-2V5h2v14Zm-5-2H6v-2h12v2Zm-9-4H7v-2h2v2Zm4 0h-2v-2h2v2Zm4 0h-2v-2h2v2ZM7 9H5V7h2v2Zm4 0H9V7h2v2Zm4 0h-2V7h2v2Zm4 0h-2V7h2v2Zm2-4H3V3h18v2Z"
);

export const CoinsIcon = makeIcon(
  "M6 2h6v2H6zM4 4h2v2H4zm8 0h2v2h-2zm-8 8h2v2H4zm8 0h2v2h-2zm-6 2h6v2H6zM2 6h2v6H2zm12 0h2v6h-2zM14 8h4v2h-4zm-4 10h2v2h-2zm8-8h2v2h-2zm-6 10h2v2h-2zm6-2h2v2h-2zM12 20h6v2h-6zm-4-6h2v4H8zm12-2h2v6h-2zM7 6h4v2H7zM9 6h2v6H9zm6 8h2v4h-2zm-1-2h3v2h-3z"
);

export const MoneyIcon = makeIcon(
  "M8 8h12v2H8zm0 10h12v2H8zm-2-8h2v8H6zm14 0h2v8h-2zM4 4h12v2H4zm0 10h2v2H4zM2 6h2v8H2zm14 0h2v2h-2zm-4 6h4v4h-4z"
);

export const ReceiptIcon = makeIcon(
  "M3 2h2v18H3zm16 0h2v18h-2zM5 4h2v2H5zm4 0h2v2H9zM5 20h14v2H5zm8-16h2v2h-2zM7 2h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2zm2 2h2v2h-2zM7 8h10v2H7zm0 4h10v2H7zm0 4h4v2H7z"
);

export const InvoiceIcon = makeIcon(
  "M5 20h2v2H3V4h2v16Zm6 2H9v-2h2v2Zm4 0h-2v-2h2v2Zm6 0h-4v-2h2V4h2v18ZM9 20H7v-2h2v2Zm4 0h-2v-2h2v2Zm4 0h-2v-2h2v2Zm2-16H5V2h14v2Z"
);

export const StickyNoteIcon = makeIcon(
  "M4 4H2v16h2zm12-2H4v2h12zm6 6h-2v12h2zm-2 12H4v2h16zM18 6h2v2h-2zm-2-2h2v2h-2zm-4 0h2v6h-2zm0 6h8v2h-8z"
);

export const CardTextIcon = makeIcon(
  "M6 8h12v2H6zm0 4h8v2H6zM4 4h16v2H4zm0 14h16v2H4zM2 6h2v12H2zm18 0h2v12h-2z"
);

export const BulletListIcon = makeIcon(
  "M10 5h12v2H10zm0 4h8v2h-8zm0 4h12v2H10zm0 4h8v2h-8zm-4-6H4V9h2v2ZM4 9H2V7h2v2Zm4 0H6V7h2v2ZM6 7H4V5h2v2Zm-2 6h2v2H4zm0 4h2v2H4zm-2 0v-2h2v2zm4 0v-2h2v2z"
);

export const SaveIcon = makeIcon(
  "M20 22H4V20H6V14H8V20H16V14H18V20H20V22ZM4 20H2V4H4V20ZM22 20H20V6H22V20ZM16 14H8V12H16V14ZM12 10H6V6H12V10ZM20 6H18V4H20V6ZM18 4H4V2H18V4Z"
);

export const RobotIcon = makeIcon(
  "M5 7h14v2H5zm0 12h14v2H5zM3 9h2v10H3zm16 0h2v10h-2zM1 13h2v2H1zm20 0h2v2h-2zM11 5h2v2h-2zM7 3h4v2H7zm1 9h2v4H8zm6 0h2v4h-2z"
);

export const SparkleIcon = makeIcon(
  "M11 1h2v4h-2zm0 22h2v-4h-2zM9 5h2v4H9zm0 14h2v-4H9zm4-14h2v4h-2zm0 14h2v-4h-2zM5 9h4v2H5zm14 0h-4v2h4zM1 11h4v2H1zm22 0h-4v2h4zM5 13h4v2H5zm14 0h-4v2h4z"
);

export const StarIcon = makeIcon(
  "M5 20H8V22H3V16H5V20ZM21 22H16V20H19V16H21V22ZM10 20H8V18H10V20ZM16 20H14V18H16V20ZM14 18H10V16H14V18ZM7 16H5V13H7V16ZM19 16H17V13H19V16ZM5 13H3V11H5V13ZM21 13H19V11H21V13ZM9 9H3V11H1V7H9V9ZM23 11H21V9H15V7H23V11ZM11 7H9V3H11V7ZM15 7H13V3H15V7ZM13 3H11V1H13V3Z"
);

export const EyeIcon = makeIcon(
  "M16 20H8v-2h8v2Zm-8-2H4v-2h4v2Zm12 0h-4v-2h4v2ZM4 16H2v-2h2v2Zm10-6h-2v2h2v-2h2v4h-2v2h-4v-2H8v-4h2V8h4v2Zm8 6h-2v-2h2v2ZM2 14H0v-4h2v4Zm22 0h-2v-4h2v4ZM4 10H2V8h2v2Zm18 0h-2V8h2v2ZM8 8H4V6h4v2Zm12 0h-4V6h4v2Zm-4-2H8V4h8v2Z"
);

export const CalendarIcon = makeIcon(
  "M5 4h14v2H5zm0 16h14v2H5zM3 10h2v10H3zm0-4h2v2H3zm16 0h2v2h-2zm0 4h2v10h-2zM3 8h18v2H3zm12-6h2v2h-2zM7 2h2v2H7z"
);

export const ClockIcon = makeIcon(
  "M6 2h12v2H6zM2 6h2v12H2zm18 0h2v12h-2zm-2-2h2v2h-2zM4 4h2v2H4zm2 18h12v-2H6zm12-2h2v-2h-2zM4 20h2v-2H4zm7-14h2v7h-2zm2 7h2v2h-2zm2 2h2v2h-2z"
);
