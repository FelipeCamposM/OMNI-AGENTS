mod conversations;
mod account_usage;
mod agent_runtime;
mod mobile;
mod engine_client;
mod git_client;
mod docker_client;
mod ssh;
mod target_files;
mod history;
mod instalacao;
mod profiles;
mod extensoes;
mod relatorio;
mod agentes;
mod fluxos;

pub fn run() {
    #[cfg(unix)]
    engine_client::import_login_shell_path();
    // Antes de qualquer detecção ou spawn: o engine e os terminais herdam este PATH.
    omni_core::cli_path::ampliar_path();
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("links-externos")
                .on_navigation(|_, url| {
                    if eh_do_app(url) {
                        return true;
                    }
                    // Link do chat (`localhost:3000`, docs…) trocava a tela do app pela página, sem
                    // volta: vai para o navegador do sistema e o app fica onde estava.
                    if matches!(url.scheme(), "http" | "https") {
                        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
                    }
                    false
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            engine_client::engine_status,
            account_usage::account_usage,
            extensoes::listar_extensoes,
            extensoes::compartilhamento_de_extensoes,
            extensoes::definir_compartilhamento_de_extensoes,
            extensoes::definir_conta_principal,
            agent_runtime::agent_runtime,
            mobile::mobile_settings,
            mobile::publish_workspace,
            instalacao::install_hint,
            instalacao::install_agent_cli,
            mobile::mobile_check,
            mobile::mobile_totp,
            engine_client::ensure_engine,
            engine_client::terminal_sessions,
            engine_client::agent_cli_statuses,
            engine_client::connect_agent_cli,
            engine_client::ensure_agent_trust,
            engine_client::spawn_terminal,
            engine_client::write_terminal,
            engine_client::resize_terminal,
            engine_client::stop_terminal,
            engine_client::close_terminal,
            engine_client::duplicate_terminal,
            engine_client::restart_terminal,
            engine_client::terminal_snapshot,
            conversations::list_conversations,
            conversations::begin_conversation,
            conversations::attach_terminal,
            conversations::handoff_prompt,
            conversations::plan_switch,
            history::agent_history,
            history::agent_history_transcript,
            profiles::list_profiles,
            profiles::create_profile,
            profiles::rename_profile,
            profiles::delete_profile,
            git_client::git_status,
            docker_client::docker_containers,
            docker_client::docker_container_action,
            git_client::git_diff,
            git_client::git_stage,
            git_client::git_unstage,
            git_client::git_commit,
            git_client::git_push,
            git_client::git_pull,
            git_client::git_fetch,
            engine_client::wsl_distros,
            engine_client::rename_conversation,
            engine_client::rename_session,
            engine_client::engine_api,
            ssh::ssh_connections,
            ssh::save_ssh_connection,
            ssh::remove_ssh_connection,
            ssh::test_ssh_connection,
            ssh::ssh_mount_status,
            ssh::ssh_mount,
            ssh::ssh_unmount,
            target_files::target_project_files,
            git_client::git_branches,
            git_client::git_checkout_branch,
            git_client::git_log_graph,
            git_client::git_conta,
            relatorio::relatorio_ia,
            agentes::agentes_listar,
            agentes::agentes_salvar,
            agentes::agentes_apagar,
            agentes::agentes_restaurar_kit,
            agentes::agentes_instalar_claude,
            agentes::agentes_criar_com_ia,
            agentes::agentes_modelos,
            fluxos::fluxos_criar_com_ia,
            fluxos::fluxos_listar,
            fluxos::fluxos_salvar,
            fluxos::fluxos_apagar,
            fluxos::fluxos_validar,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// A própria tela do app: instalado (`tauri.localhost`/`tauri:`), em dev (Vite na 1420) ou interna
/// (`about:`, `blob:`, `data:`). `localhost` em outra porta é o projeto do usuário, não o app.
fn eh_do_app(url: &tauri::Url) -> bool {
    match url.scheme() {
        "http" | "https" => match url.host_str() {
            Some("tauri.localhost") => true,
            Some("localhost") => url.port() == Some(1420),
            _ => false,
        },
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::eh_do_app;

    #[test]
    fn so_a_tela_do_app_navega_na_janela() {
        let url = |s: &str| tauri::Url::parse(s).unwrap();
        assert!(eh_do_app(&url("http://tauri.localhost/index.html")));
        assert!(eh_do_app(&url("tauri://localhost/")));
        assert!(eh_do_app(&url("http://localhost:1420/")));
        assert!(eh_do_app(&url("about:blank")));
        assert!(!eh_do_app(&url("http://localhost:3000/")));
        assert!(!eh_do_app(&url("https://github.com/x")));
    }
}
