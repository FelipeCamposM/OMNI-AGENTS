import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { joinPath } from "../features/files/filesService";
import { BookIcon, FolderPlusIcon } from "./ui/PixelIcon";
import { useProjectSkills } from "../features/skills/useProjectSkills";
import { criarSkillNoProjeto, installSkill, skillScopes } from "../features/skills/skillsService";

interface SkillsListProps {
  projectPath: string | null;
  onOpenFile: (path: string, kind: "file" | "markdown") => void;
}

/** Lista os skills do projeto aberto (`.claude/skills/<nome>/SKILL.md`). Clicar abre o
 * SKILL.md como markdown — reaproveita o `MarkdownPane` já existente, sem componente novo.
 * No topo: criar uma skill nova (já abre o SKILL.md) ou importar uma pasta de skill. */
export function SkillsList({ projectPath, onOpenFile }: SkillsListProps) {
  const [skills, recarregar] = useProjectSkills(projectPath);
  const [nome, setNome] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  if (!projectPath) return null;
  const raiz = projectPath;

  async function agir(acao: () => Promise<void>) {
    setErro(null);
    try {
      await acao();
      recarregar();
    } catch (motivo) {
      setErro(motivo instanceof Error ? motivo.message : String(motivo));
    }
  }

  const criar = () => agir(async () => {
    const arquivo = await criarSkillNoProjeto(raiz, nome ?? "");
    setNome(null);
    onOpenFile(arquivo, "markdown");
  });

  const importar = () => agir(async () => {
    const escolhida = await open({ directory: true, multiple: false, title: "Pasta da skill (com SKILL.md)" });
    if (typeof escolhida !== "string") return;
    const projeto = skillScopes([], raiz).find((escopo) => escopo.kind === "project")!;
    await installSkill(projeto, escolhida);
  });

  return (
    <div className="space-y-0.5">
      <div className="flex gap-1 px-3 pb-1">
        <button type="button" onClick={() => { setErro(null); setNome(nome === null ? "" : null); }}
          title="Criar uma skill neste projeto (.claude/skills)"
          className="flex-1 border border-border-subtle px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-text-secondary hover:border-accent/50 hover:text-accent">
          + Nova
        </button>
        <button type="button" onClick={() => void importar()} title="Copiar para o projeto uma pasta de skill que tenha SKILL.md"
          className="flex flex-1 items-center justify-center gap-1.5 border border-border-subtle px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-text-secondary hover:border-accent/50 hover:text-accent">
          <FolderPlusIcon className="h-3 w-3" aria-hidden />Importar
        </button>
      </div>
      {nome !== null && (
        <form className="px-3 pb-1" onSubmit={(evento) => { evento.preventDefault(); void criar(); }}>
          <input autoFocus value={nome} onChange={(evento) => setNome(evento.target.value)}
            onKeyDown={(evento) => { if (evento.key === "Escape") setNome(null); }}
            aria-label="Nome da skill nova" placeholder="Nome da skill · Enter cria"
            className="w-full border border-accent/50 bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none" />
        </form>
      )}
      {erro && <p role="alert" className="px-3 py-1 text-[11px] text-warning">{erro}</p>}
      {skills.length === 0 && <p className="text-text-muted text-xs px-6 py-1.5">Vazio</p>}
      {skills.map((skill) => (
        <button
          key={skill.id}
          type="button"
          onClick={() => onOpenFile(joinPath(skill.path, "SKILL.md"), "markdown")}
          className="w-full px-6 py-1.5 text-left truncate hover:bg-overlay/[0.07]"
          title={skill.description || skill.name}
        >
          <span className="block text-xs text-text-secondary hover:text-text-primary truncate">
            <BookIcon className="mr-1.5 inline-block h-3 w-3 shrink-0 align-[-2px]" aria-hidden />
            {skill.name}
          </span>
          {skill.description && (
            <span className="block text-[10px] text-text-muted truncate">{skill.description}</span>
          )}
        </button>
      ))}
    </div>
  );
}
