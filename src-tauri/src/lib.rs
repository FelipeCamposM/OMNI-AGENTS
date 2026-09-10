mod conversations;
mod account_usage;
mod mobile;
mod engine_client;
mod git_client;
mod profiles;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            engine_client::engine_status,
            account_usage::account_usage,
            mobile::mobile_settings,
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
            profiles::list_profiles,
            profiles::create_profile,
            profiles::rename_profile,
            profiles::delete_profile,
            git_client::git_status,
            git_client::git_diff,
            git_client::git_stage,
            git_client::git_unstage,
            git_client::git_commit,
            git_client::git_branches,
            git_client::git_checkout_branch,
            git_client::git_log_graph,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
