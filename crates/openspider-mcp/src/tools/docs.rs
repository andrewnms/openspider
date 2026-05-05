//! Doc (sidebar tree) tools — 17 in total.
//!
//! Each doc is a flat markdown file in <vault>/docs/. Hierarchy is logical
//! via `parentId` in frontmatter, not filesystem nesting (simpler to move).
//! Trashed docs live under docs/_trash/.

use crate::registry::Tool;
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use openspider_core::{DocPatch, ListDocsOpts};
use serde_json::{json, Value};

pub struct ListDocs;
#[async_trait]
impl Tool for ListDocs {
    fn name(&self) -> &'static str { "s16_list_docs" }
    fn description(&self) -> &'static str { "List docs in the workspace (top-level or by parent)." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "parentId":        { "type": "string" },
                "includeArchived": { "type": "boolean" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let opts = ListDocsOpts {
            parent_id: args.get("parentId").and_then(|v| v.as_str()).map(String::from),
            include_archived: args.get("includeArchived").and_then(|v| v.as_bool()).unwrap_or(false),
        };
        Ok(serde_json::to_value(state.vault.list_docs(opts)?)?)
    }
}

pub struct ListAllDocs;
#[async_trait]
impl Tool for ListAllDocs {
    fn name(&self) -> &'static str { "s16_list_all_docs" }
    fn description(&self) -> &'static str { "Flat list of every non-archived doc." }
    async fn call(&self, state: &AppState, _args: Value) -> Result<Value> {
        Ok(serde_json::to_value(state.vault.list_all_docs()?)?)
    }
}

pub struct ListDocChildren;
#[async_trait]
impl Tool for ListDocChildren {
    fn name(&self) -> &'static str { "s16_list_doc_children" }
    fn description(&self) -> &'static str { "List direct children of a doc." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["docId"], "properties": { "docId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "docId")?;
        Ok(serde_json::to_value(state.vault.list_doc_children(&id)?)?)
    }
}

pub struct ListTrashDocs;
#[async_trait]
impl Tool for ListTrashDocs {
    fn name(&self) -> &'static str { "s16_list_trash_docs" }
    fn description(&self) -> &'static str { "List archived (trashed) docs." }
    async fn call(&self, state: &AppState, _args: Value) -> Result<Value> {
        Ok(serde_json::to_value(state.vault.list_trash_docs()?)?)
    }
}

pub struct GetDoc;
#[async_trait]
impl Tool for GetDoc {
    fn name(&self) -> &'static str { "s16_get_doc" }
    fn description(&self) -> &'static str { "Get a doc with metadata. Use s16_get_doc_content for HTML body." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["docId"], "properties": { "docId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "docId")?;
        Ok(serde_json::to_value(state.vault.get_doc(&id)?)?)
    }
}

pub struct GetDocContent;
#[async_trait]
impl Tool for GetDocContent {
    fn name(&self) -> &'static str { "s16_get_doc_content" }
    fn description(&self) -> &'static str { "Get the rich content (HTML) of a doc." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["docId"], "properties": { "docId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "docId")?;
        Ok(Value::String(state.vault.get_doc_content(&id)?))
    }
}

pub struct GetDocAncestors;
#[async_trait]
impl Tool for GetDocAncestors {
    fn name(&self) -> &'static str { "s16_get_doc_ancestors" }
    fn description(&self) -> &'static str { "Get the parent chain of a doc, root → immediate parent." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["docId"], "properties": { "docId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "docId")?;
        Ok(serde_json::to_value(state.vault.get_doc_ancestors(&id)?)?)
    }
}

pub struct GetDocBacklinks;
#[async_trait]
impl Tool for GetDocBacklinks {
    fn name(&self) -> &'static str { "s16_get_doc_backlinks" }
    fn description(&self) -> &'static str { "Find docs that link to this doc via [[wiki-links]]." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["docId"], "properties": { "docId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "docId")?;
        Ok(serde_json::to_value(state.vault.get_doc_backlinks(&id)?)?)
    }
}

pub struct GetPublicDoc;
#[async_trait]
impl Tool for GetPublicDoc {
    fn name(&self) -> &'static str { "s16_get_public_doc" }
    fn description(&self) -> &'static str { "Get a public doc through its share id." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["shareId"], "properties": { "shareId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let share_id = sarg(&args, "shareId")?;
        Ok(serde_json::to_value(state.vault.get_public_doc(&share_id)?)?)
    }
}

pub struct CreateDoc;
#[async_trait]
impl Tool for CreateDoc {
    fn name(&self) -> &'static str { "s16_create_doc" }
    fn description(&self) -> &'static str { "Create a new doc with optional icon, parent, and markdown body." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["title"],
            "properties": {
                "title":         { "type": "string" },
                "icon":          { "type": "string" },
                "parentId":      { "type": "string" },
                "content":       { "type": "string" },
                "contentFormat": { "type": "string", "enum": ["markdown", "html"] }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let title = sarg(&args, "title")?;
        let icon = args.get("icon").and_then(|v| v.as_str()).map(String::from);
        let parent_id = args.get("parentId").and_then(|v| v.as_str()).map(String::from);
        let content = args.get("content").and_then(|v| v.as_str()).map(String::from);
        Ok(serde_json::to_value(state.vault.create_doc(&title, icon, parent_id, content)?)?)
    }
}

pub struct UpdateDoc;
#[async_trait]
impl Tool for UpdateDoc {
    fn name(&self) -> &'static str { "s16_update_doc" }
    fn description(&self) -> &'static str { "Update doc title/icon/content. Replaces content if provided." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["docId"],
            "properties": {
                "docId":         { "type": "string" },
                "title":         { "type": "string" },
                "icon":          { "type": "string" },
                "content":       { "type": "string" },
                "contentFormat": { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "docId")?;
        let patch = DocPatch {
            title: args.get("title").and_then(|v| v.as_str()).map(String::from),
            icon: args.get("icon").and_then(|v| v.as_str()).map(String::from),
            parent_id: None, // update doesn't move; use s16_move_doc for that
            content_md: args.get("content").and_then(|v| v.as_str()).map(String::from),
        };
        Ok(serde_json::to_value(state.vault.update_doc(&id, patch)?)?)
    }
}

pub struct UpdateDocContent;
#[async_trait]
impl Tool for UpdateDocContent {
    fn name(&self) -> &'static str { "s16_update_doc_content" }
    fn description(&self) -> &'static str { "Replace doc body content. Markdown by default." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["docId", "content"],
            "properties": {
                "docId":         { "type": "string" },
                "content":       { "type": "string" },
                "contentFormat": { "type": "string", "enum": ["markdown", "html"] }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "docId")?;
        let content = sarg(&args, "content")?;
        let format = args.get("contentFormat").and_then(|v| v.as_str()).unwrap_or("markdown");
        state.vault.update_doc_content(&id, &content, format)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct SetDocSharing;
#[async_trait]
impl Tool for SetDocSharing {
    fn name(&self) -> &'static str { "s16_set_doc_sharing" }
    fn description(&self) -> &'static str { "Toggle public sharing for a doc. Generates shareId on first publish." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["docId", "isPublic"],
            "properties": {
                "docId":    { "type": "string" },
                "isPublic": { "type": "boolean" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "docId")?;
        let is_public = args.get("isPublic").and_then(|v| v.as_bool()).unwrap_or(false);
        Ok(serde_json::to_value(state.vault.set_doc_sharing(&id, is_public)?)?)
    }
}

pub struct MoveDoc;
#[async_trait]
impl Tool for MoveDoc {
    fn name(&self) -> &'static str { "s16_move_doc" }
    fn description(&self) -> &'static str { "Move a doc to a new parent. newParentId = null moves to root." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["docId"],
            "properties": {
                "docId":       { "type": "string" },
                "newParentId": { "type": ["string", "null"] }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "docId")?;
        let new_parent = args.get("newParentId").and_then(|v| v.as_str()).map(String::from);
        Ok(serde_json::to_value(state.vault.move_doc(&id, new_parent)?)?)
    }
}

pub struct DuplicateDoc;
#[async_trait]
impl Tool for DuplicateDoc {
    fn name(&self) -> &'static str { "s16_duplicate_doc" }
    fn description(&self) -> &'static str { "Duplicate a doc (subtree duplication lands later; this is single-doc)." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["docId"], "properties": { "docId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "docId")?;
        Ok(serde_json::to_value(state.vault.duplicate_doc(&id)?)?)
    }
}

pub struct DeleteDoc;
#[async_trait]
impl Tool for DeleteDoc {
    fn name(&self) -> &'static str { "s16_delete_doc" }
    fn description(&self) -> &'static str { "Soft-delete a doc to trash. Restore with s16_restore_doc." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["docId"], "properties": { "docId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "docId")?;
        state.vault.delete_doc(&id)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct RestoreDoc;
#[async_trait]
impl Tool for RestoreDoc {
    fn name(&self) -> &'static str { "s16_restore_doc" }
    fn description(&self) -> &'static str { "Restore a doc from trash to the active sidebar." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["docId"], "properties": { "docId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "docId")?;
        Ok(serde_json::to_value(state.vault.restore_doc(&id)?)?)
    }
}

pub struct DeleteDocPermanently;
#[async_trait]
impl Tool for DeleteDocPermanently {
    fn name(&self) -> &'static str { "s16_delete_doc_permanently" }
    fn description(&self) -> &'static str { "Permanently delete a doc. Irreversible — file is removed from disk." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["docId"], "properties": { "docId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "docId")?;
        state.vault.delete_doc_permanently(&id)?;
        Ok(json!({ "ok": true }))
    }
}

fn sarg(args: &Value, key: &str) -> Result<String> {
    args.get(key).and_then(|v| v.as_str()).map(String::from)
        .ok_or_else(|| anyhow!("missing required string arg: {key}"))
}
