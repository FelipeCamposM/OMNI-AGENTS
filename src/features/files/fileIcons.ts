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

export type PixelIconComponent = React.ComponentType<{
  className?: string;
  size?: number | string;
  "aria-hidden"?: boolean;
}>;

/**
 * Ícone por tipo de arquivo, no espírito do Material Icon Theme — mas **monocromático**, por
 * decisão de design: tudo herda `currentColor` como o resto do app.
 *
 * Isso muda a estratégia em relação ao Material, onde metade do reconhecimento vem da cor. Aqui a
 * forma é o único diferenciador, e o `pixelarticons` não tem ícone de linguagem nenhuma (só
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
  "claude.md": RobotIcon,
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

/** Só para os testes: garante que nenhuma entrada aponta para um export inexistente. */
export const MAPAS_DE_ICONE = { PASTAS, NOMES, EXTENSOES };
