import { exists, readDir } from "@tauri-apps/plugin-fs";
import { joinPath, readTextFile } from "../files/filesService";

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  path: string;
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

/** Skills do projeto aberto (`.claude/skills/<nome>/SKILL.md`, convenção do Claude Code) —
 * projeto sem essa pasta devolve lista vazia, não erro. */
export async function listProjectSkills(projectRoot: string): Promise<SkillInfo[]> {
  const skillsDir = joinPath(projectRoot, ".claude", "skills");
  if (!(await exists(skillsDir))) return [];

  const entries = await readDir(skillsDir);
  const skills: SkillInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const skillPath = joinPath(skillsDir, entry.name);
    const skillFile = joinPath(skillPath, "SKILL.md");
    if (!(await exists(skillFile))) continue;
    try {
      const content = await readTextFile(skillFile, projectRoot);
      const meta = parseFrontmatter(content);
      skills.push({ id: entry.name, name: meta.name ?? entry.name, description: meta.description ?? "", path: skillPath });
    } catch {
      // SKILL.md ilegível — pula esse, não trava a lista inteira
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
