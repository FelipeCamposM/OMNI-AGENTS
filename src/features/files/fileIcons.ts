import type { CSSProperties } from "react";
import {
  AlgorithmIcon,
  AndroidIcon,
  AppleIcon,
  ArchiveIcon,
  ArticleIcon,
  BinaryIcon,
  BlocksIcon,
  BookIcon,
  BookmarkIcon,
  BracesIcon,
  BracketsAngleIcon,
  BracketsIcon,
  BrushIcon,
  BugIcon,
  BulletListIcon,
  CalculatorIcon,
  CalendarIcon,
  CameraIcon,
  CardTextIcon,
  ChartIcon,
  ChartLineIcon,
  CircuitIcon,
  ClapperboardIcon,
  ClipboardNoteIcon,
  ClockIcon,
  CloudIcon,
  CodeIcon,
  CoinsIcon,
  CpuIcon,
  DatabaseIcon,
  DenoIcon,
  DockerIcon,
  FileIcon,
  FileTextIcon,
  FlagIcon,
  FolderIcon,
  GearIcon,
  GitBranchIcon,
  GithubIcon,
  GlobeIcon,
  GpuIcon,
  HashIcon,
  HeadphoneIcon,
  ImageIcon,
  InvoiceIcon,
  KeyIcon,
  KeyboardIcon,
  LabelIcon,
  KanbanIcon,
  LinkIcon,
  LinuxIcon,
  ListIcon,
  LockIcon,
  MailIcon,
  MonitorIcon,
  MoneyIcon,
  MusicIcon,
  NoteIcon,
  NotebookIcon,
  NotesIcon,
  NpmIcon,
  PackageIcon,
  PnpmIcon,
  PresentationIcon,
  ReactIcon,
  ReceiptIcon,
  RobotIcon,
  SaveIcon,
  ScriptIcon,
  ServerIcon,
  ShapesIcon,
  ShieldIcon,
  SparkleIcon,
  StarIcon,
  StickyNoteIcon,
  SwatchIcon,
  TerminalIcon,
  TestTubeIcon,
  ToolsIcon,
  VercelIcon,
  VideoIcon,
  WaveformIcon,
} from "../../components/ui/PixelIcon";
import { ClaudeIcon, CursorIcon } from "../../components/ui/AgentIcon";

export type PixelIconComponent = React.ComponentType<{
  className?: string;
  size?: number | string;
  style?: CSSProperties;
  "aria-hidden"?: boolean;
}>;

/**
 * Ícone por tipo de arquivo, no espírito do Material Icon Theme: o desenho é pixel-art (o estilo do
 * app) e a cor vem do Material (`CORES_*` abaixo), para quem vem do VS Code reconhecer de longe.
 *
 * A forma continua carregando a identidade sozinha (cor some para daltônico e em tela ruim). A
 * forma também tem que diferenciar, e o `pixelarticons` não tem ícone de linguagem nenhuma (só
 * marcas: npm, docker, react, github…). Então linguagens irmãs recebem glifos *diferentes*
 * (`braces` vs `brackets` vs `script` vs `binary`) em vez de todas caírem num `code` genérico —
 * que devolveria 70 extensões com o mesmo desenho, ou seja, nada.
 *
 * ponytail: a noção de "extensão" ainda mora em três lugares — `LANGUAGE_BY_EXTENSION`
 * (`FilePane.tsx`, linguagem do Monaco), `IMAGE_EXTENSIONS` (`filesService.ts`, escolha de pane) e
 * este mapa. Têm propósitos diferentes; unificar viraria refatoração de três consumidores por
 * causa de ícone. Juntar se um quarto consumidor aparecer.
 */

/** Pastas com nome conhecido, como o Material faz. Só ganham ícone próprio as que mudam a leitura
 *  de uma árvore grande — o resto é pasta comum. */
const PASTAS: Record<string, PixelIconComponent> = {
  node_modules: PackageIcon,
  ".git": GitBranchIcon,
  ".github": GithubIcon,
  // Pastas dos agentes: a marca diz de quem é a config (o laranja do Claude vem no próprio ícone).
  ".claude": ClaudeIcon,
  ".cursor": CursorIcon,
  apps: MonitorIcon,
  src: CodeIcon,
  dist: ArchiveIcon,
  build: ArchiveIcon,
  out: ArchiveIcon,
  target: ArchiveIcon,
  public: GlobeIcon,
  assets: ImageIcon,
  images: ImageIcon,
  img: ImageIcon,
  docs: BookIcon,
  doc: BookIcon,
  test: TestTubeIcon,
  tests: TestTubeIcon,
  __tests__: TestTubeIcon,
  spec: TestTubeIcon,
  scripts: ScriptIcon,
  config: GearIcon,
  ".vscode": GearIcon,
  ".idea": GearIcon,
  bin: BinaryIcon,
  lib: BlocksIcon,
  components: BlocksIcon,
  hooks: LinkIcon,
  types: LabelIcon,
  styles: BrushIcon,
  css: BrushIcon,
  fonts: CardTextIcon,
  media: VideoIcon,
  videos: VideoIcon,
  audio: MusicIcon,
  cache: ClockIcon,
  tmp: ClockIcon,
  temp: ClockIcon,
  ".cache": ClockIcon,
  vendor: PackageIcon,
  packages: PackageIcon,
  crates: PackageIcon,
  server: ServerIcon,
  api: CloudIcon,
  db: DatabaseIcon,
  database: DatabaseIcon,
  migrations: DatabaseIcon,
  locale: GlobeIcon,
  locales: GlobeIcon,
  i18n: GlobeIcon,
};

/** Nome exato do arquivo. Vem antes da extensão: `package.json` não é "um json qualquer". */
const NOMES: Record<string, PixelIconComponent> = {
  "package.json": NpmIcon,
  "package-lock.json": NpmIcon,
  ".npmrc": NpmIcon,
  "pnpm-lock.yaml": PnpmIcon,
  "pnpm-workspace.yaml": PnpmIcon,
  "yarn.lock": PnpmIcon,
  "deno.json": DenoIcon,
  "deno.jsonc": DenoIcon,
  dockerfile: DockerIcon,
  "docker-compose.yml": DockerIcon,
  "docker-compose.yaml": DockerIcon,
  ".dockerignore": DockerIcon,
  makefile: ToolsIcon,
  "cmakelists.txt": ToolsIcon,
  ".gitignore": GitBranchIcon,
  ".gitattributes": GitBranchIcon,
  ".gitmodules": GitBranchIcon,
  license: ShieldIcon,
  "license.md": ShieldIcon,
  "license.txt": ShieldIcon,
  ".env": KeyIcon,
  ".env.local": KeyIcon,
  ".env.example": KeyIcon,
  "readme.md": ArticleIcon,
  "changelog.md": NotesIcon,
  "contributing.md": NotebookIcon,
  "claude.md": ClaudeIcon,
  ".cursorrules": CursorIcon,
  "agents.md": RobotIcon,
  "cargo.toml": PackageIcon,
  "cargo.lock": LockIcon,
  "tsconfig.json": GearIcon,
  "tsconfig.node.json": GearIcon,
  "vite.config.ts": SparkleIcon,
  "vite.config.js": SparkleIcon,
  "tailwind.config.ts": BrushIcon,
  "tailwind.config.js": BrushIcon,
  "postcss.config.ts": BrushIcon,
  "vercel.json": VercelIcon,
  ".eslintrc": BugIcon,
  ".eslintrc.json": BugIcon,
  ".prettierrc": BulletListIcon,
  ".editorconfig": BulletListIcon,
};

/** Extensão → ícone. Formas espalhadas de propósito (ver comentário do módulo). */
const EXTENSOES: Record<string, PixelIconComponent> = {
  // Web / markup — família "brackets"
  html: BracketsAngleIcon,
  htm: BracketsAngleIcon,
  xml: BracketsAngleIcon,
  svg: ShapesIcon,
  vue: BracketsIcon,
  svelte: BracketsIcon,
  astro: BracketsIcon,
  // Estilo
  css: BrushIcon,
  scss: BrushIcon,
  sass: BrushIcon,
  less: BrushIcon,
  // JS/TS — react ganha o próprio, o resto se separa por chaves/colchetes
  ts: BracesIcon,
  mts: BracesIcon,
  cts: BracesIcon,
  tsx: ReactIcon,
  jsx: ReactIcon,
  js: CodeIcon,
  mjs: CodeIcon,
  cjs: CodeIcon,
  // Dados / config
  json: BracesIcon,
  jsonc: BracesIcon,
  json5: BracesIcon,
  yml: BulletListIcon,
  yaml: BulletListIcon,
  toml: GearIcon,
  ini: GearIcon,
  cfg: GearIcon,
  conf: GearIcon,
  properties: GearIcon,
  lock: LockIcon,
  env: KeyIcon,
  csv: ChartIcon,
  tsv: ChartIcon,
  sql: DatabaseIcon,
  db: DatabaseIcon,
  sqlite: DatabaseIcon,
  graphql: CircuitIcon,
  gql: CircuitIcon,
  proto: CircuitIcon,
  // Linguagens de sistema / compiladas
  rs: CpuIcon,
  go: GlobeIcon,
  c: BinaryIcon,
  h: BinaryIcon,
  cpp: BinaryIcon,
  cc: BinaryIcon,
  hpp: BinaryIcon,
  cs: HashIcon,
  java: CoinsIcon,
  kt: AndroidIcon,
  kts: AndroidIcon,
  swift: AppleIcon,
  m: AppleIcon,
  dart: MonitorIcon,
  zig: AlgorithmIcon,
  // Linguagens de script
  py: AlgorithmIcon,
  rb: StarIcon,
  php: GlobeIcon,
  lua: MoneyIcon,
  pl: ScriptIcon,
  r: ChartLineIcon,
  sh: TerminalIcon,
  bash: TerminalIcon,
  zsh: TerminalIcon,
  fish: TerminalIcon,
  ps1: TerminalIcon,
  bat: TerminalIcon,
  cmd: TerminalIcon,
  // Documentos
  md: ArticleIcon,
  markdown: ArticleIcon,
  mdx: ArticleIcon,
  txt: FileTextIcon,
  rtf: FileTextIcon,
  pdf: BookmarkIcon,
  doc: NotebookIcon,
  docx: NotebookIcon,
  odt: NotebookIcon,
  xls: CalculatorIcon,
  xlsx: CalculatorIcon,
  ods: CalculatorIcon,
  ppt: PresentationIcon,
  pptx: PresentationIcon,
  odp: PresentationIcon,
  log: ClipboardNoteIcon,
  // Imagem
  png: ImageIcon,
  jpg: ImageIcon,
  jpeg: ImageIcon,
  gif: ImageIcon,
  webp: ImageIcon,
  avif: ImageIcon,
  bmp: ImageIcon,
  tiff: ImageIcon,
  ico: StarIcon,
  psd: SwatchIcon,
  xcf: SwatchIcon,
  ai: SwatchIcon,
  fig: ShapesIcon,
  raw: CameraIcon,
  cr2: CameraIcon,
  nef: CameraIcon,
  // Vídeo
  mp4: VideoIcon,
  mkv: VideoIcon,
  mov: ClapperboardIcon,
  avi: ClapperboardIcon,
  webm: VideoIcon,
  wmv: ClapperboardIcon,
  flv: ClapperboardIcon,
  // Áudio
  mp3: MusicIcon,
  wav: WaveformIcon,
  flac: WaveformIcon,
  ogg: MusicIcon,
  m4a: MusicIcon,
  aac: HeadphoneIcon,
  opus: HeadphoneIcon,
  mid: KeyboardIcon,
  // Pacotes / binários
  zip: ArchiveIcon,
  tar: ArchiveIcon,
  gz: ArchiveIcon,
  bz2: ArchiveIcon,
  xz: ArchiveIcon,
  "7z": ArchiveIcon,
  rar: ArchiveIcon,
  exe: MonitorIcon,
  msi: MonitorIcon,
  dll: BlocksIcon,
  so: BlocksIcon,
  dylib: BlocksIcon,
  app: AppleIcon,
  dmg: AppleIcon,
  deb: LinuxIcon,
  rpm: LinuxIcon,
  appimage: LinuxIcon,
  apk: AndroidIcon,
  wasm: GpuIcon,
  bin: BinaryIcon,
  iso: SaveIcon,
  // Fontes e diversos
  ttf: CardTextIcon,
  otf: CardTextIcon,
  woff: CardTextIcon,
  woff2: CardTextIcon,
  eml: MailIcon,
  ics: CalendarIcon,
  url: LinkIcon,
  torrent: CloudIcon,
  pem: KeyIcon,
  key: KeyIcon,
  crt: ShieldIcon,
  sig: ShieldIcon,
  bak: ClockIcon,
  tmp: ClockIcon,
  note: NoteIcon,
  todo: StickyNoteIcon,
  receipt: ReceiptIcon,
  invoice: InvoiceIcon,
  flag: FlagIcon,
  kanban: KanbanIcon,
  list: ListIcon,
};

/**
 * Separa nome e extensão tratando os dois casos que o `split(".").pop()` espalhado pelo app erra:
 * dotfile (`.gitignore` não tem extensão "gitignore" — o nome inteiro é a identidade) e arquivo
 * sem ponto nenhum (`Makefile`).
 */
function extensaoDe(nome: string): string {
  const limpo = nome.toLowerCase();
  const ponto = limpo.lastIndexOf(".");
  if (ponto <= 0) return ""; // sem ponto, ou dotfile puro (".env", ".gitignore")
  return limpo.slice(ponto + 1);
}

/** Ícone de um item da árvore.
 *
 *  Sem variante de "pasta aberta": o `pixelarticons` não tem `folder-open`, e a seta ao lado já
 *  diz se está aberta — dois indicadores do mesmo estado seria redundância, não informação. */
export function iconForEntry(name: string, isDirectory: boolean): PixelIconComponent {
  const limpo = name.toLowerCase();

  if (isDirectory) {
    return PASTAS[limpo] ?? FolderIcon;
  }

  const exato = NOMES[limpo];
  if (exato) return exato;

  return EXTENSOES[extensaoDe(limpo)] ?? FileIcon;
}

/** Ícone a partir de um caminho completo (abas, painel do Git, skills). */
export function iconForPath(path: string, isDirectory = false): PixelIconComponent {
  const base = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  return iconForEntry(base, isDirectory);
}

/**
 * Cores do Material Icon Theme (VS Code), com as mesmas chaves dos mapas de ícone — o teste de
 * integridade reprova chave de ícone sem cor. No tema claro a cor escurece via `--mistura-arquivo`
 * (`index.css`): o amarelo do JS some num fundo branco.
 */
const CORES_PASTAS: Record<string, string> = {
  node_modules: "#8bc34a", ".git": "#ff7043", ".github": "#90a4ae", src: "#4caf50",
  ".claude": "#d97757", ".cursor": "#cfd8dc", apps: "#ab47bc",
  dist: "#e57373", build: "#e57373", out: "#e57373", target: "#e57373",
  public: "#039be5", assets: "#ffb300", images: "#26a69a", img: "#26a69a",
  docs: "#0288d1", doc: "#0288d1",
  test: "#00bfa5", tests: "#00bfa5", __tests__: "#00bfa5", spec: "#00bfa5",
  scripts: "#ff7043", config: "#00acc1", ".vscode": "#1e88e5", ".idea": "#ec407a",
  bin: "#78909c", lib: "#c0ca33", components: "#ffca28", hooks: "#7e57c2", types: "#0288d1",
  styles: "#7e57c2", css: "#7e57c2", fonts: "#ef5350", media: "#ff9800", videos: "#ff9800", audio: "#ef5350",
  cache: "#90a4ae", tmp: "#90a4ae", temp: "#90a4ae", ".cache": "#90a4ae",
  vendor: "#8bc34a", packages: "#ffb300", crates: "#ff7043",
  server: "#ff7043", api: "#ffb300", db: "#ffca28", database: "#ffca28", migrations: "#ffca28",
  locale: "#5c6bc0", locales: "#5c6bc0", i18n: "#5c6bc0",
};

const CORES_NOMES: Record<string, string> = {
  "package.json": "#e53935", "package-lock.json": "#e53935", ".npmrc": "#e53935",
  "pnpm-lock.yaml": "#f9ad00", "pnpm-workspace.yaml": "#f9ad00", "yarn.lock": "#2c8ebb",
  "deno.json": "#cfd8dc", "deno.jsonc": "#cfd8dc",
  dockerfile: "#0288d1", "docker-compose.yml": "#0288d1", "docker-compose.yaml": "#0288d1", ".dockerignore": "#0288d1",
  makefile: "#ef5350", "cmakelists.txt": "#ef5350",
  ".gitignore": "#e64a19", ".gitattributes": "#e64a19", ".gitmodules": "#e64a19",
  license: "#ffca28", "license.md": "#ffca28", "license.txt": "#ffca28",
  ".env": "#fbc02d", ".env.local": "#fbc02d", ".env.example": "#fbc02d",
  "readme.md": "#42a5f5", "changelog.md": "#8bc34a", "contributing.md": "#ffca28",
  "claude.md": "#d97757", ".cursorrules": "#cfd8dc", "agents.md": "#90a4ae",
  "cargo.toml": "#ff7043", "cargo.lock": "#ff7043",
  "tsconfig.json": "#0288d1", "tsconfig.node.json": "#0288d1",
  "vite.config.ts": "#ab47bc", "vite.config.js": "#ab47bc",
  "tailwind.config.ts": "#4db6ac", "tailwind.config.js": "#4db6ac", "postcss.config.ts": "#e53935",
  "vercel.json": "#cfd8dc", ".eslintrc": "#7986cb", ".eslintrc.json": "#7986cb",
  ".prettierrc": "#56b3b4", ".editorconfig": "#b0bec5",
};

const CORES_EXTENSOES: Record<string, string> = {
  html: "#e65100", htm: "#e65100", xml: "#8bc34a", svg: "#ffb300", vue: "#41b883", svelte: "#ff5722", astro: "#ff7043",
  css: "#7e57c2", scss: "#ec407a", sass: "#ec407a", less: "#0277bd",
  ts: "#0288d1", mts: "#0288d1", cts: "#0288d1", tsx: "#00bcd4", jsx: "#00bcd4",
  js: "#ffca28", mjs: "#ffca28", cjs: "#ffca28",
  json: "#fbc02d", jsonc: "#fbc02d", json5: "#fbc02d", yml: "#ff5252", yaml: "#ff5252",
  toml: "#9e9e9e", ini: "#90a4ae", cfg: "#90a4ae", conf: "#90a4ae", properties: "#90a4ae",
  lock: "#ffd54f", env: "#fbc02d", csv: "#8bc34a", tsv: "#8bc34a",
  sql: "#ffca28", db: "#ffca28", sqlite: "#ffca28", graphql: "#ec407a", gql: "#ec407a", proto: "#ff9800",
  rs: "#ff7043", go: "#00acc1", c: "#0288d1", h: "#7e57c2", cpp: "#0288d1", cc: "#0288d1", hpp: "#7e57c2",
  cs: "#0277bd", java: "#f44336", kt: "#7e57c2", kts: "#7e57c2", swift: "#fe5722", m: "#42a5f5",
  dart: "#40c4ff", zig: "#faa41a",
  py: "#42a5f5", rb: "#f44336", php: "#1e88e5", lua: "#42a5f5", pl: "#9575cd", r: "#1976d2",
  sh: "#ff7043", bash: "#ff7043", zsh: "#ff7043", fish: "#ff7043", ps1: "#03a9f4", bat: "#ff7043", cmd: "#ff7043",
  md: "#42a5f5", markdown: "#42a5f5", mdx: "#ffca28", txt: "#90a4ae", rtf: "#42a5f5",
  pdf: "#ef5350", doc: "#2196f3", docx: "#2196f3", odt: "#2196f3",
  xls: "#4caf50", xlsx: "#4caf50", ods: "#4caf50", ppt: "#ff5722", pptx: "#ff5722", odp: "#ff5722", log: "#afb42b",
  png: "#26a69a", jpg: "#26a69a", jpeg: "#26a69a", gif: "#26a69a", webp: "#26a69a", avif: "#26a69a",
  bmp: "#26a69a", tiff: "#26a69a", ico: "#ffca28", psd: "#1e88e5", xcf: "#8d6e63", ai: "#ff9800", fig: "#f24e1e",
  raw: "#26a69a", cr2: "#26a69a", nef: "#26a69a",
  mp4: "#ff9800", mkv: "#ff9800", mov: "#ff9800", avi: "#ff9800", webm: "#ff9800", wmv: "#ff9800", flv: "#ff9800",
  mp3: "#ef5350", wav: "#ef5350", flac: "#ef5350", ogg: "#ef5350", m4a: "#ef5350", aac: "#ef5350", opus: "#ef5350", mid: "#ef5350",
  zip: "#afb42b", tar: "#afb42b", gz: "#afb42b", bz2: "#afb42b", xz: "#afb42b", "7z": "#afb42b", rar: "#afb42b",
  exe: "#e64a19", msi: "#e64a19", dll: "#42a5f5", so: "#42a5f5", dylib: "#42a5f5", app: "#9e9e9e", dmg: "#9e9e9e",
  deb: "#d32f2f", rpm: "#d32f2f", appimage: "#f9a825", apk: "#8bc34a", wasm: "#7e57c2", bin: "#78909c", iso: "#9e9e9e",
  ttf: "#f44336", otf: "#f44336", woff: "#f44336", woff2: "#f44336",
  eml: "#42a5f5", ics: "#42a5f5", url: "#42a5f5", torrent: "#8bc34a",
  pem: "#26a69a", key: "#26a69a", crt: "#ff7043", sig: "#ff7043", bak: "#90a4ae", tmp: "#90a4ae",
  note: "#ffca28", todo: "#8bc34a", receipt: "#4caf50", invoice: "#4caf50", flag: "#f44336", kanban: "#42a5f5", list: "#90a4ae",
};

/** Pasta sem regra: o azul-acinzentado das pastas comuns do Material. Arquivo sem regra fica sem cor. */
const COR_PASTA = "#90a4ae";

export function colorForEntry(name: string, isDirectory: boolean): string | undefined {
  const limpo = name.toLowerCase();
  if (isDirectory) return CORES_PASTAS[limpo] ?? COR_PASTA;
  return CORES_NOMES[limpo] ?? CORES_EXTENSOES[extensaoDe(limpo)];
}

/** `style` do ícone. Inline (e não classe) para vencer o `text-*` de quem desenha o ícone. */
export function iconStyle(name: string, isDirectory = false): CSSProperties | undefined {
  const base = name.split(/[\\/]/).filter(Boolean).pop() ?? name;
  const cor = colorForEntry(base, isDirectory);
  return cor ? { color: `color-mix(in oklab, ${cor} var(--mistura-arquivo, 100%), black)` } : undefined;
}

/** Só para os testes: garante que nenhuma entrada aponta para um export inexistente. */
export const MAPAS_DE_ICONE = { PASTAS, NOMES, EXTENSOES };
export const MAPAS_DE_COR = { PASTAS: CORES_PASTAS, NOMES: CORES_NOMES, EXTENSOES: CORES_EXTENSOES };
