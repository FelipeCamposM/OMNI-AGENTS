use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, fs::File, io::{BufRead, BufReader}, path::{Path, PathBuf}};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Segment {
    pub provider: String,
    pub profile_id: Option<String>,
    pub external_session_id: Option<String>,
    pub transcript_path: Option<String>,
    pub terminal_session_id: Option<String>,
    pub started_at_ms: u64,
    pub ended_at_ms: Option<u64>,
    /// Fork: este segmento é o histórico da conversa de origem, e vale só até o instante do fork — a
    /// original segue viva, e o que ela ganha depois não é desta conversa.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub historico_ate_ms: Option<u64>,
}

/// De onde veio o nome da conversa. `Manual` trava o nome automático: escreveu, é seu.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TitleSource {
    #[default]
    Auto,
    Manual,
    /// Resumido pela própria IA (Haiku) a partir do primeiro prompt. Não trava como o manual: é
    /// só o automático melhorado, e renomear à mão passa por cima.
    Ia,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub project_id: String,
    pub cwd: String,
    pub title: String,
    /// `default` para o índice que já está gravado em disco: conversa antiga nasce como automática e
    /// ganha nome de verdade na primeira leitura.
    #[serde(default)]
    pub title_source: TitleSource,
    pub created_at_ms: u64,
    pub segments: Vec<Segment>,
}

/// No máximo 3 palavras: o nome inteiro cabe numa aba e diz o assunto num relance.
pub const TITULO_PALAVRAS: usize = 3;
const PALAVRA_MAX: usize = 24;

/// Primeiro prompt de verdade do usuário, lido do transcript que a própria CLI grava (sem comando
/// local nem instrução injetada). `None` enquanto ninguém falou nada.
pub fn primeiro_prompt(conversation: &Conversation) -> Option<String> {
    for segment in &conversation.segments {
        let Some(path) = segment.transcript_path.as_deref() else { continue };
        let Ok(file) = File::open(path) else { continue };
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            let Ok(value) = serde_json::from_str::<Value>(&line) else { continue };
            let Some((role, text)) = text_message(&value, &segment.provider) else { continue };
            if role != "user" {
                continue;
            }
            // Mensagem de sistema do próprio CLI (comando local, lembrete) não é o assunto da conversa.
            let text = text.trim_start();
            if text.starts_with('<') || text.starts_with("# AGENTS.md") || text.starts_with("Caveat:") || text.is_empty() {
                continue;
            }
            return Some(text.chars().take(2_000).collect());
        }
    }
    None
}

/// Nome automático enquanto a IA não resumiu: as 3 primeiras palavras de conteúdo do primeiro prompt.
pub fn auto_title(conversation: &Conversation) -> Option<String> {
    primeiro_prompt(conversation).and_then(|texto| titulo_curto(&texto))
}

/// Conectivos, pronomes e os verbos de pedido ("corrigir", "quero", "ajusta"): sobra o assunto.
const VAZIAS: &[&str] = &[
    "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "da", "do", "das", "dos", "em", "na", "no", "nas", "nos", "num", "numa",
    "por", "pra", "pro", "para", "com", "sem", "sob", "sobre", "entre", "até", "ate", "e", "ou", "mas", "que", "se", "como", "quando",
    "onde", "porque", "pq", "porém", "pois", "também", "tambem", "ainda", "já", "ja", "só", "so", "mais", "menos", "muito", "muita",
    "bem", "mal", "sim", "não", "nao", "isso", "isto", "esse", "essa", "este", "esta", "esses", "essas", "aquele", "aquela", "aqui",
    "ali", "lá", "la", "eu", "tu", "ele", "ela", "nós", "nos", "eles", "elas", "vc", "você", "voce", "vcs", "me", "te", "lhe", "meu",
    "minha", "seu", "sua", "nosso", "nossa", "dele", "dela", "agora", "depois", "antes", "então", "entao", "tipo", "ai", "aí", "oi",
    "olá", "ola", "favor", "obrigado", "tá", "ta", "está", "estão", "estao", "estava", "fica", "ficar", "ficou", "ficando", "é", "ser",
    "seja", "foi", "era", "vai", "ir", "vamos", "tem", "ter", "temos", "tinha", "há", "faz", "fazer", "faça", "faca", "feito", "pode",
    "poderia", "podemos", "deve", "quero", "queria", "preciso", "precisa", "gostaria", "consegue", "consegue", "deixa", "deixe",
    "deixar", "coloca", "coloque", "colocar", "ajusta", "ajuste", "ajustar", "corrige", "corrija", "corrigir", "cria", "crie", "criar",
    "adiciona", "adicione", "adicionar", "muda", "mude", "mudar", "troca", "troque", "trocar", "implementa", "implemente",
    "implementar", "verifica", "verifique", "verificar", "veja", "ver", "olha", "olhe", "analisa", "analise", "analisar", "arruma",
    "arrume", "arrumar", "melhora", "melhore", "melhorar", "remove", "remova", "remover", "tira", "tire", "tirar", "usa", "use",
    "usar", "mostra", "mostre", "mostrar", "precisamos", "vou", "estou", "tô", "to", "algum", "alguma", "todo", "toda", "todos",
    "todas", "cada", "tão", "tao", "acho", "falei", "disse", "qual", "quais", "quanto", "aquilo", "nele", "nela", "dessa", "desse", "nessa", "nesse", "pelo", "pela",
    "the", "an", "of", "to", "in", "for", "and", "or", "with", "on", "at", "is", "are", "it", "this", "that", "please", "fix", "add",
    "make", "create", "update", "i", "we", "you", "can", "could", "would", "should", "want", "need", "let's", "lets",
];

/// Até `TITULO_PALAVRAS` palavras de conteúdo, na ordem em que aparecem. Palavra só de letras ganha
/// maiúscula; sigla, arquivo e nome com caixa própria (`SIAPLUS`, `App.tsx`) ficam como estão.
pub fn titulo_curto(texto: &str) -> Option<String> {
    let sem_codigo: String = texto.split("```").step_by(2).collect::<Vec<_>>().join(" ");
    let palavras: Vec<String> = sem_codigo
        .split(|c: char| c.is_whitespace() || ",;:!?()[]{}\"'`“”‘’<>|*#=+".contains(c))
        .map(|p| p.trim_matches(|c: char| c == '.' || c == '-' || c == '/' || c == '…'))
        .filter(|p| p.chars().count() >= 2 && p.chars().any(char::is_alphabetic) && !p.starts_with('/'))
        .filter(|p| !VAZIAS.contains(&p.to_lowercase().as_str()))
        .take(TITULO_PALAVRAS)
        .map(|p| {
            let p: String = p.chars().take(PALAVRA_MAX).collect();
            if p.chars().all(|c| c.is_alphabetic() && c.is_lowercase()) {
                let mut letras = p.chars();
                letras.next().map(|c| c.to_uppercase().chain(letras).collect()).unwrap_or_default()
            } else { p }
        })
        .collect();
    (!palavras.is_empty()).then(|| palavras.join(" "))
}

/// Título vindo da IA: só grava se ninguém renomeou nesse meio-tempo.
pub fn definir_titulo_ia(dir: &Path, conversation_id: &str, titulo: &str) -> Result<(), String> {
    let mut index = read_index(dir);
    let Some(conversation) = index.iter_mut().find(|item| item.id == conversation_id) else { return Ok(()) };
    if conversation.title_source != TitleSource::Auto || !valid_title(titulo) {
        return Ok(());
    }
    conversation.title = titulo.trim().to_string();
    conversation.title_source = TitleSource::Ia;
    write_index(dir, &index).map_err(|erro| erro.to_string())
}

/// O nome que todas as telas devem mostrar: o que o usuário escreveu, ou o derivado do primeiro
/// prompt enquanto ele não escreveu nada.
pub fn display_title(conversation: &Conversation) -> String {
    if conversation.title_source != TitleSource::Auto {
        return conversation.title.clone();
    }
    auto_title(conversation).unwrap_or_else(|| conversation.title.clone())
}

/// Limite do nome escrito à mão. Mesma regra que o spawn pelo celular já aplicava.
pub fn valid_title(title: &str) -> bool {
    let limpo = title.trim();
    !limpo.is_empty() && limpo.len() <= 120 && !limpo.chars().any(char::is_control)
}

/// Renomeia e marca como manual. Escritor único: quem chama isto é o engine — o desktop pede por
/// ele, para não existirem dois processos gravando o mesmo índice.
pub fn rename(dir: &Path, conversation_id: &str, title: &str) -> Result<Conversation, String> {
    if !valid_title(title) {
        return Err("Título inválido".into());
    }
    let mut index = read_index(dir);
    let conversation = index
        .iter_mut()
        .find(|item| item.id == conversation_id)
        .ok_or("Conversa não encontrada")?;
    conversation.title = title.trim().to_string();
    conversation.title_source = TitleSource::Manual;
    let atualizada = conversation.clone();
    write_index(dir, &index).map_err(|erro| erro.to_string())?;
    Ok(atualizada)
}

pub fn read_index(dir: &Path) -> Vec<Conversation> {
    #[derive(Deserialize)] struct Store { conversations: Vec<Conversation> }
    std::fs::read(dir.join("conversations.json")).ok()
        .and_then(|b| serde_json::from_slice::<Store>(&b).ok()).map(|s| s.conversations).unwrap_or_default()
}

/// Grava o índice inteiro. Escrita atômica via `.tmp` + rename, igual ao resto dos stores.
///
/// **Dois escritores agora**: desktop e engine (uma sessão aberta pelo celular nasce no engine).
/// Não há lock entre processos, então um spawn pelo telefone exatamente durante uma troca de conta
/// no PC pode perder um segmento. Aceitável: as duas escritas são raras e o índice é reconstruível a
/// partir dos transcripts.
/// ponytail: sem lock; se isso passar a doer, centralizar toda escrita no engine.
pub fn write_index(dir: &Path, conversations: &[Conversation]) -> std::io::Result<()> {
    let path = dir.join("conversations.json");
    let encoded = serde_json::to_vec_pretty(&serde_json::json!({"version":1,"conversations":conversations}))?;
    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, encoded)?;
    std::fs::rename(temporary, path)
}

/// Nome do diretório onde o Claude Code guarda os transcripts de um projeto: o caminho absoluto
/// com todo caractere não-alfanumérico virando `-`, caixa preservada.
/// `D:\PROGRAMACAO\...\OMNI-AGENTS` -> `D--PROGRAMACAO-...-OMNI-AGENTS`
pub fn claude_project_slug(cwd: &str) -> String {
    cwd.trim_end_matches(['\\', '/'])
        .chars()
        .map(|character| if character.is_ascii_alphanumeric() { character } else { '-' })
        .collect()
}

/// Onde o transcript de uma sessão do Claude vai parar, dado o config dir daquela conta.
pub fn claude_transcript_path(config_dir: &Path, cwd: &str, session_id: &str) -> PathBuf {
    config_dir.join("projects").join(claude_project_slug(cwd)).join(format!("{session_id}.jsonl"))
}

pub(crate) fn timestamp(value: &Value) -> Option<u64> {
    chrono::DateTime::parse_from_rfc3339(value.as_str()?).ok()
        .and_then(|d| u64::try_from(d.timestamp_millis()).ok())
}

/// Localiza e valida o transcript de um trecho dentro do diretório da conta a que ele pertence.
///
/// Para Claude o caminho normalmente já está no índice. Para Codex, que não aceita um id
/// escolhido no spawn, encontra o rollout pelo id nativo ou pela combinação pasta + instante.
/// Público porque a troca de conta precisa copiar exatamente esse mesmo arquivo; manter uma segunda
/// heurística no desktop faria timeline e failover discordarem sobre qual sessão continuar.
pub fn resolve_transcript(
    segment: &Segment,
    conversation: &Conversation,
    profiles: &[crate::Profile],
) -> Option<PathBuf> {
    let profile = profiles.iter().find(|p| Some(&p.id) == segment.profile_id.as_ref() && p.provider == segment.provider)?;
    let root = Path::new(&profile.config_dir).canonicalize().ok()?;
    // Antigravity: o log da própria sessão diz a conversa na tela agora — vale mais que o ponteiro
    // guardado, que fica velho quando o agy reabre (reinício, engine reiniciado) ou depois de um `/clear`.
    if segment.provider == "antigravity" {
        if let Some((_, path)) = segment.terminal_session_id.as_deref().and_then(|id| crate::antigravity::conversa_da_sessao(&root, id)) {
            return Some(path);
        }
    }
    if let Some(path) = &segment.transcript_path {
        let path = Path::new(path).canonicalize().ok()?;
        let extensao = if segment.provider == "antigravity" { "db" } else { "jsonl" };
        return (path.starts_with(&root) && path.extension().is_some_and(|e| e == extensao)).then_some(path);
    }
    // O agy não aceita id escolhido no spawn: a conversa é achada pela pasta + instante no índice dele.
    if segment.provider == "antigravity" {
        return crate::antigravity::descobrir(&root, &conversation.cwd, segment.started_at_ms).map(|(_, path)| path);
    }
    if segment.provider != "codex" { return None; }
    let candidates: Vec<_> = crate::rollouts(&root.join("sessions")).into_iter().filter(|path| {
        let Ok(file) = File::open(path) else { return false };
        let Some(Ok(line)) = BufReader::new(file).lines().next() else { return false };
        let Ok(value) = serde_json::from_str::<Value>(&line) else { return false };
        if value["type"] != "session_meta" { return false; }
        let meta = &value["payload"];
        if let Some(id) = &segment.external_session_id { return meta["id"].as_str() == Some(id.as_str()); }
        let same_cwd = meta["cwd"].as_str().is_some_and(|cwd| cwd.replace('\\',"/").eq_ignore_ascii_case(&conversation.cwd.replace('\\',"/")));
        same_cwd && timestamp(&meta["timestamp"]).or_else(|| timestamp(&value["timestamp"]))
            .is_some_and(|t| t.abs_diff(segment.started_at_ms) <= 30_000)
    }).collect();
    (candidates.len() == 1).then(|| candidates[0].clone())
}

fn codex_session_id(path: &Path) -> Option<String> {
    let first = BufReader::new(File::open(path).ok()?).lines().next()?.ok()?;
    let value: Value = serde_json::from_str(&first).ok()?;
    (value["type"] == "session_meta")
        .then(|| value["payload"]["id"].as_str())
        .flatten()
        .filter(|id| !id.trim().is_empty())
        .map(str::to_owned)
}

/// Completa os ponteiros que o Codex não deixa escolher no spawn. Depois que o primeiro prompt
/// cria o rollout, pasta + instante identificam a sessão; persistir caminho e id faz título,
/// histórico, celular e troca de conta usarem a mesma conversa sem repetir a busca.
pub fn discover_codex_transcripts(
    conversations: &mut [Conversation],
    profiles: &[crate::Profile],
) -> bool {
    let mut changed = false;
    for conversation_index in 0..conversations.len() {
        for segment_index in 0..conversations[conversation_index].segments.len() {
            let should_discover = {
                let segment = &conversations[conversation_index].segments[segment_index];
                // Antigravity troca de conversa dentro da mesma sessão: o ponteiro é conferido sempre.
                (segment.provider == "codex" && segment.transcript_path.is_none()) || segment.provider == "antigravity"
            };
            if !should_discover {
                continue;
            }
            let resolved = {
                let conversation = &conversations[conversation_index];
                resolve_transcript(&conversation.segments[segment_index], conversation, profiles)
            };
            let Some(path) = resolved else { continue };
            let atual = conversations[conversation_index].segments[segment_index].transcript_path.as_deref().map(Path::new);
            if atual.is_some_and(|atual| atual == path) { continue; }
            let session_id = if conversations[conversation_index].segments[segment_index].provider == "antigravity" {
                path.file_stem().map(|s| s.to_string_lossy().into_owned())
            } else { codex_session_id(&path) };
            let segment = &mut conversations[conversation_index].segments[segment_index];
            segment.transcript_path = Some(path.to_string_lossy().into_owned());
            if segment.external_session_id.is_none() || segment.provider == "antigravity" {
                segment.external_session_id = session_id;
            }
            changed = true;
        }
    }
    changed
}

#[derive(Serialize)]
pub struct Message {
    pub id: String,
    pub role: String,
    pub text: String,
    pub provider: String,
    pub timestamp: Option<String>,
    /// `text`, `tool` (ação do agente), `command` (`/comando` do usuário) ou `notice`.
    pub kind: crate::feed::Kind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    /// Imagens coladas nesta mensagem; o conteúdo vem por `GET …/imagens/{n}/{k}`.
    #[serde(skip_serializing_if = "sem_imagens")]
    pub imagens: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<crate::feed::Diff>,
}
fn sem_imagens(n: &usize) -> bool { *n == 0 }
#[derive(Serialize)]
pub struct Timeline {
    pub messages: Vec<Message>,
    pub next_cursor: Option<usize>,
    /// Onde começa a página anterior a esta. `None` = esta já começa na primeira mensagem.
    pub prev_cursor: Option<usize>,
    pub unavailable_segments: Vec<usize>,
}

pub(crate) fn text_message(value: &Value, provider: &str) -> Option<(String, String)> {
    if value["isSidechain"] == true { return None; }
    // Mensagem mandada no meio do turno (ver `feed::items`).
    if provider == "claude" && value["type"] == "attachment" && value["attachment"]["type"] == "queued_command" {
        if value["attachment"]["commandMode"].as_str().is_some_and(|modo| modo != "prompt") { return None; }
        let texto = crate::feed::sem_colado(value["attachment"]["prompt"].as_str()?);
        return (!texto.trim().is_empty()).then(|| ("user".into(), texto));
    }
    let message = match provider {
        "claude" if value["type"] == "user" || value["type"] == "assistant" => &value["message"],
        "codex" if value["type"] == "response_item" && value["payload"]["type"] == "message" => &value["payload"],
        _ => return None,
    };
    let role = message["role"].as_str()?;
    if role != "user" && role != "assistant" { return None; }
    let text = if let Some(s) = message["content"].as_str() { s.to_owned() } else {
        message["content"].as_array()?.iter().filter(|b| matches!(b["type"].as_str(),Some("text" | "input_text" | "output_text")))
            .filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("
")
    };
    // Texto colado vem embrulhado em `<pasted_content>`: é fala do usuário, não lembrete do CLI.
    let text = if role == "user" { crate::feed::sem_marcas_de_imagem(&crate::feed::sem_colado(&text)) } else { text };
    (!text.trim().is_empty()).then_some((role.into(), text))
}

/// Uma página da conversa. `cursor: None` devolve as **últimas** `limit` mensagens — é o que um chat
/// abre mostrando. Antes só existia a leitura a partir do início, e numa conversa com mais de 100
/// mensagens a resposta nova nunca aparecia na tela sem paginar até o fim.
///
/// Sem cache: lê os transcripts inteiros. Quem consulta a mesma conversa várias vezes (o servidor do
/// celular) usa [`timeline_cached`].
pub fn timeline(conversation: &Conversation, profiles: &[crate::Profile], cursor: Option<usize>, limit: usize) -> Timeline {
    timeline_cached(conversation, profiles, cursor, limit, &mut crate::feed::FeedCache::default())
}

/// Os transcripts da conversa na ordem do timeline (os mesmos que `timeline_cached` lê), para achar
/// de novo uma mensagem pelo número — ver `feed::imagem`.
pub fn fontes(conversation: &Conversation, profiles: &[crate::Profile]) -> Vec<(std::path::PathBuf, String, Option<u64>)> {
    conversation.segments.iter()
        .filter(|segment| !segment.transcript_path.as_deref().is_some_and(|path| !Path::new(path).exists()))
        .filter_map(|segment| resolve_transcript(segment, conversation, profiles).map(|path| (path, segment.provider.clone(), segment.historico_ate_ms)))
        .collect()
}

/// Maior página aceita. Ações do agente contam como item, então a página é maior que a de texto puro.
pub const PAGE_MAX: usize = 200;

pub fn timeline_cached(
    conversation: &Conversation,
    profiles: &[crate::Profile],
    cursor: Option<usize>,
    limit: usize,
    cache: &mut crate::feed::FeedCache,
) -> Timeline {
    let (itens, unavailable) = itens_cached(conversation, profiles, cache);
    let mut result = page(&conversation.id, itens, cursor, limit);
    result.unavailable_segments = unavailable;
    result
}

/// A conversa inteira, na ordem da timeline (com os avisos de troca), e os trechos que não deu para ler.
pub fn itens_cached(
    conversation: &Conversation,
    profiles: &[crate::Profile],
    cache: &mut crate::feed::FeedCache,
) -> (Vec<(String, crate::feed::Item)>, Vec<usize>) {
    let mut unavailable = Vec::new();
    let mut itens: Vec<(String, crate::feed::Item)> = Vec::new();
    let mut seen = HashSet::new();
    for (segment_index, segment) in conversation.segments.iter().enumerate() {
        // O Claude só grava o `.jsonl` depois da primeira mensagem. Conversa recém-aberta tem o
        // caminho já fixado (`--session-id`) mas nenhum arquivo: isso é "vazia", não "indisponível".
        // Antes caía no aviso de histórico perdido logo na primeira abertura. Nada é lido aqui, então
        // pular não abre brecha na checagem de caminho feita em `resolve_transcript`.
        if segment.transcript_path.as_deref().is_some_and(|path| !Path::new(path).exists()) { continue }
        let Some(path) = resolve_transcript(segment, conversation, profiles) else { unavailable.push(segment_index); continue };
        // ponytail: o SQLite do agy é relido inteiro a cada consulta (conversa pequena, leitura local);
        // cache por mtime se uma conversa longa pesar.
        let lidos;
        let entries: &[crate::feed::Entry] = if segment.provider == "antigravity" {
            let Ok(itens) = crate::antigravity::itens(&path) else { unavailable.push(segment_index); continue };
            lidos = itens;
            &lidos
        } else {
            let Ok(entries) = cache.read(&path, &segment.provider) else { unavailable.push(segment_index); continue };
            entries
        };
        for entry in entries {
            if !crate::feed::ate(&entry.item, segment.historico_ate_ms) { continue; }
            // Claude UUIDs survive profile copies (and forks). Codex records preserve timestamp/content.
            if !seen.insert(entry.identity.clone()) { continue; }
            itens.push((segment.provider.clone(), entry.item.clone()));
        }
    }
    (com_avisos_de_troca(conversation, em_ordem_de_hora(itens), profiles), unavailable)
}

/// Os segmentos são lidos um depois do outro, mas trocar de conta e voltar faz o `.jsonl` do primeiro
/// já trazer as mensagens mais novas: o que só existia no arquivo da outra conta (dias antes) caía no
/// fim do chat, por cima da conversa de agora. Ordena pela hora; ordenação estável, e item sem hora
/// herda a do anterior, para não sair do lugar.
fn em_ordem_de_hora(itens: Vec<(String, crate::feed::Item)>) -> Vec<(String, crate::feed::Item)> {
    let mut ultima = i64::MIN;
    let mut com_hora: Vec<_> = itens.into_iter().map(|par| {
        if let Some(m) = par.1.timestamp.as_deref().and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()) {
            ultima = m.timestamp_millis();
        }
        (ultima, par)
    }).collect();
    com_hora.sort_by_key(|(hora, _)| *hora);
    com_hora.into_iter().map(|(_, par)| par).collect()
}

/// Põe "Conta trocada: A → B" no ponto da conversa em que a troca aconteceu — pela **hora** da
/// troca, não pela ordem dos segmentos: voltar para uma conta grava no mesmo `.jsonl` de antes, e
/// as mensagens novas eram lidas junto com o primeiro segmento, deixando os avisos (de dias atrás)
/// presos no fim do chat. Trocas seguidas sem mensagem no meio viram um aviso só, da primeira conta
/// até a última; ida e volta para a mesma conta não aparece.
fn com_avisos_de_troca(conversation: &Conversation, itens: Vec<(String, crate::feed::Item)>, profiles: &[crate::Profile]) -> Vec<(String, crate::feed::Item)> {
    let segmentos = &conversation.segments;
    let trocas: Vec<(i64, &Segment, &Segment)> = segmentos.windows(2)
        .filter(|par| par[0].profile_id != par[1].profile_id || par[0].provider != par[1].provider)
        .map(|par| (par[1].started_at_ms as i64, &par[0], &par[1]))
        .collect();
    if trocas.is_empty() { return itens; }
    let hora = |item: &crate::feed::Item| item.timestamp.as_deref()
        .and_then(|t| chrono::DateTime::parse_from_rfc3339(t).ok()).map(|d| d.timestamp_millis());
    let mut resultado = Vec::with_capacity(itens.len() + trocas.len());
    let mut proxima = 0;
    let mut despejar = |ate: Option<i64>, resultado: &mut Vec<(String, crate::feed::Item)>| {
        let fim = trocas[proxima..].iter().take_while(|t| ate.is_none_or(|m| t.0 <= m)).count() + proxima;
        if fim > proxima {
            let (de, para) = (trocas[proxima].1, trocas[fim - 1].2);
            if de.profile_id != para.profile_id || de.provider != para.provider {
                resultado.push((para.provider.clone(), aviso_de_troca(de, para, profiles)));
            }
            proxima = fim;
        }
    };
    for (provider, item) in itens {
        if let Some(m) = hora(&item) { despejar(Some(m), &mut resultado); }
        resultado.push((provider, item));
    }
    despejar(None, &mut resultado);
    resultado
}

/// "Conta trocada: Padrão → EmailUber" (ou "IA trocada: Claude → Codex"), com a hora da troca.
fn aviso_de_troca(anterior: &Segment, novo: &Segment, profiles: &[crate::Profile]) -> crate::feed::Item {
    let nome = |segment: &Segment| segment.profile_id.as_deref()
        .and_then(|id| profiles.iter().find(|p| p.id == id).map(|p| p.name.clone()))
        .unwrap_or_else(|| "Padrão".into());
    let agente = |provider: &str| match provider { "claude" => "Claude", "codex" => "Codex", "cursor" => "Cursor", "antigravity" => "Antigravity", outro => outro }.to_string();
    let text = if anterior.provider != novo.provider {
        format!("IA trocada: {} ({}) → {} ({})", agente(&anterior.provider), nome(anterior), agente(&novo.provider), nome(novo))
    } else {
        format!("Conta trocada: {} → {}", nome(anterior), nome(novo))
    };
    crate::feed::Item {
        kind: crate::feed::Kind::Notice,
        role: "assistant".into(),
        text,
        tool: None,
        timestamp: chrono::DateTime::from_timestamp_millis(novo.started_at_ms as i64).map(|d| d.to_rfc3339()),
        imagens: 0,
        diff: None,
    }
}

/// Recorta uma página de itens já em ordem e numera as mensagens `<conversa>:<n>` pela posição na
/// conversa inteira — a numeração é o que o cliente usa para saber se algo novo chegou.
pub fn page(conversation_id: &str, itens: Vec<(String, crate::feed::Item)>, cursor: Option<usize>, limit: usize) -> Timeline {
    let limit = limit.clamp(1, PAGE_MAX);
    let total = itens.len();
    let inicio = match cursor { Some(inicio) => inicio.min(total), None => total.saturating_sub(limit) };
    let fim = (inicio + limit).min(total);
    let messages = itens.into_iter().enumerate().skip(inicio).take(fim - inicio).map(|(n, (provider, item))| Message {
        id: format!("{conversation_id}:{n}"),
        role: item.role,
        text: item.text,
        provider,
        timestamp: item.timestamp,
        kind: item.kind,
        tool: item.tool,
        imagens: item.imagens,
        diff: item.diff,
    }).collect();
    Timeline {
        messages,
        next_cursor: (cursor.is_some() && fim < total).then_some(fim),
        prev_cursor: (inicio > 0).then(|| inicio.saturating_sub(limit)),
        unavailable_segments: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test] fn text_only_and_provider_formats() {
        assert_eq!(text_message(&json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"oi"}]}}),"codex"),Some(("assistant".into(),"oi".into())));
        assert!(text_message(&json!({"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"secret"}]}}),"claude").is_none());
    }

    fn conversa_com_transcript(dir: &std::path::Path, linhas: &[serde_json::Value]) -> Conversation {
        let transcript = dir.join("t.jsonl");
        std::fs::write(&transcript, linhas.iter().map(|l| l.to_string()).collect::<Vec<_>>().join("
")).unwrap();
        Conversation {
            id: "c".into(), project_id: "p".into(), cwd: "C:/t".into(),
            title: "Conversa".into(), title_source: TitleSource::Auto, created_at_ms: 0,
            segments: vec![Segment { provider: "claude".into(), profile_id: Some("p".into()), external_session_id: None,
                transcript_path: Some(transcript.to_string_lossy().into_owned()), terminal_session_id: None,
                started_at_ms: 0, ended_at_ms: None, historico_ate_ms: None }],
        }
    }

    /// Conversa passada de uma conta para outra: o chat mostra a troca no ponto em que aconteceu,
    /// mesmo antes de a conta nova gravar a primeira mensagem.
    #[test] fn troca_de_conta_aparece_no_chat() {
        let dir = tempfile::tempdir().unwrap();
        let mut conversa = conversa_com_transcript(dir.path(), &[
            json!({"type":"user","uuid":"u1","message":{"role":"user","content":"oi"}}),
        ]);
        conversa.segments.push(Segment { provider: "claude".into(), profile_id: Some("q".into()), external_session_id: None,
            transcript_path: Some(dir.path().join("ainda-nao-existe.jsonl").to_string_lossy().into_owned()), terminal_session_id: None,
            started_at_ms: 1_000, ended_at_ms: None, historico_ate_ms: None });
        let perfis: Vec<crate::Profile> = serde_json::from_value(json!([
            {"id":"p","provider":"claude","name":"Padrão","config_dir":"x","created_at_ms":0},
            {"id":"q","provider":"claude","name":"EmailUber","config_dir":"y","created_at_ms":0}])).unwrap();
        let t = timeline(&conversa, &perfis, None, 50);
        let ultima = t.messages.last().unwrap();
        assert_eq!(ultima.text, "Conta trocada: Padrão → EmailUber");
        assert_eq!(ultima.kind, crate::feed::Kind::Notice);
    }

    /// O caso real: voltar para uma conta grava no mesmo `.jsonl`. O aviso fica entre as mensagens
    /// certas (pela hora), ida-e-volta seguida vira um aviso só e voltar à mesma conta não aparece.
    #[test] fn aviso_de_troca_entra_pela_hora_e_nao_fica_preso_no_fim() {
        let dir = tempfile::tempdir().unwrap();
        let msg = |uuid: &str, papel: &str, hora: &str, texto: &str| json!({"type":papel,"uuid":uuid,"timestamp":hora,
            "message":{"role":papel,"content":[{"type":"text","text":texto}]}});
        let mut conversa = conversa_com_transcript(dir.path(), &[
            msg("u1","user","2026-10-12T10:00:00Z","primeira"),
            msg("u2","user","2026-10-15T10:00:00Z","segunda"),
            msg("u3","user","2026-10-17T10:00:00Z","de hoje"),
        ]);
        let caminho = conversa.segments[0].transcript_path.clone();
        let ms = |t: &str| chrono::DateTime::parse_from_rfc3339(t).unwrap().timestamp_millis() as u64;
        let seg = |perfil: &str, inicio: u64| Segment { provider: "claude".into(), profile_id: Some(perfil.into()), external_session_id: None,
            transcript_path: caminho.clone(), terminal_session_id: None, started_at_ms: inicio, ended_at_ms: None, historico_ate_ms: None };
        conversa.segments.push(seg("q", ms("2026-10-12T11:00:00Z")));
        // Três trocas em segundos no dia 15: viram um aviso só (EmailUber → Padrão).
        conversa.segments.push(seg("p", ms("2026-10-15T11:00:00Z")));
        conversa.segments.push(seg("q", ms("2026-10-15T11:00:05Z")));
        conversa.segments.push(seg("p", ms("2026-10-15T11:00:09Z")));
        let pasta = dir.path().to_string_lossy();
        let perfis: Vec<crate::Profile> = serde_json::from_value(json!([
            {"id":"p","provider":"claude","name":"Padrão","config_dir":pasta,"created_at_ms":0},
            {"id":"q","provider":"claude","name":"EmailUber","config_dir":pasta,"created_at_ms":0}])).unwrap();
        let textos: Vec<String> = timeline(&conversa, &perfis, None, 50).messages.into_iter().map(|m| m.text).collect();
        assert_eq!(textos, ["primeira", "Conta trocada: Padrão → EmailUber", "segunda", "Conta trocada: EmailUber → Padrão", "de hoje"]);
    }

    /// O nome da aba sai do **primeiro prompt**: é o que diz de que conversa se trata, e é o que o
    /// usuário reconhece ao voltar dias depois.
    #[test] fn nome_automatico_vem_do_primeiro_prompt_do_usuario() {
        let dir = tempfile::tempdir().unwrap();
        let conversa = conversa_com_transcript(dir.path(), &[
            json!({"type":"user","message":{"role":"user","content":"<command-name>/init</command-name>"}}),
            json!({"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"claro"}]}}),
            json!({"type":"user","message":{"role":"user","content":"Corrigir o login que quebra no Safari
segunda linha"}}),
        ]);
        // Mensagem de sistema da própria CLI não conta; do prompt de verdade saem as palavras de
        // conteúdo, sem o verbo do pedido nem conectivo.
        assert_eq!(display_title(&conversa), "Login Quebra Safari");
    }

    #[test] fn titulo_curto_fica_com_ate_tres_palavras_de_conteudo() {
        assert_eq!(titulo_curto("quero ajustar tambem os titulos das conversas que tao ficando muito extensos").as_deref(), Some("Titulos Conversas Extensos"));
        assert_eq!(titulo_curto("eu falei abrir o SIAPLUS no App.tsx").as_deref(), Some("Abrir SIAPLUS App.tsx"));
        assert_eq!(titulo_curto("```\ncodigo colado\n```\nexplica isso").as_deref(), Some("Explica"));
        assert_eq!(titulo_curto("e o que"), None);
    }

    #[test] fn nome_longo_e_cortado_e_conversa_vazia_mantem_o_provisorio() {
        let dir = tempfile::tempdir().unwrap();
        let longo = "a".repeat(200);
        let conversa = conversa_com_transcript(dir.path(), &[
            json!({"type":"user","message":{"role":"user","content":longo}}),
        ]);
        let titulo = display_title(&conversa);
        assert_eq!(titulo.chars().count(), PALAVRA_MAX);

        let vazia = conversa_com_transcript(dir.path(), &[]);
        assert_eq!(display_title(&vazia), "Conversa");
    }

    #[test]
    fn codex_descobre_o_rollout_e_usa_o_primeiro_prompt_como_nome() {
        let dir = tempfile::tempdir().unwrap();
        let sessions = dir.path().join("sessions").join("1970").join("01").join("01");
        std::fs::create_dir_all(&sessions).unwrap();
        let distante = sessions.join("rollout-distante.jsonl");
        let correto = sessions.join("rollout-correto.jsonl");
        std::fs::write(&distante, [
            json!({"type":"session_meta","payload":{"id":"distante","cwd":"C:/projeto","timestamp":"1970-01-01T00:00:50Z"}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Prompt errado"}]}}),
        ].iter().map(Value::to_string).collect::<Vec<_>>().join("\n")).unwrap();
        std::fs::write(&correto, [
            json!({"type":"session_meta","payload":{"id":"codex-1","cwd":"C:\\projeto","timestamp":"1970-01-01T00:00:10Z"}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>injetado</environment_context>"}]}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions\ninjetado"}]}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Implementar busca por cliente\ncom filtros"}]}}),
        ].iter().map(Value::to_string).collect::<Vec<_>>().join("\n")).unwrap();

        let profile = crate::Profile { id:"codex-p".into(),provider:"codex".into(),name:"Codex".into(),
            config_dir:dir.path().to_string_lossy().into_owned(),builtin:true,created_at_ms:0,last_used_at_ms:None,authenticated:false,email:None };
        let mut conversations = vec![Conversation { id:"c".into(),project_id:"p".into(),cwd:"C:/projeto".into(),
            title:"Projeto · novo agente".into(),title_source:TitleSource::Auto,created_at_ms:9_000,
            segments:vec![Segment { provider:"codex".into(),profile_id:Some("codex-p".into()),external_session_id:None,
                transcript_path:None,terminal_session_id:Some("t".into()),started_at_ms:9_000,ended_at_ms:None,historico_ate_ms:None }] }];

        assert!(discover_codex_transcripts(&mut conversations, &[profile]));
        assert_eq!(conversations[0].segments[0].external_session_id.as_deref(), Some("codex-1"));
        assert_eq!(Path::new(conversations[0].segments[0].transcript_path.as_deref().unwrap()), correto.canonicalize().unwrap());
        assert_eq!(display_title(&conversations[0]), "Busca Cliente Filtros");
        assert!(!discover_codex_transcripts(&mut conversations, &[]), "ponteiro já conhecido não deve ser redescoberto");
    }

    /// Renomear trava o automático: o nome escrito à mão não pode ser trocado pelo primeiro prompt
    /// na leitura seguinte.
    #[test] fn renomear_trava_o_nome_automatico() {
        let dir = tempfile::tempdir().unwrap();
        let conversa = conversa_com_transcript(dir.path(), &[
            json!({"type":"user","message":{"role":"user","content":"Corrigir o login"}}),
        ]);
        write_index(dir.path(), &[conversa]).unwrap();

        let renomeada = rename(dir.path(), "c", "  Refatorar autenticação  ").unwrap();
        assert_eq!(renomeada.title, "Refatorar autenticação");
        assert_eq!(renomeada.title_source, TitleSource::Manual);
        assert_eq!(display_title(&read_index(dir.path())[0]), "Refatorar autenticação");

        assert!(rename(dir.path(), "c", "  ").is_err());
        assert!(rename(dir.path(), "c", "nome
com quebra").is_err());
        assert!(rename(dir.path(), "outra", "x").is_err());
    }

    #[test] fn pagination_deduplicates_copied_claude_messages_and_rejects_outside_profile() {
        let dir = tempfile::tempdir().unwrap();
        let transcript = dir.path().join("transcript.jsonl");
        std::fs::write(&transcript,(0..105).map(|i|json!({"uuid":format!("m{i}"),"type":"user","message":{"role":"user","content":format!("message {i}")}}).to_string()).collect::<Vec<_>>().join("\n")).unwrap();
        let profile = crate::Profile{id:"p".into(),provider:"claude".into(),name:"Test".into(),config_dir:dir.path().to_string_lossy().into_owned(),builtin:false,created_at_ms:0,last_used_at_ms:None,authenticated:false,email:None};
        let segment = Segment{provider:"claude".into(),profile_id:Some("p".into()),external_session_id:None,transcript_path:Some(transcript.to_string_lossy().into_owned()),terminal_session_id:None,started_at_ms:0,ended_at_ms:None,historico_ate_ms:None};
        let conversation = Conversation{id:"c".into(),project_id:"project".into(),cwd:"C:/test".into(),title:"test".into(),title_source:TitleSource::default(),created_at_ms:0,segments:vec![segment.clone(),segment]};
        let first = timeline(&conversation,std::slice::from_ref(&profile),Some(0),100);
        assert_eq!(first.messages.len(),100); assert_eq!(first.next_cursor,Some(100)); assert!(first.prev_cursor.is_none());
        let second = timeline(&conversation,std::slice::from_ref(&profile),Some(100),100);
        assert_eq!(second.messages.len(),5); assert!(second.next_cursor.is_none()); assert_eq!(second.prev_cursor,Some(0));
        let wrong = crate::Profile{config_dir:dir.path().join("other").to_string_lossy().into_owned(),..profile};
        assert_eq!(timeline(&conversation,&[wrong],Some(0),100).unavailable_segments,vec![0,1]);
    }

    /// Caso real (conversa "PRINCIPAL"): conta A → B → A. O `.jsonl` da A, lido primeiro, já tem a
    /// mensagem de hoje; o da B tem uma de dias antes que a A não tem. Ela não pode fechar o chat.
    #[test] fn ida_e_volta_de_conta_mantem_o_chat_em_ordem_de_hora() {
        let dir = tempfile::tempdir().unwrap();
        let linha = |uuid: &str, hora: &str, texto: &str| json!({"uuid":uuid,"type":"user","timestamp":hora,"message":{"role":"user","content":texto}}).to_string();
        let a = dir.path().join("a.jsonl");
        std::fs::write(&a, [linha("1","2026-10-19T10:00:00Z","antigo"), linha("3","2026-10-21T03:15:00Z","ola")].join("\n")).unwrap();
        let b = dir.path().join("b.jsonl");
        std::fs::write(&b, [linha("1","2026-10-19T10:00:00Z","antigo"), linha("2","2026-10-20T02:15:00Z","so na outra conta")].join("\n")).unwrap();
        let profile = crate::Profile{id:"p".into(),provider:"claude".into(),name:"Test".into(),config_dir:dir.path().to_string_lossy().into_owned(),builtin:false,created_at_ms:0,last_used_at_ms:None,authenticated:false,email:None};
        let seg = |caminho: &Path| Segment{provider:"claude".into(),profile_id:Some("p".into()),external_session_id:None,transcript_path:Some(caminho.to_string_lossy().into_owned()),terminal_session_id:None,started_at_ms:0,ended_at_ms:None,historico_ate_ms:None};
        let conversa = Conversation{id:"c".into(),project_id:"project".into(),cwd:"C:/test".into(),title:"t".into(),title_source:TitleSource::Manual,created_at_ms:0,segments:vec![seg(&a),seg(&b),seg(&a)]};
        let textos: Vec<_> = timeline(&conversa,std::slice::from_ref(&profile),None,100).messages.into_iter().map(|m| m.text).collect();
        assert_eq!(textos, ["antigo","so na outra conta","ola"]);
    }

    /// Fork: antes da primeira mensagem a cópia não tem arquivo e a conversa mostra o histórico da
    /// original. O que a original ganhou depois do fork não entra, e o que foi copiado não duplica.
    #[test] fn fork_mostra_o_historico_da_original_ate_o_fork() {
        let dir = tempfile::tempdir().unwrap();
        let linha = |uuid: &str, hora: &str, texto: &str| json!({"uuid":uuid,"type":"user","timestamp":hora,"message":{"role":"user","content":texto}}).to_string();
        let original = dir.path().join("original.jsonl");
        std::fs::write(&original, [linha("a","2026-10-19T10:00:00Z","antes"), linha("b","2026-10-19T12:00:00Z","depois do fork, na original")].join("\n")).unwrap();
        let copia = dir.path().join("copia.jsonl");
        let fork = chrono::DateTime::parse_from_rfc3339("2026-10-19T11:00:00Z").unwrap().timestamp_millis() as u64;
        let profile = crate::Profile{id:"p".into(),provider:"claude".into(),name:"Test".into(),config_dir:dir.path().to_string_lossy().into_owned(),builtin:false,created_at_ms:0,last_used_at_ms:None,authenticated:false,email:None};
        let seg = |caminho: &Path, ate: Option<u64>| Segment{provider:"claude".into(),profile_id:Some("p".into()),external_session_id:None,transcript_path:Some(caminho.to_string_lossy().into_owned()),terminal_session_id:None,started_at_ms:fork,ended_at_ms:None,historico_ate_ms:ate};
        let conversa = Conversation{id:"c".into(),project_id:"project".into(),cwd:"C:/test".into(),title:"fork".into(),title_source:TitleSource::Manual,created_at_ms:fork,segments:vec![seg(&original,Some(fork)),seg(&copia,None)]};
        let textos = || timeline(&conversa,std::slice::from_ref(&profile),None,100).messages.into_iter().map(|m| m.text).collect::<Vec<_>>();

        assert_eq!(textos(), ["antes"]);
        std::fs::write(&copia, [linha("a","2026-10-19T10:00:00Z","antes"), linha("c","2026-10-19T11:30:00Z","nova no fork")].join("\n")).unwrap();
        assert_eq!(textos(), ["antes", "nova no fork"]);
    }

    /// O chat abre no fim: sem cursor vêm as últimas mensagens, com a mais nova por último, e o
    /// cursor para buscar as anteriores. Os ids batem com os da leitura paginada.
    #[test] fn sem_cursor_devolve_o_fim_da_conversa() {
        let dir = tempfile::tempdir().unwrap();
        let transcript = dir.path().join("transcript.jsonl");
        std::fs::write(&transcript,(0..250).map(|i|json!({"uuid":format!("m{i}"),"type":"user","message":{"role":"user","content":format!("message {i}")}}).to_string()).collect::<Vec<_>>().join("\n")).unwrap();
        let profile = crate::Profile{id:"p".into(),provider:"claude".into(),name:"Test".into(),config_dir:dir.path().to_string_lossy().into_owned(),builtin:false,created_at_ms:0,last_used_at_ms:None,authenticated:false,email:None};
        let segment = Segment{provider:"claude".into(),profile_id:Some("p".into()),external_session_id:None,transcript_path:Some(transcript.to_string_lossy().into_owned()),terminal_session_id:None,started_at_ms:0,ended_at_ms:None,historico_ate_ms:None};
        let conversation = Conversation{id:"c".into(),project_id:"project".into(),cwd:"C:/test".into(),title:"test".into(),title_source:TitleSource::default(),created_at_ms:0,segments:vec![segment]};

        let fim = timeline(&conversation,std::slice::from_ref(&profile),None,100);
        assert_eq!(fim.messages.len(),100);
        assert_eq!(fim.messages.first().unwrap().text,"message 150");
        assert_eq!(fim.messages.last().unwrap().text,"message 249");
        assert!(fim.next_cursor.is_none());
        assert_eq!(fim.prev_cursor,Some(50));

        let antes = timeline(&conversation,std::slice::from_ref(&profile),fim.prev_cursor,100);
        assert_eq!(antes.messages.first().unwrap().text,"message 50");
        assert_eq!(antes.next_cursor,Some(150));
        assert_eq!(antes.prev_cursor,Some(0));
        assert_eq!(antes.messages[0].id,"c:50");
        assert_eq!(fim.messages[0].id,"c:150");

        // Conversa curta: tudo numa página, sem nada antes.
        let curta = timeline(&conversation,std::slice::from_ref(&profile),None,500);
        assert_eq!(curta.messages.len(),PAGE_MAX, "limite continua travado em PAGE_MAX");
    }

    /// Conversa recém-aberta: caminho do transcript já fixado, arquivo ainda não gravado. Isso é
    /// "sem mensagens ainda", não "histórico indisponível" — que era o aviso que o celular mostrava.
    #[test] fn transcript_ainda_nao_gravado_e_vazio_e_nao_indisponivel() {
        let dir = tempfile::tempdir().unwrap();
        let profile = crate::Profile{id:"p".into(),provider:"claude".into(),name:"Test".into(),config_dir:dir.path().to_string_lossy().into_owned(),builtin:true,created_at_ms:0,last_used_at_ms:None,authenticated:false,email:None};
        let futuro = dir.path().join("projects").join("x").join("ainda-nao-existe.jsonl");
        let segment = Segment{provider:"claude".into(),profile_id:Some("p".into()),external_session_id:Some("s".into()),transcript_path:Some(futuro.to_string_lossy().into_owned()),terminal_session_id:None,started_at_ms:0,ended_at_ms:None,historico_ate_ms:None};
        let conversation = Conversation{id:"c".into(),project_id:"project".into(),cwd:"C:/test".into(),title:"test".into(),title_source:TitleSource::default(),created_at_ms:0,segments:vec![segment]};
        let vazia = timeline(&conversation,std::slice::from_ref(&profile),None,100);
        assert!(vazia.messages.is_empty());
        assert!(vazia.unavailable_segments.is_empty(),"arquivo ainda não gravado não é histórico perdido");
    }
}

#[cfg(test)]
mod slug_tests {
    use super::*;

    #[test]
    fn slug_matches_the_layout_claude_uses_on_disk() {
        // Conferido contra ~/.claude/projects nesta máquina.
        assert_eq!(
            claude_project_slug(r"D:\PROGRAMACAO\PROJETOS\PROJETOS_REACT\OMNI-AGENTS"),
            "D--PROGRAMACAO-PROJETOS-PROJETOS-REACT-OMNI-AGENTS"
        );
        assert_eq!(claude_project_slug(r"C:\Users\Felipe Campos"), "C--Users-Felipe-Campos");
        // Barra final não pode gerar um sufixo a mais.
        assert_eq!(claude_project_slug(r"C:\Users\dev\"), "C--Users-dev");
    }
}
