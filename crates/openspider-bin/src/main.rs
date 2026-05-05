//! `brain` — openspider CLI dispatcher.
//!
//! Subcommands:
//!   brain init [path]           — initialize a vault directory
//!   brain serve [--port N]      — start the MCP server
//!   brain status [path]         — show vault path + cache stats

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use openspider_core::Vault;
use openspider_mcp::{tools, AppState};
use std::path::PathBuf;
use std::sync::Arc;

const S16_TOOL_CATALOG: &str = include_str!("../../s16_tools.json");

#[derive(Parser)]
#[command(name = "spider", version, about = "OpenSpider — your local Brain (Rust + MCP)")]
struct Cli {
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Initialize a new vault.
    Init {
        /// Vault path (default: ./brain-vault)
        path: Option<PathBuf>,
    },
    /// Start the MCP server against a vault.
    Serve {
        /// Vault path (default: $KBRAIN_VAULT or ./brain-vault)
        #[arg(long)]
        vault: Option<PathBuf>,
        /// Bind address (default: 127.0.0.1:7700)
        #[arg(long, default_value = "127.0.0.1:7700")]
        addr: String,
    },
    /// Show vault status.
    Status {
        #[arg(long)]
        vault: Option<PathBuf>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,openspider=debug".into()),
        )
        .init();

    let cli = Cli::parse();
    match cli.command {
        Cmd::Init { path } => init(path),
        Cmd::Serve { vault, addr } => serve(vault, addr).await,
        Cmd::Status { vault } => status(vault),
    }
}

fn resolve_vault_path(arg: Option<PathBuf>) -> PathBuf {
    arg.or_else(|| std::env::var("KBRAIN_VAULT").ok().map(PathBuf::from))
        .unwrap_or_else(default_vault_path)
}

/// Default vault location when no flag or env var is set. Matches the Tauri
/// desktop app so a user who runs `brain serve` and a user who launches
/// OpenSpider.app point at the same data.
fn default_vault_path() -> PathBuf {
    if let Some(dirs) = directories::BaseDirs::new() {
        return dirs.data_dir().join("OpenSpider").join("vault")
    }
    PathBuf::from("./brain-vault")
}

fn init(path: Option<PathBuf>) -> Result<()> {
    let p = resolve_vault_path(path);
    let vault = Vault::init(&p).with_context(|| format!("init vault at {p:?}"))?;
    let cfg = vault.config()?;
    let display = vault.root.display();
    println!("✓ initialized OpenSpider vault at {display}");
    println!("  workspace_id: {}", cfg.workspace_id);
    println!();
    println!("Next steps:");
    println!("  1. Start the MCP server:");
    println!("       brain serve --vault {display}");
    println!();
    println!("  2. (Optional) Point a client at it. With bettersync:");
    println!("       bettersync auth login --token kb_localdev --endpoint http://127.0.0.1:7700/mcp");
    println!("       bettersync db list");
    println!();
    println!("  3. Inspect the workspace any time:");
    println!("       brain status --vault {display}");
    println!();
    println!("Your data lives at {display}/. It's plain markdown + YAML, gitignore-safe.");
    Ok(())
}

async fn serve(vault: Option<PathBuf>, addr: String) -> Result<()> {
    let p = resolve_vault_path(vault);
    // Auto-init if missing — matches the Tauri app's behavior so a fresh
    // user can `brain serve` without a separate init step.
    let vault = if p.join(".openspider/config.json").exists() {
        Vault::open(&p)?
    } else {
        Vault::init(&p).with_context(|| format!("auto-init vault at {p:?}"))?
    };
    let registry = tools::build_registry(S16_TOOL_CATALOG)?;
    let self_endpoint = format!("http://{}/mcp", addr);
    let dbs = vault.list_databases().unwrap_or_default().len();
    let agents = vault.list_agents().unwrap_or_default();
    let cron_count = agents.iter()
        .filter_map(|a| vault.list_triggers(&a.id).ok())
        .flatten()
        .filter(|t| t.kind == "cron")
        .count();
    let state = AppState {
        vault: Arc::new(vault),
        registry: Arc::new(registry),
        self_endpoint,
        self_token: "kb_localdev".into(),
        oauth_sessions: openspider_mcp::oauth::new_session_store(),
    };
    println!();
    println!("┌─ OpenSpider ─────────────────────────────────────");
    println!("│ vault:     {}", p.display());
    println!("│ databases: {dbs}");
    println!("│ agents:    {} ({cron_count} cron-triggered)", agents.len());
    println!("│ scheduler: tick every 20s");
    println!("│");
    println!("│ MCP:       http://{addr}/mcp");
    println!("│ webhooks:  http://{addr}/webhook/<agentId>");
    println!("│ oauth cb:  http://{addr}/oauth/callback");
    println!("└──────────────────────────────────────────────");
    println!();
    openspider_mcp::serve(state, &addr).await
}

fn status(vault: Option<PathBuf>) -> Result<()> {
    let p = resolve_vault_path(vault);
    let vault = Vault::open(&p)?;
    let cfg = vault.config()?;

    println!("── workspace ──");
    println!("  vault:        {}", vault.root.display());
    println!("  workspace_id: {}", cfg.workspace_id);
    println!("  created_at:   {}", cfg.created_at);
    if let Some(llm) = cfg.llm.as_ref() {
        println!("  llm:          {} ({})", llm.default_model, llm.base_url);
    } else {
        println!("  llm:          (not configured — agents that call s16.ai will fail)");
    }

    let dbs = vault.list_databases()?;
    println!("\n── databases ({}) ──", dbs.len());
    for d in dbs.iter().take(10) {
        let row_count = vault.count_pages(&d.id, None).unwrap_or(0);
        println!("  {} {} ({} rows)", d.icon.as_deref().unwrap_or("·"), d.name, row_count);
    }
    if dbs.len() > 10 { println!("  …and {} more", dbs.len() - 10); }

    let docs = vault.list_all_docs().unwrap_or_default();
    println!("\n── docs ({}) ──", docs.len());
    for d in docs.iter().take(10) {
        println!("  {} {}", d.icon.as_deref().unwrap_or("·"), d.title);
    }
    if docs.len() > 10 { println!("  …and {} more", docs.len() - 10); }

    let agents = vault.list_agents().unwrap_or_default();
    println!("\n── agents ({}) ──", agents.len());
    for a in agents.iter().take(10) {
        let triggers = vault.list_triggers(&a.id).unwrap_or_default();
        let trig_str = if triggers.is_empty() { "no triggers".into() }
            else { triggers.iter().map(|t| t.kind.as_str()).collect::<Vec<_>>().join(", ") };
        println!("  · {} [{}]", a.name, trig_str);
    }
    if agents.len() > 10 { println!("  …and {} more", agents.len() - 10); }

    let skills = vault.list_skills().unwrap_or_default();
    println!("\n── skills ({}) ──", skills.len());
    for s in skills.iter().take(5) {
        let label = s.display_name.as_deref().unwrap_or(&s.name);
        println!("  · {label}");
    }
    if skills.len() > 5 { println!("  …and {} more", skills.len() - 5); }

    let runs = vault.list_runs(None, 3).unwrap_or_default();
    println!("\n── recent runs ({}) ──", runs.len());
    for r in runs.iter() {
        let when = r.started_at.split('.').next().unwrap_or(&r.started_at);
        let agent = r.agent_name.as_deref().unwrap_or(&r.agent_id);
        println!("  {when}  {}  {agent}", r.status);
    }

    let sites = vault.list_sites(false).unwrap_or_default();
    if !sites.is_empty() {
        println!("\n── sites ({}) ──", sites.len());
        for s in sites.iter().take(5) {
            println!("  {} {} (slug: {}, {} pages)",
                s.icon.as_deref().unwrap_or("·"), s.name, s.slug, s.pages.len());
        }
    }

    let files = vault.list_files().unwrap_or_default();
    if !files.is_empty() {
        println!("\n── files ({}) ──", files.len());
    }

    let creds = vault.list_credentials(None).unwrap_or_default();
    let secrets = vault.list_secret_keys().unwrap_or_default();
    if !creds.is_empty() || !secrets.is_empty() {
        println!("\n── credentials & secrets ──");
        println!("  credentials: {}", creds.len());
        println!("  secrets:     {} keys", secrets.len());
    }
    Ok(())
}
