//! File tools — 4 in total.

use crate::registry::Tool;
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use base64::Engine;
use serde_json::{json, Value};

pub struct ListFiles;
#[async_trait]
impl Tool for ListFiles {
    fn name(&self) -> &'static str { "s16_list_files" }
    fn description(&self) -> &'static str { "List files in the workspace." }
    async fn call(&self, state: &AppState, _args: Value) -> Result<Value> {
        Ok(serde_json::to_value(state.vault.list_files()?)?)
    }
}

pub struct CreateFile;
#[async_trait]
impl Tool for CreateFile {
    fn name(&self) -> &'static str { "s16_create_file" }
    fn description(&self) -> &'static str { "Register an existing public URL as a workspace file (no upload)." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["name", "url"],
            "properties": {
                "name":     { "type": "string" },
                "url":      { "type": "string" },
                "mimeType": { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let name = sarg(&args, "name")?;
        let url = sarg(&args, "url")?;
        let mime_type = args.get("mimeType").and_then(|v| v.as_str()).map(String::from);
        Ok(serde_json::to_value(state.vault.create_file_url(&name, &url, mime_type)?)?)
    }
}

pub struct UploadFile;
#[async_trait]
impl Tool for UploadFile {
    fn name(&self) -> &'static str { "s16_upload_file" }
    fn description(&self) -> &'static str { "Upload a file from base64-encoded data. Returns the file record." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["name", "base64"],
            "properties": {
                "name":     { "type": "string" },
                "base64":   { "type": "string" },
                "mimeType": { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let name = sarg(&args, "name")?;
        let b64 = sarg(&args, "base64")?;
        let mime_type = args.get("mimeType").and_then(|v| v.as_str()).map(String::from);
        let bytes = base64::engine::general_purpose::STANDARD.decode(&b64)
            .map_err(|e| anyhow!("invalid base64: {e}"))?;
        Ok(serde_json::to_value(state.vault.upload_file(&name, &bytes, mime_type)?)?)
    }
}

pub struct DeleteFile;
#[async_trait]
impl Tool for DeleteFile {
    fn name(&self) -> &'static str { "s16_delete_file" }
    fn description(&self) -> &'static str { "Delete a file from the workspace." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["fileId"], "properties": { "fileId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "fileId")?;
        state.vault.delete_file(&id)?;
        Ok(json!({ "ok": true }))
    }
}

fn sarg(args: &Value, key: &str) -> Result<String> {
    args.get(key).and_then(|v| v.as_str()).map(String::from)
        .ok_or_else(|| anyhow!("missing required string arg: {key}"))
}
