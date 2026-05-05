//! Trigger tools — 2 in total. Cron + webhook fire for real (see scheduler.rs).
//! event/gmail/agent_change configs are stored but firing lands in v0.7+.

use crate::registry::Tool;
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct SetTrigger;
#[async_trait]
impl Tool for SetTrigger {
    fn name(&self) -> &'static str { "s16_set_trigger" }
    fn description(&self) -> &'static str {
        "Create an agent trigger. Types: cron (real), webhook (real), event/gmail/agent_change (config-only stubs in OpenSpider)."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["agentId", "type"],
            "properties": {
                "agentId": { "type": "string" },
                "type":    { "type": "string", "enum": ["cron", "event", "webhook", "gmail", "agent_change"] },
                "config":  { "type": "object" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let agent_id = sarg(&args, "agentId")?;
        let kind = sarg(&args, "type")?;
        let config = args.get("config").cloned().unwrap_or(json!({}));
        let trigger = state.vault.set_trigger(&agent_id, &kind, config)?;
        Ok(serde_json::to_value(trigger)?)
    }
}

pub struct DeleteTrigger;
#[async_trait]
impl Tool for DeleteTrigger {
    fn name(&self) -> &'static str { "s16_delete_trigger" }
    fn description(&self) -> &'static str { "Delete an agent trigger." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["triggerId"], "properties": { "triggerId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "triggerId")?;
        state.vault.delete_trigger(&id)?;
        Ok(json!({ "ok": true }))
    }
}

fn sarg(args: &Value, key: &str) -> Result<String> {
    args.get(key).and_then(|v| v.as_str()).map(String::from)
        .ok_or_else(|| anyhow!("missing required string arg: {key}"))
}
