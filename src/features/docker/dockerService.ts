import { invoke } from "@tauri-apps/api/core";

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  /** `running`, `exited`, `paused`, `created`, `restarting`, `dead`. */
  state: string;
  status: string;
  ports: string;
  /** Projeto do Compose; vazio quando o container não veio de Compose. */
  compose_project: string;
}

export type DockerAction = "start" | "stop" | "restart" | "remove";

export function dockerContainers(): Promise<DockerContainer[]> {
  return invoke<DockerContainer[]>("docker_containers");
}

export function dockerContainerAction(id: string, action: DockerAction): Promise<void> {
  return invoke("docker_container_action", { id, action });
}

/** Agrupa como a extensão Containers: um grupo por projeto do Compose, soltos por último. */
export function groupByCompose(containers: DockerContainer[]): { project: string; containers: DockerContainer[] }[] {
  const groups = new Map<string, DockerContainer[]>();
  for (const container of [...containers].sort((a, b) => a.name.localeCompare(b.name))) {
    const list = groups.get(container.compose_project) ?? [];
    list.push(container);
    groups.set(container.compose_project, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([project, list]) => ({ project, containers: list }));
}
