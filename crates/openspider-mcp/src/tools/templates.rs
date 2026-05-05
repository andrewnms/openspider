//! Template tools — 7 in total. Templates stored at databases/<name>/_templates/<id>.md.

use crate::registry::Tool;
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct ListTemplates;
#[async_trait]
impl Tool for ListTemplates {
    fn name(&self) -> &'static str { "s16_list_templates" }
    fn description(&self) -> &'static str { "List all templates for a database." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["databaseId"], "properties": { "databaseId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "databaseId")?;
        Ok(serde_json::to_value(state.vault.list_templates(&id)?)?)
    }
}

pub struct GetTemplate;
#[async_trait]
impl Tool for GetTemplate {
    fn name(&self) -> &'static str { "s16_get_template" }
    fn description(&self) -> &'static str { "Get a template by id with full content + config + styles." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["templateId"], "properties": { "templateId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "templateId")?;
        Ok(serde_json::to_value(state.vault.get_template(&id)?)?)
    }
}

pub struct CreateTemplate;
#[async_trait]
impl Tool for CreateTemplate {
    fn name(&self) -> &'static str { "s16_create_template" }
    fn description(&self) -> &'static str { "Create a new template for a database. Body supports {{variable}} placeholders." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["databaseId", "name"],
            "properties": {
                "databaseId": { "type": "string" },
                "name":       { "type": "string" },
                "icon":       { "type": "string" },
                "title":      { "type": "string" },
                "content":    { "type": "string" },
                "config":     { "type": "object" },
                "styles":     { "type": "object" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let database_id = sarg(&args, "databaseId")?;
        let name = sarg(&args, "name")?;
        let icon = args.get("icon").and_then(|v| v.as_str()).map(String::from);
        let title = args.get("title").and_then(|v| v.as_str()).map(String::from);
        let content = args.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let config = args.get("config").cloned().unwrap_or(Value::Null);
        let styles = args.get("styles").cloned().unwrap_or(Value::Null);
        Ok(serde_json::to_value(state.vault.create_template(&database_id, &name, icon, title, &content, config, styles)?)?)
    }
}

pub struct UpdateTemplate;
#[async_trait]
impl Tool for UpdateTemplate {
    fn name(&self) -> &'static str { "s16_update_template" }
    fn description(&self) -> &'static str { "Update an existing template. Only provided fields change." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["templateId"],
            "properties": {
                "templateId": { "type": "string" },
                "name":       { "type": "string" },
                "icon":       { "type": "string" },
                "title":      { "type": "string" },
                "content":    { "type": "string" },
                "config":     { "type": "object" },
                "styles":     { "type": "object" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "templateId")?;
        Ok(serde_json::to_value(state.vault.update_template(&id, args)?)?)
    }
}

pub struct DeleteTemplate;
#[async_trait]
impl Tool for DeleteTemplate {
    fn name(&self) -> &'static str { "s16_delete_template" }
    fn description(&self) -> &'static str { "Delete a template." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["templateId"], "properties": { "templateId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "templateId")?;
        state.vault.delete_template(&id)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct ApplyTemplate;
#[async_trait]
impl Tool for ApplyTemplate {
    fn name(&self) -> &'static str { "s16_apply_template" }
    fn description(&self) -> &'static str { "Apply a template to create one new page. {{variables}} resolved via the variables arg." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["templateId"],
            "properties": {
                "templateId": { "type": "string" },
                "variables":  { "type": "object" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "templateId")?;
        let vars = args.get("variables").and_then(|v| v.as_object()).cloned().unwrap_or_default();
        Ok(serde_json::to_value(state.vault.apply_template(&id, vars)?)?)
    }
}

pub struct ApplyTemplateToAll;
#[async_trait]
impl Tool for ApplyTemplateToAll {
    fn name(&self) -> &'static str { "s16_apply_template_to_all" }
    fn description(&self) -> &'static str {
        "DESTRUCTIVE: overwrite content of every existing page in the database with the template content."
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["templateId"], "properties": { "templateId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "templateId")?;
        let n = state.vault.apply_template_to_all(&id)?;
        Ok(json!({ "ok": true, "updated": n }))
    }
}

fn sarg(args: &Value, key: &str) -> Result<String> {
    args.get(key).and_then(|v| v.as_str()).map(String::from)
        .ok_or_else(|| anyhow!("missing required string arg: {key}"))
}
