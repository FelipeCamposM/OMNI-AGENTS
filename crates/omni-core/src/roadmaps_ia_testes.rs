use super::*;

#[test]
fn argumentos_do_claude_so_com_a_web_e_sem_historico() {
    let (args, entrada) = argumentos("claude", Some("sonnet"), true, "SISTEMA", "pedido").unwrap();
    let junto = args.join(" ");
    assert!(junto.contains("-p --output-format json --no-session-persistence --strict-mcp-config"));
    assert!(junto.contains("--tools WebSearch,WebFetch --allowedTools WebSearch,WebFetch"));
    assert!(junto.contains("--model sonnet"));
    assert_eq!(args.last().unwrap(), "SISTEMA");
    assert_eq!(entrada, "pedido", "o pedido vai pela entrada, não pela linha de comando");
    let (sem_web, _) = argumentos("claude", None, false, "S", "p").unwrap();
    let i = sem_web.iter().position(|a| a == "--tools").unwrap();
    assert_eq!(sem_web[i + 1], "", "sem web: nenhuma ferramenta");
    assert!(!sem_web.contains(&"--allowedTools".to_string()) && !sem_web.contains(&"--model".to_string()));
}

#[test]
fn argumentos_do_codex_efemero_e_so_leitura() {
    let (args, entrada) = argumentos("codex", Some("gpt-5.5"), true, "SISTEMA", "pedido").unwrap();
    let junto = args.join(" ");
    assert!(junto.starts_with("exec --json --ephemeral --skip-git-repo-check --sandbox read-only"));
    assert!(junto.contains("web_search=\"live\""));
    assert!(junto.contains("--model gpt-5.5"));
    assert_eq!(args.last().unwrap(), "-");
    assert!(entrada.starts_with("SISTEMA") && entrada.ends_with("pedido"));
    let (sem_web, _) = argumentos("codex", None, false, "S", "p").unwrap();
    assert!(sem_web.join(" ").contains("web_search=\"disabled\""));
}

#[test]
fn recusa_cli_e_modelo_estranhos() {
    assert!(argumentos("gemini", None, false, "s", "p").is_err());
    for modelo in ["--dangerously-skip-permissions", "a b", "x;rm", "$(x)"] {
        assert!(argumentos("claude", Some(modelo), false, "s", "p").is_err(), "{modelo}");
    }
    assert!(argumentos("claude", Some("claude-sonnet-5-5[1m]"), false, "s", "p").is_ok());
}

#[test]
fn le_a_resposta_de_cada_cli() {
    assert_eq!(resposta_da_saida("claude", r#"{"type":"result","subtype":"success","is_error":false,"result":"oi"}"#).unwrap(), "oi");
    assert!(resposta_da_saida("claude", r#"{"type":"result","subtype":"error_max_turns","is_error":true,"result":""}"#).is_err());
    assert!(resposta_da_saida("claude", "lixo").is_err());
    let codex = [
        r#"{"type":"thread.started","thread_id":"t"}"#,
        r#"{"type":"item.completed","item":{"type":"reasoning","text":"pensando"}}"#,
        r#"{"type":"item.completed","item":{"type":"agent_message","text":"primeira"}}"#,
        r#"{"type":"item.completed","item":{"type":"agent_message","text":"final"}}"#,
        r#"{"type":"turn.completed"}"#,
    ].join("\n");
    assert_eq!(resposta_da_saida("codex", &codex).unwrap(), "final");
    let falhou = r#"{"type":"turn.failed","error":{"message":"sem crédito"}}"#;
    assert!(resposta_da_saida("codex", falhou).unwrap_err().contains("sem crédito"));
}

#[cfg(unix)]
fn cli_falsa(dir: &Path, nome: &str, corpo: &str) -> PathBuf {
    use std::os::unix::fs::PermissionsExt;
    let caminho = dir.join(nome);
    std::fs::write(&caminho, format!("#!/bin/sh\n{corpo}\n")).unwrap();
    std::fs::set_permissions(&caminho, std::fs::Permissions::from_mode(0o755)).unwrap();
    caminho
}

#[cfg(unix)]
#[test]
fn claude_falso_recebe_o_pedido_pela_entrada_e_responde() {
    let dir = tempfile::tempdir().unwrap();
    // Ecoa a entrada no campo `result` (sem aspas no texto de teste) e confere a conta pelo ambiente.
    let exe = cli_falsa(dir.path(), "claude-falso", r#"pedido=$(cat); printf '{"type":"result","is_error":false,"result":"%s|%s"}\n' "$pedido" "$CLAUDE_CONFIG_DIR""#);
    let (args, entrada) = argumentos("claude", None, true, "SISTEMA", "monte meu plano").unwrap();
    let env = vec![("CLAUDE_CONFIG_DIR".to_owned(), "/perfil/sintetico".to_owned())];
    let saida = rodar("teste:claude", &exe, &args, &entrada, &env, dir.path(), Duration::from_secs(10)).unwrap();
    assert_eq!(resposta_da_saida("claude", &saida).unwrap(), "monte meu plano|/perfil/sintetico");
}

#[cfg(unix)]
#[test]
fn codex_falso_responde_em_jsonl() {
    let dir = tempfile::tempdir().unwrap();
    let exe = cli_falsa(dir.path(), "codex-falso", r#"cat >/dev/null; echo '{"type":"thread.started","thread_id":"x"}'; echo '{"type":"item.completed","item":{"type":"agent_message","text":"{\"tipo\":\"pergunta\"}"}}'"#);
    let (args, entrada) = argumentos("codex", None, false, "S", "p").unwrap();
    let saida = rodar("teste:codex", &exe, &args, &entrada, &[], dir.path(), Duration::from_secs(10)).unwrap();
    assert_eq!(resposta_da_saida("codex", &saida).unwrap(), r#"{"tipo":"pergunta"}"#);
}

#[cfg(unix)]
#[test]
fn erro_da_cli_vira_mensagem_e_libera_a_chave() {
    let dir = tempfile::tempdir().unwrap();
    let exe = cli_falsa(dir.path(), "quebrada", "cat >/dev/null; echo 'Not logged in' >&2; exit 1");
    let erro = rodar("teste:erro", &exe, &[], "x", &[], dir.path(), Duration::from_secs(10)).unwrap_err();
    assert!(erro.contains("Not logged in"), "{erro}");
    let ok = cli_falsa(dir.path(), "ok", "cat >/dev/null; echo '{}'");
    assert!(rodar("teste:erro", &ok, &[], "x", &[], dir.path(), Duration::from_secs(10)).is_ok(), "a chave ficou livre");
}

#[cfg(unix)]
#[test]
fn cancelar_mata_a_cli_e_limite_de_tempo_tambem() {
    let dir = tempfile::tempdir().unwrap();
    let lenta = cli_falsa(dir.path(), "lenta", "cat >/dev/null; sleep 30; echo '{}'");
    let (exe, pasta) = (lenta.clone(), dir.path().to_path_buf());
    let fio = std::thread::spawn(move || rodar("teste:cancelar", &exe, &[], "x", &[], &pasta, Duration::from_secs(60)));
    let inicio = Instant::now();
    // Espera a CLI nascer; um segundo pedido na mesma chave é recusado enquanto isso.
    while !em_andamento().lock().unwrap().get("teste:cancelar").is_some_and(|e| e.pid.is_some()) { std::thread::sleep(Duration::from_millis(20)); }
    assert!(rodar("teste:cancelar", &lenta, &[], "x", &[], dir.path(), Duration::from_secs(1)).unwrap_err().contains("em andamento"));
    cancelar("teste:cancelar");
    assert_eq!(fio.join().unwrap().unwrap_err(), CANCELADO);
    assert!(inicio.elapsed() < Duration::from_secs(10));

    let inicio = Instant::now();
    let erro = rodar("teste:limite", &lenta, &[], "x", &[], dir.path(), Duration::from_millis(300)).unwrap_err();
    assert!(erro.contains("demorou demais"));
    assert!(inicio.elapsed() < Duration::from_secs(10));
}
