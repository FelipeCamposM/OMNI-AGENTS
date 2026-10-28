//! O que o OMNI faz sozinho numa conversa, no engine — vale com a janela fechada e para quem usa só
//! a web ou o celular (antes morava no `TerminalPane` do desktop e só rodava com a aba montada):
//!
//! - **Troca de conta no limite de uso**: a CLI avisou o limite → reabre a mesma sessão noutra conta
//!   da mesma IA (`mobile::trocar_de_conta`, o transcript vai junto).
//! - **Compactar depois da troca**: a conta nova não tem a conversa em cache; se ela é grande, um
//!   `/compact` antes do "continue" faz cada passo seguinte custar bem menos.
//! - **Compactar antes do limite**: agente acabou de parar, conta passou do limiar → `/compact` ainda
//!   nesta conta, que tem o cache; numa troca, a conta nova recebe só o resumo.
//!
//! O próprio Claude compacta sozinho ao chegar na janela (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`), com ou
//! sem OMNI: aqui só se compacta abaixo dela. Acima, mandar `/compact` seria pagar duas vezes — a
//! CLI já vai compactar na próxima mensagem.

use super::*;
use omni_core::usage::{AccountUsage, UsageWindow};
use omni_protocol::AvisoAutomatico;
use std::{collections::{HashSet, VecDeque}, time::Duration};

const RITMO: Duration = Duration::from_secs(2);
/// Limite que chega até isso depois do agente ter sido visto trabalhando = caiu no meio de uma tarefa.
const MEIO_DA_TAREFA_MS: u64 = 120_000;
/// Compactar antes do limite só numa conversa em uso: o agente terminou um turno há pouco. Conversa
/// parada nunca dispara nada — o resumo gastaria cota numa conversa que talvez nem continue.
const ACABOU_DE_TRABALHAR_MS: u64 = 180_000;
const OLHAR_USO_A_CADA_MS: u64 = 60_000;
/// Sem outra conta (ou a troca falhou): tenta de novo depois disso. Conta conectada no meio-tempo
/// passa a ser achada sem ninguém reabrir nada.
const TENTAR_TROCA_A_CADA_MS: u64 = 30_000;
/// Retomar (e compactar) uma conversa de centenas de milhares de tokens passa fácil de 2 minutos.
const ESPERAR_CAMPO_ATE_MS: u64 = 600_000;
/// Depois de mandar, a CLI leva um instante para mostrar que começou e o campo parece livre.
const ENTRE_MENSAGENS_MS: u64 = 10_000;
/// Depois da troca, sem cache na conta nova: abaixo disso reler a conversa sai mais barato que resumir.
const PISO_DEPOIS_DA_TROCA: u64 = 150_000;
const COMPACTAR: &str = "/compact";
const CONTINUAR: &str = "Continue de onde parou. (Mensagem automática do OMNI: a conta anterior atingiu o limite de uso e esta conversa foi passada para outra conta.)";

#[derive(Default)]
struct Memoria {
    /// Conversa → última vez em que o agente foi visto trabalhando.
    trabalhou_em: HashMap<String, u64>,
    /// Conta → quando volta ao rodízio. Impede A → B → A sem bloquear conta para sempre.
    esgotadas: HashMap<String, u64>,
    tentar_troca_em: HashMap<String, u64>,
    /// Conversa → conta que acabou de recebê-la: o aviso de limite da conta anterior ainda pode estar
    /// na tela. Vale até ele sumir uma vez.
    recem_trocada: HashMap<String, String>,
    pendentes: HashMap<String, Pendente>,
    /// Conversa + janela de uso já compactadas antes do limite: uma vez por janela.
    compactadas: HashSet<String>,
    olhar_uso_em: HashMap<String, u64>,
}

struct Pendente { mensagens: VecDeque<String>, ate: u64, proxima_em: u64 }

pub(crate) fn iniciar(state: Arc<EngineState>) {
    std::thread::spawn(move || {
        let mut memoria = Memoria::default();
        loop {
            std::thread::sleep(RITMO);
            passo(&state, &mut memoria);
        }
    });
}

fn passo(state: &Arc<EngineState>, mem: &mut Memoria) {
    let agora = now_ms();
    mem.esgotadas.retain(|_, ate| *ate > agora);
    let vivas: Vec<Arc<LiveSession>> = match state.sessions.lock() {
        Ok(sessoes) => sessoes.values().filter_map(|e| match e { SessionEntry::Live(s) => Some(s.clone()), _ => None }).collect(),
        Err(_) => return,
    };
    for sessao in vivas {
        let Ok(meta) = sessao.meta.lock().map(|m| m.clone()) else { continue };
        let (Some(conversa), Some(provider), Some(conta)) = (&meta.conversation_id, meta.provider.as_deref(), &meta.profile_id) else { continue };
        if !matches!(provider, "claude" | "codex") { continue; }
        let limite = meta.notice.as_deref() == Some("usage_limit");
        if meta.state == SessionState::Working && !limite { mem.trabalhou_em.insert(conversa.clone(), agora); }
        if !limite && mem.recem_trocada.get(conversa) == Some(conta) { mem.recem_trocada.remove(conversa); }
        if mandar_pendente(state, &sessao, conversa, mem, agora) { continue; }
        if limite && mem.recem_trocada.get(conversa) != Some(conta) {
            trocar_conta(state, &sessao, &meta, mem, agora);
        } else if provider == "claude" && meta.state == SessionState::Answered && !limite {
            compactar_antes(state, &sessao, &meta, mem, agora);
        }
    }
}

fn avisar(sessao: &LiveSession, tom: &str, texto: String, detalhe: String) {
    if let Ok(mut meta) = sessao.meta.lock() {
        meta.automatico = Some(AvisoAutomatico { tom: tom.into(), texto, detalhe });
    }
}

/// `true` enquanto há mensagem esperando o campo desta conversa (nada mais roda nela até lá).
fn mandar_pendente(state: &Arc<EngineState>, sessao: &Arc<LiveSession>, conversa: &str, mem: &mut Memoria, agora: u64) -> bool {
    let Some(p) = mem.pendentes.get_mut(conversa) else { return false };
    if agora > p.ate { mem.pendentes.remove(conversa); return false; }
    if agora < p.proxima_em || !interaction::capabilities(sessao).prompt { return true; }
    let Some(texto) = p.mensagens.front().cloned() else { mem.pendentes.remove(conversa); return false };
    let chave = format!("auto-{conversa}-{}-{}", p.ate, p.mensagens.len());
    match mobile::enfileirar_sozinho(state, conversa, &chave, texto.clone()) {
        Ok(()) => {
            p.mensagens.pop_front();
            p.proxima_em = agora + ENTRE_MENSAGENS_MS;
            if p.mensagens.is_empty() { mem.pendentes.remove(conversa); }
            let (texto, detalhe) = if texto == COMPACTAR {
                ("compactando", "O OMNI mandou /compact: a conversa vira um resumo e cada passo seguinte gasta bem menos.")
            } else {
                ("continuando", "O OMNI mandou \"continue\" sozinho, porque a troca de conta aconteceu no meio de uma tarefa.")
            };
            avisar(sessao, "working", texto.into(), detalhe.into());
        }
        Err(erro) => {
            mem.pendentes.remove(conversa);
            avisar(sessao, "warning", "mensagem automática falhou".into(),
                format!("Não consegui mandar a mensagem automática ({erro}); mande a próxima mensagem."));
        }
    }
    true
}

fn trocar_conta(state: &Arc<EngineState>, sessao: &LiveSession, meta: &TerminalSession, mem: &mut Memoria, agora: u64) {
    let (Some(conversa), Some(provider), Some(conta)) = (&meta.conversation_id, meta.provider.as_deref(), &meta.profile_id) else { return };
    if mem.tentar_troca_em.get(conversa).is_some_and(|em| agora < *em) { return; }
    mem.tentar_troca_em.insert(conversa.clone(), agora + TENTAR_TROCA_A_CADA_MS);
    let Some(dir) = state.state_file.parent() else { return };
    let perfis: Vec<_> = omni_core::profiles(dir).into_iter().filter(|p| p.provider == provider && p.authenticated).collect();
    let nome = |id: &str| perfis.iter().find(|p| p.id == id).map_or(id.to_owned(), |p| p.name.clone());
    let uso_atual = perfis.iter().find(|p| &p.id == conta).and_then(|p| uso(state, p));
    let volta_em = reset_do_limite(uso_atual.as_ref(), agora);
    mem.esgotadas.insert(conta.clone(), volta_em);
    // Revalida as outras pelo uso gravado: não adianta trocar para uma conta que também está em 100%.
    for perfil in perfis.iter().filter(|p| &p.id != conta) {
        if let Some(ate) = esgotada_ate(uso(state, perfil).as_ref(), agora) { mem.esgotadas.insert(perfil.id.clone(), ate); }
    }
    let quando = hora(volta_em);
    let Some(alvo) = perfis.iter().find(|p| &p.id != conta && !mem.esgotadas.contains_key(&p.id)) else {
        avisar(sessao, "warning", "sem outra conta".into(), format!("O limite de {} foi atingido e não há outra conta conectada disponível. Ela volta ao rodízio {quando}. Uma conta conectada depois disso é usada automaticamente.", nome(conta)));
        return;
    };
    let meio = agora.saturating_sub(mem.trabalhou_em.get(conversa).copied().unwrap_or(0)) < MEIO_DA_TAREFA_MS;
    let ajuste = Compactacao::ler(dir);
    let mensagens = depois_da_troca(meio, &ajuste, contexto(dir, meta));
    match mobile::trocar_de_conta(state, conversa, &alvo.id) {
        Ok(()) => {
            mem.recem_trocada.insert(conversa.clone(), alvo.id.clone());
            if !mensagens.is_empty() {
                mem.pendentes.insert(conversa.clone(), Pendente { mensagens: mensagens.into(), ate: agora + ESPERAR_CAMPO_ATE_MS, proxima_em: agora + 5_000 });
            }
            let seguir = if meio { "segue sozinha de onde parou" } else { "espera a sua próxima mensagem" };
            avisar(sessao, "success", format!("conta trocada: {} → {}", nome(conta), alvo.name),
                format!("Limite de {} atingido; a conversa foi reaberta em {} e {seguir}. {} volta ao rodízio {quando}.", nome(conta), alvo.name, nome(conta)));
        }
        Err(erro) => avisar(sessao, "warning", "troca automática falhou".into(), erro.to_string()),
    }
}

fn compactar_antes(state: &Arc<EngineState>, sessao: &LiveSession, meta: &TerminalSession, mem: &mut Memoria, agora: u64) {
    let (Some(conversa), Some(conta)) = (&meta.conversation_id, &meta.profile_id) else { return };
    if agora.saturating_sub(mem.trabalhou_em.get(conversa).copied().unwrap_or(0)) > ACABOU_DE_TRABALHAR_MS { return; }
    if mem.olhar_uso_em.get(conversa).is_some_and(|em| agora < *em) { return; }
    mem.olhar_uso_em.insert(conversa.clone(), agora + OLHAR_USO_A_CADA_MS);
    let Some(dir) = state.state_file.parent() else { return };
    let ajuste = Compactacao::ler(dir);
    if !ajuste.antes_do_limite { return; }
    let Some(perfil) = omni_core::profiles(dir).into_iter().find(|p| &p.id == conta) else { return };
    let Some(uso) = uso(state, &perfil) else { return };
    let Some(janela) = mais_usada(&uso) else { return };
    if janela.used_percent < f64::from(ajuste.limiar) { return; }
    let chave = format!("{conversa}:{}", janela.resets_at.map_or("?".into(), |r| r.to_string()));
    if mem.compactadas.contains(&chave) { return; }
    let Some(tokens) = contexto(dir, meta) else { return };
    if !(u64::from(ajuste.janela) / 2..u64::from(ajuste.janela)).contains(&tokens) { return; }
    mem.compactadas.insert(chave);
    mem.pendentes.insert(conversa.clone(), Pendente { mensagens: [COMPACTAR.to_owned()].into(), ate: agora + ESPERAR_CAMPO_ATE_MS, proxima_em: 0 });
    avisar(sessao, "working", "compactando antes do limite".into(),
        format!("A conta está em {}% do uso e a conversa tem {}k tokens. O OMNI compacta agora, nesta conta, para que uma troca de conta leve só o resumo.", janela.used_percent.round(), tokens / 1000));
}

/// `/compact` (se compensa e a CLI não vai compactar sozinha) e "continue" (só no meio da tarefa;
/// conversa parada fica como está, compactar ali seria gasto sem ninguém pedir nada).
fn depois_da_troca(meio: bool, ajuste: &Compactacao, contexto: Option<u64>) -> Vec<String> {
    if !meio { return Vec::new(); }
    let compactar = ajuste.depois_da_troca && contexto.is_some_and(|t| (PISO_DEPOIS_DA_TROCA..u64::from(ajuste.janela)).contains(&t));
    compactar.then(|| COMPACTAR.to_owned()).into_iter().chain([CONTINUAR.to_owned()]).collect()
}

fn uso(state: &Arc<EngineState>, perfil: &omni_core::Profile) -> Option<AccountUsage> {
    match perfil.provider.as_str() {
        // Só o que a CLI já gravou: nunca digita `/usage` no terminal de ninguém.
        "claude" => match interaction::account_usage(state, &perfil.id, false).ok()? {
            EngineResponse::AccountUsage { usage } => Some(usage),
            _ => None,
        },
        "codex" => Some(omni_core::usage::read_codex(&perfil.id, Path::new(&perfil.config_dir), now_ms())),
        _ => None,
    }
}

/// Tamanho da conversa agora (o que a última resposta leu). Só Claude.
fn contexto(dir: &Path, meta: &TerminalSession) -> Option<u64> {
    if meta.provider.as_deref() != Some("claude") { return None; }
    let perfil = omni_core::profiles(dir).into_iter().find(|p| Some(&p.id) == meta.profile_id.as_ref())?;
    omni_core::runtime::claude_runtime(Path::new(&perfil.config_dir), &meta.cwd, meta.external_session_id.as_deref()?)?.context_tokens
}

fn janelas(uso: &AccountUsage) -> impl Iterator<Item = &UsageWindow> { uso.primary.iter().chain(uso.secondary.iter()) }

/// Janela mais consumida que ainda não estourou.
fn mais_usada(uso: &AccountUsage) -> Option<&UsageWindow> {
    janelas(uso).filter(|j| j.used_percent < 100.0).max_by(|a, b| a.used_percent.total_cmp(&b.used_percent))
}

/// Quando uma conta comprovadamente esgotada volta. Com mais de uma janela em 100%, vale o reset mais
/// distante: liberar no de 5 h com a semanal estourada só faria outra troca na hora.
fn esgotada_ate(uso: Option<&AccountUsage>, agora: u64) -> Option<u64> {
    uso.into_iter().flat_map(janelas).filter(|j| j.used_percent >= 100.0)
        .filter_map(|j| j.resets_at).map(|r| r.max(0) as u64 * 1000).filter(|r| *r > agora).max()
}

/// O aviso na tela manda mesmo com o uso gravado abaixo de 100%: vale o reset futuro da janela mais
/// usada; sem horário nenhum, 5 h — conta nunca fica bloqueada para sempre.
fn reset_do_limite(uso: Option<&AccountUsage>, agora: u64) -> u64 {
    esgotada_ate(uso, agora).or_else(|| {
        uso.into_iter().flat_map(janelas)
            .filter(|j| j.resets_at.is_some_and(|r| r.max(0) as u64 * 1000 > agora))
            .max_by(|a, b| a.used_percent.total_cmp(&b.used_percent))
            .and_then(|j| j.resets_at).map(|r| r as u64 * 1000)
    }).unwrap_or(agora + 5 * 60 * 60 * 1000)
}

/// "daqui a 2h15" — o engine não sabe o fuso de quem lê; relativo vale em qualquer tela.
fn hora(ms: u64) -> String {
    let minutos = ms.saturating_sub(now_ms()) / 60_000;
    match (minutos / 60, minutos % 60) {
        (0, m) => format!("daqui a {m} min"),
        (h, 0) => format!("daqui a {h}h"),
        (h, m) => format!("daqui a {h}h{m:02}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn janela(usado: f64, reset_s: Option<i64>) -> UsageWindow { UsageWindow { used_percent: usado, window_minutes: 300, resets_at: reset_s, reset_label: None } }
    fn uso(primary: UsageWindow, secondary: Option<UsageWindow>) -> AccountUsage {
        AccountUsage { profile_id: "a".into(), provider: "claude".into(), source: "t".into(), status: "available".into(),
            observed_at_ms: None, primary: Some(primary), secondary, reason: None }
    }

    #[test] fn conta_esgotada_volta_no_reset_mais_distante() {
        let agora = 1_000_000;
        let u = uso(janela(100.0, Some(2_000)), Some(janela(100.0, Some(9_000))));
        assert_eq!(esgotada_ate(Some(&u), agora), Some(9_000_000));
        assert_eq!(esgotada_ate(Some(&uso(janela(80.0, Some(2_000)), None)), agora), None);
        // Aviso na tela com uso gravado abaixo de 100%: reset da mais usada; sem nada, 5 h.
        assert_eq!(reset_do_limite(Some(&uso(janela(80.0, Some(3_000)), Some(janela(20.0, Some(9_000))))), agora), 3_000_000);
        assert_eq!(reset_do_limite(None, agora), agora + 5 * 3_600_000);
    }

    #[test] fn depois_da_troca_so_compacta_abaixo_da_janela_da_cli() {
        let ajuste = Compactacao::default();
        assert!(depois_da_troca(false, &ajuste, Some(300_000)).is_empty(), "conversa parada fica como está");
        assert_eq!(depois_da_troca(true, &ajuste, Some(300_000)), [COMPACTAR, CONTINUAR]);
        assert_eq!(depois_da_troca(true, &ajuste, Some(100_000)), [CONTINUAR], "pequena: reler sai mais barato");
        // Na janela ou acima, a própria CLI compacta na próxima mensagem: /compact seria pagar duas vezes.
        assert_eq!(depois_da_troca(true, &ajuste, Some(450_000)), [CONTINUAR]);
        assert_eq!(depois_da_troca(true, &Compactacao { depois_da_troca: false, ..ajuste }, Some(300_000)), [CONTINUAR]);
    }

    #[test] fn mais_usada_ignora_janela_estourada() {
        let u = uso(janela(100.0, Some(1)), Some(janela(90.0, Some(2))));
        assert_eq!(mais_usada(&u).map(|j| j.used_percent), Some(90.0));
    }
}
