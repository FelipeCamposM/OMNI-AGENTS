import { describe, expect, it, vi, beforeEach } from "vitest";
import { listProjectSkills } from "../features/skills/skillsService";

const mockExists = vi.mocked((await import("@tauri-apps/plugin-fs")).exists);
const mockReadDir = vi.mocked((await import("@tauri-apps/plugin-fs")).readDir);
const mockReadTextFile = vi.mocked((await import("@tauri-apps/plugin-fs")).readTextFile);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listProjectSkills", () => {
  it("devolve lista vazia quando o projeto não tem .claude/skills", async () => {
    mockExists.mockResolvedValueOnce(false);
    const skills = await listProjectSkills("C:\\dev\\projeto");
    expect(skills).toEqual([]);
    expect(mockReadDir).not.toHaveBeenCalled();
  });

  it("lê nome e descrição do frontmatter, ordenado por nome", async () => {
    mockExists.mockResolvedValueOnce(true); // .claude/skills existe
    mockReadDir.mockResolvedValueOnce([
      { name: "zebra-skill", isDirectory: true, isFile: false, isSymlink: false },
      { name: "alpha-skill", isDirectory: true, isFile: false, isSymlink: false },
      { name: "nota.txt", isDirectory: false, isFile: true, isSymlink: false },
    ]);
    mockExists.mockResolvedValueOnce(true); // zebra-skill/SKILL.md existe
    mockReadTextFile.mockResolvedValueOnce("---\nname: Zebra\ndescription: Faz coisa de zebra\n---\n# corpo");
    mockExists.mockResolvedValueOnce(true); // alpha-skill/SKILL.md existe
    mockReadTextFile.mockResolvedValueOnce('---\nname: "Alpha"\ndescription: \'Faz coisa alpha\'\n---\n# corpo');

    const skills = await listProjectSkills("C:\\dev\\projeto");

    expect(skills.map((s) => s.name)).toEqual(["Alpha", "Zebra"]);
    expect(skills[0].description).toBe("Faz coisa alpha");
    expect(skills[1].description).toBe("Faz coisa de zebra");
  });

  it("pula pasta sem SKILL.md sem quebrar a lista inteira", async () => {
    mockExists.mockResolvedValueOnce(true); // .claude/skills existe
    mockReadDir.mockResolvedValueOnce([{ name: "sem-skill-md", isDirectory: true, isFile: false, isSymlink: false }]);
    mockExists.mockResolvedValueOnce(false); // sem-skill-md/SKILL.md não existe

    const skills = await listProjectSkills("C:\\dev\\projeto");
    expect(skills).toEqual([]);
  });

  it("usa o nome da pasta quando o frontmatter não tem name/description", async () => {
    mockExists.mockResolvedValueOnce(true);
    mockReadDir.mockResolvedValueOnce([{ name: "sem-frontmatter", isDirectory: true, isFile: false, isSymlink: false }]);
    mockExists.mockResolvedValueOnce(true);
    mockReadTextFile.mockResolvedValueOnce("# só um título, sem frontmatter");

    const skills = await listProjectSkills("C:\\dev\\projeto");
    expect(skills).toEqual([{ id: "sem-frontmatter", name: "sem-frontmatter", description: "", path: "C:\\dev\\projeto\\.claude\\skills\\sem-frontmatter" }]);
  });
});
