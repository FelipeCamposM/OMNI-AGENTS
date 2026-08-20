// Prevents console window from appearing on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    omni_agents_lib::run()
}
