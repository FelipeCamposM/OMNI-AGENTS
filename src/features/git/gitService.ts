import { invoke } from "@tauri-apps/api/core";

export interface GitStatusEntry {
  path: string;
  x: string;
  y: string;
}

export interface GitStatus {
  branch: string;
  entries: GitStatusEntry[];
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export interface GitCommit {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  message: string;
  refs: string[];
}

export const UNTRACKED = "?";

export function isStaged(entry: GitStatusEntry): boolean {
  return entry.x !== "." && entry.x !== UNTRACKED;
}

export function isUnstaged(entry: GitStatusEntry): boolean {
  // "??" (untracked) já cai aqui: y vem "?" (!= "."), sem precisar de caso especial.
  return entry.y !== ".";
}

/** `null` = projeto não tem repositório git vinculado — estado normal, não erro. */
export async function gitStatus(projectPath: string): Promise<GitStatus | null> {
  const result = await invoke<GitStatus | null>("git_status", { projectPath });
  if (result === null) return null;
  if (!result || !Array.isArray(result.entries)) throw new Error("Resposta inesperada do git_status");
  return result;
}

export async function gitDiff(projectPath: string, file: string, staged: boolean): Promise<string> {
  return invoke<string>("git_diff", { projectPath, file, staged });
}

export async function gitStage(projectPath: string, files: string[]): Promise<void> {
  await invoke("git_stage", { projectPath, files });
}

export async function gitUnstage(projectPath: string, files: string[]): Promise<void> {
  await invoke("git_unstage", { projectPath, files });
}

export async function gitCommit(projectPath: string, message: string): Promise<void> {
  await invoke("git_commit", { projectPath, message });
}

export async function gitBranches(projectPath: string): Promise<GitBranch[]> {
  const result = await invoke<GitBranch[]>("git_branches", { projectPath });
  return Array.isArray(result) ? result : [];
}

export async function gitCheckoutBranch(projectPath: string, branch: string): Promise<void> {
  await invoke("git_checkout_branch", { projectPath, branch });
}

export async function gitLogGraph(projectPath: string): Promise<GitCommit[]> {
  const result = await invoke<GitCommit[]>("git_log_graph", { projectPath });
  return Array.isArray(result) ? result : [];
}
