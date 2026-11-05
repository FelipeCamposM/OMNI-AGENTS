//! Relatório de uso de IA: tokens, mensagens e conversas por dia, lidos dos transcripts que as
//! próprias CLIs gravam (Claude: `projects/**/*.jsonl`; Codex: `sessions/**/rollout-*.jsonl`).
//!
//! Nada sai do computador e nenhum conteúdo de mensagem é guardado: de cada linha só ficam data,
//! contagem de tokens, modelo, conta e o nome da pasta do projeto.

use crate::Profile;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Um evento contável de um transcript, já sem conteúdo.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Evento {
    /// Identidade estável entre cópias do arquivo (fork e troca de conta copiam o `.jsonl`).
    chave: String,
    /// Epoch em ms.
    em_ms: i64,
    tipo: TipoEvento,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
enum TipoEvento {
    /// Mensagem que você mandou.
    Prompt,
    /// Uma resposta do modelo com o uso dela.
    Resposta { modelo: String, entrada: u64, saida: u64, cache_lido: u64 },
}

/// Eventos de um arquivo e de onde ele veio. É o que o cache guarda por (caminho, mtime, tamanho).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Arquivo {
    eventos: Vec<Evento>,
    /// Nome da pasta do projeto (último componente do `cwd`).
    projeto: Option<String>,
    sessao: String,
    /// Até que byte o arquivo já foi lido. Transcript só cresce: a próxima leitura continua daqui.
    #[serde(default)]
    lido_ate: u64,
    /// Codex: último modelo visto (`turn_context`), para quem continuar a leitura saber qual é.
    #[serde(default)]
    modelo: Option<String>,
}

pub type Cache = HashMap<PathBuf, (u64, u64, Arquivo)>;

#[derive(Serialize, Default, Clone, Debug, PartialEq)]
pub struct Dia {
    /// `AAAA-MM-DD` no fuso de quem pediu.
    pub data: String,
    /// Tokens de entrada (inclui o que foi gravado em cache) + saída.
    pub tokens: u64,
    pub saida: u64,
    /// Lidos do cache: custam bem menos, por isso ficam à parte.
    pub cache_lido: u64,
    pub prompts: u64,
    pub respostas: u64,
    pub conversas: u64,
}

#[derive(Serialize, Default, Clone, Debug)]
pub struct Fatia {
    pub nome: String,
    /// Só para conta: `claude`/`codex`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    pub tokens: u64,
    pub prompts: u64,
}

#[derive(Serialize, Default, Clone, Debug)]
pub struct Relatorio {
    pub dias: Vec<Dia>,
    pub por_conta: Vec<Fatia>,
    pub por_modelo: Vec<Fatia>,
    pub por_projeto: Vec<Fatia>,
    /// Hora do dia (0–23, no fuso pedido) → prompts. Mostra quando você mais usa.
    pub por_hora: Vec<u64>,
}

fn epoch_ms(valor: &Value) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(valor.as_str()?).ok().map(|data| data.timestamp_millis())
}

fn numero(valor: &Value) -> u64 {
    valor.as_u64().unwrap_or(0)
}

fn pasta(cwd: &str) -> Option<String> {
    cwd.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next().filter(|nome| !nome.is_empty()).map(str::to_owned)
}

/// Texto que a própria CLI injeta como "user" (comandos, avisos, resultados de ferramenta) não é
/// mensagem sua.
fn prompt_de_verdade(mensagem: &Value) -> bool {
    match &mensagem["content"] {
        Value::String(texto) => !texto.trim_start().starts_with('<'),
        Value::Array(blocos) => blocos.iter().any(|bloco| bloco["type"] == "text" && bloco["text"].as_str().is_some_and(|t| !t.trim_start().starts_with('<'))),
        _ => false,
    }
}

/// Linhas que entraram no arquivo desde `arquivo.lido_ate`, avançando a marca. A última linha sem
/// `\n` só conta se já for um JSON inteiro — senão a CLI ainda está escrevendo e fica para a próxima.
fn linhas_novas(caminho: &Path, arquivo: &mut Arquivo) -> Vec<String> {
    let Ok(mut file) = crate::abrir(caminho) else { return Vec::new() };
    if file.seek(SeekFrom::Start(arquivo.lido_ate)).is_err() { return Vec::new(); }
    let mut leitor = BufReader::new(file);
    let mut linhas = Vec::new();
    let mut linha = String::new();
    loop {
        linha.clear();
        let Ok(lidos) = leitor.read_line(&mut linha) else { break };
        if lidos == 0 { break; }
        if !linha.ends_with('\n') && serde_json::from_str::<Value>(&linha).is_err() { break; }
        arquivo.lido_ate += lidos as u64;
        linhas.push(linha.trim_end().to_owned());
    }
    linhas
}

fn novo_arquivo(caminho: &Path) -> Arquivo {
    Arquivo { sessao: caminho.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(), ..Default::default() }
}

pub fn ler_claude(caminho: &Path) -> Arquivo {
    let mut arquivo = novo_arquivo(caminho);
    continuar_claude(caminho, &mut arquivo);
    arquivo
}

fn continuar_claude(caminho: &Path, arquivo: &mut Arquivo) {
    // Só evita empilhar o mesmo evento: a contagem em `montar` já deduplica pela chave.
    let mut vistas = HashSet::new();
    for linha in linhas_novas(caminho, arquivo) {
        // Filtro barato antes do parse: a maioria das linhas não conta.
        let resposta = linha.contains("\"usage\"");
        if !resposta && !linha.contains("\"type\":\"user\"") { continue; }
        let Ok(valor) = serde_json::from_str::<Value>(&linha) else { continue };
        if arquivo.projeto.is_none() { arquivo.projeto = valor["cwd"].as_str().and_then(pasta); }
        let Some(em_ms) = epoch_ms(&valor["timestamp"]) else { continue };
        if valor["isSidechain"] == true || valor["isMeta"] == true { continue; }
        let mensagem = &valor["message"];
        if valor["type"] == "assistant" {
            let uso = &mensagem["usage"];
            let modelo = mensagem["model"].as_str().unwrap_or("");
            // A CLI grava a mesma resposta uma vez por bloco (texto, ferramenta…), com o mesmo uso.
            let Some(id) = mensagem["id"].as_str() else { continue };
            if uso.is_null() || modelo.is_empty() || modelo.starts_with('<') || !vistas.insert(id.to_owned()) { continue; }
            arquivo.eventos.push(Evento { chave: format!("c:{id}"), em_ms, tipo: TipoEvento::Resposta {
                modelo: modelo.to_owned(),
                entrada: numero(&uso["input_tokens"]) + numero(&uso["cache_creation_input_tokens"]),
                saida: numero(&uso["output_tokens"]),
                cache_lido: numero(&uso["cache_read_input_tokens"]),
            }});
        } else if valor["type"] == "user" && prompt_de_verdade(mensagem) {
            let Some(uuid) = valor["uuid"].as_str() else { continue };
            arquivo.eventos.push(Evento { chave: format!("u:{uuid}"), em_ms, tipo: TipoEvento::Prompt });
        }
    }
}

pub fn ler_codex(caminho: &Path) -> Arquivo {
    let mut arquivo = novo_arquivo(caminho);
    continuar_codex(caminho, &mut arquivo);
    arquivo
}

fn continuar_codex(caminho: &Path, arquivo: &mut Arquivo) {
    let mut modelo = arquivo.modelo.clone().unwrap_or_else(|| "codex".into());
    for linha in linhas_novas(caminho, arquivo) {
        if !linha.contains("token_count") && !linha.contains("user_message") && !linha.contains("turn_context") && !linha.contains("session_meta") { continue; }
        let Ok(valor) = serde_json::from_str::<Value>(&linha) else { continue };
        let carga = &valor["payload"];
        match (valor["type"].as_str(), carga["type"].as_str()) {
            (Some("session_meta"), _) => { if arquivo.projeto.is_none() { arquivo.projeto = carga["cwd"].as_str().and_then(pasta); } }
            (Some("turn_context"), _) => { if let Some(m) = carga["model"].as_str() { modelo = m.to_owned(); } }
            (Some("event_msg"), Some("token_count")) => {
                let uso = &carga["info"]["last_token_usage"];
                let Some(em_ms) = epoch_ms(&valor["timestamp"]) else { continue };
                if uso.is_null() { continue; }
                let cache_lido = numero(&uso["cached_input_tokens"]);
                arquivo.eventos.push(Evento {
                    chave: format!("x:{}:{}", valor["timestamp"].as_str().unwrap_or(""), numero(&carga["info"]["total_token_usage"]["total_tokens"])),
                    em_ms,
                    tipo: TipoEvento::Resposta {
                        modelo: modelo.clone(),
                        entrada: numero(&uso["input_tokens"]).saturating_sub(cache_lido),
                        saida: numero(&uso["output_tokens"]),
                        cache_lido,
                    },
                });
            }
            (Some("event_msg"), Some("user_message")) => {
                let Some(em_ms) = epoch_ms(&valor["timestamp"]) else { continue };
                arquivo.eventos.push(Evento { chave: format!("xu:{}", valor["timestamp"].as_str().unwrap_or("")), em_ms, tipo: TipoEvento::Prompt });
            }
            _ => {}
        }
    }
    arquivo.modelo = Some(modelo);
}

fn carimbo(caminho: &Path) -> (u64, u64) {
    let meta = std::fs::metadata(caminho).ok();
    let modificado = meta.as_ref().and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0);
    (modificado, meta.map(|m| m.len()).unwrap_or(0))
}

/// Monta o relatório dos últimos `dias` dias (hoje incluso). `fuso_min` é o deslocamento do fuso
/// de quem pediu em minutos (Brasília = -180), para "hoje" ser o dia de quem olha.
pub fn montar(profiles: &[Profile], dias: u32, fuso_min: i32, agora_ms: i64, cache: &mut Cache) -> Relatorio {
    let dias = dias.clamp(1, 90);
    let deslocamento = i64::from(fuso_min) * 60_000;
    let dia_de = |ms: i64| (ms + deslocamento).div_euclid(86_400_000);
    let hoje = dia_de(agora_ms);
    let primeiro = hoje - i64::from(dias) + 1;
    // Arquivo sem mudança desde antes do período não tem evento nele.
    let corte_ms = (primeiro * 86_400_000 - deslocamento - 86_400_000).max(0) as u64;

    let mut vivos = HashSet::new();
    let mut fontes: Vec<(&Profile, PathBuf)> = Vec::new();
    for profile in profiles {
        let raiz = Path::new(&profile.config_dir);
        let caminhos = match profile.provider.as_str() {
            "claude" => crate::history::claude_transcripts(raiz),
            "codex" => crate::rollouts(&raiz.join("sessions")),
            _ => continue,
        };
        fontes.extend(caminhos.into_iter().map(|caminho| (profile, caminho)));
    }

    let mut por_dia: BTreeMap<i64, Dia> = (primeiro..=hoje).map(|d| (d, Dia::default())).collect();
    let mut sessoes_por_dia: HashMap<i64, HashSet<String>> = HashMap::new();
    let mut contas: HashMap<String, Fatia> = HashMap::new();
    let mut modelos: HashMap<String, Fatia> = HashMap::new();
    let mut projetos: HashMap<String, Fatia> = HashMap::new();
    let mut por_hora = vec![0_u64; 24];
    let mut contados = HashSet::new();

    for (profile, caminho) in fontes {
        let (modificado, tamanho) = carimbo(&caminho);
        if modificado < corte_ms { continue; }
        vivos.insert(caminho.clone());
        let entrada = cache.entry(caminho.clone()).or_insert_with(|| (0, 0, novo_arquivo(&caminho)));
        if (entrada.0, entrada.1) != (modificado, tamanho) {
            // Transcript só cresce: lê só o pedaço novo. Encolheu = foi reescrito, lê do zero.
            if tamanho < entrada.2.lido_ate { entrada.2 = novo_arquivo(&caminho); }
            if profile.provider == "claude" { continuar_claude(&caminho, &mut entrada.2); } else { continuar_codex(&caminho, &mut entrada.2); }
            entrada.0 = modificado;
            entrada.1 = tamanho;
        }
        let arquivo = &entrada.2;
        for evento in &arquivo.eventos {
            let dia = dia_de(evento.em_ms);
            if dia < primeiro || dia > hoje || !contados.insert(evento.chave.clone()) { continue; }
            let linha = por_dia.entry(dia).or_default();
            sessoes_por_dia.entry(dia).or_default().insert(arquivo.sessao.clone());
            let conta = contas.entry(profile.id.clone()).or_insert_with(|| Fatia { nome: profile.name.clone(), provider: Some(profile.provider.clone()), ..Default::default() });
            let projeto = projetos.entry(arquivo.projeto.clone().unwrap_or_else(|| "Outros".into())).or_default();
            match &evento.tipo {
                TipoEvento::Prompt => {
                    linha.prompts += 1;
                    conta.prompts += 1;
                    projeto.prompts += 1;
                    por_hora[((evento.em_ms + deslocamento).div_euclid(3_600_000)).rem_euclid(24) as usize] += 1;
                }
                TipoEvento::Resposta { modelo, entrada, saida, cache_lido } => {
                    let tokens = entrada + saida;
                    linha.tokens += tokens;
                    linha.saida += saida;
                    linha.cache_lido += cache_lido;
                    linha.respostas += 1;
                    conta.tokens += tokens;
                    projeto.tokens += tokens;
                    modelos.entry(modelo.clone()).or_default().tokens += tokens;
                }
            }
        }
    }
    // Fica o que ainda pode cair em algum período (até 90 dias); o resto sai da memória e do disco.
    let corte_maximo = (agora_ms - 91 * 86_400_000).max(0) as u64;
    cache.retain(|caminho, (modificado, _, _)| vivos.contains(caminho) || (*modificado >= corte_maximo && caminho.exists()));

    let dias_saida = por_dia.into_iter().map(|(dia, mut linha)| {
        linha.conversas = sessoes_por_dia.get(&dia).map_or(0, |s| s.len() as u64);
        linha.data = chrono::DateTime::from_timestamp(dia * 86_400, 0).map(|d| d.format("%Y-%m-%d").to_string()).unwrap_or_default();
        linha
    }).collect();
    let ordenar = |mapa: HashMap<String, Fatia>| {
        let mut lista: Vec<Fatia> = mapa.into_iter().map(|(nome, mut f)| { if f.nome.is_empty() { f.nome = nome; } f })
            .filter(|f| f.tokens > 0 || f.prompts > 0).collect();
        lista.sort_by(|a, b| b.tokens.cmp(&a.tokens).then(b.prompts.cmp(&a.prompts)));
        lista
    };
    Relatorio { dias: dias_saida, por_conta: ordenar(contas), por_modelo: ordenar(modelos), por_projeto: ordenar(projetos), por_hora }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn perfil(dir: &Path, provider: &str) -> Profile {
        serde_json::from_value(serde_json::json!({"id":format!("{provider}-1"),"provider":provider,"name":"Padrão",
            "config_dir":dir.to_string_lossy(),"created_at_ms":0})).unwrap()
    }

    /// Resposta repetida por bloco conta uma vez; a mesma conversa copiada (fork) não conta em
    /// dobro; texto injetado pela CLI não é prompt; o dia respeita o fuso.
    #[test]
    fn soma_tokens_sem_contar_duas_vezes() {
        let dir = tempfile::tempdir().unwrap();
        let pasta_projeto = dir.path().join("projects").join("proj");
        std::fs::create_dir_all(&pasta_projeto).unwrap();
        let linhas = [
            r#"{"type":"user","uuid":"u1","cwd":"D:\\code\\loja","timestamp":"2026-10-16T02:30:00Z","message":{"role":"user","content":"arruma o login"}}"#,
            r#"{"type":"user","uuid":"u2","timestamp":"2026-10-16T02:31:00Z","message":{"role":"user","content":"<command-name>/clear</command-name>"}}"#,
            r#"{"type":"assistant","timestamp":"2026-10-16T02:32:00Z","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":10,"cache_creation_input_tokens":90,"cache_read_input_tokens":1000,"output_tokens":5}}}"#,
            r#"{"type":"assistant","timestamp":"2026-10-16T02:32:01Z","message":{"id":"m1","model":"claude-opus-5-5","usage":{"input_tokens":10,"cache_creation_input_tokens":90,"cache_read_input_tokens":1000,"output_tokens":5}}}"#,
        ].join("\n");
        std::fs::write(pasta_projeto.join("a.jsonl"), &linhas).unwrap();
        std::fs::write(pasta_projeto.join("fork.jsonl"), &linhas).unwrap();
        let agora = chrono::DateTime::parse_from_rfc3339("2026-10-16T12:00:00Z").unwrap().timestamp_millis();
        let mut cache = Cache::new();
        // Brasília: 02:30Z ainda é dia 15.
        let r = montar(&[perfil(dir.path(), "claude")], 2, -180, agora, &mut cache);
        assert_eq!(r.dias.len(), 2);
        assert_eq!(r.dias[0].data, "2026-10-15");
        assert_eq!((r.dias[0].tokens, r.dias[0].saida, r.dias[0].cache_lido, r.dias[0].prompts), (105, 5, 1000, 1));
        assert_eq!(r.dias[1].tokens, 0);
        assert_eq!(r.por_projeto[0].nome, "loja");
        assert_eq!(r.por_modelo[0].nome, "claude-opus-5-5");
        assert_eq!(r.por_hora[23], 1);
        // Segunda leitura vem do cache e dá o mesmo resultado.
        assert_eq!(montar(&[perfil(dir.path(), "claude")], 2, -180, agora, &mut cache).dias, r.dias);
    }

    /// Arquivo que cresceu é lido só do ponto onde parou; linha pela metade espera a próxima leitura;
    /// o cache sobrevive a ir e voltar do disco (JSON).
    #[test]
    fn continua_de_onde_parou() {
        let dir = tempfile::tempdir().unwrap();
        let pasta_projeto = dir.path().join("projects").join("proj");
        std::fs::create_dir_all(&pasta_projeto).unwrap();
        let arquivo = pasta_projeto.join("a.jsonl");
        let prompt = |id: &str| format!(r#"{{"type":"user","uuid":"{id}","timestamp":"2026-10-16T12:00:00Z","message":{{"role":"user","content":"oi"}}}}"#);
        std::fs::write(&arquivo, format!("{}\n{}", prompt("u1"), &prompt("u2")[..20])).unwrap();
        let agora = chrono::DateTime::parse_from_rfc3339("2026-10-16T13:00:00Z").unwrap().timestamp_millis();
        let perfis = [perfil(dir.path(), "claude")];
        let mut cache = Cache::new();
        assert_eq!(montar(&perfis, 1, 0, agora, &mut cache).dias[0].prompts, 1);
        std::fs::write(&arquivo, format!("{}\n{}\n{}\n", prompt("u1"), prompt("u2"), prompt("u3"))).unwrap();
        let mut cache: Cache = serde_json::from_str(&serde_json::to_string(&cache).unwrap()).unwrap();
        assert_eq!(montar(&perfis, 1, 0, agora, &mut cache).dias[0].prompts, 3);
        assert_eq!(cache.values().next().unwrap().2.eventos.len(), 3, "releu o começo do arquivo");
    }
}

