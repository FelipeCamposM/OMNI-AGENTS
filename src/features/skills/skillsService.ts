import { exists, mkdir, readDir, readTextFile, remove, rename } from "@tauri-apps/plugin-fs";
import { baseName, copyIntoProject, joinPath } from "../files/filesService";
import { MULTI_ACCOUNT_PROVIDERS, type AgentCliId, type Profile } from "../terminal/terminalService";

export interface SkillInfo {
  /** Nome da pasta — é o identificador real, o `name` do frontmatter é só rótulo. */
  id: string;
  name: string;
  description: string;
  /** Onde a skill está agora: dentro de `skills/` ou de `skills-disabled/`. */
  path: string;
  enabled: boolean;
  /** Skill instalada como link para outra pasta (o caso comum de skill compartilhada entre CLIs).
   *  Remover apaga só o link; o original fica. */
  symlink: boolean;
}

/** Onde um conjunto de skills mora. `root` é a pasta que **contém** `skills/` — o diretório de
 *  configuração da conta, ou o `.claude` do projeto. */
export interface SkillScope {
  id: string;
  label: string;
  provider: AgentCliId | null;
  kind: "global" | "project";
  root: string;
}

/** Pasta para onde uma skill desativada vai. O CLI só varre `skills/`, então sair dessa pasta é o
 *  que desliga a skill — não existe flag de "desativada" no formato, e mexer no `SKILL.md` de uma
 *  skill em link mudaria o original, que outras CLIs também usam. */
const DISABLED_DIR = "skills-disabled";

export function skillsDir(scope: SkillScope) {
  return joinPath(scope.root, "skills");
}

export function disabledSkillsDir(scope: SkillScope) {
  return joinPath(scope.root, DISABLED_DIR);
}

const PROVIDER_LABEL: Record<string, string> = { claude: "Claude", codex: "Codex", cursor: "Cursor" };

/** Um escopo por conta cadastrada das CLIs que têm pasta de skills, mais o projeto aberto.
 *  Cursor fica de fora: o CLI dele (`agent`) não lê `skills/`. */
export function skillScopes(profiles: Profile[], projectPath: string | null): SkillScope[] {
  const scopes: SkillScope[] = profiles
    .filter((profile) => MULTI_ACCOUNT_PROVIDERS.includes(profile.provider))
    .map((profile) => ({
      id: `profile:${profile.id}`,
      label: `${PROVIDER_LABEL[profile.provider] ?? profile.provider} · ${profile.name}`,
      provider: profile.provider,
      kind: "global" as const,
      root: profile.config_dir,
    }));
  if (projectPath) {
    scopes.push({
      id: "project",
      label: `Projeto · ${baseName(projectPath)}`,
      provider: "claude",
      kind: "project",
      root: joinPath(projectPath, ".claude"),
    });
  }
  return scopes;
}

/** Parser mínimo de frontmatter — só os dois campos que interessam aqui (`name`,
 * `description`), linha única. Não é YAML de verdade: blocos multi-linha (`description: |`)
 * não são cobertos. Suficiente pro formato que todo SKILL.md real usa; se aparecer um com
 * bloco multi-linha, cai pro nome da pasta/descrição vazia em vez de quebrar a lista inteira. */
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^(name|description):\s*(.*)$/);
    if (!field) continue;
    let value = field[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[field[1] as "name" | "description"] = value;
  }
  return result;
}

async function readSkillDir(dir: string, enabled: boolean): Promise<SkillInfo[]> {
  if (!(await exists(dir))) return [];
  const entries = await readDir(dir);
  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    // `readDir` não segue link: uma skill instalada como link chega com `isDirectory: false`.
    // Exigir só `isDirectory` sumia com a maioria das skills globais, que são links.
    if (!entry.isDirectory && !entry.isSymlink) continue;
    const path = joinPath(dir, entry.name);
    if (!(await exists(joinPath(path, "SKILL.md")))) continue;
    let meta: { name?: string; description?: string } = {};
    try {
      meta = parseFrontmatter(await readTextFile(joinPath(path, "SKILL.md")));
    } catch {
      // SKILL.md ilegível — entra na lista pelo nome da pasta, não some dela
    }
    skills.push({
      id: entry.name,
      name: meta.name ?? entry.name,
      description: meta.description ?? "",
      path,
      enabled,
      symlink: entry.isSymlink,
    });
  }
  return skills;
}

const byName = (a: SkillInfo, b: SkillInfo) => a.name.localeCompare(b.name);

/** Skills do escopo, ativas e desativadas na mesma lista. Escopo sem pasta devolve vazio, não erro. */
export async function listSkills(scope: SkillScope): Promise<SkillInfo[]> {
  const [ativas, inativas] = await Promise.all([
    readSkillDir(skillsDir(scope), true),
    readSkillDir(disabledSkillsDir(scope), false),
  ]);
  return [...ativas, ...inativas].sort(byName);
}

/** Skills ativas do projeto aberto (`.claude/skills/<nome>/SKILL.md`) — o que a barra lateral lista. */
export async function listProjectSkills(projectRoot: string): Promise<SkillInfo[]> {
  return (await readSkillDir(joinPath(projectRoot, ".claude", "skills"), true)).sort(byName);
}

/** Liga/desliga movendo a pasta entre `skills/` e `skills-disabled/`. Move o link, não o destino. */
export async function setSkillEnabled(scope: SkillScope, skill: SkillInfo, enabled: boolean): Promise<string> {
  const target = enabled ? skillsDir(scope) : disabledSkillsDir(scope);
  await mkdir(target, { recursive: true });
  const destino = joinPath(target, skill.id);
  if (await exists(destino)) {
    throw new Error(`Já existe "${skill.id}" em ${baseName(target)}. Resolva o conflito na mão.`);
  }
  await rename(skill.path, destino);
  return destino;
}

/** Apaga a skill. Em link, `recursive: false` faz o plugin remover só o link — com `true` ele
 *  chamaria `remove_dir_all` e levaria junto a pasta original compartilhada. */
export async function removeSkill(skill: SkillInfo): Promise<void> {
  await remove(skill.path, { recursive: !skill.symlink });
}

/** Instala copiando uma pasta de skill para dentro do escopo. A origem precisa ter `SKILL.md` na
 *  raiz — é o que o CLI procura, e copiar uma pasta qualquer só encheria o diretório de lixo. */
export async function installSkill(scope: SkillScope, sourceDir: string): Promise<string> {
  if (!(await exists(joinPath(sourceDir, "SKILL.md")))) {
    throw new Error("A pasta escolhida não tem SKILL.md na raiz — não é uma skill.");
  }
  const destinoDir = skillsDir(scope);
  const destino = joinPath(destinoDir, baseName(sourceDir));
  if (await exists(destino)) {
    throw new Error(`Já existe uma skill chamada "${baseName(sourceDir)}" neste escopo.`);
  }
  await mkdir(destinoDir, { recursive: true });
  // `copyIntoProject` é a cópia recursiva do app (o plugin não tem uma); a "raiz" aqui é a própria
  // pasta de skills, que é o único destino que a validação dele precisa aceitar.
  return copyIntoProject(destinoDir, sourceDir, destinoDir);
}
