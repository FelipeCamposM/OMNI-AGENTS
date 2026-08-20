// Prevents console window from appearing on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pdf_to_markdown_lib::run()
}
