//! Relation tools — 4 in total.
//!
//! Relations are stored as wiki-link arrays in the source page's frontmatter:
//!   Company: ["[[Acme Corp|<uuid>]]"]
//! Two-way relations also write the inverse on the target page.

use crate::registry::Tool;
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct ListRelations;

#[async_trait]
impl Tool for ListRelations {
    fn name(&self) -> &'static str { "s16_list_relations" }
    fn description(&self) -> &'static str { "List linked pages for a relation property on a source page." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["pageId", "propertyId"],
            "properties": {
                "pageId":     { "type": "string" },
                "propertyId": { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let page_id = string_arg(&args, "pageId")?;
        let property_id = string_arg(&args, "propertyId")?;
        let pages = state.vault.list_relations(&page_id, &property_id)?;
        Ok(json!({ "items": pages }))
    }
}

pub struct AddRelation;

#[async_trait]
impl Tool for AddRelation {
    fn name(&self) -> &'static str { "s16_add_relation" }
    fn description(&self) -> &'static str {
        "Link source page to target page via relation property. Two-way relations update the inverse automatically."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["sourcePageId", "targetPageId", "propertyId"],
            "properties": {
                "sourcePageId": { "type": "string" },
                "targetPageId": { "type": "string" },
                "propertyId":   { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let src = string_arg(&args, "sourcePageId")?;
        let tgt = string_arg(&args, "targetPageId")?;
        let pid = string_arg(&args, "propertyId")?;
        state.vault.add_relation(&src, &tgt, &pid)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct RemoveRelation;

#[async_trait]
impl Tool for RemoveRelation {
    fn name(&self) -> &'static str { "s16_remove_relation" }
    fn description(&self) -> &'static str {
        "Unlink source page from target page. Two-way relations update the inverse automatically."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["sourcePageId", "targetPageId", "propertyId"],
            "properties": {
                "sourcePageId": { "type": "string" },
                "targetPageId": { "type": "string" },
                "propertyId":   { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let src = string_arg(&args, "sourcePageId")?;
        let tgt = string_arg(&args, "targetPageId")?;
        let pid = string_arg(&args, "propertyId")?;
        state.vault.remove_relation(&src, &tgt, &pid)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct ConvertRelationToTwoWay;

#[async_trait]
impl Tool for ConvertRelationToTwoWay {
    fn name(&self) -> &'static str { "s16_convert_relation_to_two_way" }
    fn description(&self) -> &'static str {
        "Convert a one-way relation to two-way. Creates an inverse column on the target db and backfills."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["propertyId"],
            "properties": { "propertyId": { "type": "string" } }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let pid = string_arg(&args, "propertyId")?;
        let result = state.vault.convert_relation_to_two_way(&pid)?;
        Ok(result)
    }
}

fn string_arg(args: &Value, key: &str) -> Result<String> {
    args.get(key).and_then(|v| v.as_str()).map(String::from)
        .ok_or_else(|| anyhow!("missing required string arg: {key}"))
}
