import { useEffect, useState } from "react";
import { listProjectSkills, type SkillInfo } from "./skillsService";

/** Skills ativas do projeto e `recarregar` para reler depois de criar/importar uma. */
export function useProjectSkills(projectPath: string | null) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    setSkills([]);
    if (!projectPath) return;
    let cancelled = false;
    void listProjectSkills(projectPath).then((list) => {
      if (!cancelled) setSkills(list);
    });
    return () => {
      cancelled = true;
    };
  }, [projectPath, versao]);

  return [skills, () => setVersao((atual) => atual + 1)] as const;
}
