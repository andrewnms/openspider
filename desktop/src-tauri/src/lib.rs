//! Tauri shell for openspider.
//!
//! On startup we (1) resolve a vault path under the user's data dir,
//! initializing it if needed, and (2) spin up the openspider MCP server in a
//! background tokio task. The webview is bound to localhost:7700/mcp via the
//! same JSON-RPC protocol any other MCP client uses.
//!
//! The webview fetches `http://127.0.0.1:7700/mcp` directly — no Tauri
//! command bridging needed. That means the React side stays portable
//! (works against a remote openspider too).

use anyhow::Result;
use openspider_core::Vault;
use openspider_mcp::{tools, AppState};
use std::path::PathBuf;
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
    let p = dirs.data_dir().join("OpenSpider").join("vault");
    Ok(p)
}

fn boot_openspider_server() -> Result<()> {
    let path = default_vault_path()?;
    let vault = Vault::init(&path)?; // idempotent
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
        eprintln!("failed to start embedded openspider MCP server: {e:#}");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build())
        .invoke_handler(tauri::generate_handler![get_vault_path, get_mcp_endpoint])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
