import { useEffect, useState } from "react";
import { readDir } from "@tauri-apps/plugin-fs";
import { joinPath } from "../files/filesService";
import type { Project, WorkspaceState } from "../../types/workspace";

/** Nome de arquivo que costuma ser o símbolo de um projeto web/app. */
const NOME_DE_ICONE = /^(favicon|apple-touch-icon|android-chrome|icon|app-icon|logo|mstile)([-_.@][\w.@-]*)?\.(ico|png|svg|webp|jpe?g|gif)$/i;
/** Pastas que só repetem (build) ou nunca têm o ícone do projeto, e que custam caro para varrer. */
const PULAR = new Set(["node_modules", "target", "dist", "build", "out", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache",
  "coverage", "vendor", "venv", ".venv", "__pycache__", "bin", "obj", "Pods", "DerivedData", "installers"]);
/** `dist-mobile`, `build_web`, `out-prod`: saída de build com outro nome, mesmo ícone repetido. */
const SAIDA_DE_BUILD = /^(dist|build|out|release)[-_.]/i;
const PROFUNDIDADE = 4;
const MAXIMO = 30;

/** Ordem de preferência: favicon antes de logo; o mais raso antes; svg/png antes de ico. */
function peso(caminho: string, raiz: string): number {
  const relativo = caminho.slice(raiz.length).replace(/^[\\/]/, "");
  const nome = relativo.split(/[\\/]/).pop()!.toLowerCase();
  const tipo = nome.startsWith("favicon") ? 0 : nome.startsWith("apple-touch") || nome.startsWith("android-chrome") ? 1 : nome.startsWith("icon") || nome.startsWith("app-icon") ? 2 : 3;
  const formato = /\.svg$/.test(nome) ? 0 : /\.png$/.test(nome) ? 1 : 2;
  return tipo * 100 + relativo.split(/[\\/]/).length * 10 + formato;
}

/** Varre o projeto atrás de favicons e logos (até 4 níveis, sem pastas de build e ocultas). */
export async function procurarIcones(raiz: string): Promise<string[]> {
  const achados: string[] = [];
  let nivel = [raiz];
  for (let profundidade = 0; profundidade <= PROFUNDIDADE && nivel.length > 0; profundidade++) {
    const proximo: string[] = [];
    await Promise.all(nivel.map(async (pasta) => {
      let entradas;
      try { entradas = await readDir(pasta); } catch { return; }
      for (const entrada of entradas) {
        const caminho = joinPath(pasta, entrada.name);
        if (entrada.isDirectory) {
          if (!entrada.name.startsWith(".") && !PULAR.has(entrada.name) && !SAIDA_DE_BUILD.test(entrada.name)) proximo.push(caminho);
        } else if (NOME_DE_ICONE.test(entrada.name)) {
          achados.push(caminho);
        }
      }
    }));
    nivel = proximo;
  }
  return achados.sort((a, b) => peso(a, raiz) - peso(b, raiz)).slice(0, MAXIMO);
}

// Um projeto não ganha favicon novo a cada render: a varredura roda uma vez por pasta por sessão.
const cache = new Map<string, Promise<string[]>>();
export function iconesDe(raiz: string): Promise<string[]> {
  let busca = cache.get(raiz);
  if (!busca) {
    busca = procurarIcones(raiz).catch(() => []);
    cache.set(raiz, busca);
  }
  return busca;
}

/** Favicons do projeto; `null` enquanto procura. */
export function useIconesDoProjeto(raiz: string | null): string[] | null {
  const [icones, setIcones] = useState<string[] | null>(null);
  useEffect(() => {
    setIcones(null);
    if (!raiz) return;
    let vivo = true;
    void iconesDe(raiz).then((lista) => { if (vivo) setIcones(lista); });
    return () => { vivo = false; };
  }, [raiz]);
  return icones;
}

/** O que mostrar: escolhido (`string`), nenhum (`null`, ícone de pasta) ou, sem escolha, o primeiro achado. */
export function iconeEfetivo(escolhido: string | null | undefined, achados: string[] | null): string | null {
  if (escolhido !== undefined) return escolhido;
  return achados?.[0] ?? null;
}

/** Símbolo do projeto como a lateral mostra: escolhido, pasta (`null`) ou o primeiro favicon achado. */
export function useIconeDoProjeto(project: Pick<Project, "path" | "icone">): string | null {
  const achados = useIconesDoProjeto(project.icone === undefined ? project.path : null);
  return iconeEfetivo(project.icone, achados);
}

/** Símbolo do workspace: o escolhido, a caixa (`null`) ou, sem escolha, o do primeiro projeto que tiver um. */
export function useIconeDoWorkspace(workspace: Pick<WorkspaceState, "icone" | "projects">): string | null {
  const [automatico, setAutomatico] = useState<string | null>(null);
  const chave = workspace.projects.map((project) => `${project.path}|${project.icone ?? ""}|${project.icone === null}`).join("\n");
  useEffect(() => {
    setAutomatico(null);
    if (workspace.icone !== undefined) return;
    let vivo = true;
    void (async () => {
      for (const project of workspace.projects) {
        const icone = project.icone !== undefined ? project.icone : iconeEfetivo(undefined, await iconesDe(project.path));
        if (icone) { if (vivo) setAutomatico(icone); return; }
      }
    })();
    return () => { vivo = false; };
  }, [workspace.icone, chave]); // eslint-disable-line react-hooks/exhaustive-deps
  return workspace.icone !== undefined ? workspace.icone : automatico;
}
