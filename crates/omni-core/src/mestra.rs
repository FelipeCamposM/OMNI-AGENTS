//! Conta mestra das conversas: uma por IA. O arquivo da conversa mora nela, e as outras contas da
//! mesma IA enxergam o **mesmo** arquivo por hard link — a CLI de cada conta só acha conversa dentro
//! da própria pasta, mas o disco guarda uma vez só.
//!
//! Hard link, não symlink: não pede admin nem modo desenvolvedor. A CLI escreve no fim do arquivo
//! (o id NTFS não muda enquanto ele cresce), então o que uma conta escreve a outra já vê. Se um dia
//! uma CLI regravar trocando o arquivo, o link vira cópia de novo — nada se perde, só volta a ocupar
//! dobrado até a próxima junção.

use crate::Profile;
use std::{collections::HashMap, fs, io, path::{Path, PathBuf}};

fn arquivo(dir: &Path) -> PathBuf { dir.join("mestras.json") }

/// `provider → id da conta` escolhido pelo usuário. Sem escolha, vale a primeira conta criada.
pub fn escolhidas(dir: &Path) -> HashMap<String, String> {
    fs::read(arquivo(dir)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn escolher(dir: &Path, provider: &str, conta_id: &str) -> io::Result<()> {
    let mut mapa = escolhidas(dir);
    mapa.insert(provider.to_owned(), conta_id.to_owned());
    fs::write(arquivo(dir), serde_json::to_vec_pretty(&mapa)?)
}

/// A mestra da IA: a escolhida, se ainda existe; senão a primeira inserida (o Padrão nasce primeiro).
pub fn mestra<'a>(dir: &Path, perfis: &'a [Profile], provider: &str) -> Option<&'a Profile> {
    let da_ia = || perfis.iter().filter(move |p| p.provider == provider);
    let escolhida = escolhidas(dir).remove(provider);
    da_ia().find(|p| Some(&p.id) == escolhida.as_ref())
        .or_else(|| da_ia().min_by_key(|p| (p.created_at_ms, !p.builtin)))
}

pub fn mesmo_arquivo(a: &Path, b: &Path) -> bool { same_file::is_same_file(a, b).unwrap_or(false) }

fn modificado(p: &Path) -> Option<std::time::SystemTime> { fs::metadata(p).and_then(|m| m.modified()).ok() }

/// Manda para a Lixeira do Windows (dá para restaurar). Fora do Windows não há lixeira padrão:
/// devolve erro e quem chamou deixa o arquivo onde está.
pub fn para_lixeira(caminho: &Path) -> io::Result<()> {
    #[cfg(windows)] {
        use windows_sys::Win32::UI::Shell::*;
        // O shell não aceita o prefixo `\\?\` do canonicalize; a lista termina com dois NUL.
        let texto = caminho.to_string_lossy();
        let limpo = texto.strip_prefix(r"\\?\").unwrap_or(&texto);
        let de: Vec<u16> = limpo.encode_utf16().chain([0, 0]).collect();
        let mut op = SHFILEOPSTRUCTW {
            hwnd: std::ptr::null_mut(), wFunc: FO_DELETE, pFrom: de.as_ptr(), pTo: std::ptr::null(),
            fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI) as u16,
            fAnyOperationsAborted: 0, hNameMappings: std::ptr::null_mut(), lpszProgressTitle: std::ptr::null(),
        };
        let codigo = unsafe { SHFileOperationW(&mut op) };
        if codigo != 0 || op.fAnyOperationsAborted != 0 || caminho.exists() {
            return Err(io::Error::other(format!("não deu para mandar {} para a Lixeira (código {codigo})", caminho.display())));
        }
        Ok(())
    }
    #[cfg(not(windows))] { Err(io::Error::other(format!("sem Lixeira para {}", caminho.display()))) }
}

/// Liga `nome` ao arquivo `de`; em outro disco (hard link não atravessa volume), copia.
fn ligar(de: &Path, nome: &Path) -> io::Result<()> {
    if let Some(pasta) = nome.parent() { fs::create_dir_all(pasta)?; }
    fs::hard_link(de, nome).or_else(|_| fs::copy(de, nome).map(|_| ()))
}

/// Deixa a conversa num arquivo só: o da `mestre`. A versão mais recente entre a mestra e as
/// `copias` vira a da mestra; cada cópia que não é o mesmo arquivo vai para a Lixeira e volta como
/// link da mestra. Cópia que ainda não existe (a conta para onde a conversa está indo) nasce como
/// link. Devolve quantos bytes foram para a Lixeira.
pub fn unificar(mestre: &Path, copias: &[PathBuf]) -> io::Result<u64> {
    let existentes: Vec<&Path> = std::iter::once(mestre).chain(copias.iter().map(PathBuf::as_path)).filter(|p| p.is_file()).collect();
    let Some(recente) = existentes.iter().copied().max_by_key(|p| modificado(p)) else { return Ok(0) };
    let mut lixo = 0;
    if !mestre.is_file() || !mesmo_arquivo(recente, mestre) {
        if mestre.is_file() { lixo += fs::metadata(mestre)?.len(); para_lixeira(mestre)?; }
        ligar(recente, mestre)?;
    }
    for copia in copias {
        if copia == mestre || (copia.is_file() && mesmo_arquivo(copia, mestre)) { continue; }
        if copia.is_file() { lixo += fs::metadata(copia)?.len(); para_lixeira(copia)?; }
        ligar(mestre, copia)?;
    }
    Ok(lixo)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn perfil(id: &str, criado: u64, builtin: bool) -> Profile {
        Profile { id: id.into(), provider: "claude".into(), name: id.into(), config_dir: String::new(), builtin,
            created_at_ms: criado, last_used_at_ms: None, authenticated: false, email: None }
    }

    #[test]
    fn mestra_e_a_primeira_criada_ate_o_usuario_escolher() {
        let dir = tempfile::tempdir().unwrap();
        let perfis = [perfil("trabalho", 5, false), perfil("claude-padrao", 1, true)];
        assert_eq!(mestra(dir.path(), &perfis, "claude").unwrap().id, "claude-padrao");
        escolher(dir.path(), "claude", "trabalho").unwrap();
        assert_eq!(mestra(dir.path(), &perfis, "claude").unwrap().id, "trabalho");
        escolher(dir.path(), "claude", "apagada").unwrap();
        assert_eq!(mestra(dir.path(), &perfis, "claude").unwrap().id, "claude-padrao");
        assert!(mestra(dir.path(), &perfis, "codex").is_none());
    }

    /// A conversa vai para uma conta nova: nasce lá como link da mestra, sem cópia, e o que é
    /// escrito por uma conta aparece na outra.
    #[test]
    fn levar_para_outra_conta_liga_em_vez_de_copiar() {
        let raiz = tempfile::tempdir().unwrap();
        let mestre = raiz.path().join("padrao/projects/p/x.jsonl");
        let outra = raiz.path().join("trabalho/projects/p/x.jsonl");
        fs::create_dir_all(mestre.parent().unwrap()).unwrap();
        fs::write(&mestre, "a\n").unwrap();
        assert_eq!(unificar(&mestre, &[mestre.clone(), outra.clone()]).unwrap(), 0);
        assert!(mesmo_arquivo(&mestre, &outra));
        use std::io::Write;
        fs::OpenOptions::new().append(true).open(&outra).unwrap().write_all(b"b\n").unwrap();
        assert_eq!(fs::read_to_string(&mestre).unwrap(), "a\nb\n");
        // Já ligadas: rodar de novo não mexe em nada.
        assert_eq!(unificar(&mestre, &[outra.clone()]).unwrap(), 0);
    }

    /// Manda um arquivo de teste de verdade para a Lixeira, por isso fica fora do `cargo test`:
    /// `cargo test -p omni-core mestra -- --ignored`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn copia_mais_nova_vira_a_da_mestra_e_a_velha_vai_para_a_lixeira() {
        let raiz = tempfile::tempdir().unwrap();
        let mestre = raiz.path().join("padrao.jsonl");
        let outra = raiz.path().join("trabalho.jsonl");
        fs::write(&mestre, "velha\n").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30));
        fs::write(&outra, "velha\nnova\n").unwrap();
        assert_eq!(unificar(&mestre, &[outra.clone()]).unwrap(), 6);
        assert_eq!(fs::read_to_string(&mestre).unwrap(), "velha\nnova\n");
        assert!(mesmo_arquivo(&mestre, &outra));
    }
}
