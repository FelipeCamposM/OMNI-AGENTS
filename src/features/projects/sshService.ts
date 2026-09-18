import { invoke } from "@tauri-apps/api/core";

/** Conexão salva. O app nunca guarda senha nem passphrase — autenticação é por chave/ssh-agent. */
export interface SshConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  /** Vazio = deixa o `ssh` decidir pelo `~/.ssh/config` ou pelo agente de chaves. */
  key_path: string;
  remote_path: string;
  /** Letra onde o SSHFS monta a pasta remota, ex.: `X:`. */
  drive: string;
}

export interface MountStatus {
  sshfs_installed: boolean;
  mounted: boolean;
  drive: string;
  path: string;
}

export const NOVA_CONEXAO: SshConnection = {
  id: "",
  name: "",
  host: "",
  port: 22,
  user: "",
  key_path: "",
  remote_path: "",
  drive: "X:",
};

export async function listSshConnections(): Promise<SshConnection[]> {
  const lista = await invoke<SshConnection[]>("ssh_connections");
  return Array.isArray(lista) ? lista : [];
}

export async function saveSshConnection(connection: SshConnection): Promise<SshConnection> {
  return invoke<SshConnection>("save_ssh_connection", { connection });
}

export async function removeSshConnection(id: string): Promise<void> {
  await invoke("remove_ssh_connection", { id });
}

/** Abre uma conexão de verdade e devolve o que a máquina respondeu (`uname -a`). */
export async function testSshConnection(connection: SshConnection): Promise<string> {
  return invoke<string>("test_ssh_connection", { connection });
}

export async function sshMountStatus(id: string): Promise<MountStatus> {
  return invoke<MountStatus>("ssh_mount_status", { id });
}

/** Monta (se preciso) e devolve a raiz local da máquina remota. */
export async function sshMount(id: string): Promise<string> {
  return invoke<string>("ssh_mount", { id });
}

export async function sshUnmount(id: string): Promise<void> {
  await invoke("ssh_unmount", { id });
}
