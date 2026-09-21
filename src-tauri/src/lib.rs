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
        .invoke_handler(tauri::generate_handler![
            engine_client::engine_status,
            account_usage::account_usage,
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
            engine_client::wsl_distros,
            engine_client::rename_conversation,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
