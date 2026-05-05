//! Agent execution via Node sidecar.
//!
//! Spawns `node <vault>/.openspider/sidecar/agent-runner.mjs <input.json>`,
//! captures stdout NDJSON, builds a [`Run`] record. Sync for v0.4 — each
//! `s16_run_agent` call blocks until the agent returns.
//!
//! Async polling (s16_await_run reads file state repeatedly) lands in v0.5.

use anyhow::{anyhow, Context, Result};
use openspider_core::{Agent, Run, Vault};
use serde::Deserialize;
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::process::Stdio;
use uuid::Uuid;

const SIDECAR_JS: &str = include_str!("../../openspider-bin/src/sidecar/agent-runner.mjs");

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum SidecarEvent {
    Log { msg: String },
    Return { value: Value },
    Error { msg: String, #[serde(default)] stack: Option<String> },
}

/// Run an agent end-to-end (sync). Returns the final Run record.
pub async fn run_agent(
    vault: &Vault,
    agent: &Agent,
    input_data: Value,
    input_prompt: Option<String>,
    openspider_endpoint: &str,
    openspider_token: &str,
) -> Result<Run> {
    if agent.compiled_script.as_deref().unwrap_or("").is_empty() {
        return Err(anyhow!("agent \"{}\" has no compiledScript", agent.name));
    }

    // Resolve attached skills.
    let mut skills = Vec::new();
    for sid in &agent.skill_ids {
        if let Ok(s) = vault.get_skill(sid) {
            skills.push(json!({
                "id": s.id,
                "name": s.name,
                "displayName": s.display_name,
                "description": s.description,
                "content": s.skill_md,
                "source": "attached",
            }));
        }
    }

    // Materialize sidecar JS to a stable location inside the vault.
    let sidecar_dir = vault.root.join(".openspider/sidecar");
    fs::create_dir_all(&sidecar_dir)?;
    let sidecar_path = sidecar_dir.join("agent-runner.mjs");
    if !sidecar_path.exists() || fs::read_to_string(&sidecar_path).unwrap_or_default() != SIDECAR_JS {
        fs::write(&sidecar_path, SIDECAR_JS)?;
    }

    // Pull LLM config (optional; sidecar errors only when agent calls s16.ai).
    let llm = vault.config().ok().and_then(|c| c.llm).map(|l| {
        json!({
            "baseUrl": l.base_url,
            "apiKey": l.api_key,
            "defaultModel": l.default_model,
        })
    });

    // Prepare run record.
    let run_id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let mut run = Run {
        id: run_id.clone(),
        agent_id: agent.id.clone(),
        agent_name: Some(agent.name.clone()),
        status: "running".into(),
        input_data: input_data.clone(),
        input_prompt: input_prompt.clone(),
        trigger_type: "manual".into(),
        trigger_context: json!({ "runner": "openspider", "via": "sidecar" }),
        script_logs: Vec::new(),
        output: None,
        error: None,
        tokens_used: 0,
        started_at: now.clone(),
        finished_at: None,
        created_at: now,
    };
    vault.save_run(&run)?;

    // Build the input file for the sidecar.
    let agent_payload = json!({
        "id": agent.id,
        "name": agent.name,
        "model": agent.model,
        "systemPrompt": agent.system_prompt,
        "compiledScript": agent.compiled_script,
        "skillIds": agent.skill_ids,
        "tools": agent.tools,
    });
    let input_payload = json!({
        "agent":          agent_payload,
        "inputData":      input_data,
        "inputPrompt":    input_prompt,
        "skills":         skills,
        "openspiderEndpoint": openspider_endpoint,
        "openspiderToken":    openspider_token,
        "llm":            llm,
    });
    let input_path = vault.root.join(".openspider/runs").join(format!("{run_id}.input.json"));
    fs::write(&input_path, serde_json::to_string(&input_payload)?)?;

    // Spawn the sidecar.
    let output = tokio::process::Command::new("node")
        .arg(&sidecar_path)
        .arg(&input_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .with_context(|| "spawn node sidecar")?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // Parse NDJSON events.
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        match serde_json::from_str::<SidecarEvent>(line) {
            Ok(SidecarEvent::Log { msg }) => run.script_logs.push(msg),
            Ok(SidecarEvent::Return { value }) => {
                run.output = Some(match value {
                    Value::String(s) => s,
                    other => serde_json::to_string(&other).unwrap_or_default(),
                });
            }
            Ok(SidecarEvent::Error { msg, stack }) => {
                run.error = Some(if let Some(s) = stack { format!("{msg}\n{s}") } else { msg });
            }
            Err(_) => {
                // Non-NDJSON line: capture for diagnostics.
                run.script_logs.push(format!("(unparsed) {line}"));
            }
        }
    }

    if !output.status.success() && run.error.is_none() {
        run.error = Some(format!("sidecar exited {}: {}", output.status, stderr.trim()));
    }
    run.status = if run.error.is_some() { "failed".into() } else { "success".into() };
    run.finished_at = Some(chrono::Utc::now().to_rfc3339());

    // Clean up the input file (run record is the durable artifact).
    let _ = fs::remove_file(&input_path);

    vault.save_run(&run)?;
    Ok(run)
}

/// Resolve the canonical path to the bundled sidecar (writes to vault on demand).
pub fn ensure_sidecar(vault: &Vault) -> Result<PathBuf> {
    let dir = vault.root.join(".openspider/sidecar");
    fs::create_dir_all(&dir)?;
    let path = dir.join("agent-runner.mjs");
    if !path.exists() || fs::read_to_string(&path).unwrap_or_default() != SIDECAR_JS {
        fs::write(&path, SIDECAR_JS)?;
    }
    Ok(path)
}
