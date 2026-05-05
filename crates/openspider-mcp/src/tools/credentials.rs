//! Credential tools — 8 in total. 6 real (providers/list/get/create/update/delete),
//! 2 stubs (OAuth flows land in v0.8).
//!
//! Plus the remote-MCP credential pair (s16_list_mcp_tools, s16_call_mcp_tool)
//! which are also stubs in v0.5.

use crate::registry::Tool;
use crate::server::AppState;
use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct ListCredentialProviders;
#[async_trait]
impl Tool for ListCredentialProviders {
    fn name(&self) -> &'static str { "s16_list_credential_providers" }
    fn description(&self) -> &'static str { "List supported credential providers and their capabilities." }
    async fn call(&self, _state: &AppState, _args: Value) -> Result<Value> {
        // Mirror the S16 wire shape with a slim built-in list. Manual is the
        // catch-all. OAuth providers gate on s16_start_credential_oauth which
        // is a stub in v0.5.
        Ok(json!([
            {
                "id": "manual",
                "label": "Manual credential",
                "service": "custom",
                "connectionType": "manual",
                "description": "Store API keys, bot tokens, secrets, webhook keys, and any custom fields.",
                "capabilities": ["api_key", "bot_token", "webhook_secret", "custom_data"],
                "configured": true,
                "oauthClientRequired": false,
                "streamableHttpOnly": false
            },
            {
                "id": "groq",
                "label": "Groq",
                "service": "groq",
                "connectionType": "manual",
                "description": "Groq Cloud API key for fast inference.",
                "capabilities": ["llm"],
                "configured": true,
                "oauthClientRequired": false,
                "streamableHttpOnly": false
            },
            {
                "id": "openrouter",
                "label": "OpenRouter",
                "service": "openrouter",
                "connectionType": "manual",
                "description": "OpenRouter aggregated LLM API.",
                "capabilities": ["llm"],
                "configured": true,
                "oauthClientRequired": false,
                "streamableHttpOnly": false
            },
            {
                "id": "openai",
                "label": "OpenAI",
                "service": "openai",
                "connectionType": "manual",
                "description": "OpenAI API key.",
                "capabilities": ["llm"],
                "configured": true,
                "oauthClientRequired": false,
                "streamableHttpOnly": false
            },
            {
                "id": "google",
                "label": "Google",
                "service": "google",
                "connectionType": "oauth",
                "description": "Google account for Gmail/Calendar/Drive (OAuth lands in v0.8).",
                "capabilities": ["email", "calendar", "drive"],
                "configured": false,
                "oauthClientRequired": false,
                "streamableHttpOnly": false
            }
        ]))
    }
}

pub struct ListCredentials;
#[async_trait]
impl Tool for ListCredentials {
    fn name(&self) -> &'static str { "s16_list_credentials" }
    fn description(&self) -> &'static str { "List workspace credentials. Optional filter by service." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "service": { "type": "string" } }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let service = args.get("service").and_then(|v| v.as_str());
        Ok(serde_json::to_value(state.vault.list_credentials(service)?)?)
    }
}

pub struct GetCredential;
#[async_trait]
impl Tool for GetCredential {
    fn name(&self) -> &'static str { "s16_get_credential" }
    fn description(&self) -> &'static str { "Get a credential by id." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["credentialId"], "properties": { "credentialId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "credentialId")?;
        Ok(serde_json::to_value(state.vault.get_credential(&id)?)?)
    }
}

pub struct CreateCredential;
#[async_trait]
impl Tool for CreateCredential {
    fn name(&self) -> &'static str { "s16_create_credential" }
    fn description(&self) -> &'static str {
        "Create a service credential (API key, bot token, OAuth token). Stored as JSON."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["service", "title"],
            "properties": {
                "service": { "type": "string" },
                "title":   { "type": "string" },
                "data":    { "type": "object" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let service = sarg(&args, "service")?;
        let title = sarg(&args, "title")?;
        let data = args.get("data").cloned().unwrap_or(json!({}));
        Ok(serde_json::to_value(state.vault.create_credential(&service, &title, data)?)?)
    }
}

pub struct UpdateCredential;
#[async_trait]
impl Tool for UpdateCredential {
    fn name(&self) -> &'static str { "s16_update_credential" }
    fn description(&self) -> &'static str { "Update a credential (title, data)." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["credentialId"],
            "properties": {
                "credentialId": { "type": "string" },
                "title":        { "type": "string" },
                "data":         { "type": "object" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "credentialId")?;
        let title = args.get("title").and_then(|v| v.as_str()).map(String::from);
        let data = args.get("data").cloned();
        Ok(serde_json::to_value(state.vault.update_credential(&id, title, data)?)?)
    }
}

pub struct DeleteCredential;
#[async_trait]
impl Tool for DeleteCredential {
    fn name(&self) -> &'static str { "s16_delete_credential" }
    fn description(&self) -> &'static str { "Delete a credential." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["credentialId"], "properties": { "credentialId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "credentialId")?;
        state.vault.delete_credential(&id)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct StartCredentialOauth;
#[async_trait]
impl Tool for StartCredentialOauth {
    fn name(&self) -> &'static str { "s16_start_credential_oauth" }
    fn description(&self) -> &'static str {
        "Start an OAuth flow. Returns sessionId + authorizationUrl. Open the URL in a browser to consent."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["service"],
            "properties": { "service": { "type": "string" } }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let service = sarg(&args, "service")?;
        let session = crate::oauth::start(
            &state.vault, &state.oauth_sessions, &state.self_endpoint, &service,
        )?;
        Ok(serde_json::to_value(session)?)
    }
}

pub struct GetCredentialAuthSession;
#[async_trait]
impl Tool for GetCredentialAuthSession {
    fn name(&self) -> &'static str { "s16_get_credential_auth_session" }
    fn description(&self) -> &'static str {
        "Get the current status of an OAuth session (pending / completed / failed)."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["sessionId"],
            "properties": { "sessionId": { "type": "string" } }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "sessionId")?;
        Ok(serde_json::to_value(crate::oauth::get(&state.oauth_sessions, &id)?)?)
    }
}

// Remote-MCP passthrough (v0.8). The credential's `credentials` JSON must
// have `endpoint` (URL to /mcp) and either `apiKey` or `token` for bearer auth.
pub struct ListMcpTools;
#[async_trait]
impl Tool for ListMcpTools {
    fn name(&self) -> &'static str { "s16_list_mcp_tools" }
    fn description(&self) -> &'static str {
        "List tools exposed by an external MCP server reachable through a workspace credential."
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["credentialId"], "properties": { "credentialId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let cred_id = sarg(&args, "credentialId")?;
        let cred = state.vault.get_credential(&cred_id)?;
        let (endpoint, token) = extract_mcp_creds(&cred.credentials)?;
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" });
        let resp_text = mcp_post(&endpoint, &token, body).await?;
        let env: serde_json::Value = parse_sse_json(&resp_text)?;
        Ok(env.get("result").cloned().unwrap_or(json!({ "tools": [] })))
    }
}

pub struct CallMcpTool;
#[async_trait]
impl Tool for CallMcpTool {
    fn name(&self) -> &'static str { "s16_call_mcp_tool" }
    fn description(&self) -> &'static str {
        "Call a tool on an external MCP server reachable through a workspace credential."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["credentialId", "toolName"],
            "properties": {
                "credentialId": { "type": "string" },
                "toolName":     { "type": "string" },
                "arguments":    { "type": "object" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let cred_id = sarg(&args, "credentialId")?;
        let tool_name = sarg(&args, "toolName")?;
        let inner_args = args.get("arguments").cloned().unwrap_or(json!({}));
        let cred = state.vault.get_credential(&cred_id)?;
        let (endpoint, token) = extract_mcp_creds(&cred.credentials)?;
        let body = json!({
            "jsonrpc": "2.0", "id": 1, "method": "tools/call",
            "params": { "name": tool_name, "arguments": inner_args },
        });
        let resp_text = mcp_post(&endpoint, &token, body).await?;
        let env: serde_json::Value = parse_sse_json(&resp_text)?;
        if let Some(err) = env.get("error") {
            return Err(anyhow!("remote MCP error: {err}"));
        }
        Ok(env.get("result").cloned().unwrap_or(Value::Null))
    }
}

fn extract_mcp_creds(data: &Value) -> Result<(String, Option<String>)> {
    let endpoint = data.get("endpoint").and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("credential is missing `endpoint` (URL to remote /mcp)"))?
        .to_string();
    let token = data.get("token").or_else(|| data.get("apiKey"))
        .and_then(|v| v.as_str()).map(String::from);
    Ok((endpoint, token))
}

async fn mcp_post(endpoint: &str, token: &Option<String>, body: Value) -> Result<String> {
    let client = reqwest::Client::new();
    let mut req = client.post(endpoint)
        .header("Content-Type", "application/json")
        .header("Accept", "application/json, text/event-stream")
        .json(&body);
    if let Some(t) = token { req = req.bearer_auth(t); }
    let resp = req.send().await.with_context(|| format!("POST {endpoint}"))?;
    if !resp.status().is_success() {
        let s = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(anyhow!("remote MCP HTTP {s}: {}", body.chars().take(500).collect::<String>()));
    }
    Ok(resp.text().await?)
}

/// Parse either a plain JSON body or an SSE-wrapped single-event response.
fn parse_sse_json(text: &str) -> Result<Value> {
    if text.trim_start().starts_with('{') {
        return Ok(serde_json::from_str(text)?);
    }
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("data:") {
            let t = rest.trim();
            if !t.is_empty() {
                return Ok(serde_json::from_str(t)?);
            }
        }
    }
    Err(anyhow!("no JSON in response: {}", text.chars().take(200).collect::<String>()))
}

fn sarg(args: &Value, key: &str) -> Result<String> {
    args.get(key).and_then(|v| v.as_str()).map(String::from)
        .ok_or_else(|| anyhow!("missing required string arg: {key}"))
}
