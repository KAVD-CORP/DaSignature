fn main() {
    // Windows (MSVC): SQLCipher's crypto provider is the vendored LibTomCrypt (vendor/libtomcrypt
    // README). The library is named `crypto` because libsqlite3-sys links `crypto` when it isn't
    // given an OpenSSL; LIBSQLITE3_FLAGS=-DSQLCIPHER_CRYPTO_LIBTOMCRYPT selects the provider.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let root = std::path::Path::new("vendor/libtomcrypt/src");
        let mut files = Vec::new();
        collect(root, &mut files);
        cc::Build::new()
            .include(root.join("headers"))
            .define("_CRT_SECURE_NO_WARNINGS", None)
            .define("LTC_NO_TEST", None)
            .warnings(false)
            .files(files)
            .compile("crypto");
        println!("cargo:rustc-link-lib=advapi32");
        println!("cargo:rerun-if-changed=vendor/libtomcrypt");
    }
    tauri_build::build()
}

fn collect(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            collect(&p, out);
        } else if p.extension().is_some_and(|x| x == "c") {
            out.push(p);
        }
    }
}
