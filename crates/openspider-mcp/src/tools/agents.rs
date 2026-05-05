//! Agent + run tools. 10 agent tools, 4 run tools (real: 11, stubs: 3).
//!
//! Agent execution goes through the Node sidecar (see `runner::run_agent`).

use crate::registry::Tool;
use crate::runner;
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use openspider_core::{Agent, AgentPatch};
use serde_json::{json, Value};

// ── Agents ──────────────────────────────────────────────────────────────

pub struct ListAgents;
#[async_trait]
impl Tool for ListAgents {
    fn name(&self) -> &'static str { "s16_list_agents" }
    fn description(&self) -> &'static str { "List all AI agents in the workspace." }
    async fn call(&self, state: &AppState, _args: Value) -> Result<Value> {
        Ok(serde_json::to_value(state.vault.list_agents()?)?)
    }
}

pub struct GetAgent;
#[async_trait]
impl Tool for GetAgent {
    fn name(&self) -> &'static str { "s16_get_agent" }
    fn description(&self) -> &'static str { "Get full agent details (system prompt, model, tools, compiled script)." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["agentId"], "properties": { "agentId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "agentId")?;
        Ok(serde_json::to_value(state.vault.get_agent(&id)?)?)
    }
}

pub struct CreateAgent;
#[async_trait]
impl Tool for CreateAgent {
    fn name(&self) -> &'static str { "s16_create_agent" }
    fn description(&self) -> &'static str {
        "Create a new agent. Add a compiledScript to make it runnable."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["name"],
            "properties": {
                "name":           { "type": "string" },
                "description":    { "type": "string" },
                "model":          { "type": "string" },
                "systemPrompt":   { "type": "string" },
                "tools":          { "type": "array" },
                "skillIds":       { "type": "array", "items": { "type": "string" } },
                "inputSchema":    { "type": "object" },
                "outputSchema":   { "type": "object" },
                "compiledScript": { "type": "string" },
                "timeout":        { "type": "integer" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let mut agent = Agent::default();
        agent.name = sarg(&args, "name")?;
        agent.description = args.get("description").and_then(|v| v.as_str()).map(String::from);
        agent.model = args.get("model").and_then(|v| v.as_str()).unwrap_or("").to_string();
        agent.system_prompt = args.get("systemPrompt").and_then(|v| v.as_str()).unwrap_or("").to_string();
        agent.tools = args.get("tools").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        agent.skill_ids = args.get("skillIds").and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        agent.input_schema = args.get("inputSchema").cloned().unwrap_or(Value::Null);
        agent.output_schema = args.get("outputSchema").cloned();
        agent.compiled_script = args.get("compiledScript").and_then(|v| v.as_str()).map(String::from);
        agent.timeout = args.get("timeout").and_then(|v| v.as_u64()).map(|n| n as u32).unwrap_or(300);
        Ok(serde_json::to_value(state.vault.create_agent(agent)?)?)
    }
}

pub struct UpdateAgent;
#[async_trait]
impl Tool for UpdateAgent {
    fn name(&self) -> &'static str { "s16_update_agent" }
    fn description(&self) -> &'static str { "Update an agent. Set compiledScript directly to write a custom JS script." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["agentId"],
            "properties": {
                "agentId":        { "type": "string" },
                "name":           { "type": "string" },
                "description":    { "type": "string" },
                "model":          { "type": "string" },
                "systemPrompt":   { "type": "string" },
                "tools":          { "type": "array" },
                "skillIds":       { "type": "array", "items": { "type": "string" } },
                "inputSchema":    { "type": "object" },
                "outputSchema":   { "type": ["object", "null"] },
                "compiledScript": { "type": "string" },
                "timeout":        { "type": "integer" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "agentId")?;
        let patch = AgentPatch {
            name: args.get("name").and_then(|v| v.as_str()).map(String::from),
            description: args.get("description").and_then(|v| v.as_str()).map(String::from),
            model: args.get("model").and_then(|v| v.as_str()).map(String::from),
            system_prompt: args.get("systemPrompt").and_then(|v| v.as_str()).map(String::from),
            tools: args.get("tools").and_then(|v| v.as_array()).cloned(),
            input_schema: args.get("inputSchema").cloned(),
            output_schema: args.get("outputSchema").map(|v| if v.is_null() { None } else { Some(v.clone()) }),
            skill_ids: args.get("skillIds").and_then(|v| v.as_array()).map(|arr| {
                arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()
            }),
            compiled_script: args.get("compiledScript").and_then(|v| v.as_str()).map(String::from),
            timeout: args.get("timeout").and_then(|v| v.as_u64()).map(|n| n as u32),
        };
        Ok(serde_json::to_value(state.vault.update_agent(&id, patch)?)?)
    }
}

pub struct DeleteAgent;
#[async_trait]
impl Tool for DeleteAgent {
    fn name(&self) -> &'static str { "s16_delete_agent" }
    fn description(&self) -> &'static str { "Delete an agent (folder + compiled script)." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["agentId"], "properties": { "agentId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "agentId")?;
        state.vault.delete_agent(&id)?;
        Ok(json!({ "ok": true, "agentId": id }))
    }
}

// Stubs for compile/webhook/history (the platform-side AI compilation,
// webhook URL endpoints, and version history land in later versions).
pub struct CompileAgent;
#[async_trait]
impl Tool for CompileAgent {
    fn name(&self) -> &'static str { "s16_compile_agent" }
    fn description(&self) -> &'static str { "Compile an agent via AI. Not implemented in OpenSpider — write the script yourself via s16_update_agent({compiledScript})." }
    async fn call(&self, _state: &AppState, _args: Value) -> Result<Value> {
        Err(anyhow!("AI-driven compilation not implemented in OpenSpider. Pass compiledScript directly via s16_update_agent."))
    }
}

pub struct GetAgentWebhookUrl;
#[async_trait]
impl Tool for GetAgentWebhookUrl {
    fn name(&self) -> &'static str { "s16_get_agent_webhook_url" }
    fn description(&self) -> &'static str { "Get the webhook URL for an agent (must have a webhook trigger)." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["agentId"], "properties": { "agentId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "agentId")?;
        let agent = state.vault.get_agent(&id)?;
        let triggers = state.vault.list_triggers(&agent.id)?;
        let _wh = triggers.iter().find(|t| t.kind == "webhook")
            .ok_or_else(|| anyhow!("agent \"{}\" has no webhook trigger configured", agent.name))?;
        // Derive base from self_endpoint (replace /mcp with /webhook/<id>).
        let base = state.self_endpoint.trim_end_matches("/mcp");
        Ok(json!({ "url": format!("{base}/webhook/{}", agent.id) }))
    }
}

pub struct ListAgentHistory;
#[async_trait]
impl Tool for ListAgentHistory {
    fn name(&self) -> &'static str { "s16_list_agent_history" }
    fn description(&self) -> &'static str { "List agent change history. Not implemented in OpenSpider (use git on the vault)." }
    async fn call(&self, _state: &AppState, _args: Value) -> Result<Value> {
        Ok(json!({ "items": [], "note": "OpenSpider stores agents as files; use git for change history" }))
    }
}

// ── Run ─────────────────────────────────────────────────────────────────

pub struct RunAgent;
#[async_trait]
impl Tool for RunAgent {
    fn name(&self) -> &'static str { "s16_run_agent" }
    fn description(&self) -> &'static str {
        "Run an agent. Spawns the Node sidecar, blocks until done (OpenSpider sync). Returns the full Run record."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["agentId"],
            "properties": {
                "agentId":     { "type": "string" },
                "inputData":   { "type": "object" },
                "inputPrompt": { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "agentId")?;
        let agent = state.vault.get_agent(&id)?;
        let input_data = args.get("inputData").cloned().unwrap_or(json!({}));
        let input_prompt = args.get("inputPrompt").and_then(|v| v.as_str()).map(String::from);
        let run = runner::run_agent(
            &state.vault, &agent, input_data, input_prompt,
            &state.self_endpoint, &state.self_token,
        ).await?;
        Ok(serde_json::to_value(run)?)
    }
}

pub struct RunAgentByName;
#[async_trait]
impl Tool for RunAgentByName {
    fn name(&self) -> &'static str { "s16_run_agent_by_name" }
    fn description(&self) -> &'static str { "Find an agent by name (case-insensitive) and run it." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["name"],
            "properties": {
                "name":        { "type": "string" },
                "inputData":   { "type": "object" },
                "inputPrompt": { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let name = sarg(&args, "name")?;
        let agent = state.vault.find_agent_by_name(&name)?;
        let input_data = args.get("inputData").cloned().unwrap_or(json!({}));
        let input_prompt = args.get("inputPrompt").and_then(|v| v.as_str()).map(String::from);
        let run = runner::run_agent(
            &state.vault, &agent, input_data, input_prompt,
            &state.self_endpoint, &state.self_token,
        ).await?;
        Ok(serde_json::to_value(run)?)
    }
}

pub struct GetRun;
#[async_trait]
impl Tool for GetRun {
    fn name(&self) -> &'static str { "s16_get_run" }
    fn description(&self) -> &'static str { "Get details of an agent run including messages and output." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["runId"], "properties": { "runId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "runId")?;
        Ok(serde_json::to_value(state.vault.get_run(&id)?)?)
    }
}

pub struct ListRuns;
#[async_trait]
impl Tool for ListRuns {
    fn name(&self) -> &'static str { "s16_list_runs" }
    fn description(&self) -> &'static str { "List recent agent runs in the workspace." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "agentId": { "type": "string" },
                "limit":   { "type": "integer" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let agent_id = args.get("agentId").and_then(|v| v.as_str());
        let limit = args.get("limit").and_then(|v| v.as_u64()).map(|n| n as usize).unwrap_or(20);
        Ok(serde_json::to_value(state.vault.list_runs(agent_id, limit)?)?)
    }
}

pub struct AwaitRun;
#[async_trait]
impl Tool for AwaitRun {
    fn name(&self) -> &'static str { "s16_await_run" }
    fn description(&self) -> &'static str {
        "Wait for an agent run to complete. (OpenSpider runs are sync, so this just reads the persisted record.)"
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["runId"],
            "properties": {
                "runId":          { "type": "string" },
                "timeoutSeconds": { "type": "integer" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "runId")?;
        Ok(serde_json::to_value(state.vault.get_run(&id)?)?)
    }
}

pub struct CancelRun;
#[async_trait]
impl Tool for CancelRun {
    fn name(&self) -> &'static str { "s16_cancel_run" }
    fn description(&self) -> &'static str {
        "Cancel a running agent. (No-op in OpenSpider since runs are sync; lands in v0.5 with async runs.)"
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["runId"], "properties": { "runId": { "type": "string" } } })
    }
    async fn call(&self, _state: &AppState, _args: Value) -> Result<Value> {
        Ok(json!({ "ok": true, "note": "no-op in OpenSpider (sync runs)" }))
    }
}

fn sarg(args: &Value, key: &str) -> Result<String> {
    args.get(key).and_then(|v| v.as_str()).map(String::from)
        .ok_or_else(|| anyhow!("missing required string arg: {key}"))
}
