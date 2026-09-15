fn main() {
    // Triple do alvo para achar `binaries/omni-engine-<triple>` em dev (convenção de sidecar do Tauri).
    println!("cargo:rustc-env=OMNI_TARGET_TRIPLE={}", std::env::var("TARGET").unwrap());
    tauri_build::build()
}
