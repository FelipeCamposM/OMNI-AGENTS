import { targetLabel } from "../../lib/paths";
import { listSshConnections } from "./sshService";

/**
 * Cache de "qual unidade é qual máquina", para qualquer parte da UI perguntar se um projeto é
 * remoto sem fazer IPC no meio de um render.
 *
 * O WSL se reconhece pelo próprio caminho; o SSH não — `X:\proj` só é remoto se existir uma conexão
 * montada em `X:`. Sem este cache, um projeto por SSH era tratado como disco local e levava poll de
 * 3 em 3 segundos por cima da rede.
 */
let unidades: Record<string, string> = {};

export async function primeSshDrives(): Promise<void> {
  try {
    const conexoes = await listSshConnections();
    unidades = Object.fromEntries(conexoes.map((item) => [item.drive.toUpperCase(), item.name]));
  } catch {
    /* sem conexões cadastradas: tudo que não é WSL conta como local */
  }
}

/** Rótulo do alvo (`WSL · Ubuntu`, `SSH · Servidor`) ou `null` quando o projeto é local. */
export function targetOf(path: string | null | undefined): string | null {
  return path ? targetLabel(path, unidades) : null;
}

export function isRemoteProject(path: string | null | undefined): boolean {
  return targetOf(path) !== null;
}
