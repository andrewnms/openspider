//! Tauri shell for OpenSpider.
//!
//! On startup we (1) resolve a vault path under the user's data dir,
//! (2) auto-migrate from a legacy kbrain vault if one is sitting next door,
//! (3) initialize the vault if needed, and (4) spin up the OpenSpider MCP
//! server in a background tokio task. The webview is bound to
//! localhost:7700/mcp via the same JSON-RPC protocol any other MCP client
//! uses.

use anyhow::{Context, Result};
use openspider_core::Vault;
use openspider_mcp::{tools, AppState};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

const OPENSPIDER_ADDR: &str = "127.0.0.1:7700";
const S16_TOOL_CATALOG: &str = include_str!("../../../crates/s16_tools.json");

#[tauri::command]
fn get_vault_path() -> Result<String, String> {
    Ok(default_vault_path().map_err(|e| e.to_string())?
        .display().to_string())
}

#[tauri::command]
fn get_mcp_endpoint() -> String {
    format!("http://{OPENSPIDER_ADDR}/mcp")
}

fn default_vault_path() -> Result<PathBuf> {
    let dirs = directories::BaseDirs::new()
        .ok_or_else(|| anyhow::anyhow!("no home directory"))?;
    Ok(dirs.data_dir().join("OpenSpider").join("vault"))
}

fn legacy_kbrain_vault_path() -> Result<PathBuf> {
    let dirs = directories::BaseDirs::new()
        .ok_or_else(|| anyhow::anyhow!("no home directory"))?;
    Ok(dirs.data_dir().join("kbrain").join("vault"))
}

/// If a kbrain vault exists from a previous install AND the OpenSpider vault
/// is empty (just the auto-init dirs, no real data), copy the kbrain data
/// over. Idempotent via a marker file inside .openspider/.
fn auto_migrate_from_kbrain(new_vault: &Path) -> Result<()> {
    let old = match legacy_kbrain_vault_path() {
        Ok(p) => p,
        Err(_) => return Ok(()),
    };
    if !old.exists() { return Ok(()) }

    let marker = new_vault.join(".openspider").join("migrated_from_kbrain.flag");
    if marker.exists() { return Ok(()) }

    if !is_vault_empty(new_vault)? {
        // User already has data here; never clobber.
        return Ok(());
    }

    eprintln!("openspider: auto-migrating legacy kbrain vault from {old:?}");

    for sub in &["databases", "docs", "agents", "skills", "sites", "files"] {
        let from = old.join(sub);
        let to = new_vault.join(sub);
        if from.exists() {
            copy_dir_recursive(&from, &to)
                .with_context(|| format!("copying {sub} from legacy vault"))?;
        }
    }

    // Also bring across config / credentials / secrets / oauth-providers
    // from .kbrain/ → .openspider/. Skip runs/ and sidecar/ (regenerated).
    let from_kbrain = old.join(".kbrain");
    let to_os = new_vault.join(".openspider");
    if from_kbrain.exists() {
        for f in &["config.json", "credentials.json", "secrets.json", "oauth-providers.json"] {
            let src = from_kbrain.join(f);
            let dst = to_os.join(f);
            if src.exists() && !dst.exists() {
                let _ = fs::copy(&src, &dst);
            }
        }
    }

    if let Some(parent) = marker.parent() { let _ = fs::create_dir_all(parent); }
    let _ = fs::write(&marker,
        format!("Migrated from {} on {}\n", old.display(), chrono_now()));
    eprintln!("openspider: migration complete.");
    Ok(())
}

fn chrono_now() -> String {
    // tiny, no-deps timestamp
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("{secs}")
}

/// Empty = no top-level dirs OR every top-level data dir contains only
/// hidden / underscore-prefixed entries (the auto-init scaffolding).
fn is_vault_empty(vault: &Path) -> Result<bool> {
    for sub in &["databases", "docs", "agents", "skills", "sites", "files"] {
        let dir = vault.join(sub);
        if !dir.exists() { continue; }
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let n = entry.file_name();
            let name = n.to_string_lossy();
            if name.starts_with('.') || name.starts_with('_') { continue; }
            return Ok(false); // found real user data
        }
    }
    Ok(true)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

fn boot_openspider_server() -> Result<()> {
    let path = default_vault_path()?;
    let vault = Vault::init(&path)?; // idempotent: creates dirs + .openspider/

    // After init the dirs exist. Run migration check before booting the
    // server, so by the time the UI fetches, the data is in place.
    if let Err(e) = auto_migrate_from_kbrain(&path) {
        eprintln!("openspider: kbrain auto-migration failed (continuing): {e:#}");
    }

    let registry = tools::build_registry(S16_TOOL_CATALOG)?;
    let self_endpoint = format!("http://{OPENSPIDER_ADDR}/mcp");
    let state = AppState {
        vault: Arc::new(vault),
        registry: Arc::new(registry),
        self_endpoint,
        self_token: "kb_localdev".into(),
        oauth_sessions: openspider_mcp::oauth::new_session_store(),
    };
    let rt = tokio::runtime::Runtime::new()?;
    std::thread::spawn(move || {
        rt.block_on(async {
            if let Err(e) = openspider_mcp::serve(state, OPENSPIDER_ADDR).await {
                eprintln!("openspider server failed: {e:#}");
            }
        });
    });
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(e) = boot_openspider_server() {
        eprintln!("failed to start embedded OpenSpider MCP server: {e:#}");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build())
        .invoke_handler(tauri::generate_handler![get_vault_path, get_mcp_endpoint])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
