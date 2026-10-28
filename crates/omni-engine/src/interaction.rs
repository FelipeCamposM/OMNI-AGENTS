//! Typed actions over existing PTYs. Recognition deliberately fails closed.
use super::*;
use omni_core::usage::{AccountUsage, parse_claude_screen};
use std::{collections::hash_map::DefaultHasher, hash::{Hash, Hasher}, time::{Duration, Instant}};

/// `turn_active`: o agente mostrou sinal de turno (hint de interromper ou diálogo de aprovação) desde
/// o último fim de turno. É o que separa "terminou" de "está ocioso" em `settle`.
/// `aprovacao_contada`: o diálogo de aprovação na tela já virou aviso (`attention_seq`). A TUI
/// redesenha o diálogo em pedaços, e um quadro parcial não é reconhecido — sem esta trava, cada
/// redesenho contava um pedido novo e o aviso já visto voltava sozinho.
///
/// `avisos_antes_do_turno`: quantos avisos (limite, erro de API) já estavam na tela quando o turno
/// atual começou. Só os que aparecerem depois disso são deste turno — ver `notice_since`.
///
/// `turnos_iniciados`: antes do primeiro turno, nada na tela é aviso novo — ver `append_output`.
pub struct Interaction { pub parser: vt100::Parser, pub input_revision: u64, pub turn_active: bool, pub aprovacao_contada: bool, pub avisos_antes_do_turno: (usize, usize), pub turnos_iniciados: u64, generation: u64 }
impl Interaction {
    pub fn new(rows: u16, cols: u16) -> Self { Self { parser: vt100::Parser::new(rows,cols,0), input_revision: 0, turn_active: false, aprovacao_contada: false, avisos_antes_do_turno: (0, 0), turnos_iniciados: 0, generation: rand::random() } }
    pub fn revision(&self, session: &Arc<LiveSession>) -> String {
        let mut hash = DefaultHasher::new();
        self.parser.screen().contents().hash(&mut hash);
        self.input_revision.hash(&mut hash);
        self.generation.hash(&mut hash);
        (Arc::as_ptr(session) as usize).hash(&mut hash);
        format!("\"{:x}\"",hash.finish())
    }
}

#[derive(Clone, serde::Serialize)]
pub struct Capabilities {
    pub prompt: bool, pub approve: bool, pub revision: String, pub approval_text: Option<String>, pub reason: Option<String>,
    /// O agente está no meio de um turno, mas o campo da CLI está vazio e aceita digitação: uma
    /// mensagem mandada agora entra na fila da própria CLI, como digitar no terminal.
    #[serde(default)]
    pub enfileirar: bool,
    /// Menu de escolha da própria CLI na tela (ex.: "Teach auto mode about your environment?"): sem
    /// responder, o campo fica travado. A conversa mostra as opções e manda o número.
    pub escolha: Option<Escolha>,
    /// O processo do agente ainda não está rodando na PTY (o shell acabou de abrir e o
    /// `claude --resume` está sendo digitado). A conversa mostra "abrindo" em vez de "não reconhecida".
    pub iniciando: bool,
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Escolha {
    pub pergunta: String,
    /// Texto entre a pergunta e as opções, uma linha da tela por linha.
    pub detalhe: Option<String>,
    pub opcoes: Vec<Opcao>,
    /// Marcar várias (AskUserQuestion com `multiSelect`): o número marca/desmarca e "avançar" (Tab)
    /// segue para a próxima pergunta ou para a revisão.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub multipla: bool,
    /// Abas de várias perguntas seguidas ("☐ Cor  ☒ Fruta"), sem a de enviar.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub etapas: Vec<Etapa>,
    /// Pergunta com prévia ("n to add notes"): ali o número só move a seleção, e é o Enter que escolhe.
    #[serde(skip)]
    pub previa: bool,
    /// Menu sem números, só de setas ("❯ Autocompact at 400k" / "Keep auto"): qual opção está marcada
    /// agora. A resposta anda com ↑/↓ dela até a pedida e confirma com Enter.
    #[serde(skip)]
    pub setas: Option<u8>,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Opcao {
    pub numero: u8,
    pub rotulo: String,
    /// A linha de explicação embaixo da opção, quando o agente escreveu uma.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub descricao: Option<String>,
    /// Só em `multipla`: se está marcada agora.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub marcada: Option<bool>,
}
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Etapa { pub titulo: String, pub respondida: bool }

/// Texto da tela com uma linha por linha do terminal. O `contents()` junta linha que quebrou por
/// largura com a de baixo — a pergunta do agente ocupa a largura toda e a opção "1." colava nela,
/// e o menu inteiro deixava de ser reconhecido.
pub fn linha_a_linha(screen: &vt100::Screen) -> String {
    screen.rows(0, screen.size().1).collect::<Vec<_>>().join("\n")
}

/// Menu numerado da CLI com o rodapé "Enter to confirm · Esc to cancel": a caixa vai da última
/// linha de borda (`────`) acima do rodapé até ele. Precisa de pelo menos duas opções numeradas em
/// sequência a partir de 1. Pedido de permissão ("Do you want to…") fica de fora: é o `approval`,
/// que só aceita as escolhas de uso único — a conversa nunca manda "não perguntar de novo".
pub fn escolha(text: &str) -> Option<Escolha> {
    escolha_numerada(text).or_else(|| escolha_por_setas(text))
}

/// Menu de setas sem números do Claude Code (ex.: "We recommend compacting earlier", rodapé
/// "↑/↓ choose · ←/→ change size · enter confirm · esc not now"). Sem reconhecer, o campo ficava
/// travado e a conversa dizia "entrada não reconhecida". As opções são o bloco de linhas em volta
/// da marcada com `❯`; a pergunta, o texto entre a borda de cima e esse bloco.
fn escolha_por_setas(text: &str) -> Option<Escolha> {
    let linhas: Vec<&str> = text.lines().collect();
    let borda = |linha: &str| { let linha = linha.trim(); linha.chars().count() >= 10 && linha.chars().all(|c| c == '─') };
    let rodape = linhas.iter().rposition(|linha| {
        let linha = linha.to_lowercase();
        linha.contains('↑') && linha.contains("enter") && linha.contains("esc")
    })?;
    let marcada = linhas[..rodape].iter().rposition(|l| l.trim_start().starts_with('❯'))?;
    let parte_do_bloco = |l: &str| !l.trim().is_empty() && !borda(l);
    let inicio = linhas[..marcada].iter().rposition(|l| !parte_do_bloco(l)).map_or(0, |i| i + 1);
    let fim = linhas[marcada..rodape].iter().position(|l| !parte_do_bloco(l)).map_or(rodape, |i| marcada + i);
    let opcoes: Vec<Opcao> = linhas[inicio..fim].iter().enumerate().map(|(i, l)| Opcao {
        numero: i as u8 + 1, rotulo: l.trim().trim_start_matches('❯').trim().to_owned(), descricao: None, marcada: None,
    }).collect();
    // Menu numerado já é do `escolha_numerada`; `❯ 1. …` aqui seria um dele que não bateu.
    if opcoes.len() < 2 || opcoes.len() > 9 || opcoes.iter().any(|o| o.rotulo.split_once(". ").is_some_and(|(n, _)| n.parse::<u8>().is_ok())) { return None; }
    let topo = linhas[..inicio].iter().rposition(|l| borda(l)).map_or(0, |i| i + 1);
    let texto: Vec<&str> = linhas[topo..inicio].iter().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    if texto.iter().any(|l| l.contains("Do you want to")) { return None; }
    let (pergunta, detalhe) = texto.split_first()?;
    let detalhe = detalhe.join("\n");
    Some(Escolha { pergunta: (*pergunta).to_owned(), detalhe: (!detalhe.is_empty()).then_some(detalhe), opcoes,
        multipla: false, etapas: Vec::new(), previa: false, setas: Some((marcada - inicio) as u8 + 1) })
}

fn escolha_numerada(text: &str) -> Option<Escolha> {
    // Linha da largura do terminal quebra sem `\n` no texto da tela e cola na de baixo: a borda
    // gruda na barra de abas ("────… ☐ Cor") e, depois de um turno, também no prompt destacado de
    // cima ("❯ manda de novo…   ────… ☐ Cor"). Cada sequência longa de `─` vira linha própria.
    let linhas: Vec<&str> = text.lines().flat_map(|linha| {
        let mut partes = Vec::new();
        let mut resto = linha;
        while let Some(inicio) = resto.find("──────────") {
            let fim = resto[inicio..].find(|c| c != '─').map_or(resto.len(), |i| inicio + i);
            if !resto[..inicio].trim().is_empty() { partes.push(&resto[..inicio]); }
            partes.push(&resto[inicio..fim]);
            resto = &resto[fim..];
        }
        if partes.is_empty() || !resto.trim().is_empty() { partes.push(resto); }
        partes
    }).collect();
    let borda = |linha: &str| { let linha = linha.trim(); linha.chars().count() >= 10 && linha.chars().all(|c| c == '─') };
    // Pergunta com prévia (`preview` do AskUserQuestion): o desenho fica à direita das opções, na
    // mesma linha ("1. Lado a lado     ┌────┐"), e embaixo delas ("│ | claude | │"). Corta no
    // primeiro caractere de caixa ou num vão largo.
    const CAIXA: [char; 11] = ['│', '┌', '┐', '└', '┘', '├', '┤', '┬', '┴', '┼', '─'];
    let sem_previa = |texto: &str| -> String {
        let fim = [texto.find(CAIXA), texto.find("   ")].into_iter().flatten().min().unwrap_or(texto.len());
        texto[..fim].trim().to_owned()
    };
    let opcao = |linha: &str| -> Option<Opcao> {
        let linha = linha.trim().trim_start_matches(['❯', '›', '>']).trim();
        let (numero, rotulo) = linha.split_once(". ")?;
        let numero: u8 = numero.parse().ok()?;
        let rotulo = sem_previa(rotulo);
        let rotulo = rotulo.as_str();
        // Caixa de marcar ("[ ] Uva", "[✔] Uva"): vira `marcada`.
        let (marcada, rotulo) = match rotulo.strip_prefix('[').and_then(|r| r.split_once("] ")) {
            Some((dentro, resto)) if dentro.chars().count() == 1 => (Some(dentro != " "), resto.trim()),
            _ => (None, rotulo),
        };
        (!rotulo.is_empty()).then(|| Opcao { numero, rotulo: rotulo.to_owned(), descricao: None, marcada })
    };
    let rodape = linhas.iter().rposition(|linha| {
        let linha = linha.trim().to_lowercase();
        (linha.contains("esc to cancel") && linha.contains("enter"))
            // Antigravity: "↑/↓ Navigate · enter Select · esc Skip".
            || (linha.contains("enter select") && linha.contains("navigate"))
    }).or_else(|| {
        // Revisão no fim de várias perguntas ("Submit answers / Cancel") vem sem rodapé: a caixa vai
        // até a última opção depois de "Ready to submit your answers?".
        let pronto = linhas.iter().rposition(|l| l.trim() == "Ready to submit your answers?")?;
        (pronto + 1..linhas.len()).filter(|&i| opcao(linhas[i]).is_some()).last().map(|i| i + 1)
    })?;
    // A caixa começa na borda acima da opção 1: a pergunta do agente (AskUserQuestion) tem outra
    // borda antes de "Chat about this", e começar na última deixava só essa opção.
    let um = linhas[..rodape].iter().rposition(|l| opcao(l).is_some_and(|o| o.numero == 1))?;
    let inicio = linhas[..um].iter().rposition(|l| borda(l)).map(|i| i + 1).unwrap_or(um.saturating_sub(20));
    let caixa: Vec<&str> = linhas[inicio..rodape].iter().copied().filter(|l| !borda(l)).collect();
    if caixa.iter().any(|l| l.contains("Do you want to")) { return None; }
    // Opções só da opção 1 para baixo: o que vem antes é a pergunta, mesmo que tenha lista numerada.
    let primeira = caixa.iter().rposition(|l| opcao(l).is_some_and(|o| o.numero == 1))?;
    // Cada opção com a explicação das linhas de baixo (até a próxima opção). Uma borda encerra a
    // explicação: o que vem depois dela ("Chat about this" sem número, na prévia) não é da opção.
    let mut todas: Vec<Opcao> = Vec::new();
    let mut explicando = false;
    for linha in &linhas[um..rodape] {
        if borda(linha) { explicando = false; continue; }
        match opcao(linha) {
            Some(nova) => { todas.push(nova); explicando = true; }
            None => if let (true, Some(atual)) = (explicando, todas.last_mut()) {
                let texto = sem_previa(linha.trim());
                if !texto.is_empty() && !texto.starts_with("Notes:") {
                    atual.descricao = Some(match atual.descricao.take() { Some(antes) => format!("{antes} {texto}"), None => texto });
                }
            },
        }
    }
    if todas.len() < 2 || todas.len() > 9 || todas.iter().enumerate().any(|(i, o)| o.numero as usize != i + 1) { return None; }
    let multipla = todas.iter().any(|o| o.marcada.is_some());
    // "Type something" abre um campo de texto dentro do menu, que a conversa não preenche; para
    // responder livre existe "Chat about this", que volta ao campo normal. A linha "Submit" do
    // marcar-várias fica pendurada nele e some junto.
    // "Write-in..." é o mesmo campo livre no Antigravity.
    let opcoes: Vec<Opcao> = todas.into_iter().filter(|o| !o.rotulo.starts_with("Type something") && !o.rotulo.starts_with("Write-in")).collect();
    // A barra de abas das perguntas ("← ☐ Cor  ☒ Fruta  ✔ Submit →") não é texto da pergunta; as
    // respostas da revisão ("→ Azul") são, e vão no detalhe.
    let aba = |l: &str| l.contains(['☐', '☒', '✔']);
    let etapas: Vec<Etapa> = caixa[..primeira].iter().find(|l| aba(l)).map(|barra| {
        barra.split(['☐', '☒']).skip(1).zip(barra.match_indices(['☐', '☒']))
            .map(|(resto, (_, marca))| Etapa {
                titulo: resto.split("  ").next().unwrap_or("").split('✔').next().unwrap_or("").trim().to_owned(),
                respondida: marca == "☒",
            })
            .filter(|e| !e.titulo.is_empty()).collect()
    }).filter(|e: &Vec<Etapa>| e.len() > 1).unwrap_or_default();
    let mut textos = caixa[..primeira].iter().filter(|l| !aba(l)).map(|l| l.trim()).filter(|l| !l.is_empty());
    // Antigravity numera as perguntas ("Question 1/1: O que…"): a numeração não é texto da pergunta.
    let pergunta = textos.next()?;
    let pergunta = pergunta.strip_prefix("Question ").and_then(|resto| resto.split_once(": "))
        .filter(|(n, _)| n.contains('/') && n.chars().all(|c| c.is_ascii_digit() || c == '/'))
        .map_or(pergunta, |(_, texto)| texto).to_owned();
    let detalhe = textos.collect::<Vec<_>>().join("\n");
    let previa = linhas[um..].iter().take(rodape + 1 - um).any(|l| l.contains("to add notes"));
    Some(Escolha { pergunta, detalhe: (!detalhe.is_empty()).then_some(detalhe), opcoes, multipla, etapas, previa, setas: None })
}

/// Require provider chrome plus an empty composer at the actual terminal cursor.
pub fn ready(screen: &vt100::Screen, provider: &str) -> bool {
    let text = screen.contents();
    // "Claude Code" only shows in the startup banner; it scrolls out of the visible screen after
    // the first exchange, so requiring it here made this permanently false for any session with
    // history (confirmed against a real running session — the idle composer never re-shows it).
    // The structural checks below are strict enough on their own to recognize the composer.
    // Antigravity: "? for shortcuts" no rodapé só existe parado; trabalhando vira "esc to cancel".
    // Codex: o cabeçalho "OpenAI Codex" também sai da tela depois de uma resposta comprida (conferido
    // no 0.154.0 — a conversa travava em "não reconhecida"); quem garante que é o Codex é o `provider_running`.
    let brand = match provider { "claude" | "codex" => true, "antigravity" => text.contains("? for shortcuts"), _ => false };
    brand && screen.bracketed_paste() && composer_vazio(screen)
        && !cancelavel(&text) && !area_do_turno(&text).contains("esc to interrupt")
        && approval(&text,provider).is_none()
}

/// "Esc to cancel" de menu aberto ou do Antigravity trabalhando: só na área do turno e fora das
/// falas do histórico. O aviso "● Usage limit reached · … · esc to cancel" ficava na tela depois do
/// /compact e a conversa travava em "não reconhecida" com o campo vazio logo embaixo.
fn cancelavel(texto: &str) -> bool {
    area_do_turno(texto).lines().filter(|l| !l.trim_start().starts_with(['●', '⏺']))
        .any(|l| l.to_lowercase().contains("esc to cancel"))
}

/// Turno parado com texto sobrando no campo: o Esc antes de a CLI ler o prompt devolve o texto ao
/// campo, e campo com texto não passa no `ready` ("não reconhecida" até alguém apagar no PC).
pub fn sobra_no_campo(screen: &vt100::Screen, provider: &str) -> bool {
    let text = screen.contents();
    let turno = area_do_turno(&text);
    matches!(provider, "claude" | "codex") && screen.bracketed_paste() && !composer_vazio(screen)
        && turno.lines().any(|l| { let l = l.trim_start(); l.starts_with('❯') || l.starts_with('›') })
        && !turno.to_lowercase().contains("esc to interrupt") && !cancelavel(&text)
        && approval(&text,provider).is_none()
}

/// Onde a CLI escreve o "esc to interrupt": a linha de status logo acima do campo (`✻ Mulling… (esc
/// to interrupt)`, `• Working (3s • esc to interrupt)`) e o rodapé embaixo dele. Procurar na tela
/// inteira pegava o texto da conversa — um diff de código com `"esc to interrupt"` deixava a sessão
/// "trabalhando" para sempre, mesmo parada no `done`. Sem campo à vista, as últimas linhas.
pub fn area_do_turno(texto: &str) -> String {
    let linhas: Vec<&str> = texto.lines().collect();
    let campo = linhas.iter().rposition(|l| { let l = l.trim_start(); l.starts_with('❯') || l.starts_with('›') });
    let inicio = campo.map_or(linhas.len().saturating_sub(8), |i| i.saturating_sub(4));
    linhas[inicio..].join("\n")
}

/// Turno em andamento com o campo livre: o Claude Code (e o Codex) aceitam digitar e mandar
/// durante o turno — a mensagem fica na fila e entra quando o turno acaba. É o mesmo campo vazio
/// do `ready`, só que com o "esc to interrupt" na tela em vez de proibido por ele.
pub fn pode_enfileirar(screen: &vt100::Screen, provider: &str) -> bool {
    let text = screen.contents();
    let brand = matches!(provider, "claude" | "codex");
    brand && screen.bracketed_paste() && composer_vazio(screen)
        && area_do_turno(&text).to_lowercase().contains("esc to interrupt")
        && approval(&text,provider).is_none()
}

/// Tokens do turno em andamento, como a CLI mostra na linha de status:
/// `· Propagating… (5s · ↓ 113 tokens · thinking with low effort)` → `"113"`; `"1.2k"` também vale.
/// A linha mais de baixo vence (a de cima pode ser de um turno anterior que ficou na tela).
pub fn tokens_do_turno(texto: &str) -> Option<String> {
    texto.lines().rev().find_map(|linha| {
        let fim = linha.find(" tokens").or_else(|| linha.find("tokens"))?;
        let antes = linha[..fim].trim_end();
        let seta = antes.rfind(['↓', '↑'])?;
        let numero = antes[seta..].trim_start_matches(['↓', '↑']).trim();
        (!numero.is_empty() && numero.chars().all(|c| c.is_ascii_digit() || c == '.' || c == ',' || c == 'k' || c == 'K'))
            .then(|| numero.to_owned())
    })
}

/// O campo de digitação está vazio no cursor real.
///
/// À esquerda do cursor, só o símbolo do prompt; à direita, só célula vazia ou texto `dim`. Texto
/// digitado de verdade não é `dim`, então um rascunho a meio continua bloqueando — colar um prompt no
/// meio do que a pessoa escreveu no PC seria pior que recusar.
///
/// A tolerância a `dim` cobre o exemplo em cinza que o Claude Code desenha no campo vazio
/// (`❯ Try "edit <filepath> to..."`). Na tela capturada ele já vinha apagado por um `ESC[K`
/// logo depois, então não era o que travava; a regra antiga (linha inteira igual a `❯`) quebraria
/// no dia em que o redesenho vier sem esse `ESC[K`.
/// O ConPTY escreve U+FFFD no lugar do que não converteu (acento de saída em cp1252, por exemplo).
/// O terminal desenha cada um com 1 coluna; o `vt100` com 0. A linha sai torta, o autowrap do
/// ConPTY deixa de bater e o campo do `❯` fica coberto pela borda: a conversa travava em "entrada
/// não reconhecida" até o fim da sessão. `?` ocupa a mesma coluna que o terminal mostra.
pub(crate) fn sem_substituto(bytes: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    const FFFD: &[u8] = "\u{FFFD}".as_bytes();
    if !bytes.windows(3).any(|w| w == FFFD) { return std::borrow::Cow::Borrowed(bytes); }
    let mut saida = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i..].starts_with(FFFD) { saida.push(b'?'); i += 3; } else { saida.push(bytes[i]); i += 1; }
    }
    std::borrow::Cow::Owned(saida)
}

pub(crate) fn composer_vazio(screen: &vt100::Screen) -> bool {
    let (row, col) = screen.cursor_position();
    let (_, cols) = screen.size();
    let antes = screen.contents_between(row,0,row,col);
    matches!(antes.trim(), "❯" | "›" | ">")
        // Espaço em branco conta como vazio: a 2.1.302 apaga cada palavra do exemplo em separado e deixa
        // os espaços entre elas sem `dim` — `Try "fix lint errors"` virava "rascunho" e travava a conversa.
        && (col..cols).all(|c| screen.cell(row,c).is_none_or(|cell| !cell.has_contents() || cell.dim() || cell.contents().trim().is_empty()))
}

/// Quanto esperar a colagem aparecer no campo antes de mandar o Enter assim mesmo.
const ESPERA_DA_COLAGEM: Duration = Duration::from_millis(1_200);
/// Folga depois que o texto aparece: a CLI ainda está montando o "[Pasted text #1 +N lines]" no
/// instante em que a primeira parte dele chega à tela.
const FOLGA_ANTES_DO_ENTER: Duration = Duration::from_millis(80);

/// Manda o Enter que submete um prompt **já colado** no campo.
///
/// Enter no mesmo `write` da colagem não submete: a CLI recebe tudo como uma rajada só e trata o
/// `\r` como parte do texto colado. Com uma linha isso passava despercebido; com várias (é o caso
/// de um prompt com anexos) o texto ficava digitado no terminal e nunca era enviado — e o celular
/// ficava em "trabalhando" para sempre.
///
/// Espera o texto **aparecer no campo** em vez de dormir um tempo fixo: é o sinal de que a CLI
/// terminou de processar a colagem. Fora dos locks de propósito — quem atualiza a tela é o leitor
/// da PTY, que precisa do mesmo `interaction` no intervalo.
pub fn submeter_colagem(session: &Arc<LiveSession>) -> Result<()> {
    let limite = Instant::now() + ESPERA_DA_COLAGEM;
    loop {
        let vazio = session.interaction.lock().map_err(|_| anyhow!("screen poisoned"))
            .map(|context| composer_vazio(context.parser.screen()))?;
        // Campo preenchido: a colagem chegou. Sem eco até o limite, manda assim mesmo — é o único
        // jeito de submeter, e uma CLI que não desenha o campo não pode travar o envio para sempre.
        if !vazio || Instant::now() >= limite { break; }
        std::thread::sleep(Duration::from_millis(30));
    }
    std::thread::sleep(FOLGA_ANTES_DO_ENTER);
    let mut writer = session.writer.lock().map_err(|_| anyhow!("writer poisoned"))?;
    writer.write_all(b"\r")?;
    writer.flush()?;
    Ok(())
}

/// Only single-use choices with exact labels. Persistent permission choices are never sent.
pub fn approval(text: &str, provider: &str) -> Option<(String, String, String)> {
    let lines: Vec<_> = text.lines().map(str::trim).collect();
    let (question,yes,no) = match provider {
        "claude" => ("Do you want to proceed?","1. Yes","3. No"),
        "codex" => ("Would you like to run the following command?","1. Yes, proceed (y)","3. No, and tell Codex what to do differently (esc)"),
        _ => return None,
    };
    let normalize = |line: &str| line.trim_start_matches(['❯','›',' ']).to_string();
    // The question and choices must be one contiguous dialog, not old scrollback. Everything is
    // counted from the question down: the user's own message above it also starts with `❯`/`›`, and
    // counting the whole screen made every real dialog look like it had two selections.
    let start = lines.iter().rposition(|l| *l == question)?;
    let dialog = &lines[start..];
    let selected = dialog.iter().filter(|line| line.starts_with('❯') || line.starts_with('›')).count();
    if dialog.len() > 24 || selected != 1
        || dialog.iter().filter(|l| normalize(l) == yes).count() != 1
        || dialog.iter().filter(|l| normalize(l) == no).count() != 1 { return None; }
    Some((if provider == "codex" { "y" } else { "1\r" }.into(),
        if provider == "codex" { "\x1b" } else { "3\r" }.into(),text.trim().to_owned()))
}

/// Nome do executável de cada CLI quando difere do id do provider.
fn executavel(provider: &str) -> &str {
    match provider { "antigravity" => "agy", outro => outro }
}

#[cfg(windows)]
pub fn provider_running(pid: Option<u32>, provider: &str) -> bool {
    let provider = executavel(provider);
    use windows_sys::Win32::{Foundation::{CloseHandle, INVALID_HANDLE_VALUE}, System::Diagnostics::ToolHelp::*};
    let Some(pid) = pid else { return false };
    // A PTY shell survives when its CLI exits. Confirm the CLI is still its descendant.
    unsafe {
        let handle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);
        if handle == INVALID_HANDLE_VALUE { return false; }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed(); entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut processes = HashMap::new(); let mut candidates = Vec::new();
        let mut valid = Process32FirstW(handle,&mut entry) != 0;
        while valid {
            let end = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..end]);
            processes.insert(entry.th32ProcessID,entry.th32ParentProcessID);
            if name.eq_ignore_ascii_case(&format!("{provider}.exe")) { candidates.push(entry.th32ProcessID); }
            valid = Process32NextW(handle,&mut entry) != 0;
        }
        CloseHandle(handle);
        candidates.into_iter().any(|mut child| { for _ in 0..32 {
            if child == pid { return true; }
            let Some(parent) = processes.get(&child) else { break }; if *parent == child { break; } child = *parent;
        } false })
    }
}
/// O shell tem um processo filho rodando (`npm run dev`, `node`…): silêncio aí não é "parado".
/// Shell no prompt não tem filho. conhost/OpenConsole são da ConPTY, não do usuário.
#[cfg(windows)]
pub fn has_children(pid: Option<u32>) -> bool {
    use windows_sys::Win32::{Foundation::{CloseHandle, INVALID_HANDLE_VALUE}, System::Diagnostics::ToolHelp::*};
    let Some(pid) = pid else { return false };
    unsafe {
        let handle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS,0);
        if handle == INVALID_HANDLE_VALUE { return false; }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed(); entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = false;
        let mut valid = Process32FirstW(handle,&mut entry) != 0;
        while valid && !found {
            if entry.th32ParentProcessID == pid && entry.th32ProcessID != pid {
                let end = entry.szExeFile.iter().position(|c| *c == 0).unwrap_or(entry.szExeFile.len());
                let name = String::from_utf16_lossy(&entry.szExeFile[..end]).to_ascii_lowercase();
                found = name != "conhost.exe" && name != "openconsole.exe";
            }
            valid = Process32NextW(handle,&mut entry) != 0;
        }
        CloseHandle(handle);
        found
    }
}
#[cfg(not(windows))]
pub fn has_children(pid: Option<u32>) -> bool {
    let Some(pid) = pid else { return false };
    let Ok(output) = std::process::Command::new("ps").args(["-A", "-o", "ppid="]).output() else { return false };
    String::from_utf8_lossy(&output.stdout).lines().any(|line| line.trim().parse::<u32>() == Ok(pid))
}

#[cfg(not(windows))]
pub fn provider_running(pid: Option<u32>, provider: &str) -> bool {
    let provider = executavel(provider);
    let Some(pid) = pid else { return false };
    // `ps` existe igual no macOS e no Linux (não há /proc no macOS). Duas leituras:
    // - `args`: instalado pelo npm o CLI roda como `node .../claude`, e `comm` diria só `node`;
    // - `comm`: o Claude Code troca o `process.title` pelo título da conversa, e no macOS/Linux isso
    //   reescreve o `args` ("✳ Corrigir login") — sem o `comm` (no macOS, o caminho do executável)
    //   o agente "sumia" depois do primeiro título e a conversa travava em "entrada não reconhecida".
    let ps = |coluna: &str| std::process::Command::new("ps").args(["-A", "-o", "pid=", "-o", "ppid=", "-o", coluna]).output()
        .map(|saida| String::from_utf8_lossy(&saida.stdout).into_owned()).unwrap_or_default();
    agent_descends_from(&format!("{}\n{}", ps("args="), ps("comm=")), pid, provider)
}

/// Linhas `pid ppid comando` do `ps` (de `args` e de `comm`, misturadas). O agente conta quando o
/// executável ou o script que o node roda se chama `provider` e o processo descende da PTY.
#[cfg(any(not(windows), test))]
fn agent_descends_from(ps: &str, pid: u32, provider: &str) -> bool {
    let mut parents = HashMap::new(); let mut candidates = Vec::new();
    for line in ps.lines() {
        fn campo(s: &str) -> (Result<u32, std::num::ParseIntError>, &str) { let s = s.trim_start(); let fim = s.find(char::is_whitespace).unwrap_or(s.len()); (s[..fim].parse(), &s[fim..]) }
        let (Ok(child), resto) = campo(line) else { continue };
        let (Ok(parent), resto) = campo(resto) else { continue };
        let resto = resto.trim();
        parents.insert(child, parent);
        // `comm` do macOS é o caminho inteiro e pode ter espaço ("/Users/Ana Lima/.local/bin/claude").
        if resto.rsplit('/').next() == Some(provider)
            || resto.split_whitespace().take(2).any(|arg| arg.rsplit('/').next() == Some(provider)) { candidates.push(child); }
    }
    candidates.into_iter().any(|mut child| { for _ in 0..32 {
        if child == pid { return true; }
        let Some(parent) = parents.get(&child) else { break }; if *parent == child { break; } child = *parent;
    } false })
}

pub fn capabilities(session: &Arc<LiveSession>) -> Capabilities {
    let context = session.interaction.lock().expect("screen poisoned");
    let meta = session.meta.lock().expect("metadata poisoned");
    let provider = meta.provider.as_deref().unwrap_or("");
    let rodando = provider_running(meta.pid,provider);
    let available = !session.reserved.load(Ordering::SeqCst) && rodando;
    let dialog = approval(&context.parser.screen().contents(),provider);
    let approve = available && dialog.is_some();
    let prompt = available && ready(context.parser.screen(),provider);
    let enfileirar = available && !prompt && pode_enfileirar(context.parser.screen(),provider);
    let escolha = (available && !approve && !prompt).then(|| escolha(&linha_a_linha(context.parser.screen()))).flatten();
    let reason = (!(approve || prompt || escolha.is_some())).then(|| match provider {
        // ponytail: diagnóstico detalhado enquanto a tela do agy não está calibrada em todos os casos;
        // volta para o texto genérico quando a Conversa do Antigravity estiver estável.
        "antigravity" => motivo_antigravity(context.parser.screen(), available, session.reserved.load(Ordering::SeqCst)),
        _ => "Entrada do CLI não reconhecida ou sessão ocupada".into(),
    });
    Capabilities { prompt, approve, revision: context.revision(session), approval_text: dialog.map(|d|d.2), reason, enfileirar, escolha, iniciando: !rodando }
}

/// Por que o campo do Antigravity não foi reconhecido, em palavras: qual das condições do `ready`
/// falhou. Sem isso a única pista era "não reconhecida", e a tela do terminal parecia normal.
fn motivo_antigravity(screen: &vt100::Screen, rodando: bool, reservada: bool) -> String {
    let texto = screen.contents();
    let mut faltas = Vec::new();
    if reservada { faltas.push("consulta de uso em andamento"); }
    if !rodando { faltas.push("processo agy não encontrado"); }
    if cancelavel(&texto) { faltas.push("agente trabalhando ou com pergunta aberta"); }
    else if !texto.contains("? for shortcuts") { faltas.push("rodapé \"? for shortcuts\" fora da tela"); }
    if !screen.bracketed_paste() { faltas.push("modo de colar desligado"); }
    if !composer_vazio(screen) { faltas.push("campo de digitação vazio não encontrado no cursor"); }
    if faltas.is_empty() { "Antigravity: entrada não reconhecida".into() } else { format!("Antigravity: {}", faltas.join(" · ")) }
}

/// Uso da conta Claude. A fonte é o `cachedUsageUtilization` que o próprio Claude Code grava no
/// `.claude.json` a cada `/usage` — ler a tela falhava conforme a altura do painel e o momento do
/// redesenho (a lista "What's contributing" empurra os limites para fora de um painel baixo).
///
/// - `refresh: false` só lê o arquivo. Nunca digita nada.
/// - `refresh: true` precisa de um `/usage` novo, porque o arquivo só muda quando alguém consulta:
///   usa um agente Claude ocioso da conta; sem nenhum, abre um Claude **oculto e temporário** na
///   pasta do engine, consulta e encerra. Sucesso = `fetchedAtMs` do arquivo mudou.
/// - Falhou: devolve a última leitura do arquivo com o motivo, em vez de sumir com os números.
pub fn account_usage(state: &Arc<EngineState>, profile_id: &str, refresh: bool) -> Result<EngineResponse> {
    let dir = state.state_file.parent().ok_or_else(|| anyhow!("engine dir unavailable"))?.to_path_buf();
    if let Some(perfil) = omni_core::profiles(&dir).into_iter().find(|p| p.id == profile_id && p.provider == "antigravity") {
        return uso_antigravity(state, &dir, &perfil, refresh);
    }
    let profile = omni_core::profiles(&dir).into_iter().find(|p| p.id == profile_id && p.provider == "claude");
    let state_path = profile.as_ref().map(omni_core::usage::claude_state_path);
    let read_cache = || state_path.as_deref().and_then(|path| omni_core::usage::read_claude_cache(profile_id, path, now_ms()));
    let with_reason = |usage: Option<AccountUsage>, reason: &str| {
        let mut usage = usage.unwrap_or_else(|| AccountUsage::unavailable(profile_id, "claude", reason));
        usage.reason = Some(reason.into());
        Ok(EngineResponse::AccountUsage { usage })
    };
    let before = read_cache();
    if !refresh {
        return match before {
            Some(usage) => Ok(EngineResponse::AccountUsage { usage }),
            None => with_reason(None, "Sem consulta de uso ainda. Clique em atualizar."),
        };
    }
    let Some(profile) = profile else { return with_reason(before, "Conta Claude não encontrada.") };
    // Leitura de menos de 1 min: o Claude devolveria a mesma (ele só busca de novo depois de alguns
    // minutos — medido: 4 min depois repetiu, 7 min depois buscou).
    if let Some(usage) = before.as_ref().filter(|u| u.observed_at_ms.is_some_and(|at| now_ms().saturating_sub(at) < 60_000)) {
        return Ok(EngineResponse::AccountUsage { usage: usage.clone() });
    }
    let previous_fetch = before.as_ref().and_then(|u| u.observed_at_ms);

    let idle_agent = state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?.values().filter_map(|entry| {
        let SessionEntry::Live(session) = entry else { return None };
        let meta = session.meta.lock().ok()?;
        (meta.provider.as_deref() == Some("claude") && meta.profile_id.as_deref() == Some(profile_id)).then(|| session.clone())
    }).find(|session| capabilities(session).prompt);
    if let Some(session) = idle_agent {
        if let Some(usage) = run_usage_command(state, &session, profile_id, &read_cache, previous_fetch)? {
            return Ok(EngineResponse::AccountUsage { usage });
        }
    }

    // Nenhum agente ocioso (ou ele não trouxe): Claude oculto só para consultar. `/usage` não manda
    // mensagem ao modelo, e sem mensagem o Claude não grava conversa.
    let id = state.next_id();
    let hidden = spawn_terminal_inner(state, id.clone(), String::new(), "Claude · consulta de uso".into(),
        dir.to_string_lossy().into_owned(), None, Some("claude".into()), 40, 120, now_ms(),
        SessionOrigin { env: omni_core::env_for(&profile), provider: Some("claude".into()),
            profile_id: Some(profile_id.into()), conversation_id: None, external_session_id: None });
    let result = hidden.and_then(|_| {
        let session = match state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?.get(&id) {
            Some(SessionEntry::Live(session)) => session.clone(),
            _ => return Ok(None),
        };
        if !wait_claude_ready(&session, Duration::from_secs(25)) { return Ok(None); }
        run_usage_command(state, &session, profile_id, &read_cache, previous_fetch)
    });
    end_hidden(state, &id, "claude");
    match result? {
        Some(usage) => Ok(EngineResponse::AccountUsage { usage }),
        None => with_reason(before, "O Claude não trouxe o uso a tempo; mostrando a última leitura."),
    }
}

/// Uso da conta do Antigravity. A CLI não grava o uso em arquivo nenhum: só o painel do `/usage`
/// mostra. Então a leitura é a tela, e a última fica em `uso-antigravity-<conta>.json` no engine para
/// o rodapé abrir com número sem digitar nada (`refresh: false`).
/// - `refresh: true`: usa um agy ocioso da conta; sem nenhum, abre um **oculto e temporário** na pasta
///   do engine (confiada antes, senão ele para perguntando), consulta e encerra. `/usage` não manda
///   mensagem ao modelo e não cria conversa.
fn uso_antigravity(state: &Arc<EngineState>, dir: &Path, perfil: &omni_core::Profile, refresh: bool) -> Result<EngineResponse> {
    let arquivo = dir.join(format!("uso-antigravity-{}.json", perfil.id));
    let salvo = || std::fs::read(&arquivo).ok().and_then(|bytes| serde_json::from_slice::<AccountUsage>(&bytes).ok());
    let com_motivo = |uso: Option<AccountUsage>, motivo: &str| {
        let mut uso = uso.unwrap_or_else(|| AccountUsage::unavailable(&perfil.id, "antigravity", motivo));
        uso.reason = Some(motivo.into());
        Ok(EngineResponse::AccountUsage { usage: uso })
    };
    let antes = salvo();
    if !refresh {
        return match antes { Some(usage) => Ok(EngineResponse::AccountUsage { usage }), None => com_motivo(None, "Sem consulta de uso ainda. Clique em atualizar.") };
    }
    if let Some(usage) = antes.as_ref().filter(|u| u.observed_at_ms.is_some_and(|at| now_ms().saturating_sub(at) < 60_000)) {
        return Ok(EngineResponse::AccountUsage { usage: usage.clone() });
    }
    let ocioso = state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?.values().filter_map(|entry| {
        let SessionEntry::Live(session) = entry else { return None };
        let meta = session.meta.lock().ok()?;
        (meta.provider.as_deref() == Some("antigravity")).then(|| session.clone())
    }).find(|session| capabilities(session).prompt);
    let lido = match ocioso {
        Some(session) => consultar_usage_antigravity(state, &session, &perfil.id)?,
        None => {
            let pasta = dir.to_string_lossy().into_owned();
            let _ = omni_core::antigravity::confiar(Path::new(&perfil.config_dir), &pasta);
            let id = state.next_id();
            let oculto = spawn_terminal_inner(state, id.clone(), String::new(), "Antigravity · consulta de uso".into(),
                pasta, None, Some("agy".into()), 40, 120, now_ms(),
                SessionOrigin { env: omni_core::env_for(perfil), provider: Some("antigravity".into()),
                    profile_id: Some(perfil.id.clone()), conversation_id: None, external_session_id: None });
            let resultado = oculto.and_then(|_| {
                let session = match state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?.get(&id) {
                    Some(SessionEntry::Live(session)) => session.clone(),
                    _ => return Ok(None),
                };
                let inicio = Instant::now();
                while inicio.elapsed() < Duration::from_secs(40) && !capabilities(&session).prompt {
                    if session.meta.lock().map(|meta| meta.pid.is_none()).unwrap_or(true) { return Ok(None); }
                    std::thread::sleep(Duration::from_millis(300));
                }
                consultar_usage_antigravity(state, &session, &perfil.id)
            });
            end_hidden(state, &id, "antigravity");
            resultado?
        }
    };
    match lido {
        Some(usage) => {
            if let Ok(json) = serde_json::to_vec(&usage) { let _ = std::fs::write(&arquivo, json); }
            Ok(EngineResponse::AccountUsage { usage })
        }
        None => com_motivo(antes, "O Antigravity não mostrou o uso a tempo; mostrando a última leitura."),
    }
}

/// Digita `/usage` num agy ocioso, lê o painel "Models & Quota" e fecha com Esc.
fn consultar_usage_antigravity(state: &Arc<EngineState>, session: &Arc<LiveSession>, profile_id: &str) -> Result<Option<AccountUsage>> {
    {
        let sessions = state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?;
        if !sessions.values().any(|entry| matches!(entry,SessionEntry::Live(s) if Arc::ptr_eq(s,session))) { return Ok(None); }
        let mut context = session.interaction.lock().map_err(|_|anyhow!("screen poisoned"))?;
        if !ready(context.parser.screen(),"antigravity") || session.reserved.swap(true,Ordering::SeqCst) { return Ok(None); }
        context.input_revision += 1;
    }
    struct Release<'a>(&'a LiveSession);
    impl Drop for Release<'_> { fn drop(&mut self) { self.0.reserved.store(false,Ordering::SeqCst); } }
    let _release = Release(session);
    let write = |bytes: &[u8]| -> Result<()> {
        let mut writer = session.writer.lock().map_err(|_|anyhow!("writer poisoned"))?;
        writer.write_all(bytes)?; writer.flush()?; Ok(())
    };
    write(b"/usage")?;
    // Enter separado (mesmo motivo do Claude: na mesma rajada vira texto colado).
    std::thread::sleep(Duration::from_millis(300));
    write(b"\r")?;
    let inicio = Instant::now();
    let mut resultado = None;
    while inicio.elapsed() < Duration::from_secs(15) {
        std::thread::sleep(Duration::from_millis(300));
        let tela = session.interaction.lock().map_err(|_|anyhow!("screen poisoned"))?.parser.screen().contents();
        let uso = omni_core::usage::parse_antigravity_screen(&tela, profile_id, now_ms());
        if uso.status == "available" { resultado = Some(uso); break; }
    }
    write(b"\x1b")?;
    Ok(resultado)
}

/// Encerra a CLI oculta. Só matar a sessão não basta no Windows: o shell morre e o `.exe` neto fica
/// órfão (visto no teste com o Claude). `/exit` primeiro; se ele ainda estiver vivo, derruba a árvore.
fn end_hidden(state: &Arc<EngineState>, id: &str, provider: &str) {
    let session = match state.sessions.lock().ok().as_ref().and_then(|sessions| sessions.get(id)) {
        Some(SessionEntry::Live(session)) => Some(session.clone()),
        _ => None,
    };
    if let Some(session) = session {
        let write = |bytes: &[u8]| if let Ok(mut writer) = session.writer.lock() { let _ = writer.write_all(bytes); let _ = writer.flush(); };
        let pid = session.meta.lock().ok().and_then(|meta| meta.pid);
        write(b"\x1b");
        std::thread::sleep(Duration::from_millis(300));
        write(b"/exit");
        std::thread::sleep(Duration::from_millis(250));
        write(b"\r");
        let started = Instant::now();
        while provider_running(pid, provider) && started.elapsed() < Duration::from_secs(3) {
            std::thread::sleep(Duration::from_millis(200));
        }
        #[cfg(windows)]
        if let Some(pid) = pid.filter(|pid| provider_running(Some(*pid), provider)) {
            use std::os::windows::process::CommandExt;
            let _ = std::process::Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()])
                .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
                .creation_flags(0x0800_0000).status();
        }
    }
    let _ = close_session(state, id);
}

/// Espera o Claude recém-aberto chegar no composer vazio, passando pelo "confiar nesta pasta" (a
/// pasta é a do próprio engine; o Claude grava a confiança, então só acontece na primeira vez).
pub(crate) fn wait_claude_ready(session: &Arc<LiveSession>, limit: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < limit {
        std::thread::sleep(Duration::from_millis(300));
        if session.meta.lock().map(|meta| meta.pid.is_none()).unwrap_or(true) { return false; }
        let text = session.interaction.lock().map(|c| c.parser.screen().contents()).unwrap_or_default();
        if let Some(keys) = trust_dialog_keys(&text) {
            if let Ok(mut writer) = session.writer.lock() { let _ = writer.write_all(keys.as_bytes()); let _ = writer.flush(); }
            continue;
        }
        if capabilities(session).prompt { return true; }
    }
    false
}

/// Teclas para o diálogo de confiança de pasta, ou `None` se ele não está na tela. Na 2.1.272 o
/// padrão selecionado é "No, exit" — um Enter às cegas **fecharia** o Claude. Então: seta até a opção
/// "Yes", e Enter só quando a tela já mostra o `❯` nela (a próxima volta do loop confere).
fn trust_dialog_keys(text: &str) -> Option<&'static str> {
    // Rótulo sem o `❯` e sem numeração ("1. Yes, proceed" nas versões antigas).
    let label = |line: &str| line.trim_start_matches('❯').trim_start().trim_start_matches(|c: char| c.is_ascii_digit() || c == '.').trim_start().to_owned();
    let options: Vec<&str> = text.lines().map(str::trim)
        .filter(|line| label(line).starts_with("Yes, ") || label(line).starts_with("No, exit"))
        .collect();
    let yes = options.iter().position(|line| label(line).starts_with("Yes, "))?;
    let selected = options.iter().position(|line| line.starts_with('❯'))?;
    if !options.iter().any(|line| label(line).starts_with("No, exit")) { return None; }
    Some(match selected.cmp(&yes) {
        std::cmp::Ordering::Equal => "\r",
        std::cmp::Ordering::Less => "\x1b[B",
        std::cmp::Ordering::Greater => "\x1b[A",
    })
}

/// `shift+tab`, que é o que o Claude Code liga a `chat:cycleMode`. **Cicla** entre os quatro modos
/// (default, aceitar edições, plano, automático), então chegar num modo específico é apertar e
/// conferir, nunca apertar uma vez.
const CICLAR_MODO: &[u8] = b"\x1b[Z";
/// Atalho alternativo do próprio CLI (`meta+m`), usado quando ele decide que o terminal não entrega
/// shift+tab. Só entra em cena se o rodapé não mudar com a tecla principal.
const CICLAR_MODO_ALTERNATIVO: &[u8] = b"\x1bm";
/// Quantas vezes vale apertar: o ciclo tem quatro estados, e uma volta inteira é o suficiente.
const VOLTAS_DO_CICLO: usize = 4;

/// Relê até `pronto` valer ou o tempo acabar.
fn esperar(pronto: &dyn Fn() -> bool, tempo: Duration) -> bool {
    let limite = Instant::now() + tempo;
    while Instant::now() < limite {
        if pronto() { return true; }
        std::thread::sleep(Duration::from_millis(80));
    }
    pronto()
}

/// Rótulo do preset do `/permissions` do Codex que equivale ao auto do Claude: um revisor decide e só
/// pergunta o que for arriscado. Os outros: "Read Only", "Ask for approval", "Full Access".
const AUTO_DO_CODEX: &str = "Approve for me";

/// Menu do `/permissions` (Codex 0.154.0, tela real):
/// `  Update Model Permissions` / `› 3. Approve for me (current)  Only ask…` / `Press enter to confirm…`.
/// Devolve (número marcado agora, número do preset auto).
fn menu_de_permissoes(texto: &str, rotulo: &str) -> Option<(u8, u8)> {
    if !texto.contains("Update Model Permissions") { return None; }
    let opcao = |linha: &str| -> Option<(bool, u8, String)> {
        let marcada = linha.trim_start().starts_with('›');
        let resto = linha.trim().trim_start_matches('›').trim();
        let (numero, rotulo) = resto.split_once(". ")?;
        Some((marcada, numero.parse().ok()?, rotulo.to_owned()))
    };
    let opcoes: Vec<_> = texto.lines().filter_map(opcao).collect();
    let marcada = opcoes.iter().find(|o| o.0)?.1;
    let alvo = opcoes.iter().find(|o| o.2.starts_with(rotulo))?.1;
    Some((marcada, alvo))
}

/// Abre o `/permissions` no campo vazio, anda até "Approve for me" e confirma. Erro com motivo se o
/// menu não abrir ou não fechar — nunca aperta às cegas.
fn permissoes_do_codex(rotulo: &str, tela: &dyn Fn() -> String, pronto: &dyn Fn() -> bool, escrever: &dyn Fn(&[u8]) -> Result<()>) -> Result<()> {
    if !esperar(pronto, Duration::from_millis(1_500)) {
        return Err(anyhow!("O Codex não está com o campo livre para trocar as permissões"));
    }
    escrever(b"/permissions")?;
    std::thread::sleep(Duration::from_millis(300));
    escrever(b"\r")?;
    if !esperar(&|| menu_de_permissoes(&tela(), rotulo).is_some(), Duration::from_millis(3_000)) {
        let _ = escrever(b"\x1b");
        return Err(anyhow!("O menu de permissões do Codex não abriu"));
    }
    let (marcada, alvo) = menu_de_permissoes(&tela(), rotulo).ok_or_else(|| anyhow!("Menu de permissões sem \"{rotulo}\""))?;
    let seta: &[u8] = if alvo > marcada { b"\x1b[B" } else { b"\x1b[A" };
    for _ in 0..marcada.abs_diff(alvo) {
        escrever(seta)?;
        std::thread::sleep(Duration::from_millis(60));
    }
    if !esperar(&|| menu_de_permissoes(&tela(), rotulo).is_some_and(|(m, a)| m == a), Duration::from_millis(1_000)) {
        let _ = escrever(b"\x1b");
        return Err(anyhow!("Não consegui marcar \"{rotulo}\" no menu do Codex"));
    }
    escrever(b"\r")?;
    if !esperar(&|| menu_de_permissoes(&tela(), rotulo).is_none(), Duration::from_millis(2_000)) {
        return Err(anyhow!("O menu de permissões do Codex não fechou"));
    }
    Ok(())
}

/// Modo de permissão que o rodapé do Claude Code está mostrando.
///
/// O rodapé é a fonte **imediata**: o transcript também registra a troca, mas com atraso, e este
/// laço precisa saber se a tecla pegou antes de apertar de novo. Os rótulos vêm do próprio binário
/// (`default`, `accept edits on`, `plan mode on`, `auto mode on`); `default` não escreve nada no
/// rodapé, então a ausência das outras marcas é o que o identifica.
pub fn modo_atual(screen: &vt100::Screen) -> Option<&'static str> {
    let texto = screen.contents().to_lowercase();
    // Codex: "Plan mode (shift+tab to cycle)" à direita do rodapé (0.154.0, conferido na CLI real).
    if texto.contains("plan mode on") || texto.contains("plan mode (shift+tab") {
        return Some("plan");
    }
    if texto.contains("auto mode on") {
        return Some("auto");
    }
    if texto.contains("accept edits on") {
        return Some("acceptEdits");
    }
    // Sem nenhuma marca não dá para afirmar que é `default`: pode ser uma tela em que o rodapé nem
    // está visível. Quem chama trata `None` como "não sei" e não como um modo.
    None
}

/// Modo de uma sessão viva, lido da tela dela. `None` quando o rodapé não está visível.
pub fn modo_da_sessao(session: &Arc<LiveSession>) -> Option<&'static str> {
    let provider = session.meta.lock().ok()?.provider.clone().unwrap_or_default();
    let context = session.interaction.lock().ok()?;
    modo_com_provider(context.parser.screen(), &provider)
}

/// O shift+tab do Codex só alterna Padrão ↔ Plan, e o Padrão não escreve nada no rodapé: com o
/// campo à vista e sem a marca do Plan, conta como "auto" — o preset que a conta já abre ("Approve
/// for me") e o que o botão Auto escolhe no `/permissions`.
// ponytail: o preset atual não aparece na tela; quem trocar à mão para "Ask for approval" continua
// vendo Auto aceso. Ler o `approval_policy` do rollout da sessão se isso confundir.
fn modo_com_provider(screen: &vt100::Screen, provider: &str) -> Option<&'static str> {
    modo_atual(screen).or_else(|| (provider == "codex" && ready(screen, provider)).then_some("auto"))
}

/// Alterna o modo de permissão até chegar em `alvo` (`plan` ou `auto`), como o shift+tab faz no
/// terminal.
///
/// Mesmo formato do `trust_dialog_keys`: manda tecla, relê a tela, repete. Falha honesta — se o
/// rodapé não reagir, devolve erro com motivo em vez de seguir apertando às cegas.
pub fn alternar_modo(state: &Arc<EngineState>, session: &Arc<LiveSession>, alvo: &str) -> Result<String> {
    let provider = session.meta.lock().map_err(|_| anyhow!("metadata poisoned"))?.provider.clone().unwrap_or_default();
    let ler_modo = || -> Result<Option<&'static str>> {
        let context = session.interaction.lock().map_err(|_| anyhow!("screen poisoned"))?;
        Ok(modo_com_provider(context.parser.screen(), &provider))
    };
    let escrever = |bytes: &[u8]| -> Result<()> {
        let mut context = session.interaction.lock().map_err(|_| anyhow!("screen poisoned"))?;
        context.input_revision += 1;
        let mut writer = session.writer.lock().map_err(|_| anyhow!("writer poisoned"))?;
        writer.write_all(bytes)?;
        writer.flush()?;
        Ok(())
    };
    let viva = || -> Result<bool> {
        Ok(state
            .sessions
            .lock()
            .map_err(|_| anyhow!("sessions poisoned"))?
            .values()
            .any(|entry| matches!(entry, SessionEntry::Live(s) if Arc::ptr_eq(s, session))))
    };

    let inicial = ler_modo()?;
    // Codex: o "auto" dele mora no `/permissions` ("Approve for me"), não no shift+tab. Sai do Plan
    // (se estiver) pelo laço abaixo e depois escolhe o preset no menu.
    if provider == "codex" && alvo == "auto" {
        if inicial == Some("plan") {
            escrever(CICLAR_MODO)?;
            esperar(&|| ler_modo().ok().flatten() == Some("auto"), Duration::from_millis(2_000));
        }
        let tela = || session.interaction.lock().map(|c| c.parser.screen().contents()).unwrap_or_default();
        let pronto = || session.interaction.lock().map(|c| ready(c.parser.screen(), "codex")).unwrap_or(false);
        return permissoes_do_codex(AUTO_DO_CODEX, &tela, &pronto, &escrever).map(|_| alvo.to_string());
    }
    if inicial == Some(alvo) {
        return Ok(alvo.to_string());
    }
    let mut tecla = CICLAR_MODO;
    let mut sem_reacao = 0;
    for _ in 0..VOLTAS_DO_CICLO {
        if !viva()? {
            return Err(anyhow!("A sessão não está mais aberta"));
        }
        let antes = ler_modo()?;
        escrever(tecla)?;
        // Uma volta do Ink leva alguns quadros; sem esta pausa a leitura seguinte ainda vê o modo
        // antigo e o laço apertaria de novo, passando do alvo.
        let limite = Instant::now() + Duration::from_millis(1_200);
        let mut agora = antes;
        while Instant::now() < limite {
            std::thread::sleep(Duration::from_millis(80));
            agora = ler_modo()?;
            if agora != antes {
                break;
            }
        }
        if agora == Some(alvo) {
            return Ok(alvo.to_string());
        }
        if agora == antes {
            sem_reacao += 1;
            // Duas teclas sem qualquer mudança no rodapé: provavelmente esta CLI está com o atalho
            // alternativo. Vale uma tentativa antes de desistir.
            if sem_reacao == 2 && tecla == CICLAR_MODO {
                tecla = CICLAR_MODO_ALTERNATIVO;
                continue;
            }
            if sem_reacao >= 3 {
                return Err(anyhow!("O agente não respondeu ao atalho de modo"));
            }
        }
    }
    Err(anyhow!("Não foi possível chegar no modo pedido"))
}

/// Digita `/usage` numa sessão ociosa e espera o resultado; fecha o diálogo aberto com Esc — com
/// sucesso ou não. Pronto quando:
/// - o `fetchedAtMs` do arquivo mudou (o Claude buscou de novo), ou
/// - o diálogo terminou de carregar (limites na tela, sem "Refreshing…") por duas leituras seguidas:
///   o Claude não busca de novo se consultou há pouco, e aí o valor do arquivo **é** o atual.
/// CLI que não grava o cache: os números da própria tela.
fn run_usage_command(state: &Arc<EngineState>, session: &Arc<LiveSession>, profile_id: &str,
    read_cache: &dyn Fn() -> Option<AccountUsage>, previous_fetch: Option<u64>) -> Result<Option<AccountUsage>> {
    {
        let sessions = state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?;
        if !sessions.values().any(|entry| matches!(entry,SessionEntry::Live(s) if Arc::ptr_eq(s,session))) { return Ok(None); }
        let mut context = session.interaction.lock().map_err(|_|anyhow!("screen poisoned"))?;
        if !ready(context.parser.screen(),"claude") || session.reserved.swap(true,Ordering::SeqCst) { return Ok(None); }
        context.input_revision += 1;
        let written = (|| -> Result<()> {
            let mut writer = session.writer.lock().map_err(|_|anyhow!("writer poisoned"))?;
            writer.write_all(b"/usage")?; writer.flush()?; Ok(())
        })();
        if let Err(error) = written { session.reserved.store(false,Ordering::SeqCst); return Err(error); }
    }
    struct Release<'a>(&'a LiveSession);
    impl Drop for Release<'_> { fn drop(&mut self) { self.0.reserved.store(false,Ordering::SeqCst); } }
    let _release = Release(session);
    let write = |bytes: &[u8]| -> Result<()> {
        let mut writer = session.writer.lock().map_err(|_|anyhow!("writer poisoned"))?;
        writer.write_all(bytes)?; writer.flush()?; Ok(())
    };
    // Texto e Enter no mesmo write chegam como uma rajada só, que o Claude trata como colagem: o
    // `\r` não submete. Enter separado, fora dos locks (o leitor da PTY precisa da tela no intervalo).
    std::thread::sleep(Duration::from_millis(250));
    write(b"\r")?;
    let started = Instant::now();
    let mut result = None;
    // Momento em que o diálogo terminou de carregar: o "Refreshing…" apareceu e sumiu, ou (CLI sem
    // esse aviso) os limites ficaram na tela por 2 s.
    let (mut saw_refreshing, mut loaded_at, mut limits_since) = (false, None::<Instant>, None::<Instant>);
    while started.elapsed() < Duration::from_secs(15) && result.is_none() {
        std::thread::sleep(Duration::from_millis(250));
        if !state.sessions.lock().map_err(|_|anyhow!("sessions poisoned"))?.values().any(|entry| matches!(entry,SessionEntry::Live(s) if Arc::ptr_eq(s,session))) { break; }
        if session.meta.lock().map_err(|_|anyhow!("metadata poisoned"))?.pid.is_none() { break; }
        let cached = read_cache();
        if cached.as_ref().is_some_and(|u| u.observed_at_ms.is_some() && u.observed_at_ms != previous_fetch) {
            result = cached;
            break;
        }
        let text = session.interaction.lock().map_err(|_|anyhow!("screen poisoned"))?.parser.screen().contents();
        let refreshing = text.contains("Refreshing");
        saw_refreshing |= refreshing;
        if text.contains("Current session") { limits_since.get_or_insert_with(Instant::now); }
        if loaded_at.is_none() && ((saw_refreshing && !refreshing) || limits_since.is_some_and(|at| !saw_refreshing && at.elapsed() >= Duration::from_secs(2))) {
            loaded_at = Some(Instant::now());
        }
        // Carregou e o arquivo não mudou: ou o Claude ainda vai gravar (1,5 s de folga), ou ele não
        // buscou de novo porque consultou há poucos minutos — nesse caso o arquivo é o valor atual,
        // o mesmo que o `/usage` mostraria no terminal.
        if loaded_at.is_some_and(|at| at.elapsed() >= Duration::from_millis(1500)) {
            result = cached.or_else(|| Some(parse_claude_screen(&text, profile_id, now_ms())).filter(|u| u.status == "available"));
            break;
        }
    }
    // Fecha o diálogo que NÓS abrimos: a sessão estava ociosa e com a entrada reservada, então uma
    // tela que não é o composer vazio só pode ser o `/usage` (ou o autocomplete dele).
    if session.interaction.lock().is_ok_and(|context| !ready(context.parser.screen(), "claude")) { let _ = write(b"\x1b"); }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Pergunta do Antigravity 1.4.2 (`ask_question`), copiada da tela real.
    #[test] fn escolha_do_antigravity() {
        let tela = "> me pergunte alguma coisa pra eu escolher alguma opcao\n\n? O que você gostaria de fazer agora?\n\nQuestion\n────────────────────────────────────────\n\nQuestion 1/1: O que você gostaria de fazer agora?\n\n> 1. (Recommended) Criar um novo projeto do zero\n  2. Corrigir um bug ou melhorar um código existente\n  3. Aprender sobre uma tecnologia ou ferramenta nova\n  4. Automatizar alguma tarefa repetitiva\n  5. Write-in...\n\n  ↑/↓ Navigate · enter Select · esc Skip\nesc to cancel                                   Gemini 4 Argon · medium\n";
        let menu = escolha(tela).expect("menu do agy");
        assert_eq!(menu.pergunta, "O que você gostaria de fazer agora?");
        assert_eq!(menu.opcoes.iter().map(|o| o.numero).collect::<Vec<_>>(), vec![1, 2, 3, 4]);
        assert_eq!(menu.opcoes[0].rotulo, "(Recommended) Criar um novo projeto do zero");
    }
    /// Saída de comando com acento que o ConPTY trocou por U+FFFD: sem a troca o `vt100` contava 0
    /// colunas para cada um, a linha quebrava fora do lugar e o campo vazio sumia da tela.
    #[test] fn substituto_ocupa_uma_coluna() {
        let mut context = Interaction::new(3, 20);
        let linha = "Configura\u{FFFD}\u{FFFD}es\r\n\x1b[?2004h\u{276f} ";
        context.parser.process(&sem_substituto(linha.as_bytes()));
        assert_eq!(context.parser.screen().rows(0, 20).next().unwrap(), "Configura??es");
        assert!(composer_vazio(context.parser.screen()));
        assert_eq!(&*sem_substituto(b"abc"), b"abc");
    }
    /// Sugestão de compactar do Claude Code, copiada da tela real: menu só de setas, sem números.
    #[test] fn escolha_de_setas_sem_numero() {
        let tela = "● resposta anterior\n\n────────────────────────────────────────\n   We recommend compacting earlier\n\n   Each message re-sends the whole conversation, so long conversations use up your plan's usage limits faster.\n\n   Want to autocompact at 400k tokens instead? Your model doesn't change.\n\n   ❯ Autocompact at ‹ 400k › tokens\n     Keep auto (1m tokens)\n\n   ↑/↓ choose · ←/→ change size · enter confirm · esc not now\n";
        let menu = escolha(tela).expect("menu de setas");
        assert_eq!(menu.pergunta, "We recommend compacting earlier");
        assert_eq!(menu.opcoes.iter().map(|o| o.rotulo.as_str()).collect::<Vec<_>>(), vec!["Autocompact at ‹ 400k › tokens", "Keep auto (1m tokens)"]);
        assert_eq!(menu.setas, Some(1));
        assert!(menu.detalhe.unwrap().contains("Want to autocompact"));
        // O campo do Claude (`❯` entre bordas) não é menu.
        assert_eq!(escolha("────────────\n❯ oi\n────────────\n  ? for shortcuts · ↑ history · enter send · esc\n"), None);
    }
    #[test] fn shell_com_filho_vivo_conta_como_ocupado() {
        let mut filho = if cfg!(windows) {
            std::process::Command::new("cmd").args(["/c", "ping -n 4 127.0.0.1 >nul"]).spawn()
        } else {
            std::process::Command::new("sleep").arg("3").spawn()
        }.expect("spawn");
        assert!(has_children(Some(std::process::id())));
        let _ = filho.kill(); let _ = filho.wait();
        assert!(!has_children(None));
    }
    /// Tela real (2.1.310) depois do /compact: o aviso de limite com "esc to cancel" ficou no
    /// histórico, logo acima, e travava a conversa em "não reconhecida".
    #[test] fn esc_to_cancel_do_historico_nao_trava_o_campo() {
        let borda = "─".repeat(60);
        let mut tela = Interaction::new(14, 80);
        tela.parser.process(format!("\x1b[?2004h● Usage limit reached · continuing automatically at 1am · esc to cancel\r\n\r\n✻ Cooked for 22m 48s · done segunda-feira, 23:13\r\n\r\n❯ /compact\r\n  ⎿  Compacted (ctrl+o to see full summary)\r\n{borda}\r\n❯\u{a0}\r\n{borda}\r\n  ⏵⏵ auto mode on (shift+tab to cycle)\x1b[8;3H").as_bytes());
        assert!(ready(tela.parser.screen(), "claude"));
        let mut menu = Interaction::new(10, 80);
        menu.parser.process(format!("\x1b[?2004h{borda}\r\n Quick safety check\r\n ❯ 1. Yes\r\n   2. No\r\n Enter to confirm · Esc to cancel\r\n{borda}\r\n❯\u{a0}\x1b[7;3H").as_bytes());
        assert!(!ready(menu.parser.screen(), "claude"), "menu aberto continua bloqueando");
    }
    #[test] fn reconstructs_split_ansi_and_checks_cursor_not_old_prompts() {
        let mut context = Interaction::new(10,80);
        context.parser.process(b"\x1b[?2004hClaude Code\r\n> ");
        assert!(ready(context.parser.screen(),"claude"));
        context.parser.process(b"draft"); assert!(!ready(context.parser.screen(),"claude"));
        context.parser.process(b"\x1b[2"); context.parser.process(b"J\x1b[Hshell> ");
        assert!(!ready(context.parser.screen(),"claude"));
    }
    /// O rodapé é a fonte imediata do modo — o transcript só registra depois. Rótulos tirados do
    /// binário do Claude Code: `plan mode on`, `auto mode on`, `accept edits on`.
    #[test] fn modo_sai_do_rodape_e_tela_sem_rodape_nao_chuta() {
        let tela = |rodape: &str| {
            let mut context = Interaction::new(10, 80);
            context.parser.process(format!("> \r\n{rodape}").as_bytes());
            context
        };
        assert_eq!(modo_atual(tela("⏸ plan mode on (shift+tab to cycle)").parser.screen()), Some("plan"));
        assert_eq!(
            modo_atual(tela("⏵⏵ auto mode on (shift+tab to cycle) · ← for agents").parser.screen()),
            Some("auto")
        );
        assert_eq!(modo_atual(tela("⏵ accept edits on").parser.screen()), Some("acceptEdits"));
        // Sem marca nenhuma não dá para afirmar o modo: pode ser só um rodapé fora da tela.
        assert_eq!(modo_atual(tela("nada aqui").parser.screen()), None);
        assert_eq!(modo_atual(tela("  gpt-5.6-sol high · D:/proj          Plan mode (shift+tab to cycle)").parser.screen()), Some("plan"));
    }

    /// Tela **real** do Claude Code ocioso, capturada de uma sessão aberta pelo celular (30×120).
    /// Os fixtures anteriores eram todos sintéticos; este é o que o engine realmente recebe.
    #[test] fn claude_ocioso_de_verdade_aceita_prompt() {
        let fixture = include_bytes!("../tests-fixtures/claude-composer-vazio.ansi");
        // O stream real da PTY usa CRLF. Em checkouts com `core.autocrlf=false` (Linux/macOS), o Git
        // normaliza este fixture textual para LF; o VT então mantém a coluna anterior a cada quebra
        // e o cursor termina no lugar errado. Normalize primeiro para LF para exercitar o mesmo
        // caminho em todos os sistemas, depois reponha o CR que a PTY entregou na captura real.
        let tela: Vec<_> = fixture.iter().copied().enumerate()
            .filter_map(|(index, byte)| (!(byte == b'\r' && fixture.get(index + 1) == Some(&b'\n'))).then_some(byte))
            .collect();
        let mut stream = Vec::with_capacity(tela.len() + 32);
        for byte in tela {
            if byte == b'\n' { stream.push(b'\r'); }
            stream.push(byte);
        }
        let mut context = Interaction::new(30,120);
        context.parser.process(&stream);
        assert!(ready(context.parser.screen(),"claude"));

        // Digitar de verdade na frente do cursor volta a bloquear.
        context.parser.process(b"abc");
        assert!(!ready(context.parser.screen(),"claude"));
    }

    /// Tela real do Claude Code 2.1.302 depois do primeiro turno: o menu travava o campo e a conversa
    /// só dizia "Entrada do CLI não reconhecida".
    #[test] fn menu_da_cli_vira_escolha_e_permissao_nao() {
        let borda = "─".repeat(40);
        let tela = format!("❯ responda apenas: ok\n● ok\n{borda}\n  Teach auto mode about your environment?\n\n  Auto mode works better when it knows your environment. Takes about a minute.\n\n  ❯ 1. Yes\n    2. Not now\n    3. Don't show again\n\n  Enter to confirm · Esc to cancel\n{borda}\n❯\n{borda}\n");
        let menu = escolha(&tela).expect("menu reconhecido");
        assert_eq!(menu.pergunta, "Teach auto mode about your environment?");
        assert_eq!(menu.detalhe.as_deref(), Some("Auto mode works better when it knows your environment. Takes about a minute."));
        assert_eq!(menu.opcoes.iter().map(|o| (o.numero, o.rotulo.as_str())).collect::<Vec<_>>(), vec![(1, "Yes"), (2, "Not now"), (3, "Don't show again")]);
        let permissao = format!("{borda}\n Bash command\n Do you want to proceed?\n ❯ 1. Yes\n   2. Yes, and don't ask again\n   3. No\n\n Esc to cancel · Enter to confirm\n");
        assert_eq!(escolha(&permissao), None);
        assert_eq!(escolha("● ok\n❯ \n"), None);
    }

    /// Pergunta do agente (AskUserQuestion, Claude Code 2.1.302): abas no topo, descrição embaixo de
    /// cada opção e uma borda antes de "Chat about this". Antes a conversa não mostrava nada.
    #[test] fn pergunta_do_agente_vira_escolha() {
        let borda = "─".repeat(40);
        let tela = format!("● Antes de começar, preciso de uma decisão.\n{borda}\n ←  ☐ Banco  ✔ Submit  →\n\nQual banco de dados usar?\n\n❯ 1. Postgres\n     Relacional, já usado no projeto\n  2. SQLite\n     Arquivo local, sem servidor\n  3. Type something.\n{borda}\n  4. Chat about this\n\nEnter to select · Tab/Arrow keys to navigate · Esc to cancel\n");
        let menu = escolha(&tela).expect("pergunta reconhecida");
        assert_eq!(menu.pergunta, "Qual banco de dados usar?");
        assert_eq!(menu.opcoes.iter().map(|o| (o.numero, o.rotulo.as_str())).collect::<Vec<_>>(), vec![(1, "Postgres"), (2, "SQLite"), (4, "Chat about this")]);
        // Borda da largura toda colada na linha de baixo, como sai do texto da tela.
        let colada = tela.replacen(&format!("{borda}\n ←"), &format!("{borda} ←"), 1);
        assert_eq!(escolha(&colada).expect("pergunta com borda colada").pergunta, "Qual banco de dados usar?");
        // Revisão no fim de duas perguntas: sem rodapé (tela real, 2.1.302).
        let revisao = format!("{borda}
←  ☒ Cor  ☒ Fruta  ✔ Submit  →

Review your answers

 ● Qual cor?
   → Azul
 ● Qual fruta?
   → Manga

Ready to submit your answers?

❯ 1. Submit answers
  2. Cancel
");
        let menu = escolha(&revisao).expect("revisão reconhecida");
        assert_eq!(menu.pergunta, "Review your answers");
        assert_eq!(menu.detalhe.as_deref(), Some("● Qual cor?\n→ Azul\n● Qual fruta?\n→ Manga\nReady to submit your answers?"));
        assert_eq!(menu.opcoes.iter().map(|o| o.rotulo.as_str()).collect::<Vec<_>>(), vec!["Submit answers", "Cancel"]);
        assert_eq!(menu.etapas, vec![Etapa { titulo: "Cor".into(), respondida: true }, Etapa { titulo: "Fruta".into(), respondida: true }]);
    }

    /// Marcar várias (multiSelect), tela real do 2.1.302 depois de marcar a 1 e a 3.
    #[test] fn pergunta_de_marcar_varias() {
        let borda = "─".repeat(40);
        let tela = format!("{borda}\n←  ☐ Frutas  ✔ Submit  →\n\nQuais frutas você gosta?\n\n❯ 1. [✔] Manga\n         Doce e suculenta\n  2. [ ] Uva\n         Pequena, em cachos\n  3. [✔] Banana\n         Prática e energética\n  4. [ ] Type something\n     Submit\n{borda}\n  5. Chat about this\n\nEnter to select · ↑/↓ to navigate · Esc to cancel\n");
        let menu = escolha(&tela).expect("marcar várias reconhecido");
        assert!(menu.multipla);
        assert!(menu.etapas.is_empty(), "uma pergunta só não mostra etapas");
        assert_eq!(menu.opcoes.iter().map(|o| (o.numero, o.rotulo.as_str(), o.marcada, o.descricao.as_deref())).collect::<Vec<_>>(), vec![
            (1, "Manga", Some(true), Some("Doce e suculenta")),
            (2, "Uva", Some(false), Some("Pequena, em cachos")),
            (3, "Banana", Some(true), Some("Prática e energética")),
            (5, "Chat about this", None, None),
        ]);
    }

    /// Print do usuário: depois de um turno, o prompt destacado (largura toda), a borda e a barra de
    /// abas chegam numa linha só. Sem achar a borda, a "pergunta" virava 20 linhas da conversa — e,
    /// com uma lista numerada antiga na janela, o menu sumia no clique ("Sessão ocupada…").
    #[test] fn pergunta_depois_de_um_turno_nao_pega_a_conversa() {
        let borda = "─".repeat(120);
        let tela = format!("● Testei três tipos:\n  1. Escolha única\n  2. Seleção múltipla\n\n✻ Baked for 11s · done 0:02\n\n❯ manda de novo a primeira pergunta{}{borda}←  ☐ Cor  ✔ Submit  →\n\nQual cor você mais gosta?\n\n❯ 1. Azul\n     Calma, céu e mar\n  2. Verde\n     Natureza e equilíbrio\n  3. Type something.\n{borda}\n  4. Chat about this\n\nEnter to select · ↑/↓ to navigate · Esc to cancel\n", " ".repeat(85));
        let menu = escolha(&tela).expect("pergunta reconhecida");
        assert_eq!(menu.pergunta, "Qual cor você mais gosta?");
        assert!(!menu.previa, "sem prévia o número já escolhe: Enter extra cairia na tela seguinte");
        assert_eq!(menu.detalhe, None);
        assert_eq!(menu.opcoes.iter().map(|o| (o.numero, o.rotulo.as_str(), o.descricao.as_deref())).collect::<Vec<_>>(), vec![
            (1, "Azul", Some("Calma, céu e mar")), (2, "Verde", Some("Natureza e equilíbrio")), (4, "Chat about this", None),
        ]);
    }

    /// Print do usuário: pergunta com prévia lado a lado. O desenho não é rótulo nem explicação, e o
    /// "Chat about this" sem número (depois da borda) não gruda na última opção.
    #[test] fn pergunta_com_previa_ignora_o_desenho() {
        let borda = "─".repeat(120);
        let tela = format!("{borda}\n☐ Layout\n\nQual layout de painel você prefere?\n\n❯ 1. Lado a lado          ┌────────────────────────────┐\n  2. Empilhado            │ +-----------+-----------+  │\n  3. Grade 2x2            │ | claude    | codex     |  │\n                          │ |  > _      |  > _      |  │\n                          │ +-----------+-----------+  │\n                          └────────────────────────────┘\n\n                          Notes: press n to add notes\n\n{borda}\n  Chat about this\n\nEnter to select · ↑/↓ to navigate · n to add notes · Esc to cancel\n");
        let menu = escolha(&tela).expect("pergunta com prévia reconhecida");
        assert_eq!(menu.pergunta, "Qual layout de painel você prefere?");
        assert!(menu.previa, "com prévia o número só move: precisa de Enter");
        assert_eq!(menu.opcoes.iter().map(|o| (o.numero, o.rotulo.as_str(), o.descricao.as_deref())).collect::<Vec<_>>(), vec![
            (1, "Lado a lado", None), (2, "Empilhado", None), (3, "Grade 2x2", None),
        ]);
    }

    #[test] fn le_os_tokens_do_turno_da_linha_de_status() {
        assert_eq!(tokens_do_turno("· Propagating… (5s · ↓ 113 tokens · thinking with low effort)").as_deref(), Some("113"));
        assert_eq!(tokens_do_turno("✻ Pensando… (1m 12s · ↑ 1.2k tokens · esc to interrupt)").as_deref(), Some("1.2k"));
        assert_eq!(tokens_do_turno("antigo (↓ 5 tokens)\n✢ Agora (3s · ↓ 40 tokens)").as_deref(), Some("40"));
        assert_eq!(tokens_do_turno("• Working (12s • esc to interrupt)"), None);
        assert_eq!(tokens_do_turno("fala sobre tokens em geral"), None);
    }

    /// Exemplo em cinza depois do cursor não é rascunho; o mesmo texto sem `dim` é.
    #[test] fn exemplo_em_cinza_nao_bloqueia_mas_texto_normal_bloqueia() {
        let mut cinza = Interaction::new(5,40);
        // Prompt, exemplo em `dim` (SGR 2), e o cursor volta para logo depois do símbolo.
        cinza.parser.process("[?2004h❯ [2mTry this[22m[1;3H".as_bytes());
        assert!(ready(cinza.parser.screen(),"claude"));

        let mut digitado = Interaction::new(5,40);
        digitado.parser.process("[?2004h❯ Try this[1;3H".as_bytes());
        assert!(!ready(digitado.parser.screen(),"claude"));
    }

    /// Tela real da 2.1.302 num agente recém-aberto: cada palavra do exemplo em `dim` separado, os
    /// espaços entre elas sem estilo e um NBSP depois do `❯`.
    #[test] fn exemplo_com_palavras_apagadas_em_separado_continua_vazio() {
        let mut real = Interaction::new(5,60);
        real.parser.process("\x1b[?2004h\u{276f}\u{a0}\x1b[2mTry\x1b[22m \x1b[2m\"fix\x1b[22m \x1b[2mlint\x1b[22m \x1b[2merrors\"\x1b[22m\x1b[K\x1b[1;3H".as_bytes());
        assert!(ready(real.parser.screen(),"claude"));

        let mut rascunho = Interaction::new(5,60);
        rascunho.parser.process("\x1b[?2004h\u{276f}\u{a0}fix lint\x1b[1;3H".as_bytes());
        assert!(!ready(rascunho.parser.screen(),"claude"));
    }

    /// Parado antes de a CLI ler o prompt: o texto volta ao campo e o "parar" precisa apagá-lo.
    #[test] fn prompt_devolvido_ao_campo_conta_como_sobra_so_com_o_turno_parado() {
        let mut parado = Interaction::new(5,60);
        parado.parser.process("\x1b[?2004h\u{276f}\u{a0}rode os testes".as_bytes());
        assert!(sobra_no_campo(parado.parser.screen(),"claude"));
        assert!(!ready(parado.parser.screen(),"claude"));

        let mut trabalhando = Interaction::new(5,60);
        trabalhando.parser.process("\x1b[?2004h✻ Pensando… (esc to interrupt)\r\n\u{276f}\u{a0}rode os testes".as_bytes());
        assert!(!sobra_no_campo(trabalhando.parser.screen(),"claude"));

        let mut vazio = Interaction::new(5,60);
        vazio.parser.process("\x1b[?2004h\u{276f}\u{a0}".as_bytes());
        assert!(!sobra_no_campo(vazio.parser.screen(),"claude"));
    }

    #[test] fn trust_dialog_moves_to_yes_before_confirming() {
        // Tela real da 2.1.272: "No, exit" vem selecionado.
        let screen = " Quick safety check: Is this a project you created or one you trust?\n ❯ No, exit\n   Yes, I trust this folder\n Enter to confirm · Esc to cancel";
        assert_eq!(trust_dialog_keys(screen), Some("\x1b[B"));
        assert_eq!(trust_dialog_keys(&screen.replace("❯ No, exit\n   Yes", "  No, exit\n ❯ Yes")), Some("\r"));
        assert_eq!(trust_dialog_keys(" ❯ 1. Yes, proceed\n   2. No, exit"), Some("\r"));
        assert_eq!(trust_dialog_keys("❯ "), None);
        assert_eq!(trust_dialog_keys("Do you want to proceed?\n❯ 1. Yes\n3. No"), None);
    }
    #[test] fn unix_agent_process_must_descend_from_pty() {
        let ps = "  10     1 -zsh\n  20    10 node /Users/a/.npm/bin/claude --session-id x\n  30     1 /opt/homebrew/bin/codex";
        assert!(agent_descends_from(ps, 10, "claude"));
        assert!(!agent_descends_from(ps, 10, "codex")); // codex existe, mas fora desta PTY
        assert!(!agent_descends_from("  40    10 vim notes/claude.md", 10, "claude"));
        // Claude Code com título de conversa: o `args` vira o título; o `comm` do macOS (caminho
        // inteiro, com espaço no nome da pasta) é o que ainda diz quem é.
        let titulo = "  10     1 -zsh\n  20    10 ✳ Corrigir login\n  10     1 -zsh\n  20    10 /Users/Ana Lima/.local/bin/claude";
        assert!(agent_descends_from(titulo, 10, "claude"));
        assert!(!agent_descends_from("  20    10 ✳ Corrigir login", 10, "claude"));
    }
    #[test] fn never_approves_generic_output_or_persistent_choice() {
        assert!(approval("Allow? (y/n)","claude").is_none());
        assert!(approval("Do you want to proceed?\n1. Always allow\n3. No","claude").is_none());
        assert_eq!(approval("Do you want to proceed?\n❯ 1. Yes\n2. Yes, always\n3. No","claude").unwrap().0,"1\r");
    }

    /// Telas reais (Claude Code 2.1.305 e Codex 0.154.0, capturadas pela `sonda_aprovacao`): a mensagem
    /// da pessoa fica visível acima com o mesmo `❯`/`›` da opção marcada, e nada era reconhecido.
    /// Tela real do `/permissions` (Codex 0.154.0), aberta em Read Only e no padrão da conta.
    #[test] fn menu_de_permissoes_do_codex() {
        let menu = |marcada: u8| {
            let rotulos = ["Read Only", "Ask for approval", "Approve for me", "Full Access"];
            let linhas: Vec<String> = rotulos.iter().enumerate().map(|(i, r)| {
                let n = i as u8 + 1;
                format!("{} {n}. {r}{}  descrição", if n == marcada { "›" } else { " " }, if n == marcada { " (current)" } else { "" })
            }).collect();
            format!("  Update Model Permissions\n\n{}\n\n  Press enter to confirm or esc to go back\n", linhas.join("\n"))
        };
        assert_eq!(menu_de_permissoes(&menu(1), AUTO_DO_CODEX), Some((1, 3)));
        assert_eq!(menu_de_permissoes(&menu(3), AUTO_DO_CODEX), Some((3, 3)));
        assert_eq!(menu_de_permissoes("› Ask Codex to do anything", AUTO_DO_CODEX), None);
    }

    #[test] fn aprovacao_real_com_a_mensagem_visivel() {
        let claude = "❯ Run exactly this shell command and nothing else: cmd /c ver\n  ⎿  $ cmd /c ver\n────────\n PowerShell command\n Show Windows version\n cmd /c ver\n This command requires approval\n Do you want to proceed?\n ❯ 1. Yes\n   2. Yes, and don’t ask again for: cmd /c ver\n   3. No\n Esc to cancel · Tab to amend\n";
        assert_eq!(approval(claude, "claude").map(|a| (a.0, a.1)), Some(("1\r".into(), "3\r".into())));
        let codex = "› Test of the approval UI: run the shell command 'cmd /c echo oi'\n• Running cmd /c echo oi\n  Would you like to run the following command?\n  Environment: local\n  Reason: validar a interface\n  $ cmd /c echo oi\n› 1. Yes, proceed (y)\n  2. Yes, and don't ask again for commands that start with `cmd /c echo oi` (p)\n  3. No, and tell Codex what to do differently (esc)\n  Press enter to confirm or esc to cancel\n";
        assert_eq!(approval(codex, "codex").map(|a| (a.0, a.1)), Some(("y".into(), "\x1b".into())));
    }

    /// Acervo de telas (`tests-fixtures/telas/<cli>.<esperado>.<nome>.txt`): cada arquivo diz o que o
    /// engine tem de reconhecer nele. CLI mudou o texto? Capture com a `sonda_aprovacao`
    /// (`OMNI_SONDA_SALVAR`) e este teste aponta o que deixou de casar, sem escrever Rust.
    #[test] fn telas_do_acervo() {
        let pasta = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests-fixtures/telas");
        let mut vistas = 0;
        for entrada in std::fs::read_dir(&pasta).unwrap().flatten() {
            let nome = entrada.file_name().to_string_lossy().into_owned();
            let partes: Vec<&str> = nome.splitn(3, '.').collect();
            let [cli, esperado, _] = partes[..] else { continue };
            if !nome.ends_with(".txt") { continue; }
            let tela = std::fs::read_to_string(entrada.path()).unwrap().replace("\r\n", "\n");
            assert!(matches!(esperado, "aprovacao" | "escolha" | "nada"), "{nome}: esperado desconhecido");
            let aprova = approval(&tela, cli).is_some();
            assert_eq!(aprova, esperado == "aprovacao", "{nome}: aprovação");
            // Como em `capabilities`: com aprovação na tela, menu nem é procurado.
            assert_eq!(!aprova && escolha(&tela).is_some(), esperado == "escolha", "{nome}: escolha");
            vistas += 1;
        }
        assert!(vistas >= 5, "acervo sumiu? só {vistas} telas");
    }

    /// Diagnóstico: reproduz a saída de uma sessão viva (`GET /conversas/{id}/terminal` salvo em
    /// arquivo) e mostra o que o engine vê. `OMNI_TELA_JSON=<arquivo> cargo test -p omni-engine reproduzir_tela -- --ignored --nocapture`
    #[test] #[ignore = "diagnóstico manual"] fn reproduzir_tela() {
        let j: serde_json::Value = serde_json::from_slice(&std::fs::read(std::env::var("OMNI_TELA_JSON").unwrap()).unwrap()).unwrap();
        let mut ctx = Interaction::new(j["rows"].as_u64().unwrap() as u16, j["cols"].as_u64().unwrap() as u16);
        ctx.parser.process(&sem_substituto(j["data"].as_str().unwrap().as_bytes()));
        let tela = linha_a_linha(ctx.parser.screen());
        println!("=== TELA ===\n{tela}\n=== ready={} composer_vazio={} escolha={:?} approval={:?} cursor={:?}",
            ready(ctx.parser.screen(), "claude"), composer_vazio(ctx.parser.screen()), escolha(&tela).map(|e| e.pergunta), approval(&tela, "claude").map(|a| a.0), ctx.parser.screen().cursor_position());
    }
}

/// Sonda manual: abre a CLI de verdade numa PTY, pede um comando inofensivo e imprime a tela de
/// aprovação e o que `approval` reconhece. `OMNI_SONDA=claude|codex cargo test -p omni-engine sonda_aprovacao -- --ignored --nocapture`
#[cfg(test)]
mod sonda {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::{Read, Write};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};
    use super::composer_vazio;

    #[test]
    #[ignore = "abre a CLI real e gasta um pouco de uso da conta"]
    fn sonda_aprovacao() {
        let cli = std::env::var("OMNI_SONDA").unwrap_or_else(|_| "claude".into());
        let pty = native_pty_system().openpty(PtySize { rows: 40, cols: 120, pixel_width: 0, pixel_height: 0 }).unwrap();
        let pedido = std::env::var("OMNI_SONDA_PEDIDO").unwrap_or_else(|_| "Run exactly this shell command and nothing else: cmd /c ver".into());
        let mut comando = CommandBuilder::new(std::env::var("OMNI_SONDA_BIN").unwrap_or_else(|_| format!("{cli}.exe")));
        if cli == "codex" { comando.arg("-c"); comando.arg("check_for_update_on_startup=false"); if let Ok(extra) = std::env::var("OMNI_SONDA_ARGS") { for a in extra.split('|').filter(|a| !a.is_empty()) { comando.arg(a); } } }
        if cli == "claude" { for a in ["--permission-mode", "default"] { comando.arg(a); } }
        if !pedido.is_empty() { comando.arg(&pedido); }
        comando.cwd(std::env::var("OMNI_SONDA_CWD").unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into_owned()));
        let mut filho = pty.slave.spawn_command(comando).unwrap();
        let parser = Arc::new(Mutex::new(vt100::Parser::new(40, 120, 0)));
        let mut leitor = pty.master.try_clone_reader().unwrap();
        let mut escritor = pty.master.take_writer().unwrap();
        let p = parser.clone();
        let pedidos = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let total = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let (pd, tt) = (pedidos.clone(), total.clone());
        std::thread::spawn(move || { let mut buf = [0u8; 8192]; while let Ok(n) = leitor.read(&mut buf) { if n == 0 { break; }
            tt.fetch_add(n, std::sync::atomic::Ordering::SeqCst);
            // ConPTY pergunta a posição do cursor (ESC[6n) e espera resposta, como o xterm daria.
            pd.fetch_add(buf[..n].windows(4).filter(|w| *w == b"\x1b[6n").count(), std::sync::atomic::Ordering::SeqCst);
            p.lock().unwrap().process(&super::sem_substituto(&buf[..n])); } });
        let mut respondidos = 0;
        let limite = Instant::now() + Duration::from_secs(120);
        let mut confiou = false;
        let tela = loop {
            std::thread::sleep(Duration::from_millis(500));
            let agora = pedidos.load(std::sync::atomic::Ordering::SeqCst);
            for _ in respondidos..agora { let _ = escritor.write_all(b"\x1b[1;1R"); }
            respondidos = agora;
            let tela = parser.lock().unwrap().screen().contents();
            // Pasta nova: aceita a confiança uma vez (só leitura de `ver`).
            if !confiou && (tela.contains("trust") && (tela.contains("1. Yes") || tela.contains("Yes, I trust"))) { let _ = escritor.write_all(b"\r"); confiou = true; continue; }
            if tela.contains("Do you want") || tela.contains("Would you like") || Instant::now() > limite { break tela; }
            // Troca para o auto do Codex com a mesma função do engine e reabre o menu para conferir.
            if std::env::var("OMNI_SONDA_AUTO").is_ok() && (pedido.is_empty() || tela.lines().any(|l| l.trim() == "• ok")) && super::ready(parser.lock().unwrap().screen(), &cli) {
                let esc = std::cell::RefCell::new(&mut escritor);
                let rotulo = std::env::var("OMNI_SONDA_ROTULO").unwrap_or_else(|_| super::AUTO_DO_CODEX.into());
                let resultado = super::permissoes_do_codex(&rotulo, &|| parser.lock().unwrap().screen().contents(),
                    &|| super::ready(parser.lock().unwrap().screen(), "codex"),
                    &|b: &[u8]| { esc.borrow_mut().write_all(b)?; Ok(()) });
                println!("=== permissoes_do_codex: {resultado:?}");
                std::thread::sleep(Duration::from_secs(1));
                println!("=== DEPOIS DO ENTER ===\n{}\n=== FIM", parser.lock().unwrap().screen().contents());
                let _ = esc.borrow_mut().write_all(b"/permissions");
                std::thread::sleep(Duration::from_millis(300));
                let _ = esc.borrow_mut().write_all(b"\r");
                std::thread::sleep(Duration::from_secs(3));
                break parser.lock().unwrap().screen().contents();
            }
            // Pedido sem aprovação: espera o turno acabar (campo vazio de novo, sem "esc to interrupt").
            if std::env::var("OMNI_SONDA_ATE_PRONTO").is_ok() && tela.contains("\n60") && !tela.to_lowercase().contains("esc to interrupt")
                && composer_vazio(parser.lock().unwrap().screen()) { break tela; }
            // Digita um comando (ex.: `/permissions`) no campo e mostra a tela que ele abre.
            if let Ok(digitar) = std::env::var("OMNI_SONDA_DIGITAR") {
                if tela.contains("Ask Codex to do anything") || composer_vazio(parser.lock().unwrap().screen()) {
                    std::thread::sleep(Duration::from_secs(1));
                    let _ = escritor.write_all(digitar.as_bytes());
                    std::thread::sleep(Duration::from_millis(600));
                    let _ = escritor.write_all(b"\r");
                    std::thread::sleep(Duration::from_secs(3));
                    break parser.lock().unwrap().screen().contents();
                }
                continue;
            }
            // Sem pedido: só abre, aperta shift+tab N vezes e mostra o rodapé de cada uma.
            if pedido.is_empty() && (tela.contains("? for shortcuts") || tela.contains("shift+tab") || Instant::now() + Duration::from_secs(100) > limite) {
                for i in 0..3 {
                    std::thread::sleep(Duration::from_secs(2));
                    let rodape: Vec<String> = parser.lock().unwrap().screen().contents().lines().rev().filter(|l| !l.trim().is_empty()).take(3).map(str::to_owned).collect();
                    println!("--- shift+tab x{i}: {rodape:?} modo_atual={:?}", super::modo_atual(parser.lock().unwrap().screen()));
                    let _ = escritor.write_all(b"\x1b[Z");
                }
                break parser.lock().unwrap().screen().contents();
            }
        };
        std::thread::sleep(Duration::from_secs(1));
        let tela = { let t = parser.lock().unwrap().screen().contents(); if t.trim().is_empty() { tela } else { t } };
        println!("bytes={}", total.load(std::sync::atomic::Ordering::SeqCst));
        println!("=== TELA ({cli}) ===\n{tela}\n=== approval: {:?}", super::approval(&tela, &cli).map(|a| (a.0, a.1)));
        { let p = parser.lock().unwrap(); println!("=== ready: {} · modo: {:?}", super::ready(p.screen(), &cli), super::modo_com_provider(p.screen(), &cli)); }
        // `OMNI_SONDA_SALVAR=aprovacao.comando-2.1.310` grava a tela no acervo do `telas_do_acervo`.
        if let Ok(nome) = std::env::var("OMNI_SONDA_SALVAR") {
            let destino = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("tests-fixtures/telas/{cli}.{nome}.txt"));
            std::fs::write(&destino, &tela).unwrap();
            println!("=== salvo em {}", destino.display());
        }
        let _ = escritor.write_all(b"\x1b"); std::thread::sleep(Duration::from_millis(500));
        let _ = filho.kill();
    }
}
