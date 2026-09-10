fn main() {
    println!("cargo:rustc-check-cfg=cfg(mobile_assets)");
    println!("cargo:rerun-if-changed=../../dist-mobile");
    if std::path::Path::new("../../dist-mobile/index.html").is_file() {
        println!("cargo:rustc-cfg=mobile_assets");
    }
}
