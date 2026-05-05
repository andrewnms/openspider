//! Block tools — 4 in total. v0.6 uses paragraph-level blocks (each
//! blank-line-separated chunk = one block). Round-trips through markdown so
//! the page body stays human-editable.

use crate::registry::Tool;
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct ListBlocks;
#[async_trait]
impl Tool for ListBlocks {
    fn name(&self) -> &'static str { "s16_list_blocks" }
    fn description(&self) -> &'static str { "List blocks (paragraphs) of a page in editor order." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["pageId"], "properties": { "pageId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "pageId")?;
        Ok(json!({ "items": state.vault.list_blocks(&id)? }))
    }
}

pub struct CreateBlock;
#[async_trait]
impl Tool for CreateBlock {
    fn name(&self) -> &'static str { "s16_create_block" }
    fn description(&self) -> &'static str { "Insert a new block (paragraph) into a page at the given position." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["pageId", "type", "content"],
            "properties": {
                "pageId":   { "type": "string" },
                "type":     { "type": "string" },
                "content":  { "type": "string" },
                "position": { "type": "integer" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let page_id = sarg(&args, "pageId")?;
        let kind = sarg(&args, "type")?;
        let content = sarg(&args, "content")?;
        let position = args.get("position").and_then(|v| v.as_u64()).map(|n| n as usize);
        Ok(state.vault.create_block(&page_id, &kind, &content, position)?)
    }
}

pub struct UpdateBlock;
#[async_trait]
impl Tool for UpdateBlock {
    fn name(&self) -> &'static str { "s16_update_block" }
    fn description(&self) -> &'static str { "Update a block (type/content/position). blockId format: \"<pageId>:<index>\"." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["blockId"],
            "properties": {
                "blockId":  { "type": "string" },
                "type":     { "type": "string" },
                "content":  { "type": "string" },
                "position": { "type": "integer" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let block_id = sarg(&args, "blockId")?;
        let kind = args.get("type").and_then(|v| v.as_str()).map(String::from);
        let content = args.get("content").and_then(|v| v.as_str()).map(String::from);
        let position = args.get("position").and_then(|v| v.as_u64()).map(|n| n as usize);
        state.vault.update_block(&block_id, kind, content, position)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct DeleteBlock;
#[async_trait]
impl Tool for DeleteBlock {
    fn name(&self) -> &'static str { "s16_delete_block" }
    fn description(&self) -> &'static str { "Delete a block. blockId format: \"<pageId>:<index>\"." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["blockId"], "properties": { "blockId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let block_id = sarg(&args, "blockId")?;
        state.vault.delete_block(&block_id)?;
        Ok(json!({ "ok": true }))
    }
}

fn sarg(args: &Value, key: &str) -> Result<String> {
    args.get(key).and_then(|v| v.as_str()).map(String::from)
        .ok_or_else(|| anyhow!("missing required string arg: {key}"))
}
