//! Cron scheduler for agent triggers.
//!
//! On `brain serve` startup we spawn a single tokio task that:
//!   1. Scans all agents for triggers (rescans every minute so newly-added
//!      triggers pick up without restart)
//!   2. For each cron trigger, computes the next fire time
//!   3. When the time hits, fires the agent via `runner::run_agent`
//!
//! Webhook triggers are handled separately by an axum route the server mounts.

use crate::runner;
use anyhow::Result;
use chrono::{DateTime, Utc};
use cron::Schedule;
use openspider_core::Vault;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use tokio::time::{sleep, Duration};
use tracing::{debug, info, warn};

/// Spawn the scheduler. Runs forever in the background.
pub fn spawn(vault: Arc<Vault>, self_endpoint: String, self_token: String) {
    tokio::spawn(async move {
        let mut last_fire: HashMap<String, DateTime<Utc>> = HashMap::new();
        loop {
            let now = Utc::now();
            let triggers = match vault.list_all_triggers() {
                Ok(t) => t,
                Err(e) => { warn!("scheduler: failed to list triggers: {e}"); Vec::new() }
            };
            for t in triggers.iter().filter(|t| t.kind == "cron") {
                let Some(schedule_str) = t.config.get("schedule").and_then(|v| v.as_str()) else {
                    debug!("scheduler: cron trigger {} missing schedule field", t.id); continue;
                };
                let schedule = match Schedule::from_str(schedule_str) {
                    Ok(s) => s,
                    Err(e) => { warn!("bad cron \"{schedule_str}\": {e}"); continue; }
                };
                let last = last_fire.get(&t.id).copied().unwrap_or(now - chrono::Duration::days(365));
                // Next-after-last: if it's in the past, it's overdue → fire.
                if let Some(next) = schedule.after(&last).next() {
                    if next <= now {
                        info!("scheduler: firing cron agent={} trigger={}", t.agent_id, t.id);
                        let agent = match vault.get_agent(&t.agent_id) {
                            Ok(a) => a,
                            Err(e) => { warn!("agent {} gone: {e}", t.agent_id); continue; }
                        };
                        let v = vault.clone();
                        let endpoint = self_endpoint.clone();
                        let token = self_token.clone();
                        tokio::spawn(async move {
                            if let Err(e) = runner::run_agent(
                                &v, &agent, serde_json::json!({}), None, &endpoint, &token,
                            ).await {
                                warn!("scheduled run failed for {}: {e}", agent.name);
                            }
                        });
                        last_fire.insert(t.id.clone(), now);
                    }
                }
            }
            sleep(Duration::from_secs(20)).await;
        }
    });
}

/// Handle an incoming webhook for an agent. Returns the run record.
pub async fn handle_webhook(
    vault: &Vault,
    agent_id: &str,
    body: serde_json::Value,
    self_endpoint: &str,
    self_token: &str,
) -> Result<serde_json::Value> {
    let agent = vault.get_agent(agent_id)?;
    // Verify the agent has a webhook trigger configured.
    let triggers = vault.list_triggers(&agent.id)?;
    let Some(_trigger) = triggers.iter().find(|t| t.kind == "webhook") else {
        anyhow::bail!("agent {} has no webhook trigger configured", agent.name);
    };
    // TODO v0.6.1: validate trigger.config.secret if present.
    let input_data = serde_json::json!({ "webhook": body });
    let run = runner::run_agent(vault, &agent, input_data, None, self_endpoint, self_token).await?;
    Ok(serde_json::to_value(run)?)
}
