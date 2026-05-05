//! Page (database row) tools — 15 in total.
//!
//! Wire shape mirrors S16: `propertiesCache` keyed by property ID, but
//! `s16_create_page` / `s16_update_page` / `s16_bulk_update_cells` accept
//! `properties` keyed by NAME. We translate at the boundary.

use crate::registry::Tool;
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use openspider_core::{ListPagesOpts, PagePatch};
use serde_json::{json, Map, Value};

// ── s16_list_pages ──────────────────────────────────────────────────────

pub struct ListPages;

#[async_trait]
impl Tool for ListPages {
    fn name(&self) -> &'static str { "s16_list_pages" }
    fn description(&self) -> &'static str {
        "List pages/rows in a database. Supports limit and search."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["databaseId"],
            "properties": {
                "databaseId":      { "type": "string" },
                "limit":           { "type": "integer" },
                "search":          { "type": "string" },
                "includeArchived": { "type": "boolean" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let database_id = string_arg(&args, "databaseId")?;
        let opts = ListPagesOpts {
            limit: args.get("limit").and_then(|v| v.as_u64()).map(|n| n as usize),
            search: args.get("search").and_then(|v| v.as_str()).map(String::from),
            include_archived: args.get("includeArchived").and_then(|v| v.as_bool()).unwrap_or(false),
        };
        let pages = state.vault.list_pages(&database_id, opts)?;
        Ok(json!({ "items": pages }))
    }
}

pub struct CountPages;

#[async_trait]
impl Tool for CountPages {
    fn name(&self) -> &'static str { "s16_count_pages" }
    fn description(&self) -> &'static str { "Count rows in a database with optional search." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["databaseId"],
            "properties": {
                "databaseId": { "type": "string" },
                "search":     { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let database_id = string_arg(&args, "databaseId")?;
        let search = args.get("search").and_then(|v| v.as_str()).map(String::from);
        let n = state.vault.count_pages(&database_id, search)?;
        Ok(json!({ "count": n }))
    }
}

pub struct GetPage;

#[async_trait]
impl Tool for GetPage {
    fn name(&self) -> &'static str { "s16_get_page" }
    fn description(&self) -> &'static str { "Get a page/row with all its cell values." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object", "required": ["pageId"],
            "properties": { "pageId": { "type": "string" } }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let page_id = string_arg(&args, "pageId")?;
        let (page, _) = state.vault.get_page(&page_id)?;
        Ok(serde_json::to_value(page)?)
    }
}

pub struct CreatePage;

#[async_trait]
impl Tool for CreatePage {
    fn name(&self) -> &'static str { "s16_create_page" }
    fn description(&self) -> &'static str {
        "Create a new page/row. Cells use property NAME (case-insensitive). Content is markdown."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["databaseId"],
            "properties": {
                "databaseId":    { "type": "string" },
                "title":         { "type": "string" },
                "properties":    { "type": "object" },
                "content":       { "type": "string" },
                "contentFormat": { "type": "string", "enum": ["markdown", "html"] }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let database_id = string_arg(&args, "databaseId")?;
        let title = args.get("title").and_then(|v| v.as_str()).map(String::from);
        let properties = args
            .get("properties")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();
        let content = args.get("content").and_then(|v| v.as_str()).map(String::from);
        let page = state.vault.create_page(&database_id, title, properties, content)?;
        Ok(serde_json::to_value(page)?)
    }
}

pub struct UpdatePage;

#[async_trait]
impl Tool for UpdatePage {
    fn name(&self) -> &'static str { "s16_update_page" }
    fn description(&self) -> &'static str {
        "Update a page: set cell values (by NAME) and/or replace content body."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["pageId"],
            "properties": {
                "pageId":        { "type": "string" },
                "properties":    { "type": "object" },
                "content":       { "type": "string" },
                "contentFormat": { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let page_id = string_arg(&args, "pageId")?;
        let patch = PagePatch {
            properties_by_name: args.get("properties").and_then(|v| v.as_object()).cloned(),
            content_md: args.get("content").and_then(|v| v.as_str()).map(String::from),
        };
        let page = state.vault.update_page(&page_id, patch)?;
        Ok(serde_json::to_value(page)?)
    }
}

pub struct UpdateCell;

#[async_trait]
impl Tool for UpdateCell {
    fn name(&self) -> &'static str { "s16_update_cell" }
    fn description(&self) -> &'static str { "Update a single cell on a page. Use property ID." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["pageId", "propertyId", "value"],
            "properties": {
                "pageId":     { "type": "string" },
                "propertyId": { "type": "string" },
                "value":      {}
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let page_id = string_arg(&args, "pageId")?;
        let property_id = string_arg(&args, "propertyId")?;
        let value = args.get("value").cloned().unwrap_or(Value::Null);
        state.vault.update_cell(&page_id, &property_id, value)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct BulkUpdateCells;

#[async_trait]
impl Tool for BulkUpdateCells {
    fn name(&self) -> &'static str { "s16_bulk_update_cells" }
    fn description(&self) -> &'static str {
        "Update many cells in one call. Cells keyed by property NAME (case-insensitive)."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["pageId", "databaseId", "cells"],
            "properties": {
                "pageId":     { "type": "string" },
                "databaseId": { "type": "string" },
                "cells":      { "type": "object" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let page_id = string_arg(&args, "pageId")?;
        let database_id = string_arg(&args, "databaseId")?;
        let cells: Map<String, Value> = args
            .get("cells").and_then(|v| v.as_object()).cloned().unwrap_or_default();
        state.vault.bulk_update_cells(&page_id, &database_id, cells)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct GetPageContent;

#[async_trait]
impl Tool for GetPageContent {
    fn name(&self) -> &'static str { "s16_get_page_content" }
    fn description(&self) -> &'static str { "Get the rich content (HTML) of a page." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object", "required": ["pageId"],
            "properties": { "pageId": { "type": "string" } }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let page_id = string_arg(&args, "pageId")?;
        let html = state.vault.get_page_content(&page_id)?;
        Ok(Value::String(html))
    }
}

pub struct UpdatePageContent;

#[async_trait]
impl Tool for UpdatePageContent {
    fn name(&self) -> &'static str { "s16_update_page_content" }
    fn description(&self) -> &'static str {
        "Replace page rich content. Accepts markdown (default) or html."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["pageId", "content"],
            "properties": {
                "pageId":        { "type": "string" },
                "content":       { "type": "string" },
                "contentFormat": { "type": "string", "enum": ["markdown", "html"] }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let page_id = string_arg(&args, "pageId")?;
        let content = string_arg(&args, "content")?;
        let format = args.get("contentFormat").and_then(|v| v.as_str()).unwrap_or("markdown");
        state.vault.update_page_content(&page_id, &content, format)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct ArchivePage;

#[async_trait]
impl Tool for ArchivePage {
    fn name(&self) -> &'static str { "s16_archive_page" }
    fn description(&self) -> &'static str { "Archive a page/row (hide from default lists)." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["pageId"], "properties": { "pageId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = string_arg(&args, "pageId")?;
        state.vault.archive_page(&id)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct DeletePage;

#[async_trait]
impl Tool for DeletePage {
    fn name(&self) -> &'static str { "s16_delete_page" }
    fn description(&self) -> &'static str { "Delete a page/row from the vault." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["pageId"], "properties": { "pageId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = string_arg(&args, "pageId")?;
        state.vault.delete_page(&id)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct BulkDeletePages;

#[async_trait]
impl Tool for BulkDeletePages {
    fn name(&self) -> &'static str { "s16_bulk_delete_pages" }
    fn description(&self) -> &'static str { "Delete multiple pages in one call." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object", "required": ["pageIds"],
            "properties": { "pageIds": { "type": "array", "items": { "type": "string" } } }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let ids: Vec<String> = args.get("pageIds").and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let mut errors = Vec::new();
        for id in &ids {
            if let Err(e) = state.vault.delete_page(id) {
                errors.push(format!("{id}: {e}"));
            }
        }
        Ok(json!({ "ok": errors.is_empty(), "deleted": ids.len() - errors.len(), "errors": errors }))
    }
}

pub struct DuplicatePage;

#[async_trait]
impl Tool for DuplicatePage {
    fn name(&self) -> &'static str { "s16_duplicate_page" }
    fn description(&self) -> &'static str { "Duplicate a page/row including its values and content." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["pageId"], "properties": { "pageId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = string_arg(&args, "pageId")?;
        let p = state.vault.duplicate_page(&id)?;
        Ok(serde_json::to_value(p)?)
    }
}

pub struct SetPageSharing;

#[async_trait]
impl Tool for SetPageSharing {
    fn name(&self) -> &'static str { "s16_set_page_sharing" }
    fn description(&self) -> &'static str {
        "Toggle public sharing for a page. Generates a shareId on first publish."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object", "required": ["pageId", "isPublic"],
            "properties": {
                "pageId":   { "type": "string" },
                "isPublic": { "type": "boolean" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = string_arg(&args, "pageId")?;
        let is_public = args.get("isPublic").and_then(|v| v.as_bool()).unwrap_or(false);
        let p = state.vault.set_page_sharing(&id, is_public)?;
        Ok(serde_json::to_value(p)?)
    }
}

// Public-share reads (real in v0.8).
pub struct ListPublicPages;
#[async_trait]
impl Tool for ListPublicPages {
    fn name(&self) -> &'static str { "s16_list_public_pages" }
    fn description(&self) -> &'static str { "List public pages in a publicly shared database via shareId." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["shareId"],
            "properties": {
                "shareId": { "type": "string" },
                "limit":   { "type": "integer" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let share_id = string_arg(&args, "shareId")?;
        let limit = args.get("limit").and_then(|v| v.as_u64()).map(|n| n as usize).unwrap_or(50);
        let pages = state.vault.list_public_pages(&share_id, limit)?;
        Ok(json!({ "items": pages }))
    }
}

pub struct GetPublicPage;
#[async_trait]
impl Tool for GetPublicPage {
    fn name(&self) -> &'static str { "s16_get_public_page" }
    fn description(&self) -> &'static str { "Get a public page through its share ID." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["shareId"], "properties": { "shareId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let share_id = string_arg(&args, "shareId")?;
        Ok(serde_json::to_value(state.vault.get_public_page(&share_id)?)?)
    }
}

pub struct CountPublicPages;
#[async_trait]
impl Tool for CountPublicPages {
    fn name(&self) -> &'static str { "s16_count_public_pages" }
    fn description(&self) -> &'static str { "Count public pages in a publicly shared database via shareId." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["shareId"], "properties": { "shareId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let share_id = string_arg(&args, "shareId")?;
        Ok(json!({ "count": state.vault.count_public_pages(&share_id)? }))
    }
}

fn string_arg(args: &Value, key: &str) -> Result<String> {
    args.get(key).and_then(|v| v.as_str()).map(String::from)
        .ok_or_else(|| anyhow!("missing required string arg: {key}"))
}
