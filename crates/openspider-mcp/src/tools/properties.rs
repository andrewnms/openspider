//! Property (column) tools — 6 in total.
//!
//! Properties live inside `_schema.yml` of their database folder. Each gets
//! a stable UUID so renames don't break references.

use crate::registry::Tool;
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use openspider_core::PropertyPatch;
use serde_json::{json, Value};

pub struct CreateProperty;

#[async_trait]
impl Tool for CreateProperty {
    fn name(&self) -> &'static str { "s16_create_property" }
    fn description(&self) -> &'static str {
        "Create a new property/column in a database. For relations, set config.relatedDatabaseId."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["databaseId", "name", "type"],
            "properties": {
                "databaseId": { "type": "string" },
                "name":       { "type": "string" },
                "type":       { "type": "string" },
                "config":     { "type": "object" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let database_id = string_arg(&args, "databaseId")?;
        let name = string_arg(&args, "name")?;
        let kind = string_arg(&args, "type")?;
        let config = args.get("config").cloned().unwrap_or(Value::Null);
        let prop = state.vault.create_property(&database_id, &name, &kind, config)?;
        Ok(serde_json::to_value(prop)?)
    }
}

pub struct UpdateProperty;

#[async_trait]
impl Tool for UpdateProperty {
    fn name(&self) -> &'static str { "s16_update_property" }
    fn description(&self) -> &'static str { "Update a property: rename, change config, or replace options." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["propertyId"],
            "properties": {
                "propertyId": { "type": "string" },
                "name":       { "type": "string" },
                "config":     { "type": "object" },
                "position":   { "type": "integer" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = string_arg(&args, "propertyId")?;
        let patch = PropertyPatch {
            name: args.get("name").and_then(|v| v.as_str()).map(String::from),
            config: args.get("config").cloned(),
            position: args.get("position").and_then(|v| v.as_i64()).map(|n| n as i32),
        };
        let prop = state.vault.update_property(&id, patch)?;
        Ok(serde_json::to_value(prop)?)
    }
}

pub struct DeleteProperty;

#[async_trait]
impl Tool for DeleteProperty {
    fn name(&self) -> &'static str { "s16_delete_property" }
    fn description(&self) -> &'static str { "Delete a property/column." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["propertyId"],
            "properties": { "propertyId": { "type": "string" } }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = string_arg(&args, "propertyId")?;
        state.vault.delete_property(&id)?;
        Ok(json!({ "ok": true, "propertyId": id }))
    }
}

pub struct DuplicateProperty;

#[async_trait]
impl Tool for DuplicateProperty {
    fn name(&self) -> &'static str { "s16_duplicate_property" }
    fn description(&self) -> &'static str { "Duplicate a property. Values are not copied — schema only." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["propertyId"],
            "properties": { "propertyId": { "type": "string" } }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = string_arg(&args, "propertyId")?;
        let prop = state.vault.duplicate_property(&id)?;
        Ok(serde_json::to_value(prop)?)
    }
}

pub struct RenamePropertyOption;

#[async_trait]
impl Tool for RenamePropertyOption {
    fn name(&self) -> &'static str { "s16_rename_property_option" }
    fn description(&self) -> &'static str {
        "Rename a select/multi_select/status option and propagate the change to row values."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["propertyId", "oldName", "newName"],
            "properties": {
                "propertyId": { "type": "string" },
                "oldName":    { "type": "string" },
                "newName":    { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = string_arg(&args, "propertyId")?;
        let old_name = string_arg(&args, "oldName")?;
        let new_name = string_arg(&args, "newName")?;
        state.vault.rename_property_option(&id, &old_name, &new_name)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct DeletePropertyOption;

#[async_trait]
impl Tool for DeletePropertyOption {
    fn name(&self) -> &'static str { "s16_delete_property_option" }
    fn description(&self) -> &'static str {
        "Delete a select/multi_select/status option and remove its usages from existing rows."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["propertyId", "optionName"],
            "properties": {
                "propertyId": { "type": "string" },
                "optionName": { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = string_arg(&args, "propertyId")?;
        let opt = string_arg(&args, "optionName")?;
        state.vault.delete_property_option(&id, &opt)?;
        Ok(json!({ "ok": true }))
    }
}

fn string_arg(args: &Value, key: &str) -> Result<String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| anyhow!("missing required string arg: {key}"))
}
