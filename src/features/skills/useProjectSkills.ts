import { useEffect, useState } from "react";
import { listProjectSkills, type SkillInfo } from "./skillsService";

export function useProjectSkills(projectPath: string | null) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);

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
  }, [projectPath]);

  return skills;
}
