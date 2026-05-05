//! View tools — 5 in total. Views stored in databases/<name>/_schema.yml.

use crate::registry::Tool;
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct ListViews;
#[async_trait]
impl Tool for ListViews {
    fn name(&self) -> &'static str { "s16_list_views" }
    fn description(&self) -> &'static str { "List all views for a database." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["databaseId"], "properties": { "databaseId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "databaseId")?;
        Ok(serde_json::to_value(state.vault.list_views(&id)?)?)
    }
}

pub struct CreateView;
#[async_trait]
impl Tool for CreateView {
    fn name(&self) -> &'static str { "s16_create_view" }
    fn description(&self) -> &'static str { "Create a new database view (table/board/gallery/calendar/list)." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["databaseId", "name", "type"],
            "properties": {
                "databaseId":        { "type": "string" },
                "name":              { "type": "string" },
                "type":              { "type": "string" },
                "filters":           {},
                "sorts":             {},
                "groupBy":           { "type": "string" },
                "visibleProperties": { "type": "array" },
                "config":            { "type": "object" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let database_id = sarg(&args, "databaseId")?;
        let name = sarg(&args, "name")?;
        let kind = sarg(&args, "type")?;
        Ok(serde_json::to_value(state.vault.create_view(&database_id, &name, &kind, args)?)?)
    }
}

pub struct UpdateView;
#[async_trait]
impl Tool for UpdateView {
    fn name(&self) -> &'static str { "s16_update_view" }
    fn description(&self) -> &'static str { "Update a view (name/type/filters/sorts/visibleProperties/groupBy/config/position)." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["viewId"],
            "properties": {
                "viewId":            { "type": "string" },
                "name":              { "type": "string" },
                "type":              { "type": "string" },
                "filters":           {},
                "sorts":             {},
                "groupBy":           { "type": "string" },
                "visibleProperties": { "type": "array" },
                "config":            { "type": "object" },
                "position":          { "type": "integer" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let view_id = sarg(&args, "viewId")?;
        Ok(serde_json::to_value(state.vault.update_view(&view_id, args)?)?)
    }
}

pub struct ReorderViews;
#[async_trait]
impl Tool for ReorderViews {
    fn name(&self) -> &'static str { "s16_reorder_views" }
    fn description(&self) -> &'static str { "Reorder views inside a database." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["databaseId", "viewIds"],
            "properties": {
                "databaseId": { "type": "string" },
                "viewIds":    { "type": "array", "items": { "type": "string" } }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let database_id = sarg(&args, "databaseId")?;
        let view_ids: Vec<String> = args.get("viewIds").and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .unwrap_or_default();
        state.vault.reorder_views(&database_id, &view_ids)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct DeleteView;
#[async_trait]
impl Tool for DeleteView {
    fn name(&self) -> &'static str { "s16_delete_view" }
    fn description(&self) -> &'static str { "Delete a view." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["viewId"], "properties": { "viewId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "viewId")?;
        state.vault.delete_view(&id)?;
        Ok(json!({ "ok": true }))
    }
}

fn sarg(args: &Value, key: &str) -> Result<String> {
    args.get(key).and_then(|v| v.as_str()).map(String::from)
        .ok_or_else(|| anyhow!("missing required string arg: {key}"))
}
