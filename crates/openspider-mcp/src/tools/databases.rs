//! Real implementations for the `databases` resource (8 tools total).
//!
//! Maps each MCP tool to a vault filesystem operation.

use crate::registry::Tool;
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use openspider_core::DatabasePatch;
use serde_json::{json, Value};

// ── s16_list_databases ──────────────────────────────────────────────────

pub struct ListDatabases;

#[async_trait]
impl Tool for ListDatabases {
    fn name(&self) -> &'static str { "s16_list_databases" }
    fn description(&self) -> &'static str {
        "List all databases in the workspace. Returns id, name, icon, description for each."
    }
    async fn call(&self, state: &AppState, _args: Value) -> Result<Value> {
        let dbs = state.vault.list_databases()?;
        Ok(serde_json::to_value(dbs)?)
    }
}

// ── s16_get_database ────────────────────────────────────────────────────

pub struct GetDatabase;

#[async_trait]
impl Tool for GetDatabase {
    fn name(&self) -> &'static str { "s16_get_database" }
    fn description(&self) -> &'static str {
        "Get a database schema: properties (id, name, type, isPrimary), views, templates."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["databaseId"],
            "properties": { "databaseId": { "type": "string" } }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = string_arg(&args, "databaseId")?;
        let db = state.vault.get_database(&id)?;
        Ok(serde_json::to_value(db)?)
    }
}

// ── s16_get_public_database ─────────────────────────────────────────────

pub struct GetPublicDatabase;

#[async_trait]
impl Tool for GetPublicDatabase {
    fn name(&self) -> &'static str { "s16_get_public_database" }
    fn description(&self) -> &'static str {
        "Get a database schema through a public share id."
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["shareId"], "properties": { "shareId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let share_id = string_arg(&args, "shareId")?;
        Ok(serde_json::to_value(state.vault.get_public_database(&share_id)?)?)
    }
}

// ── s16_create_database ─────────────────────────────────────────────────

pub struct CreateDatabase;

#[async_trait]
impl Tool for CreateDatabase {
    fn name(&self) -> &'static str { "s16_create_database" }
    fn description(&self) -> &'static str {
        "Create a new database. Auto-creates the primary 'Name' title property."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["name"],
            "properties": {
                "name":        { "type": "string" },
                "icon":        { "type": "string" },
                "description": { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let name = string_arg(&args, "name")?;
        let icon = optional_string(&args, "icon");
        let description = optional_string(&args, "description");
        let db = state.vault.create_database(&name, icon, description)?;
        Ok(serde_json::to_value(db)?)
    }
}

// ── s16_update_database ─────────────────────────────────────────────────

pub struct UpdateDatabase;

#[async_trait]
impl Tool for UpdateDatabase {
    fn name(&self) -> &'static str { "s16_update_database" }
    fn description(&self) -> &'static str {
        "Update database metadata (name, icon, description, propertyOrder, isPrivate)."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["databaseId"],
            "properties": {
                "databaseId":    { "type": "string" },
                "name":          { "type": "string" },
                "icon":          { "type": "string" },
                "description":   { "type": "string" },
                "isPrivate":     { "type": "boolean" },
                "propertyOrder": { "type": "array", "items": { "type": "string" } }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = string_arg(&args, "databaseId")?;
        let patch = DatabasePatch {
            name: optional_string(&args, "name"),
            icon: optional_string(&args, "icon"),
            description: optional_string(&args, "description"),
            is_private: args.get("isPrivate").and_then(|v| v.as_bool()),
            property_order: args.get("propertyOrder").and_then(|v| v.as_array()).map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            }),
        };
        let db = state.vault.update_database(&id, patch)?;
        Ok(serde_json::to_value(db)?)
    }
}

// ── s16_delete_database ─────────────────────────────────────────────────

pub struct DeleteDatabase;

#[async_trait]
impl Tool for DeleteDatabase {
    fn name(&self) -> &'static str { "s16_delete_database" }
    fn description(&self) -> &'static str {
        "Delete a database. Irreversible — removes the folder and every row file."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["databaseId"],
            "properties": { "databaseId": { "type": "string" } }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = string_arg(&args, "databaseId")?;
        state.vault.delete_database(&id)?;
        Ok(json!({ "ok": true, "databaseId": id }))
    }
}

// ── s16_reorder_databases ───────────────────────────────────────────────

pub struct ReorderDatabases;

#[async_trait]
impl Tool for ReorderDatabases {
    fn name(&self) -> &'static str { "s16_reorder_databases" }
    fn description(&self) -> &'static str {
        "Reorder databases in the workspace sidebar. (No-op in OpenSpider; sidebar position file lands in v0.6.)"
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["databaseIds"],
            "properties": {
                "databaseIds": { "type": "array", "items": { "type": "string" } }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let ids: Vec<String> = args
            .get("databaseIds")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        state.vault.reorder_databases(&ids)?;
        Ok(json!({ "ok": true }))
    }
}

// ── s16_set_database_default_template ───────────────────────────────────

pub struct SetDefaultTemplate;

#[async_trait]
impl Tool for SetDefaultTemplate {
    fn name(&self) -> &'static str { "s16_set_database_default_template" }
    fn description(&self) -> &'static str {
        "Set or clear the default template for new pages in a database."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["databaseId"],
            "properties": {
                "databaseId": { "type": "string" },
                "templateId": { "type": ["string", "null"] }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = string_arg(&args, "databaseId")?;
        let template_id = optional_string(&args, "templateId");
        state.vault.set_default_template(&id, template_id)?;
        Ok(json!({ "ok": true }))
    }
}

// ── helpers ─────────────────────────────────────────────────────────────

fn string_arg(args: &Value, key: &str) -> Result<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| anyhow!("missing required string arg: {key}"))
}

fn optional_string(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(|v| v.as_str()).map(String::from)
}
