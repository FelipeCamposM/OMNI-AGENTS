import { invoke } from "@tauri-apps/api/core";

/** Espelho de `src-tauri/src/extensoes.rs`. Nenhum valor sensível chega aqui: variáveis e
 *  cabeçalhos vêm só pelo nome, URL sem query e argumento com cara de chave mascarado. */
export interface Mcp {
  nome: string;
  /** `global`: todo projeto. `pasta`: só numa pasta, só você. `projeto`: arquivo do projeto (vai no git). */
  escopo: "global" | "pasta" | "projeto";
  tipo: string;
  destino: string;
  variaveis: string[];
  ativo: boolean;
  pasta: string | null;
  arquivo: string;
}

export interface Plugin {
  nome: string;
  origem: string | null;
  ativo: boolean;
  versao: string | null;
  escopo: string | null;
  arquivo: string;
  /** Logo do pacote (`data:` URI), quando o manifesto traz. */
  logo?: string;
  /** Site do manifesto (homepage/repositório/autor): de onde o app busca o ícone sem logo. */
  site?: string;
}

export interface ExtensoesDaConta {
  provider: string;
  conta_id: string;
  conta_nome: string;
  /** A conta com estrela (sem estrela, a nativa da CLI), de onde as outras recebem as extensões. */
  principal?: boolean;
  mcps: Mcp[];
  plugins: Plugin[];
  conectores: string[];
  arquivos: string[];
}

/** As contas extras recebem MCPs, plugins e skills da conta principal ao abrir uma sessão. */
export async function lerCompartilhamento(): Promise<boolean> {
  return Boolean(await invoke<boolean>("compartilhamento_de_extensoes"));
}

/** Liga/desliga. Ligando, já leva tudo para as contas extras na hora. */
export async function definirCompartilhamento(ligado: boolean): Promise<void> {
  await invoke("definir_compartilhamento_de_extensoes", { ligado });
}

/** Estrela: a conta de onde as outras da mesma IA recebem extensões e conectores. */
export async function definirPrincipal(provider: string, contaId: string): Promise<void> {
  await invoke("definir_conta_principal", { provider, profileId: contaId });
}

export async function listarExtensoes(projectPath: string | null): Promise<ExtensoesDaConta[]> {
  const lista = await invoke<ExtensoesDaConta[]>("listar_extensoes", { projectPath });
  return Array.isArray(lista) ? lista : [];
}

/** De onde a aba lê: o app pelo Tauri, a web pelas rotas do engine (`/extensoes`). */
export interface FonteDeExtensoes {
  listar: () => Promise<ExtensoesDaConta[]>;
  lerCompartilhamento: () => Promise<boolean>;
  definirCompartilhamento: (ligado: boolean) => Promise<void>;
  definirPrincipal: (provider: string, contaId: string) => Promise<void>;
  /** "Mostrar no Explorer" só existe no app do PC. */
  explorer: boolean;
  /** Ícone real de MCP (URL ou comando), conector (`conector:<nome>`) ou plugin (`pacote:<site>`), em `data:`;
   *  `nome` ajuda a achar a marca. Só o app do PC busca. */
  icone?: (destino: string, nome: string) => Promise<string | null>;
}

/** Pergunta ao servidor MCP (`serverInfo.icons`) ou pega o favicon do site; o Rust guarda em cache. */
export async function iconeDaExtensao(destino: string, nome: string): Promise<string | null> {
  return (await invoke<string | null>("icone_da_extensao", { destino, nome })) ?? null;
}

export function fonteDoApp(projectPath: string | null): FonteDeExtensoes {
  return { listar: () => listarExtensoes(projectPath), lerCompartilhamento, definirCompartilhamento, definirPrincipal, explorer: true, icone: iconeDaExtensao };
}
