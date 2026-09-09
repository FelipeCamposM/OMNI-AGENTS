import { joinPath } from "../features/files/filesService";
import { useProjectSkills } from "../features/skills/useProjectSkills";

interface SkillsListProps {
  projectPath: string | null;
  onOpenFile: (path: string, kind: "file" | "markdown") => void;
}

/** Lista os skills do projeto aberto (`.claude/skills/<nome>/SKILL.md`). Clicar abre o
 * SKILL.md como markdown — reaproveita o `MarkdownPane` já existente, sem componente novo. */
export function SkillsList({ projectPath, onOpenFile }: SkillsListProps) {
  const skills = useProjectSkills(projectPath);

  if (!projectPath) return null;
  if (skills.length === 0) return <p className="text-text-muted text-xs px-6 py-1.5">Vazio</p>;

  return (
    <div className="space-y-0.5">
      {skills.map((skill) => (
        <button
          key={skill.id}
          type="button"
          onClick={() => onOpenFile(joinPath(skill.path, "SKILL.md"), "markdown")}
          className="w-full px-6 py-1.5 text-left truncate hover:bg-overlay/[0.07]"
          title={skill.description || skill.name}
        >
          <span className="block text-xs text-text-secondary hover:text-text-primary truncate">{skill.name}</span>
          {skill.description && (
            <span className="block text-[10px] text-text-muted truncate">{skill.description}</span>
          )}
        </button>
      ))}
    </div>
  );
}
