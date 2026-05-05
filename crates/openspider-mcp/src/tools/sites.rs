//! Site tools — 25 in total. Sites + pages + page virtual fs + components + assets.
//!
//! Layout under <vault>/sites/.

use crate::registry::Tool;
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use openspider_core::SiteComponent;
use serde_json::{json, Value};
use std::collections::BTreeMap;

// ── Sites ───────────────────────────────────────────────────────────────

pub struct ListSites;
#[async_trait]
impl Tool for ListSites {
    fn name(&self) -> &'static str { "s16_list_sites" }
    fn description(&self) -> &'static str { "List sites in the workspace." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": { "includeArchived": { "type": "boolean" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let archived = args.get("includeArchived").and_then(|v| v.as_bool()).unwrap_or(false);
        Ok(serde_json::to_value(state.vault.list_sites(archived)?)?)
    }
}

pub struct CreateSite;
#[async_trait]
impl Tool for CreateSite {
    fn name(&self) -> &'static str { "s16_create_site" }
    fn description(&self) -> &'static str { "Create a new site (auto-creates a starter home page)." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["name"],
            "properties": {
                "name": { "type": "string" },
                "slug": { "type": "string" },
                "icon": { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let name = sarg(&args, "name")?;
        let slug = args.get("slug").and_then(|v| v.as_str()).map(String::from);
        let icon = args.get("icon").and_then(|v| v.as_str()).map(String::from);
        Ok(serde_json::to_value(state.vault.create_site(&name, slug, icon)?)?)
    }
}

pub struct GetSite;
#[async_trait]
impl Tool for GetSite {
    fn name(&self) -> &'static str { "s16_get_site" }
    fn description(&self) -> &'static str { "Get site details + pages list." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["siteId"], "properties": { "siteId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "siteId")?;
        Ok(serde_json::to_value(state.vault.get_site(&id)?)?)
    }
}

pub struct UpdateSite;
#[async_trait]
impl Tool for UpdateSite {
    fn name(&self) -> &'static str { "s16_update_site" }
    fn description(&self) -> &'static str { "Update site metadata." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["siteId"],
            "properties": {
                "siteId":      { "type": "string" },
                "name":        { "type": "string" },
                "icon":        { "type": "string" },
                "description": { "type": "string" },
                "isPublished": { "type": "boolean" },
                "isArchived":  { "type": "boolean" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "siteId")?;
        Ok(serde_json::to_value(state.vault.update_site(&id, args)?)?)
    }
}

pub struct DeleteSite;
#[async_trait]
impl Tool for DeleteSite {
    fn name(&self) -> &'static str { "s16_delete_site" }
    fn description(&self) -> &'static str { "Permanently delete a site and all its pages. Irreversible." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["siteId"], "properties": { "siteId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "siteId")?;
        state.vault.delete_site(&id)?;
        Ok(json!({ "ok": true }))
    }
}

// ── Site pages ──────────────────────────────────────────────────────────

pub struct ListSitePages;
#[async_trait]
impl Tool for ListSitePages {
    fn name(&self) -> &'static str { "s16_list_site_pages" }
    fn description(&self) -> &'static str { "List pages for a site (slim metadata)." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["siteId"], "properties": { "siteId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "siteId")?;
        Ok(serde_json::to_value(state.vault.list_site_pages(&id)?)?)
    }
}

pub struct GetSitePage;
#[async_trait]
impl Tool for GetSitePage {
    fn name(&self) -> &'static str { "s16_get_site_page" }
    fn description(&self) -> &'static str { "Get full site page (files dict + entryPath + custom CSS/JS + SEO)." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["pageId"], "properties": { "pageId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "pageId")?;
        Ok(serde_json::to_value(state.vault.get_site_page(&id)?)?)
    }
}

pub struct CreateSitePage;
#[async_trait]
impl Tool for CreateSitePage {
    fn name(&self) -> &'static str { "s16_create_site_page" }
    fn description(&self) -> &'static str { "Create a new site page. If files omitted, a starter index.html is written." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["siteId", "slug", "title"],
            "properties": {
                "siteId": { "type": "string" },
                "slug":   { "type": "string" },
                "title":  { "type": "string" },
                "isHome": { "type": "boolean" },
                "files":  { "type": "object", "additionalProperties": { "type": "string" } }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let site_id = sarg(&args, "siteId")?;
        let slug = sarg(&args, "slug")?;
        let title = sarg(&args, "title")?;
        let is_home = args.get("isHome").and_then(|v| v.as_bool()).unwrap_or(false);
        let files: BTreeMap<String, String> = args.get("files")
            .and_then(|v| v.as_object())
            .map(|m| m.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect())
            .unwrap_or_default();
        Ok(serde_json::to_value(state.vault.create_site_page(&site_id, &slug, &title, is_home, files)?)?)
    }
}

pub struct UpdateSitePage;
#[async_trait]
impl Tool for UpdateSitePage {
    fn name(&self) -> &'static str { "s16_update_site_page" }
    fn description(&self) -> &'static str { "Update site page metadata (slug/title/css/js/seo/isHome/isPublished)." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["pageId"],
            "properties": {
                "pageId":      { "type": "string" },
                "slug":        { "type": "string" },
                "title":       { "type": "string" },
                "isHome":      { "type": "boolean" },
                "isPublished": { "type": "boolean" },
                "css":         { "type": "string" },
                "js":          { "type": "string" },
                "seo":         { "type": "object" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "pageId")?;
        Ok(serde_json::to_value(state.vault.update_site_page(&id, args)?)?)
    }
}

pub struct DeleteSitePage;
#[async_trait]
impl Tool for DeleteSitePage {
    fn name(&self) -> &'static str { "s16_delete_site_page" }
    fn description(&self) -> &'static str { "Delete a site page permanently. If it was the home page, the next page becomes home." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["pageId"], "properties": { "pageId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "pageId")?;
        state.vault.delete_site_page(&id)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct PublishSitePage;
#[async_trait]
impl Tool for PublishSitePage {
    fn name(&self) -> &'static str { "s16_publish_site_page" }
    fn description(&self) -> &'static str { "Publish or unpublish a site page. Returns publicUrl + shareId on first publish." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["pageId", "isPublished"],
            "properties": {
                "pageId":      { "type": "string" },
                "isPublished": { "type": "boolean" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "pageId")?;
        let pub_ = args.get("isPublished").and_then(|v| v.as_bool()).unwrap_or(false);
        Ok(serde_json::to_value(state.vault.publish_site_page(&id, pub_)?)?)
    }
}

// ── Site page virtual file system ───────────────────────────────────────

pub struct ListSitePageFiles;
#[async_trait]
impl Tool for ListSitePageFiles {
    fn name(&self) -> &'static str { "s16_list_site_page_files" }
    fn description(&self) -> &'static str { "List file paths in a site page virtual file system." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["pageId"], "properties": { "pageId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "pageId")?;
        state.vault.list_site_page_files(&id)
    }
}

pub struct ReadSitePageFile;
#[async_trait]
impl Tool for ReadSitePageFile {
    fn name(&self) -> &'static str { "s16_read_site_page_file" }
    fn description(&self) -> &'static str { "Read the contents of a single file in the site page virtual file system." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["pageId", "path"],
            "properties": {
                "pageId": { "type": "string" },
                "path":   { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "pageId")?;
        let path = sarg(&args, "path")?;
        let content = state.vault.read_site_page_file(&id, &path)?;
        Ok(json!({ "path": path, "content": content }))
    }
}

pub struct WriteSitePageFile;
#[async_trait]
impl Tool for WriteSitePageFile {
    fn name(&self) -> &'static str { "s16_write_site_page_file" }
    fn description(&self) -> &'static str { "Create or overwrite a single file in the site page virtual file system." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["pageId", "path", "content"],
            "properties": {
                "pageId":  { "type": "string" },
                "path":    { "type": "string" },
                "content": { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "pageId")?;
        let path = sarg(&args, "path")?;
        let content = sarg(&args, "content")?;
        state.vault.write_site_page_file(&id, &path, &content)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct EditSitePageFile;
#[async_trait]
impl Tool for EditSitePageFile {
    fn name(&self) -> &'static str { "s16_edit_site_page_file" }
    fn description(&self) -> &'static str { "Replace a unique substring in a file. oldString must occur EXACTLY ONCE." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["pageId", "path", "oldString", "newString"],
            "properties": {
                "pageId":    { "type": "string" },
                "path":      { "type": "string" },
                "oldString": { "type": "string" },
                "newString": { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "pageId")?;
        let path = sarg(&args, "path")?;
        let old_s = sarg(&args, "oldString")?;
        let new_s = sarg(&args, "newString")?;
        state.vault.edit_site_page_file(&id, &path, &old_s, &new_s)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct DeleteSitePageFile;
#[async_trait]
impl Tool for DeleteSitePageFile {
    fn name(&self) -> &'static str { "s16_delete_site_page_file" }
    fn description(&self) -> &'static str { "Delete a file from the site page virtual file system. Cannot delete the entry file." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["pageId", "path"],
            "properties": {
                "pageId": { "type": "string" },
                "path":   { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "pageId")?;
        let path = sarg(&args, "path")?;
        state.vault.delete_site_page_file(&id, &path)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct SetSitePageFiles;
#[async_trait]
impl Tool for SetSitePageFiles {
    fn name(&self) -> &'static str { "s16_set_site_page_files" }
    fn description(&self) -> &'static str { "Replace the entire virtual file system of a site page." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["pageId", "files"],
            "properties": {
                "pageId":           { "type": "string" },
                "files":            { "type": "object" },
                "entryPath":        { "type": "string" },
                "allowedDatabases": { "type": "array" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "pageId")?;
        let files: BTreeMap<String, String> = args.get("files")
            .and_then(|v| v.as_object())
            .map(|m| m.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect())
            .unwrap_or_default();
        let entry = args.get("entryPath").and_then(|v| v.as_str()).map(String::from);
        let dbs = args.get("allowedDatabases").and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect());
        state.vault.set_site_page_files(&id, files, entry, dbs)?;
        Ok(json!({ "ok": true }))
    }
}

// ── Site components ────────────────────────────────────────────────────

pub struct ListSiteComponents;
#[async_trait]
impl Tool for ListSiteComponents {
    fn name(&self) -> &'static str { "s16_list_site_components" }
    fn description(&self) -> &'static str { "List workspace site components." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": { "search": { "type": "string" }, "scope": { "type": "string" }, "category": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let q = args.get("search").and_then(|v| v.as_str());
        Ok(serde_json::to_value(state.vault.list_site_components(q)?)?)
    }
}

pub struct GetSiteComponent;
#[async_trait]
impl Tool for GetSiteComponent {
    fn name(&self) -> &'static str { "s16_get_site_component" }
    fn description(&self) -> &'static str { "Get full component (propsSchema, defaultProps, tree, code)." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["componentId"], "properties": { "componentId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "componentId")?;
        Ok(serde_json::to_value(state.vault.get_site_component(&id)?)?)
    }
}

pub struct CreateSiteComponent;
#[async_trait]
impl Tool for CreateSiteComponent {
    fn name(&self) -> &'static str { "s16_create_site_component" }
    fn description(&self) -> &'static str { "Create a workspace-scoped site component." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["name"],
            "properties": {
                "name":         { "type": "string" },
                "category":     { "type": "string" },
                "description":  { "type": "string" },
                "propsSchema":  { "type": "object" },
                "defaultProps": { "type": "object" },
                "tree":         { "type": "object" },
                "code":         { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let mut spec = SiteComponent::default();
        spec.name = sarg(&args, "name")?;
        spec.category = args.get("category").and_then(|v| v.as_str()).unwrap_or("general").into();
        spec.description = args.get("description").and_then(|v| v.as_str()).map(String::from);
        spec.props_schema = args.get("propsSchema").cloned().unwrap_or(Value::Null);
        spec.default_props = args.get("defaultProps").cloned().unwrap_or(Value::Null);
        spec.tree = args.get("tree").cloned().unwrap_or(Value::Null);
        spec.code = args.get("code").and_then(|v| v.as_str()).unwrap_or("").into();
        Ok(serde_json::to_value(state.vault.create_site_component(spec)?)?)
    }
}

pub struct UpdateSiteComponent;
#[async_trait]
impl Tool for UpdateSiteComponent {
    fn name(&self) -> &'static str { "s16_update_site_component" }
    fn description(&self) -> &'static str { "Update a workspace component. System components are read-only." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["componentId"],
            "properties": {
                "componentId":  { "type": "string" },
                "name":         { "type": "string" },
                "category":     { "type": "string" },
                "description":  { "type": "string" },
                "propsSchema":  { "type": "object" },
                "defaultProps": { "type": "object" },
                "tree":         { "type": "object" },
                "code":         { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "componentId")?;
        Ok(serde_json::to_value(state.vault.update_site_component(&id, args)?)?)
    }
}

pub struct InstallSiteComponent;
#[async_trait]
impl Tool for InstallSiteComponent {
    fn name(&self) -> &'static str { "s16_install_site_component" }
    fn description(&self) -> &'static str {
        "Clone a public/system component into the workspace. (OpenSpider: takes a full spec rather than a remote id.)"
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["componentId"],
            "properties": {
                "componentId": { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "componentId")?;
        let source = state.vault.get_site_component(&id)?;
        Ok(serde_json::to_value(state.vault.install_site_component(&source)?)?)
    }
}

pub struct DeleteSiteComponent;
#[async_trait]
impl Tool for DeleteSiteComponent {
    fn name(&self) -> &'static str { "s16_delete_site_component" }
    fn description(&self) -> &'static str { "Delete a workspace component." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["componentId"], "properties": { "componentId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "componentId")?;
        state.vault.delete_site_component(&id)?;
        Ok(json!({ "ok": true }))
    }
}

// ── Site assets ────────────────────────────────────────────────────────

pub struct ListSiteAssets;
#[async_trait]
impl Tool for ListSiteAssets {
    fn name(&self) -> &'static str { "s16_list_site_assets" }
    fn description(&self) -> &'static str { "List uploaded assets across sites (filterable by siteId)." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": { "siteId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let site = args.get("siteId").and_then(|v| v.as_str());
        Ok(serde_json::to_value(state.vault.list_site_assets(site)?)?)
    }
}

pub struct DeleteSiteAsset;
#[async_trait]
impl Tool for DeleteSiteAsset {
    fn name(&self) -> &'static str { "s16_delete_site_asset" }
    fn description(&self) -> &'static str { "Delete a site asset record (and the underlying file)." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["assetId"], "properties": { "assetId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "assetId")?;
        state.vault.delete_site_asset(&id)?;
        Ok(json!({ "ok": true }))
    }
}

fn sarg(args: &Value, key: &str) -> Result<String> {
    args.get(key).and_then(|v| v.as_str()).map(String::from)
        .ok_or_else(|| anyhow!("missing required string arg: {key}"))
}
