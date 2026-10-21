//! Configurações → Armazenamento: quanto do disco as conversas ocupam, por IA, por conta e por
//! conversa. Só o que é conversa (transcripts, histórico de edições, índices e prompts digitados);
//! plugins, caches e o resto da pasta da conta ficam de fora.
//!
//! Só leitura, menos a limpeza (`limpar`) e a junção das cópias entre contas (`juntar_copias`).
//! Uma conversa ligada em duas contas (hard link, ver `crate::mestra`) conta uma vez só.

use serde::Serialize;
use std::{collections::{HashMap, HashSet}, fs, path::{Path, PathBuf}};

/// Um pedaço da pasta da conta: uma pasta inteira, um arquivo, ou os arquivos que começam com
/// um prefixo (o SQLite e seus `-wal`/`-shm`).
#[derive(Debug, Clone, Serialize)]
pub struct Parte {
    pub nome: String,
    pub bytes: u64,
    pub arquivos: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Conversa {
    /// Nome da conversa no OMNI. `None` quando ela foi aberta fora dele.
    pub titulo: Option<String>,
    pub arquivo: String,
    pub caminho: String,
    pub bytes: u64,
    pub modificado_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DaConta {
    /// `claude`, `codex`, `cursor`, `antigravity` ou `omni` (os dados do próprio OMNI).
    pub provider: String,
    pub conta_id: String,
    pub conta_nome: String,
    pub caminho: String,
    pub bytes: u64,
    pub partes: Vec<Parte>,
    /// As maiores da conta, da maior para a menor.
    pub maiores: Vec<Conversa>,
    /// Quantos arquivos de conversa a conta tem.
    pub conversas: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Armazenamento {
    pub bytes: u64,
    pub contas: Vec<DaConta>,
}

/// O que é conversa na pasta de cada IA. O primeiro item é onde moram os transcripts — é dele que
/// sai a lista das maiores. Nome com `*` no fim é prefixo de arquivo.
fn partes_de(provider: &str) -> &'static [(&'static str, &'static [&'static str])] {
    match provider {
        "claude" => &[("Conversas", &["projects"]), ("Histórico de edições", &["file-history"]),
            ("Tarefas e planos", &["todos", "plans"]), ("Prompts digitados", &["history.jsonl"])],
        "codex" => &[("Conversas", &["sessions", "archived_sessions"]), ("Índice das conversas", &["thread_history_*"]),
            ("Prompts digitados", &["history.jsonl"])],
        "cursor" => &[("Conversas", &["chats"]), ("Dados por projeto", &["projects"]), ("Planos", &["plans"])],
        "antigravity" => &[("Conversas", &["conversations"]), ("Resumos", &["conversation_summaries*"]),
            ("Artefatos", &["brain", "annotations", "implicit"]), ("Prompts digitados", &["history.jsonl"])],
        "omni" => &[("Índice das conversas", &["conversations.json", "sessions.json"]), ("Cache dos relatórios", &["relatorio-cache.json"]),
            ("Execuções de fluxos", &["execucoes"]), ("Worktrees", &["worktrees"]), ("Voz", &["voz"])],
        _ => &[],
    }
}

/// Arquivo de conversa de cada IA (o resto da pasta de conversas é anexo, subagente, saída de ferramenta).
fn e_conversa(provider: &str, caminho: &Path) -> bool {
    let extensao = caminho.extension().and_then(|e| e.to_str()).unwrap_or("");
    match provider {
        "antigravity" | "cursor" => extensao == "db",
        // `projects/<pasta>/<id>.jsonl`; o `<id>/subagents/*.jsonl` é anexo dela.
        "claude" => extensao == "jsonl" && caminho.parent().and_then(Path::parent).and_then(Path::file_name).is_some_and(|n| n == "projects"),
        _ => extensao == "jsonl",
    }
}

const MAIORES: usize = 10;

type Vistos = HashSet<same_file::Handle>;

#[derive(Default)]
struct Soma { bytes: u64, arquivos: u64, conversas: Vec<(u64, u64, std::path::PathBuf)>, total_conversas: u64 }

/// Soma uma pasta sem seguir link (junção e symlink podem apontar para outra conta ou para o disco
/// inteiro). Com `provider`, guarda também os arquivos de conversa.
fn somar(caminho: &Path, provider: Option<&str>, soma: &mut Soma, vistos: &mut Vistos) {
    let Ok(meta) = fs::symlink_metadata(caminho) else { return };
    if meta.is_file() {
        let conversa = provider.is_some_and(|p| e_conversa(p, caminho));
        // O mesmo arquivo por outro nome (link da conta mestra): já foi somado onde apareceu primeiro.
        if conversa && same_file::Handle::from_path(caminho).is_ok_and(|h| !vistos.insert(h)) {
            soma.total_conversas += 1;
            return;
        }
        soma.bytes += meta.len();
        soma.arquivos += 1;
        if conversa {
            let modificado = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64);
            soma.total_conversas += 1;
            soma.conversas.push((meta.len(), modificado, caminho.to_path_buf()));
        }
    } else if meta.is_dir() {
        let Ok(entradas) = fs::read_dir(caminho) else { return };
        for entrada in entradas.flatten() { somar(&entrada.path(), provider, soma, vistos); }
    }
}

/// Nome da conversa no OMNI pelo id da sessão da CLI. O arquivo tem o id no nome: `<id>.jsonl` no
/// Claude, `rollout-<data>-<id>.jsonl` no Codex, `<id>.db` no Antigravity.
fn titulos(dir: &Path) -> HashMap<String, String> {
    let mut mapa = HashMap::new();
    for conversa in crate::conversations::read_index(dir) {
        let titulo = crate::conversations::display_title(&conversa);
        for segmento in &conversa.segments {
            if let Some(id) = &segmento.external_session_id { mapa.insert(id.to_lowercase(), titulo.clone()); }
            if let Some(stem) = segmento.transcript_path.as_deref().and_then(|p| Path::new(p).file_stem()) {
                mapa.insert(stem.to_string_lossy().to_lowercase(), titulo.clone());
            }
        }
    }
    mapa
}

fn titulo_do_arquivo(titulos: &HashMap<String, String>, caminho: &Path) -> Option<String> {
    let stem = caminho.file_stem()?.to_string_lossy().to_lowercase();
    // Codex: o id é o fim do nome (`rollout-2026-10-20T01-02-03-<uuid>`); um uuid tem 36 caracteres.
    titulos.get(&stem).or_else(|| stem.get(stem.len().saturating_sub(36)..).and_then(|fim| titulos.get(fim))).cloned()
}

fn medir_conta(provider: &str, conta_id: &str, conta_nome: &str, raiz: &Path, titulos: &HashMap<String, String>, vistos: &mut Vistos) -> DaConta {
    let nomes: Vec<String> = fs::read_dir(raiz).map(|e| e.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect()).unwrap_or_default();
    let mut partes = Vec::new();
    let mut conversas = Vec::new();
    let mut total_conversas = 0;
    for (i, (rotulo, itens)) in partes_de(provider).iter().enumerate() {
        let mut soma = Soma::default();
        for item in *itens {
            let casa = |nome: &String| item.strip_suffix('*').map_or(nome == item, |prefixo| nome.starts_with(prefixo));
            for nome in nomes.iter().filter(|n| casa(n)) {
                somar(&raiz.join(nome), (i == 0 && provider != "omni").then_some(provider), &mut soma, vistos);
            }
        }
        conversas.append(&mut soma.conversas);
        total_conversas += soma.total_conversas;
        partes.push(Parte { nome: (*rotulo).into(), bytes: soma.bytes, arquivos: soma.arquivos });
    }
    conversas.sort_by_key(|c| std::cmp::Reverse(c.0));
    conversas.truncate(MAIORES);
    DaConta {
        provider: provider.into(), conta_id: conta_id.into(), conta_nome: conta_nome.into(),
        caminho: raiz.to_string_lossy().into_owned(),
        bytes: partes.iter().map(|p| p.bytes).sum(),
        maiores: conversas.into_iter().map(|(bytes, modificado_ms, caminho)| Conversa {
            titulo: titulo_do_arquivo(titulos, &caminho),
            arquivo: caminho.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            caminho: caminho.to_string_lossy().into_owned(), bytes, modificado_ms,
        }).collect(),
        conversas: total_conversas,
        partes,
    }
}

/// Mede todas as contas do `profiles.json` e os dados do próprio OMNI (`dir`, a pasta do engine).
pub fn medir(dir: &Path) -> Armazenamento {
    let titulos = titulos(dir);
    let mut vistos = Vistos::new();
    let mut contas: Vec<DaConta> = mestras_primeiro(dir).iter()
        .map(|p| medir_conta(&p.provider, &p.id, &p.name, Path::new(&p.config_dir), &titulos, &mut vistos))
        .collect();
    contas.push(medir_conta("omni", "omni", "OMNI", dir, &titulos, &mut vistos));
    contas.sort_by_key(|c| std::cmp::Reverse(c.bytes));
    Armazenamento { bytes: contas.iter().map(|c| c.bytes).sum(), contas }
}

/// As contas com a mestra de cada IA na frente: o arquivo ligado conta para ela.
fn mestras_primeiro(dir: &Path) -> Vec<crate::Profile> {
    let mut perfis = crate::profiles(dir);
    let mestras: HashSet<String> = perfis.iter().filter_map(|p| crate::mestra::mestra(dir, &perfis, &p.provider)).map(|p| p.id.clone()).collect();
    perfis.sort_by_key(|p| !mestras.contains(&p.id));
    perfis
}

/// Uma conversa sem uso: todas as cópias dela (uma por conta da mesma IA) e o que é dela.
#[derive(Debug, Clone, Serialize)]
pub struct Antiga {
    pub provider: String,
    pub id: String,
    pub titulo: Option<String>,
    pub contas: Vec<String>,
    pub bytes: u64,
    /// Última escrita na cópia mais nova. É o "último uso": a CLI grava a cada mensagem.
    pub usada_ms: u64,
    #[serde(skip)]
    caminhos: Vec<PathBuf>,
}

/// Id da sessão da CLI pelo arquivo da conversa. Cursor: `chats/<hash>/<id>/store.db`.
fn id_da_conversa(provider: &str, caminho: &Path) -> Option<String> {
    let id = match provider {
        "cursor" => caminho.parent()?.file_name()?.to_string_lossy().into_owned(),
        _ => caminho.file_stem()?.to_string_lossy().into_owned(),
    };
    // Codex: `rollout-<data>-<uuid>`; o uuid tem 36 caracteres.
    Some(if provider == "codex" { id.get(id.len().saturating_sub(36)..).unwrap_or(&id).to_owned() } else { id }.to_lowercase())
}

/// Tudo o que sai junto com a conversa: o arquivo dela e os anexos que só ela usa.
fn pertences(provider: &str, raiz: &Path, caminho: &Path, id: &str) -> Vec<PathBuf> {
    let mut lista = match provider {
        // A pasta do chat inteira (o `store.db` e o que mais houver nela).
        "cursor" => vec![caminho.parent().map(Path::to_path_buf).unwrap_or_else(|| caminho.to_path_buf())],
        // Subagentes e saídas de ferramenta em `<id>/`; checkpoints de edição em `file-history/<id>/`.
        "claude" => vec![caminho.to_path_buf(), caminho.with_extension(""), raiz.join("file-history").join(id)],
        "antigravity" => vec![caminho.to_path_buf(), raiz.join("brain").join(id)],
        _ => vec![caminho.to_path_buf()],
    };
    lista.retain(|p| fs::symlink_metadata(p).is_ok());
    lista
}

const DIA_MS: u64 = 24 * 60 * 60 * 1000;

/// Conversas sem uso há mais de `dias`, da maior para a menor. Uma conversa só entra se **todas**
/// as cópias estão paradas: a troca de conta deixa uma cópia velha na conta anterior enquanto a
/// conversa segue viva na nova. `protegidas` (ids das sessões abertas no OMNI) nunca entram.
pub fn antigas(dir: &Path, dias: u64, agora_ms: u64, protegidas: &HashSet<String>) -> Vec<Antiga> {
    let titulos = titulos(dir);
    let mut vistos = Vistos::new();
    let mut grupos: HashMap<(String, String), Antiga> = HashMap::new();
    for perfil in crate::profiles(dir) {
        let raiz = Path::new(&perfil.config_dir);
        let Some((_, pastas)) = partes_de(&perfil.provider).first() else { continue };
        let mut soma = Soma::default();
        for pasta in *pastas { somar(&raiz.join(pasta), Some(&perfil.provider), &mut soma, &mut Vistos::new()); }
        for (_, modificado, caminho) in soma.conversas {
            let Some(id) = id_da_conversa(&perfil.provider, &caminho) else { continue };
            let caminhos = pertences(&perfil.provider, raiz, &caminho, &id);
            let mut bytes = Soma::default();
            for p in &caminhos {
                // Link de outra conta: o caminho entra (para sair junto), os bytes não.
                if same_file::Handle::from_path(p).is_ok_and(|h| !vistos.insert(h)) { continue; }
                somar(p, None, &mut bytes, &mut Vistos::new());
            }
            let grupo = grupos.entry((perfil.provider.clone(), id.clone())).or_insert_with(|| Antiga {
                provider: perfil.provider.clone(), id: id.clone(), titulo: titulo_do_arquivo(&titulos, &caminho),
                contas: Vec::new(), bytes: 0, usada_ms: 0, caminhos: Vec::new(),
            });
            if !grupo.contas.contains(&perfil.name) { grupo.contas.push(perfil.name.clone()); }
            grupo.bytes += bytes.bytes;
            grupo.usada_ms = grupo.usada_ms.max(modificado);
            grupo.caminhos.extend(caminhos);
        }
    }
    let limite = agora_ms.saturating_sub(dias * DIA_MS);
    let mut lista: Vec<Antiga> = grupos.into_values()
        .filter(|a| a.usada_ms < limite && !protegidas.contains(&a.id))
        .collect();
    lista.sort_by_key(|a| std::cmp::Reverse(a.bytes));
    lista
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Limpeza {
    pub conversas: usize,
    pub bytes: u64,
    /// Arquivos que não deu para apagar (em uso, sem permissão). Os outros saem do mesmo jeito.
    pub erros: Vec<String>,
}

/// Apaga as conversas que `antigas` devolve **agora** — a lista é refeita aqui, nunca recebida de
/// fora, então ninguém apaga um caminho qualquer por esta função. Depois tira do índice do OMNI as
/// conversas que ficaram sem nenhum arquivo.
pub fn limpar(dir: &Path, dias: u64, agora_ms: u64, protegidas: &HashSet<String>) -> Limpeza {
    let mut resultado = Limpeza::default();
    let mut apagadas = HashSet::new();
    for antiga in antigas(dir, dias, agora_ms, protegidas) {
        let mut ok = true;
        for caminho in &antiga.caminhos {
            let Ok(meta) = fs::symlink_metadata(caminho) else { continue };
            let apagou = if meta.is_dir() { fs::remove_dir_all(caminho) } else { fs::remove_file(caminho) };
            if let Err(erro) = apagou { ok = false; resultado.erros.push(format!("{}: {erro}", caminho.display())); }
        }
        if ok {
            resultado.conversas += 1;
            resultado.bytes += antiga.bytes;
            apagadas.insert(antiga.id);
        }
    }
    if !apagadas.is_empty() {
        let indice = crate::conversations::read_index(dir);
        let antes = indice.len();
        let sobra: Vec<_> = indice.into_iter().filter(|c| {
            let dela = c.segments.iter().any(|s| s.external_session_id.as_deref().is_some_and(|id| apagadas.contains(&id.to_lowercase())));
            let algum_arquivo = c.segments.iter().any(|s| s.transcript_path.as_deref().is_some_and(|p| Path::new(p).exists()));
            !dela || algum_arquivo
        }).collect();
        if sobra.len() != antes { let _ = crate::conversations::write_index(dir, &sobra); }
    }
    resultado
}

/// Conversa da mesma IA guardada mais de uma vez (de antes de existir a conta mestra), ou que ainda
/// não está na mestra.
#[derive(Debug, Clone, Serialize)]
pub struct Duplicada {
    pub provider: String,
    pub id: String,
    pub titulo: Option<String>,
    pub contas: Vec<String>,
    /// O que vai para a Lixeira ao juntar: todas as versões menos a mais recente.
    pub bytes: u64,
    #[serde(skip)]
    mestre: PathBuf,
    #[serde(skip)]
    copias: Vec<PathBuf>,
}

/// O que `juntar_copias` faria agora, da que mais libera para a que menos libera. Só Claude e
/// Codex: são as únicas IAs com mais de uma conta. `protegidas` (sessões abertas) ficam de fora —
/// a CLI está escrevendo nelas.
pub fn copias(dir: &Path, protegidas: &HashSet<String>) -> Vec<Duplicada> {
    let titulos = titulos(dir);
    let perfis = crate::profiles(dir);
    let mut lista = Vec::new();
    for provider in ["claude", "codex"] {
        let Some(mestra) = crate::mestra::mestra(dir, &perfis, provider) else { continue };
        let mut grupos: HashMap<PathBuf, Duplicada> = HashMap::new();
        for perfil in perfis.iter().filter(|p| p.provider == provider) {
            let raiz = Path::new(&perfil.config_dir);
            let mut soma = Soma::default();
            for pasta in partes_de(provider)[0].1 { somar(&raiz.join(pasta), Some(provider), &mut soma, &mut Vistos::new()); }
            for (_, _, caminho) in soma.conversas {
                let (Ok(relativo), Some(id)) = (caminho.strip_prefix(raiz), id_da_conversa(provider, &caminho)) else { continue };
                if protegidas.contains(&id) { continue; }
                let grupo = grupos.entry(relativo.to_path_buf()).or_insert_with(|| Duplicada {
                    provider: provider.into(), id, titulo: titulo_do_arquivo(&titulos, &caminho), contas: Vec::new(), bytes: 0,
                    mestre: Path::new(&mestra.config_dir).join(relativo), copias: Vec::new(),
                });
                grupo.contas.push(perfil.name.clone());
                if perfil.id != mestra.id { grupo.copias.push(caminho); }
            }
        }
        for mut grupo in grupos.into_values() {
            // Só o que tem nome fora da mestra que ainda não é o arquivo dela.
            let mut versoes: Vec<PathBuf> = Vec::new();
            for p in std::iter::once(&grupo.mestre).chain(&grupo.copias).filter(|p| p.is_file()) {
                if !versoes.iter().any(|v| crate::mestra::mesmo_arquivo(v, p)) { versoes.push(p.clone()); }
            }
            if versoes.len() < 2 && grupo.mestre.is_file() { continue; }
            let tamanhos: Vec<(u64, std::time::SystemTime)> = versoes.iter()
                .filter_map(|p| fs::metadata(p).ok().map(|m| (m.len(), m.modified().unwrap_or(std::time::UNIX_EPOCH)))).collect();
            let recente = tamanhos.iter().max_by_key(|t| t.1).map_or(0, |t| t.0);
            grupo.bytes = tamanhos.iter().map(|t| t.0).sum::<u64>() - recente;
            lista.push(grupo);
        }
    }
    lista.sort_by_key(|d| std::cmp::Reverse(d.bytes));
    lista
}

/// Junta cada conversa de `copias` (refeita aqui, nunca recebida de fora) num arquivo só, na conta
/// mestra: a versão mais recente fica, as outras vão para a Lixeira e voltam como link.
pub fn juntar_copias(dir: &Path, protegidas: &HashSet<String>) -> Limpeza {
    let mut resultado = Limpeza::default();
    for duplicada in copias(dir, protegidas) {
        match crate::mestra::unificar(&duplicada.mestre, &duplicada.copias) {
            Ok(bytes) => { resultado.conversas += 1; resultado.bytes += bytes; }
            Err(erro) => resultado.erros.push(format!("{}: {erro}", duplicada.titulo.as_deref().unwrap_or(&duplicada.id))),
        }
    }
    resultado
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Conta com uma conversa velha (subagente e checkpoint junto), uma nova e uma velha cuja cópia
    /// na outra conta foi usada ontem — essa fica.
    #[test]
    fn limpeza_apaga_so_o_que_esta_parado_em_todas_as_contas() {
        let engine = tempfile::tempdir().unwrap();
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let agora = 100 * DIA_MS;
        let escrever = |raiz: &Path, id: &str, dias_atras: u64| {
            let pasta = raiz.join("projects").join("D--proj");
            fs::create_dir_all(pasta.join(id).join("subagents")).unwrap();
            fs::write(pasta.join(id).join("subagents").join("agent-1.jsonl"), b"sub").unwrap();
            fs::create_dir_all(raiz.join("file-history").join(id)).unwrap();
            fs::write(raiz.join("file-history").join(id).join("v1"), b"edit").unwrap();
            let arquivo = pasta.join(format!("{id}.jsonl"));
            fs::write(&arquivo, b"{}\n").unwrap();
            let quando = std::time::UNIX_EPOCH + std::time::Duration::from_millis(agora - dias_atras * DIA_MS);
            fs::File::options().write(true).open(&arquivo).unwrap().set_modified(quando).unwrap();
            arquivo
        };
        let velha = escrever(a.path(), "velha", 45);
        let nova = escrever(a.path(), "nova", 2);
        let copia_velha = escrever(a.path(), "trocou", 90);
        escrever(b.path(), "trocou", 1);
        let aberta = escrever(a.path(), "aberta", 80);
        let perfis = serde_json::json!({"profiles": [
            {"id": "a", "provider": "claude", "name": "A", "config_dir": a.path(), "created_at_ms": 0},
            {"id": "b", "provider": "claude", "name": "B", "config_dir": b.path(), "created_at_ms": 0}]});
        fs::write(engine.path().join("profiles.json"), perfis.to_string()).unwrap();
        let indice = serde_json::json!({"version": 1, "conversations": [{"id": "c", "project_id": "x", "cwd": "D:/proj", "title": "Velha",
            "title_source": "manual", "created_at_ms": 0, "segments": [{"provider": "claude", "profile_id": "a", "external_session_id": "velha",
            "transcript_path": velha, "terminal_session_id": null, "started_at_ms": 0, "ended_at_ms": null}]}]});
        fs::write(engine.path().join("conversations.json"), indice.to_string()).unwrap();
        let protegidas = HashSet::from(["aberta".to_owned()]);

        let lista = antigas(engine.path(), 30, agora, &protegidas);
        assert_eq!(lista.iter().map(|a| (a.id.as_str(), a.titulo.as_deref())).collect::<Vec<_>>(), [("velha", Some("Velha"))]);
        assert_eq!(lista[0].bytes, 3 + 3 + 4, "conversa + subagente + checkpoint");
        assert_eq!(antigas(engine.path(), 60, agora, &protegidas).len(), 0);

        let feito = limpar(engine.path(), 30, agora, &protegidas);
        assert_eq!((feito.conversas, feito.bytes, feito.erros.len()), (1, 10, 0));
        assert!(!velha.exists() && !velha.with_extension("").exists() && !a.path().join("file-history").join("velha").exists());
        assert!(nova.exists() && copia_velha.exists() && aberta.exists());
        assert!(crate::conversations::read_index(engine.path()).is_empty(), "a conversa sem arquivo sai do índice");
    }

    #[test]
    fn mede_so_o_que_e_conversa_e_da_nome_as_maiores() {
        let engine = tempfile::tempdir().unwrap();
        let conta = tempfile::tempdir().unwrap();
        let projeto = conta.path().join("projects").join("D--proj");
        fs::create_dir_all(projeto.join("abc").join("subagents")).unwrap();
        fs::write(projeto.join("abc.jsonl"), vec![b'x'; 300]).unwrap();
        fs::write(projeto.join("def.jsonl"), vec![b'x'; 100]).unwrap();
        fs::write(projeto.join("abc").join("subagents").join("s.meta.json"), vec![b'x'; 5]).unwrap();
        fs::create_dir_all(conta.path().join("file-history")).unwrap();
        fs::write(conta.path().join("file-history").join("f"), vec![b'x'; 20]).unwrap();
        fs::write(conta.path().join("history.jsonl"), vec![b'x'; 7]).unwrap();
        fs::create_dir_all(conta.path().join("plugins")).unwrap();
        fs::write(conta.path().join("plugins").join("grande"), vec![b'x'; 9_999]).unwrap();
        let perfil = serde_json::json!({"profiles": [{"id": "p", "provider": "claude", "name": "Minha", "config_dir": conta.path(), "created_at_ms": 0}]});
        fs::write(engine.path().join("profiles.json"), perfil.to_string()).unwrap();
        let indice = serde_json::json!({"version": 1, "conversations": [{"id": "c", "project_id": "x", "cwd": "D:/proj", "title": "PRINCIPAL",
            "title_source": "manual", "created_at_ms": 0, "segments": [{"provider": "claude", "profile_id": "p", "external_session_id": "abc",
            "transcript_path": null, "terminal_session_id": null, "started_at_ms": 0, "ended_at_ms": null}]}]});
        fs::write(engine.path().join("conversations.json"), indice.to_string()).unwrap();

        let tudo = medir(engine.path());
        let claude = tudo.contas.iter().find(|c| c.provider == "claude").unwrap();
        assert_eq!(claude.bytes, 300 + 100 + 5 + 20 + 7, "plugins ficam de fora");
        assert_eq!(claude.partes[0].bytes, 405);
        assert_eq!(claude.conversas, 2);
        assert_eq!(claude.maiores.iter().map(|c| (c.titulo.as_deref(), c.bytes)).collect::<Vec<_>>(), [(Some("PRINCIPAL"), 300), (None, 100)]);
        let omni = tudo.contas.iter().find(|c| c.provider == "omni").unwrap();
        assert!(omni.bytes > 0 && omni.maiores.is_empty());
        assert_eq!(tudo.bytes, tudo.contas.iter().map(|c| c.bytes).sum::<u64>());
    }

    /// Duas contas do Claude, A é a mestra (criada antes). Uma conversa está nas duas com versões
    /// diferentes, uma só em B, e uma já ligada — essa conta uma vez só e não aparece para juntar.
    #[test]
    fn acha_copias_entre_contas_e_conta_o_link_uma_vez() {
        let engine = tempfile::tempdir().unwrap();
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let em = |raiz: &Path, id: &str| raiz.join("projects").join("D--proj").join(format!("{id}.jsonl"));
        fs::create_dir_all(em(a.path(), "x").parent().unwrap()).unwrap();
        fs::create_dir_all(em(b.path(), "x").parent().unwrap()).unwrap();
        fs::write(em(a.path(), "dup"), vec![b'x'; 30]).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        fs::write(em(b.path(), "dup"), vec![b'x'; 50]).unwrap();
        fs::write(em(b.path(), "so-b"), vec![b'x'; 7]).unwrap();
        fs::write(em(a.path(), "ligada"), vec![b'x'; 100]).unwrap();
        fs::hard_link(em(a.path(), "ligada"), em(b.path(), "ligada")).unwrap();
        let perfis = serde_json::json!({"profiles": [
            {"id": "b", "provider": "claude", "name": "B", "config_dir": b.path(), "created_at_ms": 5},
            {"id": "a", "provider": "claude", "name": "A", "config_dir": a.path(), "created_at_ms": 1}]});
        fs::write(engine.path().join("profiles.json"), perfis.to_string()).unwrap();

        let lista = copias(engine.path(), &HashSet::new());
        assert_eq!(lista.iter().map(|d| (d.id.as_str(), d.bytes)).collect::<Vec<_>>(), [("dup", 30), ("so-b", 0)]);
        assert!(copias(engine.path(), &HashSet::from(["dup".to_owned()])).iter().all(|d| d.id != "dup"), "sessão aberta fica de fora");

        let tudo = medir(engine.path());
        let conta = |id: &str| tudo.contas.iter().find(|c| c.conta_id == id).unwrap();
        assert_eq!((conta("a").partes[0].bytes, conta("b").partes[0].bytes), (130, 57), "o link conta só na mestra");
        assert_eq!((conta("a").conversas, conta("b").conversas), (2, 3));
    }

    #[test]
    fn codex_acha_o_nome_pelo_fim_do_rollout() {
        let id = "019a1b2c-3d4e-7f80-9a0b-1c2d3e4f5a6b";
        let titulos = HashMap::from([(id.to_owned(), "Revisão".to_owned())]);
        assert_eq!(titulo_do_arquivo(&titulos, Path::new(&format!("rollout-2026-10-20T01-02-03-{id}.jsonl"))).as_deref(), Some("Revisão"));
    }
}

#[cfg(test)]
mod sonda {
    /// Mede as contas reais desta máquina. `cargo test -p omni-core sonda_armazenamento -- --ignored --nocapture`
    #[test]
    #[ignore = "lê as pastas reais das contas"]
    fn sonda_armazenamento() {
        let dir = std::path::PathBuf::from(std::env::var("LOCALAPPDATA").unwrap()).join("com.omni.agents").join("engine");
        let inicio = std::time::Instant::now();
        let tudo = super::medir(&dir);
        println!("{} ms, total {} MB", inicio.elapsed().as_millis(), tudo.bytes / 1_000_000);
        for c in &tudo.contas {
            println!("{} {} {} MB, {} conversas", c.provider, c.conta_nome, c.bytes / 1_000_000, c.conversas);
            for p in &c.partes { println!("   {} {} MB", p.nome, p.bytes / 1_000_000); }
            for m in c.maiores.iter().take(3) { println!("   > {:?} {} {} MB", m.titulo, m.arquivo, m.bytes / 1_000_000); }
        }
        let agora = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64;
        for dias in [30, 60] {
            let lista = super::antigas(&dir, dias, agora, &Default::default());
            println!("{dias} dias: {} conversas, {} MB", lista.len(), lista.iter().map(|a| a.bytes).sum::<u64>() / 1_000_000);
            for a in lista.iter().take(4) { println!("   {} {:?} {:?} {} MB", a.provider, a.titulo, a.contas, a.bytes / 1_000_000); }
        }
    }
}
