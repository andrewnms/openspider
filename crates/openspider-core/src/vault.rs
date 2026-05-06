//! Vault filesystem operations. The vault is the source of truth.
//!
//!   <vault>/
//!     databases/<DatabaseName>/_schema.yml + <Page>.md files
//!     docs/<...>.md (hierarchical)
//!     agents/<agent>/agent.yml + compiled.mjs
//!     skills/<skill>/SKILL.md
//!     files/...
//!     .openspider/cache.db, .openspider/config.json
//!
//! All writes go through this module so future cache invalidation has one
//! seam to hook into. v0.2 has no SQLite cache yet — operations are direct
//! file I/O. Cache lands in v0.3 when search needs it.

use crate::model::{
    Agent, Credential, Database, Doc, File, Page, Property, Run, Site, SiteAsset, SiteComponent,
    SitePage, SitePageMeta, Skill, Trigger, View,
};
use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// Subdirectories created by `init` and expected by every command.
const TOP_DIRS: &[&str] = &[
    "databases",
    "docs",
    "agents",
    "skills",
    "files",
    "sites",
    ".openspider",
    ".openspider/runs",
];

#[derive(Debug, Clone)]
pub struct Vault {
    pub root: PathBuf,
}

impl Vault {
    /// Create a vault at `path`. Idempotent.
    pub fn init(path: impl AsRef<Path>) -> Result<Self> {
        let root = path.as_ref().to_path_buf();
        fs::create_dir_all(&root).with_context(|| format!("create {root:?}"))?;
        for sub in TOP_DIRS {
            let p = root.join(sub);
            fs::create_dir_all(&p).with_context(|| format!("create {p:?}"))?;
        }
        let config_path = root.join(".openspider/config.json");
        if !config_path.exists() {
            let cfg = WorkspaceConfig {
                workspace_id: Uuid::new_v4().to_string(),
                created_at: chrono::Utc::now().to_rfc3339(),
                llm: None,
            };
            fs::write(&config_path, serde_json::to_string_pretty(&cfg)?)?;
        }
        // Drop a .gitignore inside .openspider so credentials / secrets / runs /
        // sidecar artifacts never get accidentally committed when a user
        // git-inits the vault.
        let openspider_gitignore = root.join(".openspider/.gitignore");
        if !openspider_gitignore.exists() {
            fs::write(&openspider_gitignore, "credentials.json\nsecrets.json\nruns/\nsidecar/\ncache.db*\n")?;
        }
        Ok(Self { root })
    }

    /// Open an existing vault. Errors if not initialized.
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let root = path.as_ref().to_path_buf();
        if !root.join(".openspider/config.json").exists() {
            anyhow::bail!("not an OpenSpider vault: {root:?}. Run `spider init {root:?}` first.");
        }
        Ok(Self { root })
    }

    pub fn config(&self) -> Result<WorkspaceConfig> {
        let raw = fs::read_to_string(self.root.join(".openspider/config.json"))?;
        Ok(serde_json::from_str(&raw)?)
    }

    // ── Databases ─────────────────────────────────────────────────────────

    /// List databases (slim). Doesn't load properties.
    pub fn list_databases(&self) -> Result<Vec<Database>> {
        let dir = self.root.join("databases");
        let mut out = Vec::new();
        for entry in fs::read_dir(&dir).with_context(|| format!("read {dir:?}"))? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.starts_with('_') {
                continue;
            }
            let schema = read_schema(&entry.path()).unwrap_or_default();
            out.push(Database {
                id: schema.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
                name,
                icon: schema.icon,
                description: schema.description,
                is_private: schema.is_private,
                default_template_id: schema.default_template_id,
                property_order: schema.property_order,
                properties: Vec::new(),
                views: Vec::new(),
                templates: Vec::new(),
                path: format!("databases/{}", entry.file_name().to_string_lossy()),
            });
        }
        // Sort by `position` field if present in schema, else by name.
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    /// Resolve a database by id. Reads the full schema (with properties).
    pub fn get_database(&self, database_id: &str) -> Result<Database> {
        for entry in fs::read_dir(self.root.join("databases"))? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.starts_with('_') {
                continue;
            }
            let Ok(schema) = read_schema(&entry.path()) else { continue };
            let Some(id) = schema.id.as_deref() else { continue };
            if id == database_id {
                return Ok(schema_to_database(name.clone(), &entry.path(), schema));
            }
        }
        Err(anyhow!("no database with id {database_id}"))
    }

    /// Resolve database by either id or name (case-insensitive). Useful for
    /// internal helpers; MCP tools should use `get_database` (id-only).
    pub fn find_database(&self, query: &str) -> Result<Database> {
        let q_lower = query.to_lowercase();
        for entry in fs::read_dir(self.root.join("databases"))? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.starts_with('_') {
                continue;
            }
            let schema = read_schema(&entry.path()).unwrap_or_default();
            if schema.id.as_deref() == Some(query) || name.to_lowercase() == q_lower {
                return Ok(schema_to_database(name, &entry.path(), schema));
            }
        }
        Err(anyhow!("no database matching {query}"))
    }

    pub fn create_database(
        &self,
        name: &str,
        icon: Option<String>,
        description: Option<String>,
    ) -> Result<Database> {
        let safe = sanitize_dirname(name);
        let dir = self.root.join("databases").join(&safe);
        if dir.exists() {
            return Err(anyhow!("database \"{name}\" already exists"));
        }
        fs::create_dir_all(&dir)?;

        // Auto-create the primary "Name" title property so the database is
        // immediately usable. Matches s16_create_database behavior.
        let title_prop_id = Uuid::new_v4().to_string();
        let schema = DatabaseSchema {
            id: Some(Uuid::new_v4().to_string()),
            icon,
            description,
            is_private: false,
            default_template_id: None,
            property_order: None,
            properties: vec![PropertySchema {
                id: title_prop_id,
                name: "Name".into(),
                kind: "title".into(),
                config: serde_json::Value::Null,
                position: 0,
                is_primary: true,
                inverse_property_id: None,
            }],
            views: Vec::new(),
        };
        write_schema(&dir, &schema)?;
        Ok(schema_to_database(safe, &dir, schema))
    }

    pub fn update_database(
        &self,
        database_id: &str,
        patch: DatabasePatch,
    ) -> Result<Database> {
        let mut db = self.get_database(database_id)?;
        let dir = self.root.join(&db.path);
        let mut schema = read_schema(&dir)?;
        if let Some(name) = patch.name {
            // Renaming = renaming the directory. Update db.path too.
            let new_safe = sanitize_dirname(&name);
            let new_dir = self.root.join("databases").join(&new_safe);
            if new_dir.exists() && new_dir != dir {
                return Err(anyhow!("can't rename: \"{name}\" already exists"));
            }
            if new_dir != dir {
                fs::rename(&dir, &new_dir)?;
                db.name = new_safe.clone();
                db.path = format!("databases/{new_safe}");
            }
        }
        if patch.icon.is_some() { schema.icon = patch.icon; }
        if patch.description.is_some() { schema.description = patch.description; }
        if let Some(p) = patch.is_private { schema.is_private = p; }
        if let Some(po) = patch.property_order { schema.property_order = Some(po); }
        write_schema(&self.root.join(&db.path), &schema)?;
        Ok(schema_to_database(db.name.clone(), &self.root.join(&db.path), schema))
    }

    pub fn delete_database(&self, database_id: &str) -> Result<()> {
        let db = self.get_database(database_id)?;
        let dir = self.root.join(&db.path);
        fs::remove_dir_all(&dir).with_context(|| format!("delete {dir:?}"))?;
        Ok(())
    }

    /// Set the default template for a database. v0.2 just stores the id; the
    /// template itself isn't validated until v0.6 templates ship.
    pub fn set_default_template(
        &self,
        database_id: &str,
        template_id: Option<String>,
    ) -> Result<()> {
        let db = self.get_database(database_id)?;
        let dir = self.root.join(&db.path);
        let mut schema = read_schema(&dir)?;
        schema.default_template_id = template_id;
        write_schema(&dir, &schema)?;
        Ok(())
    }

    /// Reorder is a UI concern — we don't preserve insertion order on disk
    /// today, but accept the call as a no-op for protocol compat. (v0.6 adds
    /// a sidebar position file.)
    pub fn reorder_databases(&self, _ids: &[String]) -> Result<()> {
        Ok(())
    }

    // ── Properties ───────────────────────────────────────────────────────

    pub fn create_property(
        &self,
        database_id: &str,
        name: &str,
        kind: &str,
        config: serde_json::Value,
    ) -> Result<Property> {
        let db = self.get_database(database_id)?;
        let dir = self.root.join(&db.path);
        let mut schema = read_schema(&dir)?;
        if schema.properties.iter().any(|p| p.name.eq_ignore_ascii_case(name)) {
            return Err(anyhow!("property \"{name}\" already exists in this database"));
        }
        let position = schema.properties.iter().map(|p| p.position).max().unwrap_or(-1) + 1;
        let prop = PropertySchema {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            kind: kind.to_string(),
            config,
            position,
            is_primary: false,
            inverse_property_id: None,
        };
        schema.properties.push(prop.clone());
        write_schema(&dir, &schema)?;
        Ok(Property {
            id: prop.id,
            database_id: db.id,
            name: prop.name,
            kind: prop.kind,
            config: prop.config,
            position: prop.position,
            is_primary: prop.is_primary,
            inverse_property_id: prop.inverse_property_id,
        })
    }

    /// Locate a property by id across every database in the workspace, returning
    /// (database_path, schema, property_index).
    fn find_property(&self, property_id: &str) -> Result<(PathBuf, DatabaseSchema, usize)> {
        for entry in fs::read_dir(self.root.join("databases"))? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.starts_with('_') {
                continue;
            }
            let dir = entry.path();
            let schema = read_schema(&dir).unwrap_or_default();
            if let Some(idx) = schema.properties.iter().position(|p| p.id == property_id) {
                return Ok((dir, schema, idx));
            }
        }
        Err(anyhow!("no property with id {property_id}"))
    }

    pub fn update_property(&self, property_id: &str, patch: PropertyPatch) -> Result<Property> {
        let (dir, mut schema, idx) = self.find_property(property_id)?;
        if let Some(name) = patch.name {
            schema.properties[idx].name = name;
        }
        if let Some(config) = patch.config {
            schema.properties[idx].config = config;
        }
        if let Some(position) = patch.position {
            schema.properties[idx].position = position;
        }
        write_schema(&dir, &schema)?;
        let p = &schema.properties[idx];
        let database_id = schema.id.clone().unwrap_or_default();
        Ok(Property {
            id: p.id.clone(),
            database_id,
            name: p.name.clone(),
            kind: p.kind.clone(),
            config: p.config.clone(),
            position: p.position,
            is_primary: p.is_primary,
            inverse_property_id: p.inverse_property_id.clone(),
        })
    }

    pub fn delete_property(&self, property_id: &str) -> Result<()> {
        let (dir, mut schema, idx) = self.find_property(property_id)?;
        if schema.properties[idx].is_primary {
            return Err(anyhow!("can't delete the primary title property"));
        }
        schema.properties.remove(idx);
        write_schema(&dir, &schema)?;
        Ok(())
    }

    pub fn duplicate_property(&self, property_id: &str) -> Result<Property> {
        let (dir, mut schema, idx) = self.find_property(property_id)?;
        let mut copy = schema.properties[idx].clone();
        copy.id = Uuid::new_v4().to_string();
        copy.name = format!("{} (copy)", copy.name);
        copy.is_primary = false;
        copy.position = schema.properties.iter().map(|p| p.position).max().unwrap_or(-1) + 1;
        let cloned = copy.clone();
        schema.properties.push(copy);
        write_schema(&dir, &schema)?;
        let database_id = schema.id.clone().unwrap_or_default();
        Ok(Property {
            id: cloned.id,
            database_id,
            name: cloned.name,
            kind: cloned.kind,
            config: cloned.config,
            position: cloned.position,
            is_primary: cloned.is_primary,
            inverse_property_id: cloned.inverse_property_id,
        })
    }

    /// Rename a select/multi_select/status option. Mutates schema; row-value
    /// propagation lands in v0.2c when pages are real.
    pub fn rename_property_option(&self, property_id: &str, old_name: &str, new_name: &str) -> Result<()> {
        let (dir, mut schema, idx) = self.find_property(property_id)?;
        let prop = &mut schema.properties[idx];
        if let Some(options) = prop.config.get_mut("options").and_then(|v| v.as_array_mut()) {
            let mut found = false;
            for opt in options.iter_mut() {
                if opt.get("name").and_then(|v| v.as_str()) == Some(old_name) {
                    opt["name"] = serde_json::Value::String(new_name.to_string());
                    found = true;
                }
            }
            if !found {
                return Err(anyhow!("no option named \"{old_name}\""));
            }
        } else {
            return Err(anyhow!("property has no options to rename"));
        }
        write_schema(&dir, &schema)?;
        Ok(())
    }

    // ── Views ────────────────────────────────────────────────────────────

    pub fn list_views(&self, database_id: &str) -> Result<Vec<View>> {
        Ok(self.get_database(database_id)?.views)
    }

    pub fn create_view(&self, database_id: &str, name: &str, kind: &str, body: serde_json::Value) -> Result<View> {
        let db = self.get_database(database_id)?;
        let dir = self.root.join(&db.path);
        let mut schema = read_schema(&dir)?;
        let position = schema.views.iter().map(|v| v.position).max().unwrap_or(-1) + 1;
        let view = ViewSchema {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            kind: kind.to_string(),
            filters: body.get("filters").cloned().unwrap_or(serde_json::Value::Null),
            sorts: body.get("sorts").cloned().unwrap_or(serde_json::Value::Null),
            group_by: body.get("groupBy").and_then(|v| v.as_str()).map(String::from),
            visible_properties: body.get("visibleProperties").and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default(),
            config: body.get("config").cloned().unwrap_or(serde_json::Value::Null),
            position,
        };
        schema.views.push(view.clone());
        write_schema(&dir, &schema)?;
        Ok(View {
            id: view.id,
            database_id: db.id,
            name: view.name,
            kind: view.kind,
            filters: view.filters,
            sorts: view.sorts,
            group_by: view.group_by,
            visible_properties: view.visible_properties,
            config: view.config,
            position: view.position,
        })
    }

    fn find_view(&self, view_id: &str) -> Result<(PathBuf, DatabaseSchema, usize)> {
        for entry in fs::read_dir(self.root.join("databases"))? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() { continue; }
            let n = entry.file_name().to_string_lossy().to_string();
            if n.starts_with('.') || n.starts_with('_') { continue; }
            let dir = entry.path();
            let schema = read_schema(&dir).unwrap_or_default();
            if let Some(idx) = schema.views.iter().position(|v| v.id == view_id) {
                return Ok((dir, schema, idx));
            }
        }
        Err(anyhow!("no view with id {view_id}"))
    }

    pub fn update_view(&self, view_id: &str, patch: serde_json::Value) -> Result<View> {
        let (dir, mut schema, idx) = self.find_view(view_id)?;
        let v = &mut schema.views[idx];
        if let Some(s) = patch.get("name").and_then(|x| x.as_str()) { v.name = s.into(); }
        if let Some(s) = patch.get("type").and_then(|x| x.as_str()) { v.kind = s.into(); }
        if let Some(x) = patch.get("filters") { v.filters = x.clone(); }
        if let Some(x) = patch.get("sorts") { v.sorts = x.clone(); }
        if let Some(s) = patch.get("groupBy").and_then(|x| x.as_str()) { v.group_by = Some(s.into()); }
        if let Some(arr) = patch.get("visibleProperties").and_then(|x| x.as_array()) {
            v.visible_properties = arr.iter().filter_map(|x| x.as_str().map(String::from)).collect();
        }
        if let Some(x) = patch.get("config") { v.config = x.clone(); }
        if let Some(n) = patch.get("position").and_then(|x| x.as_i64()) { v.position = n as i32; }
        let view = v.clone();
        let database_id = schema.id.clone().unwrap_or_default();
        write_schema(&dir, &schema)?;
        Ok(View {
            id: view.id,
            database_id,
            name: view.name,
            kind: view.kind,
            filters: view.filters,
            sorts: view.sorts,
            group_by: view.group_by,
            visible_properties: view.visible_properties,
            config: view.config,
            position: view.position,
        })
    }

    pub fn reorder_views(&self, database_id: &str, view_ids: &[String]) -> Result<()> {
        let db = self.get_database(database_id)?;
        let dir = self.root.join(&db.path);
        let mut schema = read_schema(&dir)?;
        for (i, id) in view_ids.iter().enumerate() {
            if let Some(v) = schema.views.iter_mut().find(|v| v.id == *id) {
                v.position = i as i32;
            }
        }
        write_schema(&dir, &schema)?;
        Ok(())
    }

    pub fn delete_view(&self, view_id: &str) -> Result<()> {
        let (dir, mut schema, idx) = self.find_view(view_id)?;
        schema.views.remove(idx);
        write_schema(&dir, &schema)?;
        Ok(())
    }

    // ── Templates ────────────────────────────────────────────────────────
    //
    // Stored at databases/<name>/_templates/<id>.md with frontmatter holding
    // template metadata. Variables are `{{name}}` placeholders resolved at
    // apply-time.

    pub fn list_templates(&self, database_id: &str) -> Result<Vec<crate::model::TemplateStub>> {
        let db = self.get_database(database_id)?;
        let dir = self.root.join(&db.path).join("_templates");
        if !dir.exists() { return Ok(Vec::new()); }
        let mut out = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let n = entry.file_name().to_string_lossy().to_string();
            if !n.ends_with(".md") { continue; }
            let raw = fs::read_to_string(entry.path())?;
            let (fm_raw, body) = match split_frontmatter(&raw) {
                Ok(x) => x,
                Err(_) => continue,
            };
            let mut fm: TemplateFrontmatter = match serde_yaml::from_str(&fm_raw) {
                Ok(x) => x,
                Err(_) => continue,
            };
            if fm.is_default && fm.id == db.default_template_id.clone().unwrap_or_default() {
                fm.is_default = true;
            } else if let Some(default) = &db.default_template_id {
                fm.is_default = &fm.id == default;
            }
            out.push(crate::model::TemplateStub {
                id: fm.id,
                database_id: db.id.clone(),
                name: fm.name,
                icon: fm.icon,
                title: fm.title,
                content: body,
                config: fm.config,
                styles: fm.styles,
                is_default: fm.is_default,
            });
        }
        Ok(out)
    }

    pub fn get_template(&self, template_id: &str) -> Result<crate::model::TemplateStub> {
        for db in self.list_databases()? {
            for t in self.list_templates(&db.id).unwrap_or_default() {
                if t.id == template_id { return Ok(t); }
            }
        }
        Err(anyhow!("no template with id {template_id}"))
    }

    pub fn create_template(
        &self,
        database_id: &str,
        name: &str,
        icon: Option<String>,
        title: Option<String>,
        content: &str,
        config: serde_json::Value,
        styles: serde_json::Value,
    ) -> Result<crate::model::TemplateStub> {
        let db = self.get_database(database_id)?;
        let dir = self.root.join(&db.path).join("_templates");
        fs::create_dir_all(&dir)?;
        let id = Uuid::new_v4().to_string();
        let fm = TemplateFrontmatter {
            id: id.clone(),
            name: name.to_string(),
            icon: icon.clone(),
            title: title.clone(),
            config: config.clone(),
            styles: styles.clone(),
            is_default: false,
        };
        let yaml = serde_yaml::to_string(&fm)?;
        let body_trim = content.trim_end_matches('\n');
        let out = if body_trim.is_empty() {
            format!("---\n{yaml}---\n")
        } else {
            format!("---\n{yaml}---\n\n{body_trim}\n")
        };
        fs::write(dir.join(format!("{id}.md")), out)?;
        Ok(crate::model::TemplateStub {
            id, database_id: db.id, name: name.into(), icon, title,
            content: content.to_string(), config, styles, is_default: false,
        })
    }

    pub fn update_template(
        &self,
        template_id: &str,
        patch: serde_json::Value,
    ) -> Result<crate::model::TemplateStub> {
        let (db_id, db_path) = self.find_template_file(template_id)?;
        let path = db_path.join("_templates").join(format!("{template_id}.md"));
        let raw = fs::read_to_string(&path)?;
        let (fm_raw, body) = split_frontmatter(&raw)?;
        let mut fm: TemplateFrontmatter = serde_yaml::from_str(&fm_raw)?;
        if let Some(s) = patch.get("name").and_then(|x| x.as_str()) { fm.name = s.into(); }
        if let Some(s) = patch.get("icon").and_then(|x| x.as_str()) { fm.icon = Some(s.into()); }
        if let Some(s) = patch.get("title").and_then(|x| x.as_str()) { fm.title = Some(s.into()); }
        if let Some(x) = patch.get("config") { fm.config = x.clone(); }
        if let Some(x) = patch.get("styles") { fm.styles = x.clone(); }
        let new_body = patch.get("content").and_then(|x| x.as_str()).map(String::from).unwrap_or(body);
        let yaml = serde_yaml::to_string(&fm)?;
        let new_body_trim = new_body.trim_end_matches('\n');
        let out = if new_body_trim.is_empty() {
            format!("---\n{yaml}---\n")
        } else {
            format!("---\n{yaml}---\n\n{new_body_trim}\n")
        };
        fs::write(&path, out)?;
        Ok(crate::model::TemplateStub {
            id: fm.id, database_id: db_id, name: fm.name, icon: fm.icon, title: fm.title,
            content: new_body, config: fm.config, styles: fm.styles, is_default: fm.is_default,
        })
    }

    pub fn delete_template(&self, template_id: &str) -> Result<()> {
        let (_db_id, db_path) = self.find_template_file(template_id)?;
        let path = db_path.join("_templates").join(format!("{template_id}.md"));
        fs::remove_file(&path)?;
        Ok(())
    }

    /// Apply a template: create one new page using template content with
    /// `{{variable}}` placeholders resolved.
    pub fn apply_template(
        &self,
        template_id: &str,
        variables: serde_json::Map<String, serde_json::Value>,
    ) -> Result<Page> {
        let t = self.get_template(template_id)?;
        let content = substitute_vars(&t.content, &variables);
        let title = t.title.clone().map(|s| substitute_vars(&s, &variables));
        let mut props = serde_json::Map::new();
        // If title is set on template, use it; otherwise pick from variables
        // labelled "title".
        let title_arg = title.or_else(|| variables.get("title").and_then(|v| v.as_str()).map(String::from));
        // Properties variables: pass through any non-"title" simple values as cell values.
        for (k, v) in &variables {
            if k == "title" { continue; }
            props.insert(k.clone(), v.clone());
        }
        self.create_page(&t.database_id, title_arg, props, Some(content))
    }

    /// Destructive: overwrite content of every existing page in the database.
    pub fn apply_template_to_all(&self, template_id: &str) -> Result<usize> {
        let t = self.get_template(template_id)?;
        let pages = self.list_pages(&t.database_id, ListPagesOpts::default())?;
        let mut updated = 0;
        for p in pages {
            self.update_page(&p.id, PagePatch {
                properties_by_name: None,
                content_md: Some(t.content.clone()),
            })?;
            updated += 1;
        }
        Ok(updated)
    }

    /// Locate the database folder owning a template by its id.
    fn find_template_file(&self, template_id: &str) -> Result<(String, PathBuf)> {
        for db in self.list_databases()? {
            let dir = self.root.join(&db.path).join("_templates");
            if !dir.exists() { continue; }
            let path = dir.join(format!("{template_id}.md"));
            if path.exists() { return Ok((db.id, self.root.join(&db.path))); }
        }
        Err(anyhow!("no template with id {template_id}"))
    }

    pub fn delete_property_option(&self, property_id: &str, option_name: &str) -> Result<()> {
        let (dir, mut schema, idx) = self.find_property(property_id)?;
        let prop = &mut schema.properties[idx];
        if let Some(options) = prop.config.get_mut("options").and_then(|v| v.as_array_mut()) {
            let before = options.len();
            options.retain(|o| o.get("name").and_then(|v| v.as_str()) != Some(option_name));
            if options.len() == before {
                return Err(anyhow!("no option named \"{option_name}\""));
            }
        } else {
            return Err(anyhow!("property has no options"));
        }
        write_schema(&dir, &schema)?;
        Ok(())
    }
}

#[derive(Debug, Clone, Default)]
pub struct PropertyPatch {
    pub name: Option<String>,
    pub config: Option<serde_json::Value>,
    pub position: Option<i32>,
}

#[derive(Debug, Clone, Default)]
pub struct PagePatch {
    /// Property values keyed by property NAME (case-insensitive).
    pub properties_by_name: Option<serde_json::Map<String, serde_json::Value>>,
    /// Optional new content body (markdown).
    pub content_md: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ListPagesOpts {
    pub limit: Option<usize>,
    pub search: Option<String>,
    pub include_archived: bool,
}

// ── Pages ────────────────────────────────────────────────────────────────
//
// On-disk layout: each row is a markdown file under
//   <vault>/databases/<DatabaseName>/<Title>.md
// with YAML frontmatter holding the property values keyed by NAME.
//
// The on-the-wire shape (`propertiesCache`) is keyed by property ID, so we
// translate at the I/O boundary using the database's `_schema.yml`.

impl Vault {
    pub fn list_pages(&self, database_id: &str, opts: ListPagesOpts) -> Result<Vec<Page>> {
        let db = self.get_database(database_id)?;
        let dir = self.root.join(&db.path);
        let mut pages = Vec::new();
        for entry in fs::read_dir(&dir).with_context(|| format!("read {dir:?}"))? {
            let entry = entry?;
            if !entry.file_type()?.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".md") || name.starts_with('_') || name.starts_with('.') {
                continue;
            }
            let Ok((page, body)) = read_page_file(&entry.path(), &db) else { continue };
            if page.is_archived && !opts.include_archived { continue; }
            if let Some(q) = &opts.search {
                let hay = format!("{} {}", page.primary_title, body).to_lowercase();
                if !hay.contains(&q.to_lowercase()) { continue; }
            }
            pages.push(page);
        }
        pages.sort_by(|a, b| a.primary_title.cmp(&b.primary_title));
        if let Some(limit) = opts.limit { pages.truncate(limit); }
        Ok(pages)
    }

    pub fn count_pages(&self, database_id: &str, search: Option<String>) -> Result<usize> {
        let pages = self.list_pages(database_id, ListPagesOpts {
            search,
            ..Default::default()
        })?;
        Ok(pages.len())
    }

    pub fn get_page(&self, page_id: &str) -> Result<(Page, String)> {
        let (db, path) = self.find_page_file(page_id)?;
        read_page_file(&path, &db)
    }

    /// Find the file holding a given page id by scanning the vault.
    /// O(n) over all rows. Acceptable for v0.2; cache lands in v0.3.
    fn find_page_file(&self, page_id: &str) -> Result<(Database, PathBuf)> {
        for entry in fs::read_dir(self.root.join("databases"))? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() { continue; }
            let dir_name = entry.file_name().to_string_lossy().to_string();
            if dir_name.starts_with('.') || dir_name.starts_with('_') { continue; }
            let dir = entry.path();
            let schema = match read_schema(&dir) { Ok(s) => s, Err(_) => continue };
            let Some(database_id) = schema.id.clone() else { continue };
            let db = schema_to_database(dir_name.clone(), &dir, schema);
            for f in fs::read_dir(&dir)? {
                let f = f?;
                let fname = f.file_name().to_string_lossy().to_string();
                if !f.file_type()?.is_file() || !fname.ends_with(".md") || fname.starts_with('_') {
                    continue;
                }
                let path = f.path();
                if let Ok((p, _)) = read_page_file(&path, &db) {
                    if p.id == page_id {
                        return Ok((Database { id: database_id, ..db }, path));
                    }
                }
            }
        }
        Err(anyhow!("no page with id {page_id}"))
    }

    pub fn create_page(
        &self,
        database_id: &str,
        title: Option<String>,
        properties_by_name: serde_json::Map<String, serde_json::Value>,
        content_md: Option<String>,
    ) -> Result<Page> {
        let db = self.get_database(database_id)?;
        let dir = self.root.join(&db.path);
        let title_prop = db.properties.iter().find(|p| p.is_primary)
            .ok_or_else(|| anyhow!("database has no primary title property"))?;

        // Merge title from `title` arg or `properties[Name]`.
        let mut props = properties_by_name.clone();
        if let Some(t) = title.clone() {
            props.insert(title_prop.name.clone(), serde_json::Value::String(t));
        }
        let primary_title = props
            .get(&title_prop.name)
            .or_else(|| props.iter().find(|(k, _)| k.eq_ignore_ascii_case(&title_prop.name)).map(|(_, v)| v))
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_else(|| "Untitled".to_string());

        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let filename = unique_filename(&dir, &primary_title);
        let path = dir.join(&filename);

        let frontmatter = PageFrontmatter {
            id: id.clone(),
            created: now.clone(),
            updated: now.clone(),
            is_archived: false,
            is_public: false,
            share_id: None,
            properties: props,
        };
        let body = content_md.unwrap_or_default();
        write_page_file(&path, &frontmatter, &body)?;

        let (page, _) = read_page_file(&path, &db)?;
        Ok(page)
    }

    pub fn update_page(&self, page_id: &str, patch: PagePatch) -> Result<Page> {
        let (db, path) = self.find_page_file(page_id)?;
        let (raw, _body) = split_frontmatter(&fs::read_to_string(&path)?)?;
        let mut fm: PageFrontmatter = serde_yaml::from_str(&raw)?;
        if let Some(props) = patch.properties_by_name {
            for (k, v) in props {
                fm.properties.insert(k, v);
            }
        }
        fm.updated = chrono::Utc::now().to_rfc3339();
        let body_md = patch.content_md.unwrap_or_else(|| {
            split_frontmatter(&fs::read_to_string(&path).unwrap_or_default())
                .map(|(_, b)| b)
                .unwrap_or_default()
        });
        // Renaming the title may require renaming the file.
        let title_prop = db.properties.iter().find(|p| p.is_primary);
        let new_title = title_prop
            .and_then(|p| fm.properties.get(&p.name))
            .and_then(|v| v.as_str())
            .map(String::from);
        let final_path = if let Some(t) = new_title {
            let target = path.parent().unwrap().join(unique_filename_skip(
                path.parent().unwrap(),
                &t,
                &path,
            ));
            if target != path {
                fs::rename(&path, &target)?;
                write_page_file(&target, &fm, &body_md)?;
                target
            } else {
                write_page_file(&path, &fm, &body_md)?;
                path
            }
        } else {
            write_page_file(&path, &fm, &body_md)?;
            path
        };
        let (p, _) = read_page_file(&final_path, &db)?;
        Ok(p)
    }

    pub fn update_cell(&self, page_id: &str, property_id: &str, value: serde_json::Value) -> Result<()> {
        let (db, _) = self.find_page_file(page_id)?;
        let prop = db.properties.iter().find(|p| p.id == property_id)
            .ok_or_else(|| anyhow!("no property {property_id} in this page's database"))?;
        let mut props = serde_json::Map::new();
        props.insert(prop.name.clone(), value);
        self.update_page(page_id, PagePatch { properties_by_name: Some(props), content_md: None })?;
        Ok(())
    }

    pub fn bulk_update_cells(
        &self,
        page_id: &str,
        _database_id: &str,
        cells_by_name: serde_json::Map<String, serde_json::Value>,
    ) -> Result<()> {
        self.update_page(page_id, PagePatch { properties_by_name: Some(cells_by_name), content_md: None })?;
        Ok(())
    }

    pub fn get_page_content(&self, page_id: &str) -> Result<String> {
        let (_, path) = self.find_page_file(page_id)?;
        let raw = fs::read_to_string(&path)?;
        let (_, body) = split_frontmatter(&raw)?;
        // Convert markdown body to HTML to match S16 wire shape.
        Ok(md_to_html(&body))
    }

    pub fn update_page_content(&self, page_id: &str, content: &str, format: &str) -> Result<()> {
        let body = if format == "html" {
            // For v0.2 we store raw HTML as-is. Markdown rendering preserves
            // raw HTML inline, so it round-trips through pulldown-cmark cleanly.
            content.to_string()
        } else {
            content.to_string()
        };
        self.update_page(page_id, PagePatch { properties_by_name: None, content_md: Some(body) })?;
        Ok(())
    }

    pub fn archive_page(&self, page_id: &str) -> Result<()> {
        let (_, path) = self.find_page_file(page_id)?;
        let (raw, body) = split_frontmatter(&fs::read_to_string(&path)?)?;
        let mut fm: PageFrontmatter = serde_yaml::from_str(&raw)?;
        fm.is_archived = true;
        fm.updated = chrono::Utc::now().to_rfc3339();
        write_page_file(&path, &fm, &body)?;
        Ok(())
    }

    pub fn delete_page(&self, page_id: &str) -> Result<()> {
        let (_, path) = self.find_page_file(page_id)?;
        fs::remove_file(&path).with_context(|| format!("delete {path:?}"))?;
        Ok(())
    }

    pub fn duplicate_page(&self, page_id: &str) -> Result<Page> {
        let (db, path) = self.find_page_file(page_id)?;
        let raw = fs::read_to_string(&path)?;
        let (fm_raw, body) = split_frontmatter(&raw)?;
        let mut fm: PageFrontmatter = serde_yaml::from_str(&fm_raw)?;
        fm.id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        fm.created = now.clone();
        fm.updated = now;

        let title_prop = db.properties.iter().find(|p| p.is_primary);
        if let Some(p) = title_prop {
            if let Some(t) = fm.properties.get(&p.name).and_then(|v| v.as_str()).map(String::from) {
                let new_title = format!("{t} (copy)");
                fm.properties.insert(p.name.clone(), serde_json::Value::String(new_title));
            }
        }
        let new_title = title_prop
            .and_then(|p| fm.properties.get(&p.name))
            .and_then(|v| v.as_str())
            .map(String::from)
            .unwrap_or_else(|| fm.id.clone());
        let dir = path.parent().unwrap();
        let new_path = dir.join(unique_filename(dir, &new_title));
        write_page_file(&new_path, &fm, &body)?;
        let (page, _) = read_page_file(&new_path, &db)?;
        Ok(page)
    }

    pub fn set_page_sharing(&self, page_id: &str, is_public: bool) -> Result<Page> {
        let (db, path) = self.find_page_file(page_id)?;
        let (raw, body) = split_frontmatter(&fs::read_to_string(&path)?)?;
        let mut fm: PageFrontmatter = serde_yaml::from_str(&raw)?;
        fm.is_public = is_public;
        if is_public && fm.share_id.is_none() {
            fm.share_id = Some(Uuid::new_v4().to_string());
        }
        fm.updated = chrono::Utc::now().to_rfc3339();
        write_page_file(&path, &fm, &body)?;
        let (page, _) = read_page_file(&path, &db)?;
        Ok(page)
    }
}

// ── Relations ────────────────────────────────────────────────────────────
//
// Stored in the source page's frontmatter as a wiki-link array under the
// property name:
//
//   Company: ["[[Acme Corp|<uuid>]]", "[[Beta Inc|<uuid>]]"]
//
// The `<uuid>` after `|` is the canonical reference (stable across renames)
// while the leading title makes the link readable to Obsidian and humans.

impl Vault {
    /// List target pages linked from `page_id` via `property_id`.
    pub fn list_relations(&self, page_id: &str, property_id: &str) -> Result<Vec<Page>> {
        let (db, path) = self.find_page_file(page_id)?;
        let prop = db.properties.iter().find(|p| p.id == property_id)
            .ok_or_else(|| anyhow!("no property {property_id} in this page's database"))?;
        let related_db_id = prop.config.get("relatedDatabaseId").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("property {property_id} has no relatedDatabaseId in config"))?;
        let related_db = self.get_database(related_db_id)?;
        let raw = fs::read_to_string(&path)?;
        let (fm_raw, _) = split_frontmatter(&raw)?;
        let fm: PageFrontmatter = serde_yaml::from_str(&fm_raw)?;
        let links = fm.properties.get(&prop.name)
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        let mut pages = Vec::new();
        for link in links {
            let Some(s) = link.as_str() else { continue };
            let Some((_, uuid)) = parse_wiki_link(s) else { continue };
            if let Ok((p, _)) = self.find_page_in(&related_db, &uuid) {
                pages.push(p);
            }
        }
        Ok(pages)
    }

    pub fn add_relation(
        &self,
        source_page_id: &str,
        target_page_id: &str,
        property_id: &str,
    ) -> Result<()> {
        let (src_db, src_path) = self.find_page_file(source_page_id)?;
        let prop = src_db.properties.iter().find(|p| p.id == property_id)
            .ok_or_else(|| anyhow!("no property {property_id} in source database"))?
            .clone();
        let related_db_id = prop.config.get("relatedDatabaseId").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("property has no relatedDatabaseId"))?;
        let related_db = self.get_database(related_db_id)?;
        let (target_page, target_path) = self.find_page_in(&related_db, target_page_id)?;

        // Mutate source frontmatter.
        push_relation(&src_path, &prop.name, &target_page.primary_title, &target_page.id)?;

        // If two-way, mutate target too.
        let two_way = prop.config.get("twoWay").and_then(|v| v.as_bool()).unwrap_or(true);
        if two_way {
            if let Some(inverse_id) = &prop.inverse_property_id {
                let inverse = related_db.properties.iter().find(|p| &p.id == inverse_id)
                    .ok_or_else(|| anyhow!("inverse property {inverse_id} not found"))?;
                let (src_page, _) = read_page_file(&src_path, &src_db)?;
                push_relation(&target_path, &inverse.name, &src_page.primary_title, &src_page.id)?;
            }
        }
        Ok(())
    }

    pub fn remove_relation(
        &self,
        source_page_id: &str,
        target_page_id: &str,
        property_id: &str,
    ) -> Result<()> {
        let (src_db, src_path) = self.find_page_file(source_page_id)?;
        let prop = src_db.properties.iter().find(|p| p.id == property_id)
            .ok_or_else(|| anyhow!("no property {property_id} in source database"))?
            .clone();
        let related_db_id = prop.config.get("relatedDatabaseId").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("property has no relatedDatabaseId"))?;
        let related_db = self.get_database(related_db_id)?;
        let (_, target_path) = self.find_page_in(&related_db, target_page_id)?;

        remove_relation_link(&src_path, &prop.name, target_page_id)?;
        let two_way = prop.config.get("twoWay").and_then(|v| v.as_bool()).unwrap_or(true);
        if two_way {
            if let Some(inverse_id) = &prop.inverse_property_id {
                let inverse = related_db.properties.iter().find(|p| &p.id == inverse_id)
                    .ok_or_else(|| anyhow!("inverse property {inverse_id} not found"))?;
                remove_relation_link(&target_path, &inverse.name, source_page_id)?;
            }
        }
        Ok(())
    }

    /// Convert a one-way relation property to two-way: create the inverse
    /// column on the target db and backfill all existing relations.
    /// Best-effort backfill — errors per-row are surfaced in the result.
    pub fn convert_relation_to_two_way(&self, property_id: &str) -> Result<serde_json::Value> {
        let (src_dir, mut src_schema, src_idx) = self.find_property(property_id)?;
        if src_schema.properties[src_idx].kind != "relation" {
            return Err(anyhow!("property is not a relation"));
        }
        if src_schema.properties[src_idx].inverse_property_id.is_some() {
            return Err(anyhow!("relation is already two-way"));
        }
        let related_db_id = src_schema.properties[src_idx].config
            .get("relatedDatabaseId").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("relation has no relatedDatabaseId"))?
            .to_string();
        let src_db_id = src_schema.id.clone().unwrap_or_default();
        let src_db_name = src_dir.file_name().unwrap_or_default().to_string_lossy().to_string();

        // Create inverse property on target db.
        let related_db = self.get_database(&related_db_id)?;
        let target_dir = self.root.join(&related_db.path);
        let mut target_schema = read_schema(&target_dir)?;
        let inverse_name = pluralize_or_self(&src_db_name);
        let inverse_id = Uuid::new_v4().to_string();
        target_schema.properties.push(PropertySchema {
            id: inverse_id.clone(),
            name: inverse_name.clone(),
            kind: "relation".into(),
            config: serde_json::json!({ "relatedDatabaseId": src_db_id, "twoWay": true }),
            position: target_schema.properties.iter().map(|p| p.position).max().unwrap_or(-1) + 1,
            is_primary: false,
            inverse_property_id: Some(property_id.to_string()),
        });
        write_schema(&target_dir, &target_schema)?;

        // Mark source side two-way.
        src_schema.properties[src_idx].inverse_property_id = Some(inverse_id.clone());
        src_schema.properties[src_idx].config["twoWay"] = serde_json::Value::Bool(true);
        let prop_name = src_schema.properties[src_idx].name.clone();
        write_schema(&src_dir, &src_schema)?;

        // Backfill: walk every source page, for each relation value mirror it to target.
        let src_db = self.get_database(&src_db_id)?;
        let mut backfilled = 0usize;
        let mut errors = Vec::new();
        for entry in fs::read_dir(&src_dir)? {
            let entry = entry?;
            let fname = entry.file_name().to_string_lossy().to_string();
            if !entry.file_type()?.is_file() || !fname.ends_with(".md") || fname.starts_with('_') {
                continue;
            }
            let src_path = entry.path();
            let raw = fs::read_to_string(&src_path)?;
            let (fm_raw, _) = split_frontmatter(&raw)?;
            let fm: PageFrontmatter = serde_yaml::from_str(&fm_raw)?;
            let Some(links) = fm.properties.get(&prop_name).and_then(|v| v.as_array()) else { continue };
            let (src_page, _) = read_page_file(&src_path, &src_db)?;
            for link in links {
                let Some(s) = link.as_str() else { continue };
                let Some((_, uuid)) = parse_wiki_link(s) else { continue };
                let Ok((_, target_path)) = self.find_page_in(&related_db, &uuid) else {
                    errors.push(format!("target {uuid} not found"));
                    continue;
                };
                if let Err(e) = push_relation(&target_path, &inverse_name, &src_page.primary_title, &src_page.id) {
                    errors.push(format!("backfill {uuid}: {e}"));
                } else {
                    backfilled += 1;
                }
            }
        }
        Ok(serde_json::json!({
            "ok": errors.is_empty(),
            "inversePropertyId": inverse_id,
            "inverseName": inverse_name,
            "backfilled": backfilled,
            "errors": errors,
        }))
    }

    /// Find a page in a specific database (faster than scanning every db).
    fn find_page_in(&self, db: &Database, page_id: &str) -> Result<(Page, PathBuf)> {
        let dir = self.root.join(&db.path);
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let fname = entry.file_name().to_string_lossy().to_string();
            if !entry.file_type()?.is_file() || !fname.ends_with(".md") || fname.starts_with('_') {
                continue;
            }
            let path = entry.path();
            if let Ok((p, _)) = read_page_file(&path, db) {
                if p.id == page_id {
                    return Ok((p, path));
                }
            }
        }
        Err(anyhow!("page {page_id} not in database {}", db.name))
    }
}

fn push_relation(path: &Path, prop_name: &str, target_title: &str, target_uuid: &str) -> Result<()> {
    let raw = fs::read_to_string(path)?;
    let (fm_raw, body) = split_frontmatter(&raw)?;
    let mut fm: PageFrontmatter = serde_yaml::from_str(&fm_raw)?;
    let link = format!("[[{target_title}|{target_uuid}]]");
    let arr = fm.properties.entry(prop_name.to_string())
        .or_insert_with(|| serde_json::Value::Array(Vec::new()));
    if let Some(arr) = arr.as_array_mut() {
        let already = arr.iter().any(|v| v.as_str() == Some(&link)
            || v.as_str().and_then(|s| parse_wiki_link(s)).map(|(_, u)| u) == Some(target_uuid.to_string()));
        if !already {
            arr.push(serde_json::Value::String(link));
        }
    }
    fm.updated = chrono::Utc::now().to_rfc3339();
    write_page_file(path, &fm, &body)?;
    Ok(())
}

fn remove_relation_link(path: &Path, prop_name: &str, target_uuid: &str) -> Result<()> {
    let raw = fs::read_to_string(path)?;
    let (fm_raw, body) = split_frontmatter(&raw)?;
    let mut fm: PageFrontmatter = serde_yaml::from_str(&fm_raw)?;
    if let Some(arr) = fm.properties.get_mut(prop_name).and_then(|v| v.as_array_mut()) {
        arr.retain(|v| {
            v.as_str()
                .and_then(parse_wiki_link)
                .map(|(_, u)| u != target_uuid)
                .unwrap_or(true)
        });
    }
    fm.updated = chrono::Utc::now().to_rfc3339();
    write_page_file(path, &fm, &body)?;
    Ok(())
}

// ── Sites ────────────────────────────────────────────────────────────────
//
// Layout:
//   <vault>/sites/<slug>/site.yml
//   <vault>/sites/<slug>/pages/<page-slug>/page.yml
//   <vault>/sites/<slug>/pages/<page-slug>/<files...>     ← virtual fs
//   <vault>/sites/<slug>/assets/<filename>                ← raw bytes
//   <vault>/sites/_components/<id>.json                   ← workspace components

const SITES_DIR: &str = "sites";
const COMPONENTS_DIR: &str = "sites/_components";

impl Vault {
    pub fn list_sites(&self, include_archived: bool) -> Result<Vec<Site>> {
        let dir = self.root.join(SITES_DIR);
        let mut out = Vec::new();
        if !dir.exists() { return Ok(out); }
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() { continue; }
            let n = entry.file_name().to_string_lossy().to_string();
            if n.starts_with('.') || n.starts_with('_') { continue; }
            let yml = entry.path().join("site.yml");
            if !yml.exists() { continue; }
            let raw = fs::read_to_string(&yml)?;
            if let Ok(mut s) = serde_yaml::from_str::<Site>(&raw) {
                if !include_archived && s.is_archived { continue; }
                s.pages = self.list_site_pages(&s.id).unwrap_or_default()
                    .into_iter().map(|p| SitePageMeta {
                        id: p.id, slug: p.slug, title: p.title,
                        is_home: p.is_home, is_published: p.is_published,
                        entry_path: p.entry_path,
                    }).collect();
                out.push(s);
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    pub fn create_site(&self, name: &str, slug: Option<String>, icon: Option<String>) -> Result<Site> {
        let dir = self.root.join(SITES_DIR);
        fs::create_dir_all(&dir)?;
        let slug_final = slug.unwrap_or_else(|| sanitize_dirname(name).to_lowercase().replace(' ', "-"));
        let folder = dir.join(&slug_final);
        if folder.exists() { return Err(anyhow!("site \"{slug_final}\" already exists")); }
        fs::create_dir_all(folder.join("pages"))?;
        fs::create_dir_all(folder.join("assets"))?;
        let now = chrono::Utc::now().to_rfc3339();
        let site = Site {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            slug: slug_final.clone(),
            icon,
            description: None,
            is_published: false,
            is_archived: false,
            created_at: Some(now.clone()),
            updated_at: Some(now),
            pages: Vec::new(),
        };
        let mut for_yaml = site.clone();
        for_yaml.pages = Vec::new();
        fs::write(folder.join("site.yml"), serde_yaml::to_string(&for_yaml)?)?;
        // Auto-create a starter "home" page with index.html.
        let home = self.create_site_page(
            &site.id,
            "home",
            "Home",
            true,
            std::collections::BTreeMap::from([
                ("/index.html".to_string(),
                 format!("<!DOCTYPE html>\n<html><head><title>{}</title></head>\n<body><h1>{}</h1><p>Edit this page in {}/pages/home/.</p></body></html>\n", name, name, slug_final)),
            ]),
        )?;
        let _ = home;
        let mut s = self.get_site(&site.id)?;
        s.pages = self.list_site_pages(&s.id).unwrap_or_default()
            .into_iter().map(|p| SitePageMeta {
                id: p.id, slug: p.slug, title: p.title,
                is_home: p.is_home, is_published: p.is_published, entry_path: p.entry_path,
            }).collect();
        Ok(s)
    }

    pub fn get_site(&self, site_id: &str) -> Result<Site> {
        for s in self.list_sites(true)? {
            if s.id == site_id { return Ok(s); }
        }
        Err(anyhow!("no site with id {site_id}"))
    }

    pub fn update_site(&self, site_id: &str, patch: serde_json::Value) -> Result<Site> {
        let mut s = self.get_site(site_id)?;
        let folder = self.root.join(SITES_DIR).join(&s.slug);
        if let Some(n) = patch.get("name").and_then(|v| v.as_str()) { s.name = n.into(); }
        if let Some(i) = patch.get("icon").and_then(|v| v.as_str()) { s.icon = Some(i.into()); }
        if let Some(d) = patch.get("description").and_then(|v| v.as_str()) { s.description = Some(d.into()); }
        if let Some(b) = patch.get("isPublished").and_then(|v| v.as_bool()) { s.is_published = b; }
        if let Some(b) = patch.get("isArchived").and_then(|v| v.as_bool()) { s.is_archived = b; }
        s.updated_at = Some(chrono::Utc::now().to_rfc3339());
        let mut for_yaml = s.clone();
        for_yaml.pages = Vec::new();
        fs::write(folder.join("site.yml"), serde_yaml::to_string(&for_yaml)?)?;
        Ok(s)
    }

    pub fn delete_site(&self, site_id: &str) -> Result<()> {
        let s = self.get_site(site_id)?;
        let folder = self.root.join(SITES_DIR).join(&s.slug);
        fs::remove_dir_all(&folder)?;
        Ok(())
    }

    // ── Site pages ─────────────────────────────────────────────────────

    pub fn list_site_pages(&self, site_id: &str) -> Result<Vec<SitePage>> {
        let s = self.find_site_internal(site_id)?;
        let dir = self.root.join(SITES_DIR).join(&s.slug).join("pages");
        let mut out = Vec::new();
        if !dir.exists() { return Ok(out); }
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() { continue; }
            let yml = entry.path().join("page.yml");
            if !yml.exists() { continue; }
            let raw = fs::read_to_string(&yml)?;
            if let Ok(p) = serde_yaml::from_str::<SitePage>(&raw) {
                out.push(p);
            }
        }
        out.sort_by(|a, b| a.slug.cmp(&b.slug));
        Ok(out)
    }

    pub fn get_site_page(&self, page_id: &str) -> Result<SitePage> {
        let (_, mut page) = self.find_site_page(page_id)?;
        page.files = self.read_page_files(&page)?;
        Ok(page)
    }

    pub fn create_site_page(
        &self,
        site_id: &str,
        slug: &str,
        title: &str,
        is_home: bool,
        files: std::collections::BTreeMap<String, String>,
    ) -> Result<SitePage> {
        let s = self.find_site_internal(site_id)?;
        let pages_dir = self.root.join(SITES_DIR).join(&s.slug).join("pages");
        fs::create_dir_all(&pages_dir)?;
        let folder = pages_dir.join(slug);
        if folder.exists() { return Err(anyhow!("page \"{slug}\" already exists in site \"{}\"", s.slug)); }
        fs::create_dir_all(&folder)?;
        let now = chrono::Utc::now().to_rfc3339();
        let entry = files.keys().find(|k| k.ends_with("/index.html"))
            .cloned()
            .unwrap_or_else(|| "/index.html".to_string());
        let page = SitePage {
            id: Uuid::new_v4().to_string(),
            site_id: s.id.clone(),
            slug: slug.to_string(),
            title: title.to_string(),
            is_home,
            is_published: false,
            share_id: None,
            public_url: None,
            entry_path: entry.clone(),
            custom_css: None,
            custom_js: None,
            seo: serde_json::Value::Null,
            allowed_databases: Vec::new(),
            files: std::collections::BTreeMap::new(),
            created_at: Some(now.clone()),
            updated_at: Some(now),
        };
        let mut for_yaml = page.clone();
        for_yaml.files = std::collections::BTreeMap::new();
        fs::write(folder.join("page.yml"), serde_yaml::to_string(&for_yaml)?)?;
        // If files dictionary provided, write each file. Otherwise write a starter index.
        let to_write = if files.is_empty() {
            std::collections::BTreeMap::from([(
                "/index.html".to_string(),
                format!("<!DOCTYPE html>\n<html><body><h1>{title}</h1></body></html>\n"),
            )])
        } else { files };
        for (path, content) in to_write {
            self.write_page_file_internal(&folder, &path, &content)?;
        }
        Ok(page)
    }

    pub fn update_site_page(&self, page_id: &str, patch: serde_json::Value) -> Result<SitePage> {
        let (s, mut page) = self.find_site_page(page_id)?;
        let folder = self.root.join(SITES_DIR).join(&s.slug).join("pages").join(&page.slug);
        // Slug change = rename folder.
        if let Some(new_slug) = patch.get("slug").and_then(|v| v.as_str()) {
            if new_slug != page.slug {
                let new_folder = folder.parent().unwrap().join(new_slug);
                if new_folder.exists() { return Err(anyhow!("slug \"{new_slug}\" already exists")); }
                fs::rename(&folder, &new_folder)?;
                page.slug = new_slug.into();
            }
        }
        let folder = self.root.join(SITES_DIR).join(&s.slug).join("pages").join(&page.slug);
        if let Some(t) = patch.get("title").and_then(|v| v.as_str()) { page.title = t.into(); }
        if let Some(b) = patch.get("isHome").and_then(|v| v.as_bool()) { page.is_home = b; }
        if let Some(b) = patch.get("isPublished").and_then(|v| v.as_bool()) { page.is_published = b; }
        if let Some(c) = patch.get("css").and_then(|v| v.as_str()) { page.custom_css = Some(c.into()); }
        if let Some(j) = patch.get("js").and_then(|v| v.as_str()) { page.custom_js = Some(j.into()); }
        if let Some(seo) = patch.get("seo") { page.seo = seo.clone(); }
        page.updated_at = Some(chrono::Utc::now().to_rfc3339());
        let mut for_yaml = page.clone();
        for_yaml.files = std::collections::BTreeMap::new();
        fs::write(folder.join("page.yml"), serde_yaml::to_string(&for_yaml)?)?;
        Ok(page)
    }

    pub fn delete_site_page(&self, page_id: &str) -> Result<()> {
        let (s, page) = self.find_site_page(page_id)?;
        let folder = self.root.join(SITES_DIR).join(&s.slug).join("pages").join(&page.slug);
        fs::remove_dir_all(&folder)?;
        // If we just deleted the home page, promote the first remaining one.
        if page.is_home {
            if let Some(mut next) = self.list_site_pages(&s.id)?.into_iter().next() {
                next.is_home = true;
                let next_folder = self.root.join(SITES_DIR).join(&s.slug).join("pages").join(&next.slug);
                let mut for_yaml = next.clone();
                for_yaml.files = std::collections::BTreeMap::new();
                fs::write(next_folder.join("page.yml"), serde_yaml::to_string(&for_yaml)?)?;
            }
        }
        Ok(())
    }

    pub fn publish_site_page(&self, page_id: &str, is_published: bool) -> Result<SitePage> {
        let (s, mut page) = self.find_site_page(page_id)?;
        let folder = self.root.join(SITES_DIR).join(&s.slug).join("pages").join(&page.slug);
        page.is_published = is_published;
        if is_published {
            if page.share_id.is_none() {
                page.share_id = Some(Uuid::new_v4().to_string());
            }
            page.public_url = Some(format!("https://openspider.local/published/{}/{}", s.slug, page.slug));
        }
        page.updated_at = Some(chrono::Utc::now().to_rfc3339());
        let mut for_yaml = page.clone();
        for_yaml.files = std::collections::BTreeMap::new();
        fs::write(folder.join("page.yml"), serde_yaml::to_string(&for_yaml)?)?;
        Ok(page)
    }

    // ── Site page virtual file system ──────────────────────────────────

    pub fn list_site_page_files(&self, page_id: &str) -> Result<serde_json::Value> {
        let (s, page) = self.find_site_page(page_id)?;
        let folder = self.root.join(SITES_DIR).join(&s.slug).join("pages").join(&page.slug);
        let files = self.read_page_files(&page)?;
        Ok(serde_json::json!({
            "paths": files.keys().collect::<Vec<_>>(),
            "entryPath": page.entry_path,
            "filesVersion": page.updated_at.unwrap_or_default(),
            "_root": folder.display().to_string(),
        }))
    }

    pub fn read_site_page_file(&self, page_id: &str, path: &str) -> Result<String> {
        let (s, page) = self.find_site_page(page_id)?;
        let folder = self.root.join(SITES_DIR).join(&s.slug).join("pages").join(&page.slug);
        let local = self.vfs_path(&folder, path)?;
        Ok(fs::read_to_string(&local)?)
    }

    pub fn write_site_page_file(&self, page_id: &str, path: &str, content: &str) -> Result<()> {
        let (s, page) = self.find_site_page(page_id)?;
        let folder = self.root.join(SITES_DIR).join(&s.slug).join("pages").join(&page.slug);
        self.write_page_file_internal(&folder, path, content)?;
        // Bump page.yml updatedAt so listings refresh.
        let mut p = page.clone();
        p.updated_at = Some(chrono::Utc::now().to_rfc3339());
        let mut for_yaml = p; for_yaml.files = std::collections::BTreeMap::new();
        fs::write(folder.join("page.yml"), serde_yaml::to_string(&for_yaml)?)?;
        Ok(())
    }

    pub fn edit_site_page_file(&self, page_id: &str, path: &str, old_str: &str, new_str: &str) -> Result<()> {
        let original = self.read_site_page_file(page_id, path)?;
        let count = original.matches(old_str).count();
        if count == 0 { return Err(anyhow!("oldString not found in {path}")); }
        if count > 1 { return Err(anyhow!("oldString appears {count} times in {path}; provide more context to make it unique")); }
        let updated = original.replacen(old_str, new_str, 1);
        self.write_site_page_file(page_id, path, &updated)
    }

    pub fn delete_site_page_file(&self, page_id: &str, path: &str) -> Result<()> {
        let (s, page) = self.find_site_page(page_id)?;
        if page.entry_path == path {
            return Err(anyhow!("can't delete the entry file ({path})"));
        }
        let folder = self.root.join(SITES_DIR).join(&s.slug).join("pages").join(&page.slug);
        let local = self.vfs_path(&folder, path)?;
        fs::remove_file(&local)?;
        Ok(())
    }

    pub fn set_site_page_files(
        &self,
        page_id: &str,
        files: std::collections::BTreeMap<String, String>,
        entry_path: Option<String>,
        allowed_databases: Option<Vec<String>>,
    ) -> Result<()> {
        let (s, mut page) = self.find_site_page(page_id)?;
        let folder = self.root.join(SITES_DIR).join(&s.slug).join("pages").join(&page.slug);
        // Wipe all existing non-yml files, then write the new set.
        for entry in fs::read_dir(&folder)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if name == "page.yml" { continue; }
            let p = entry.path();
            if entry.file_type()?.is_file() {
                fs::remove_file(&p)?;
            } else if entry.file_type()?.is_dir() {
                fs::remove_dir_all(&p)?;
            }
        }
        for (path, content) in files {
            self.write_page_file_internal(&folder, &path, &content)?;
        }
        if let Some(e) = entry_path { page.entry_path = e; }
        if let Some(dbs) = allowed_databases { page.allowed_databases = dbs; }
        page.updated_at = Some(chrono::Utc::now().to_rfc3339());
        let mut for_yaml = page; for_yaml.files = std::collections::BTreeMap::new();
        fs::write(folder.join("page.yml"), serde_yaml::to_string(&for_yaml)?)?;
        Ok(())
    }

    fn write_page_file_internal(&self, page_folder: &Path, vfs_path: &str, content: &str) -> Result<()> {
        let local = self.vfs_path(page_folder, vfs_path)?;
        if let Some(parent) = local.parent() { fs::create_dir_all(parent)?; }
        fs::write(&local, content)?;
        Ok(())
    }

    /// Translate a virtual-fs path ("/index.html") to a real disk path,
    /// rejecting `..` traversal.
    fn vfs_path(&self, page_folder: &Path, vfs_path: &str) -> Result<PathBuf> {
        let trimmed = vfs_path.trim_start_matches('/');
        if trimmed.split('/').any(|seg| seg == ".." || seg.is_empty()) {
            return Err(anyhow!("invalid virtual-fs path: {vfs_path}"));
        }
        Ok(page_folder.join(trimmed))
    }

    fn read_page_files(&self, page: &SitePage) -> Result<std::collections::BTreeMap<String, String>> {
        let s = self.find_site_internal(&page.site_id)?;
        let folder = self.root.join(SITES_DIR).join(&s.slug).join("pages").join(&page.slug);
        let mut out = std::collections::BTreeMap::new();
        let mut stack = vec![folder.clone()];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(&dir)? {
                let entry = entry?;
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                if entry.file_type()?.is_dir() { stack.push(path); continue; }
                if name == "page.yml" { continue; }
                let rel = path.strip_prefix(&folder).unwrap();
                let key = format!("/{}", rel.to_string_lossy());
                out.insert(key, fs::read_to_string(&path).unwrap_or_default());
            }
        }
        Ok(out)
    }

    fn find_site_internal(&self, site_id: &str) -> Result<Site> {
        let dir = self.root.join(SITES_DIR);
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() { continue; }
            let n = entry.file_name().to_string_lossy().to_string();
            if n.starts_with('.') || n.starts_with('_') { continue; }
            let yml = entry.path().join("site.yml");
            if !yml.exists() { continue; }
            if let Ok(s) = serde_yaml::from_str::<Site>(&fs::read_to_string(&yml)?) {
                if s.id == site_id { return Ok(s); }
            }
        }
        Err(anyhow!("no site with id {site_id}"))
    }

    fn find_site_page(&self, page_id: &str) -> Result<(Site, SitePage)> {
        for s in self.list_sites(true)? {
            for p in self.list_site_pages(&s.id)? {
                if p.id == page_id { return Ok((s, p)); }
            }
        }
        Err(anyhow!("no site page with id {page_id}"))
    }

    // ── Site components (workspace-scoped) ─────────────────────────────

    pub fn list_site_components(&self, search: Option<&str>) -> Result<Vec<SiteComponent>> {
        let dir = self.root.join(COMPONENTS_DIR);
        let mut out = Vec::new();
        if !dir.exists() { return Ok(out); }
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".json") { continue; }
            let raw = fs::read_to_string(entry.path())?;
            if let Ok(c) = serde_json::from_str::<SiteComponent>(&raw) {
                if let Some(q) = search {
                    let hay = format!("{} {} {}", c.name, c.category, c.description.clone().unwrap_or_default()).to_lowercase();
                    if !hay.contains(&q.to_lowercase()) { continue; }
                }
                out.push(c);
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    pub fn get_site_component(&self, component_id: &str) -> Result<SiteComponent> {
        let path = self.root.join(COMPONENTS_DIR).join(format!("{component_id}.json"));
        let raw = fs::read_to_string(&path).with_context(|| format!("no component with id {component_id}"))?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn create_site_component(&self, mut spec: SiteComponent) -> Result<SiteComponent> {
        let dir = self.root.join(COMPONENTS_DIR);
        fs::create_dir_all(&dir)?;
        if spec.id.is_empty() { spec.id = Uuid::new_v4().to_string(); }
        if spec.scope.is_empty() { spec.scope = "workspace".into(); }
        spec.created_at.get_or_insert_with(|| chrono::Utc::now().to_rfc3339());
        let path = dir.join(format!("{}.json", spec.id));
        fs::write(&path, serde_json::to_string_pretty(&spec)?)?;
        Ok(spec)
    }

    pub fn update_site_component(&self, component_id: &str, patch: serde_json::Value) -> Result<SiteComponent> {
        let mut c = self.get_site_component(component_id)?;
        if let Some(n) = patch.get("name").and_then(|v| v.as_str()) { c.name = n.into(); }
        if let Some(cat) = patch.get("category").and_then(|v| v.as_str()) { c.category = cat.into(); }
        if let Some(d) = patch.get("description").and_then(|v| v.as_str()) { c.description = Some(d.into()); }
        if let Some(p) = patch.get("propsSchema") { c.props_schema = p.clone(); }
        if let Some(p) = patch.get("defaultProps") { c.default_props = p.clone(); }
        if let Some(t) = patch.get("tree") { c.tree = t.clone(); }
        if let Some(code) = patch.get("code").and_then(|v| v.as_str()) { c.code = code.into(); }
        let path = self.root.join(COMPONENTS_DIR).join(format!("{component_id}.json"));
        fs::write(&path, serde_json::to_string_pretty(&c)?)?;
        Ok(c)
    }

    pub fn install_site_component(&self, source: &SiteComponent) -> Result<SiteComponent> {
        // Clone the spec into the workspace under a fresh id.
        let mut clone = source.clone();
        clone.id = Uuid::new_v4().to_string();
        clone.scope = "workspace".into();
        clone.created_at = Some(chrono::Utc::now().to_rfc3339());
        self.create_site_component(clone)
    }

    pub fn delete_site_component(&self, component_id: &str) -> Result<()> {
        let path = self.root.join(COMPONENTS_DIR).join(format!("{component_id}.json"));
        fs::remove_file(&path).with_context(|| format!("delete {path:?}"))?;
        Ok(())
    }

    // ── Site assets ────────────────────────────────────────────────────

    pub fn list_site_assets(&self, site_id_filter: Option<&str>) -> Result<Vec<SiteAsset>> {
        let mut out = Vec::new();
        for s in self.list_sites(true)? {
            if let Some(filter) = site_id_filter {
                if s.id != filter { continue; }
            }
            let dir = self.root.join(SITES_DIR).join(&s.slug).join("assets");
            if !dir.exists() { continue; }
            for entry in fs::read_dir(&dir)? {
                let entry = entry?;
                if !entry.file_type()?.is_file() { continue; }
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') { continue; }
                let meta = entry.metadata()?;
                out.push(SiteAsset {
                    id: format!("{}:{}", s.id, name),
                    site_id: s.id.clone(),
                    name: name.clone(),
                    url: format!("file://{}", entry.path().display()),
                    size: meta.len(),
                    mime_type: None,
                    created_at: meta.created().ok().and_then(|_| Some(chrono::Utc::now().to_rfc3339())),
                });
            }
        }
        Ok(out)
    }

    // ── Public-share lookups ───────────────────────────────────────────

    /// Find a database that has any publicly shared pages with `shareId`. v0.7
    /// stored shareId on pages, not databases, so this scans by share_id.
    pub fn get_public_database(&self, share_id: &str) -> Result<Database> {
        for db in self.list_databases()? {
            for p in self.list_pages(&db.id, ListPagesOpts { include_archived: true, ..Default::default() })? {
                if p.share_id.as_deref() == Some(share_id) {
                    return self.get_database(&db.id);
                }
            }
        }
        Err(anyhow!("no public resource with shareId {share_id}"))
    }

    pub fn get_public_page(&self, share_id: &str) -> Result<Page> {
        for db in self.list_databases()? {
            for p in self.list_pages(&db.id, ListPagesOpts { include_archived: true, ..Default::default() })? {
                if p.share_id.as_deref() == Some(share_id) && p.is_public {
                    let (full, _) = self.get_page(&p.id)?;
                    return Ok(full);
                }
            }
        }
        Err(anyhow!("no public page with shareId {share_id}"))
    }

    pub fn list_public_pages(&self, share_id: &str, limit: usize) -> Result<Vec<Page>> {
        // share_id identifies a single public page in v0.7. Return [that] page
        // (or matching siblings if the same db is shared).
        let target = self.get_public_page(share_id)?;
        let pages = self.list_pages(&target.database_id, ListPagesOpts {
            limit: Some(limit), ..Default::default()
        })?;
        Ok(pages.into_iter().filter(|p| p.is_public).collect())
    }

    pub fn count_public_pages(&self, share_id: &str) -> Result<usize> {
        let target = self.get_public_page(share_id)?;
        let pages = self.list_pages(&target.database_id, ListPagesOpts::default())?;
        Ok(pages.into_iter().filter(|p| p.is_public).count())
    }

    pub fn get_public_doc(&self, share_id: &str) -> Result<Doc> {
        for d in self.list_all_docs()? {
            if d.share_id.as_deref() == Some(share_id) && d.is_public {
                return Ok(d);
            }
        }
        Err(anyhow!("no public doc with shareId {share_id}"))
    }

    pub fn delete_site_asset(&self, asset_id: &str) -> Result<()> {
        // asset_id format: "<site-id>:<filename>"
        let (site_id, name) = asset_id.split_once(':')
            .ok_or_else(|| anyhow!("asset id format must be \"<siteId>:<filename>\""))?;
        let s = self.find_site_internal(site_id)?;
        let path = self.root.join(SITES_DIR).join(&s.slug).join("assets").join(name);
        fs::remove_file(&path)?;
        Ok(())
    }
}

fn parse_blocks(body: &str, _page_id: &str) -> Vec<(usize, String, String)> {
    body.split("\n\n")
        .filter(|p| !p.trim().is_empty())
        .enumerate()
        .map(|(i, p)| {
            let trimmed = p.trim_start();
            let kind = if trimmed.starts_with('#') { "heading" }
                else if trimmed.starts_with("- ") || trimmed.starts_with("* ") { "list" }
                else if trimmed.starts_with("```") { "code" }
                else if trimmed.starts_with('>') { "quote" }
                else { "paragraph" };
            (i, kind.to_string(), p.to_string())
        })
        .collect()
}

fn parse_block_id(id: &str) -> Result<(String, usize)> {
    let (page_id, idx_str) = id.rsplit_once(':')
        .ok_or_else(|| anyhow!("block id must be \"<pageId>:<index>\""))?;
    let idx: usize = idx_str.parse().map_err(|_| anyhow!("invalid block index"))?;
    Ok((page_id.to_string(), idx))
}

fn parse_wiki_link(s: &str) -> Option<(String, String)> {
    let s = s.trim();
    let s = s.strip_prefix("[[")?.strip_suffix("]]")?;
    if let Some((title, id)) = s.split_once('|') {
        Some((title.trim().to_string(), id.trim().to_string()))
    } else {
        Some((s.trim().to_string(), String::new()))
    }
}

/// Pick a sensible inverse column name from the source database name.
/// "Company" → "Companies", "Contact" → "Contacts", default add 's'.
fn pluralize_or_self(s: &str) -> String {
    if s.ends_with('s') { s.to_string() } else { format!("{s}s") }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PageFrontmatter {
    pub id: String,
    pub created: String,
    pub updated: String,
    #[serde(default)]
    pub is_archived: bool,
    #[serde(default)]
    pub is_public: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub share_id: Option<String>,
    #[serde(default)]
    pub properties: serde_json::Map<String, serde_json::Value>,
}

fn read_page_file(path: &Path, db: &Database) -> Result<(Page, String)> {
    let raw = fs::read_to_string(path).with_context(|| format!("read {path:?}"))?;
    let (fm_raw, body) = split_frontmatter(&raw)?;
    let fm: PageFrontmatter = serde_yaml::from_str(&fm_raw)
        .with_context(|| format!("parse frontmatter in {path:?}"))?;
    let title_prop = db.properties.iter().find(|p| p.is_primary);
    let primary_title = title_prop
        .and_then(|p| fm.properties.get(&p.name))
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|s| s.to_str())
                .map(String::from)
                .unwrap_or_default()
        });
    // Map frontmatter (name-keyed) → propertiesCache (id-keyed).
    let mut cache = serde_json::Map::new();
    for prop in &db.properties {
        if let Some(v) = fm.properties.get(&prop.name) {
            cache.insert(prop.id.clone(), v.clone());
        }
    }
    let path_rel = path
        .strip_prefix(path.ancestors().nth(3).unwrap_or(path))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.display().to_string());
    Ok((
        Page {
            id: fm.id,
            database_id: db.id.clone(),
            primary_title,
            properties_cache: cache,
            created: Some(fm.created),
            updated: Some(fm.updated),
            is_archived: fm.is_archived,
            is_public: fm.is_public,
            share_id: fm.share_id,
            path: path_rel,
        },
        body,
    ))
}

fn write_page_file(path: &Path, fm: &PageFrontmatter, body: &str) -> Result<()> {
    let yaml = serde_yaml::to_string(fm)?;
    let body_trimmed = body.trim_end_matches('\n');
    let out = if body_trimmed.is_empty() {
        format!("---\n{yaml}---\n")
    } else {
        format!("---\n{yaml}---\n\n{body_trimmed}\n")
    };
    fs::write(path, out).with_context(|| format!("write {path:?}"))?;
    Ok(())
}

/// Split a markdown file with YAML frontmatter into (yaml, body).
fn split_frontmatter(s: &str) -> Result<(String, String)> {
    let s = s.trim_start_matches('\u{FEFF}'); // BOM
    let s = s.strip_prefix("---\n").or_else(|| s.strip_prefix("---\r\n"))
        .ok_or_else(|| anyhow!("missing leading frontmatter marker"))?;
    let end = s.find("\n---\n").or_else(|| s.find("\r\n---\r\n"))
        .ok_or_else(|| anyhow!("missing closing frontmatter marker"))?;
    let yaml = &s[..end];
    let body = &s[end..];
    let body = body.trim_start_matches("\n---\n").trim_start_matches("\r\n---\r\n");
    Ok((yaml.to_string(), body.trim_start_matches('\n').to_string()))
}

/// Pick a filename for a new page that doesn't collide with an existing one.
fn unique_filename(dir: &Path, title: &str) -> String {
    let base = sanitize_filename(title);
    if base.is_empty() {
        return format!("{}.md", Uuid::new_v4());
    }
    let mut candidate = format!("{base}.md");
    let mut n = 2;
    while dir.join(&candidate).exists() {
        candidate = format!("{base} ({n}).md");
        n += 1;
    }
    candidate
}

/// Same as `unique_filename` but lets one specific path "claim" its filename
/// (used when renaming-in-place: the existing file shouldn't count as a collision).
fn unique_filename_skip(dir: &Path, title: &str, skip: &Path) -> String {
    let base = sanitize_filename(title);
    if base.is_empty() {
        return skip.file_name().map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| format!("{}.md", Uuid::new_v4()));
    }
    let mut candidate = format!("{base}.md");
    let mut n = 2;
    while dir.join(&candidate).exists() && dir.join(&candidate) != skip {
        candidate = format!("{base} ({n}).md");
        n += 1;
    }
    candidate
}

fn sanitize_filename(s: &str) -> String {
    s.trim()
        .chars()
        .map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}

// ── Docs ────────────────────────────────────────────────────────────────
//
// On-disk: each doc = `<vault>/docs/<Title>.md` with frontmatter holding the
// id, title, icon, parentId, archive flag. Trashed docs live under
// `docs/_trash/`.

const DOCS_DIR: &str = "docs";
const TRASH_DIR: &str = "docs/_trash";
const HISTORY_DIR: &str = "docs/_history";

#[derive(Debug, Clone, Default)]
pub struct DocPatch {
    pub title: Option<String>,
    pub icon: Option<String>,
    pub parent_id: Option<Option<String>>, // Some(None) = move to root, None = leave unchanged
    pub position: Option<Option<f64>>,     // Some(None) = clear, Some(Some(x)) = set, None = leave
    pub content_md: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ListDocsOpts {
    pub parent_id: Option<String>,
    pub include_archived: bool,
}

impl Vault {
    /// List top-level docs (parentId = null) by default. With parent_id set,
    /// returns direct children. Excludes archived unless include_archived.
    pub fn list_docs(&self, opts: ListDocsOpts) -> Result<Vec<Doc>> {
        let docs = self.scan_docs(false)?;
        let parent = opts.parent_id.as_deref();
        let mut filtered: Vec<Doc> = docs
            .into_iter()
            .filter(|d| !d.is_archived || opts.include_archived)
            .filter(|d| match (parent, d.parent_id.as_deref()) {
                (None, None) => true,
                (Some(p), Some(dp)) => p == dp,
                _ => false,
            })
            .collect();
        filtered.sort_by(cmp_position_then_title);
        Ok(filtered)
    }

    pub fn list_all_docs(&self) -> Result<Vec<Doc>> {
        let mut docs = self.scan_docs(false)?;
        docs.retain(|d| !d.is_archived);
        docs.sort_by(cmp_position_then_title);
        Ok(docs)
    }

    pub fn list_doc_children(&self, doc_id: &str) -> Result<Vec<Doc>> {
        self.list_docs(ListDocsOpts { parent_id: Some(doc_id.to_string()), include_archived: false })
    }

    pub fn list_trash_docs(&self) -> Result<Vec<Doc>> {
        self.scan_docs(true)
    }

    pub fn get_doc(&self, doc_id: &str) -> Result<Doc> {
        let (doc, _) = self.find_doc(doc_id)?;
        Ok(doc)
    }

    pub fn get_doc_content(&self, doc_id: &str) -> Result<String> {
        let (_, path) = self.find_doc(doc_id)?;
        let raw = fs::read_to_string(&path)?;
        let (_, body) = split_frontmatter(&raw)?;
        Ok(md_to_html(&body))
    }

    pub fn get_doc_ancestors(&self, doc_id: &str) -> Result<Vec<Doc>> {
        let all = self.scan_docs(false)?;
        let by_id: std::collections::HashMap<String, Doc> =
            all.into_iter().map(|d| (d.id.clone(), d)).collect();
        let mut chain = Vec::new();
        let mut current = by_id.get(doc_id).cloned();
        while let Some(d) = current {
            let parent_id = d.parent_id.clone();
            // Push the parent (not self) into the ancestor chain.
            current = parent_id.and_then(|pid| by_id.get(&pid).cloned());
            if let Some(p) = current.clone() {
                chain.push(p);
            }
        }
        Ok(chain)
    }

    /// Find docs that link to `doc_id` via `[[Title|<doc_id>]]` references in
    /// either doc bodies or page bodies. v0.3 scans every file.
    pub fn get_doc_backlinks(&self, doc_id: &str) -> Result<Vec<Doc>> {
        let target = self.get_doc(doc_id)?;
        let needle_id = format!("|{}]]", target.id);
        let needle_title = format!("[[{}]]", target.title);
        let needle_title_alias = format!("[[{}|", target.title);
        // Block-ref / transclude syntax: ((title)) and ((id)). Same
        // doc-resolution semantics as wiki-links but rendered inline as a
        // pill (the editor side of this lives in MarkdownEditor.tsx).
        let needle_block_title = format!("(({}))", target.title);
        let needle_block_id = format!("(({}))", target.id);

        let mut backlinks = Vec::new();
        for d in self.scan_docs(false)? {
            if d.id == doc_id { continue; }
            let path = self.root.join(&d.path);
            let raw = fs::read_to_string(&path).unwrap_or_default();
            if raw.contains(&needle_id) || raw.contains(&needle_title)
                || raw.contains(&needle_title_alias)
                || raw.contains(&needle_block_title)
                || raw.contains(&needle_block_id)
            {
                backlinks.push(d);
            }
        }
        Ok(backlinks)
    }

    pub fn create_doc(
        &self,
        title: &str,
        icon: Option<String>,
        parent_id: Option<String>,
        content_md: Option<String>,
    ) -> Result<Doc> {
        let dir = self.root.join(DOCS_DIR);
        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let filename = unique_filename(&dir, title);
        let path = dir.join(&filename);
        let fm = DocFrontmatter {
            id: id.clone(),
            title: title.to_string(),
            icon,
            parent_id,
            position: None,
            flashcard: None,
            card_due: None,
            card_interval: None,
            card_ease: None,
            is_archived: false,
            is_public: false,
            share_id: None,
            created_at: now.clone(),
            updated_at: now,
        };
        write_doc_file(&path, &fm, &content_md.unwrap_or_default())?;
        Ok(read_doc_file(&path, &self.root)?)
    }

    pub fn update_doc(&self, doc_id: &str, patch: DocPatch) -> Result<Doc> {
        let (_, path) = self.find_doc(doc_id)?;
        let raw = fs::read_to_string(&path)?;
        let (fm_raw, current_body) = split_frontmatter(&raw)?;
        let mut fm: DocFrontmatter = serde_yaml::from_str(&fm_raw)?;
        if let Some(t) = patch.title { fm.title = t; }
        if let Some(i) = patch.icon { fm.icon = Some(i); }
        if let Some(pid_opt) = patch.parent_id { fm.parent_id = pid_opt; }
        if let Some(pos_opt) = patch.position { fm.position = pos_opt; }
        fm.updated_at = chrono::Utc::now().to_rfc3339();
        let body = patch.content_md.unwrap_or(current_body);
        // Rename file if title changed.
        let dir = path.parent().unwrap();
        let new_filename = unique_filename_skip(dir, &fm.title, &path);
        let new_path = dir.join(&new_filename);
        if new_path != path {
            fs::rename(&path, &new_path)?;
        }
        write_doc_file(&new_path, &fm, &body)?;
        Ok(read_doc_file(&new_path, &self.root)?)
    }

    pub fn update_doc_content(&self, doc_id: &str, content: &str, _format: &str) -> Result<()> {
        // Snapshot the OLD content before overwriting — but only if the
        // content actually changed and the most recent snapshot is older
        // than 60s. This caps history at one snapshot per minute per doc,
        // which is plenty for "oops, I deleted a paragraph" recovery
        // without ballooning the vault on every keystroke autosave.
        if let Ok((_, current)) = self.find_doc(doc_id) {
            if let Ok(raw) = fs::read_to_string(&current) {
                if let Ok((_, body)) = split_frontmatter(&raw) {
                    if body.trim() != content.trim() && self.should_snapshot(doc_id, 60) {
                        let _ = self.write_history_snapshot(doc_id, &raw);
                    }
                }
            }
        }
        self.update_doc(doc_id, DocPatch { content_md: Some(content.to_string()), ..Default::default() })?;
        Ok(())
    }

    /// Returns true when the most-recent snapshot for `doc_id` is older
    /// than `min_age_seconds` (or no snapshots exist yet).
    fn should_snapshot(&self, doc_id: &str, min_age_seconds: i64) -> bool {
        let dir = self.root.join(HISTORY_DIR).join(doc_id);
        let Ok(entries) = fs::read_dir(&dir) else { return true };
        let latest = entries.flatten().filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let stem = name.strip_suffix(".md")?.to_string();
            chrono::DateTime::parse_from_rfc3339(&stem.replace('_', ":")).ok()
        }).max();
        match latest {
            Some(t) => (chrono::Utc::now().timestamp() - t.timestamp()) >= min_age_seconds,
            None => true,
        }
    }

    fn write_history_snapshot(&self, doc_id: &str, raw_content: &str) -> Result<String> {
        let dir = self.root.join(HISTORY_DIR).join(doc_id);
        fs::create_dir_all(&dir)?;
        // Colon is illegal on macOS APFS in some contexts (and ugly in URLs).
        // Use `_` as separator so the filename is portable AND parseable
        // back into a DateTime by replacing `_` with `:` on read.
        let stamp = chrono::Utc::now().to_rfc3339().replace(':', "_");
        let path = dir.join(format!("{stamp}.md"));
        fs::write(&path, raw_content)?;
        Ok(stamp)
    }

    /// List snapshot timestamps for a doc, newest first. Returns ISO-8601
    /// strings (with `:` restored) so they can be passed back to the
    /// get/restore tools without conversion gymnastics on the client.
    pub fn list_doc_history(&self, doc_id: &str) -> Result<Vec<String>> {
        let dir = self.root.join(HISTORY_DIR).join(doc_id);
        let Ok(entries) = fs::read_dir(&dir) else { return Ok(vec![]) };
        let mut stamps: Vec<String> = entries.flatten().filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let stem = name.strip_suffix(".md")?.to_string();
            Some(stem.replace('_', ":"))
        }).collect();
        stamps.sort_by(|a, b| b.cmp(a));
        Ok(stamps)
    }

    pub fn get_doc_snapshot(&self, doc_id: &str, timestamp: &str) -> Result<String> {
        let dir = self.root.join(HISTORY_DIR).join(doc_id);
        let path = dir.join(format!("{}.md", timestamp.replace(':', "_")));
        let raw = fs::read_to_string(&path)
            .with_context(|| format!("snapshot not found: {timestamp}"))?;
        let (_, body) = split_frontmatter(&raw)?;
        Ok(body)
    }

    pub fn restore_doc_snapshot(&self, doc_id: &str, timestamp: &str) -> Result<Doc> {
        // Snapshot the CURRENT content before restoring so the restore
        // itself is reversible (you can always restore-the-restore).
        if let Ok((_, current_path)) = self.find_doc(doc_id) {
            if let Ok(raw) = fs::read_to_string(&current_path) {
                let _ = self.write_history_snapshot(doc_id, &raw);
            }
        }
        let body = self.get_doc_snapshot(doc_id, timestamp)?;
        self.update_doc(doc_id, DocPatch { content_md: Some(body), ..Default::default() })
    }

    /* ────────── Flashcards (SM-2-style, state in frontmatter) ────────── */

    /// Toggle a doc's flashcard flag. Setting it to `true` initialises the
    /// card so it's due immediately (no other SRS state — the next review
    /// fills in interval/ease).
    pub fn set_doc_flashcard(&self, doc_id: &str, is_card: bool) -> Result<Doc> {
        let (_, path) = self.find_doc(doc_id)?;
        let raw = fs::read_to_string(&path)?;
        let (fm_raw, body) = split_frontmatter(&raw)?;
        let mut fm: DocFrontmatter = serde_yaml::from_str(&fm_raw)?;
        fm.flashcard = Some(is_card);
        if !is_card {
            // Strip SRS state when toggling off so the doc returns to a
            // clean shape — keeps frontmatter lean for non-cards.
            fm.card_due = None;
            fm.card_interval = None;
            fm.card_ease = None;
        } else if fm.card_due.is_none() {
            fm.card_due = Some(chrono::Utc::now().to_rfc3339());
        }
        fm.updated_at = chrono::Utc::now().to_rfc3339();
        write_doc_file(&path, &fm, &body)?;
        Ok(read_doc_file(&path, &self.root)?)
    }

    /// Apply an SM-2-ish review and persist the new state.
    ///
    /// Rating maps:
    ///   1 (Again) → reset interval, ease -= 0.20 (floor 1.3)
    ///   2 (Hard)  → interval *= 1.2, ease -= 0.15
    ///   3 (Good)  → interval *= ease (or 1d on first review), ease unchanged
    ///   4 (Easy)  → interval *= ease * 1.3, ease += 0.10
    pub fn review_card(&self, doc_id: &str, rating: u8) -> Result<Doc> {
        let (_, path) = self.find_doc(doc_id)?;
        let raw = fs::read_to_string(&path)?;
        let (fm_raw, body) = split_frontmatter(&raw)?;
        let mut fm: DocFrontmatter = serde_yaml::from_str(&fm_raw)?;
        if fm.flashcard != Some(true) {
            anyhow::bail!("doc {doc_id} is not a flashcard");
        }
        let mut ease = fm.card_ease.unwrap_or(2.5);
        let prev_interval = fm.card_interval.unwrap_or(0.0);
        let new_interval = match rating {
            1 => { ease = (ease - 0.20).max(1.3); 0.0 }   // re-learn — due now-ish
            2 => { ease = (ease - 0.15).max(1.3); (prev_interval.max(1.0)) * 1.2 }
            3 => { if prev_interval == 0.0 { 1.0 } else { prev_interval * ease } }
            4 => { ease += 0.10; if prev_interval == 0.0 { 2.0 } else { prev_interval * ease * 1.3 } }
            _ => anyhow::bail!("rating must be 1..=4"),
        };
        let next_due = chrono::Utc::now() + chrono::Duration::seconds((new_interval * 86400.0) as i64);
        fm.card_interval = Some(new_interval);
        fm.card_ease     = Some(ease);
        fm.card_due      = Some(next_due.to_rfc3339());
        fm.updated_at    = chrono::Utc::now().to_rfc3339();
        write_doc_file(&path, &fm, &body)?;
        Ok(read_doc_file(&path, &self.root)?)
    }

    /// Cards whose `card_due` is now-or-earlier (or unset). Sorted oldest-due
    /// first so the review queue surfaces stale cards before fresh ones.
    pub fn list_due_cards(&self) -> Result<Vec<Doc>> {
        let now = chrono::Utc::now();
        let mut docs: Vec<Doc> = self.scan_docs(false)?
            .into_iter()
            .filter(|d| d.flashcard == Some(true) && !d.is_archived)
            .filter(|d| match &d.card_due {
                None => true,
                Some(s) => chrono::DateTime::parse_from_rfc3339(s)
                    .map(|t| t <= now).unwrap_or(true),
            })
            .collect();
        docs.sort_by(|a, b| {
            let ad = a.card_due.as_deref().unwrap_or("0");
            let bd = b.card_due.as_deref().unwrap_or("0");
            ad.cmp(bd)
        });
        Ok(docs)
    }

    pub fn list_all_cards(&self) -> Result<Vec<Doc>> {
        let mut docs: Vec<Doc> = self.scan_docs(false)?
            .into_iter()
            .filter(|d| d.flashcard == Some(true) && !d.is_archived)
            .collect();
        docs.sort_by(|a, b| a.title.cmp(&b.title));
        Ok(docs)
    }

    pub fn set_doc_sharing(&self, doc_id: &str, is_public: bool) -> Result<Doc> {
        let (_, path) = self.find_doc(doc_id)?;
        let raw = fs::read_to_string(&path)?;
        let (fm_raw, body) = split_frontmatter(&raw)?;
        let mut fm: DocFrontmatter = serde_yaml::from_str(&fm_raw)?;
        fm.is_public = is_public;
        if is_public && fm.share_id.is_none() {
            fm.share_id = Some(Uuid::new_v4().to_string());
        }
        fm.updated_at = chrono::Utc::now().to_rfc3339();
        write_doc_file(&path, &fm, &body)?;
        Ok(read_doc_file(&path, &self.root)?)
    }

    pub fn move_doc(
        &self,
        doc_id: &str,
        new_parent_id: Option<String>,
        new_position: Option<f64>,
    ) -> Result<Doc> {
        self.update_doc(doc_id, DocPatch {
            parent_id: Some(new_parent_id),
            position:  Some(new_position),
            ..Default::default()
        })
    }

    pub fn duplicate_doc(&self, doc_id: &str) -> Result<Doc> {
        let (orig, path) = self.find_doc(doc_id)?;
        let raw = fs::read_to_string(&path)?;
        let (_, body) = split_frontmatter(&raw)?;
        let new_title = format!("{} (copy)", orig.title);
        self.create_doc(&new_title, orig.icon, orig.parent_id, Some(body))
    }

    /// Soft delete: move to docs/_trash/ and mark archived.
    pub fn delete_doc(&self, doc_id: &str) -> Result<()> {
        let (_, path) = self.find_doc(doc_id)?;
        let trash = self.root.join(TRASH_DIR);
        fs::create_dir_all(&trash)?;
        let raw = fs::read_to_string(&path)?;
        let (fm_raw, body) = split_frontmatter(&raw)?;
        let mut fm: DocFrontmatter = serde_yaml::from_str(&fm_raw)?;
        fm.is_archived = true;
        fm.updated_at = chrono::Utc::now().to_rfc3339();
        let new_filename = unique_filename(&trash, &fm.title);
        let new_path = trash.join(&new_filename);
        write_doc_file(&new_path, &fm, &body)?;
        fs::remove_file(&path)?;
        Ok(())
    }

    pub fn restore_doc(&self, doc_id: &str) -> Result<Doc> {
        let (_, path) = self.find_doc(doc_id)?;
        let raw = fs::read_to_string(&path)?;
        let (fm_raw, body) = split_frontmatter(&raw)?;
        let mut fm: DocFrontmatter = serde_yaml::from_str(&fm_raw)?;
        fm.is_archived = false;
        fm.updated_at = chrono::Utc::now().to_rfc3339();
        let dir = self.root.join(DOCS_DIR);
        let new_filename = unique_filename(&dir, &fm.title);
        let new_path = dir.join(&new_filename);
        write_doc_file(&new_path, &fm, &body)?;
        fs::remove_file(&path)?;
        Ok(read_doc_file(&new_path, &self.root)?)
    }

    pub fn delete_doc_permanently(&self, doc_id: &str) -> Result<()> {
        let (_, path) = self.find_doc(doc_id)?;
        fs::remove_file(&path)?;
        Ok(())
    }

    /// Scan for docs. If `trash_only`, only the `_trash` subdir.
    fn scan_docs(&self, trash_only: bool) -> Result<Vec<Doc>> {
        let mut out = Vec::new();
        let mut stack = vec![self.root.join(DOCS_DIR)];
        while let Some(dir) = stack.pop() {
            if !dir.exists() { continue; }
            let is_trash = dir.ends_with("_trash");
            if trash_only && !is_trash { /* keep walking until we find _trash */ }
            for entry in fs::read_dir(&dir)? {
                let entry = entry?;
                let name = entry.file_name().to_string_lossy().to_string();
                if entry.file_type()?.is_dir() {
                    if name.starts_with('_') && name != "_trash" {
                        continue;
                    }
                    stack.push(entry.path());
                    continue;
                }
                if !name.ends_with(".md") { continue; }
                if trash_only && !is_trash { continue; }
                if !trash_only && is_trash { continue; }
                if let Ok(doc) = read_doc_file(&entry.path(), &self.root) {
                    out.push(doc);
                }
            }
        }
        Ok(out)
    }

    fn find_doc(&self, doc_id: &str) -> Result<(Doc, PathBuf)> {
        // Live docs first.
        for d in self.scan_docs(false)? {
            if d.id == doc_id {
                let p = self.root.join(&d.path);
                return Ok((d, p));
            }
        }
        // Then trash.
        for d in self.scan_docs(true)? {
            if d.id == doc_id {
                let p = self.root.join(&d.path);
                return Ok((d, p));
            }
        }
        Err(anyhow!("no doc with id {doc_id}"))
    }

    // ── Search ───────────────────────────────────────────────────────────

    /// Naive workspace search: scan every page + doc body for case-insensitive
    /// substring match. Returns matched pages (S16 wire shape). Docs are
    /// included as pseudo-pages with the doc's title. v0.3 behavior; SQLite
    /// FTS5 cache lands later if perf matters.
    pub fn search_workspace(&self, query: &str, limit: usize) -> Result<Vec<serde_json::Value>> {
        let q = query.to_lowercase();
        let mut hits = Vec::new();

        // Pages across every database.
        for db in self.list_databases()? {
            let dir = self.root.join(&db.path);
            for entry in fs::read_dir(&dir)? {
                let entry = entry?;
                let fname = entry.file_name().to_string_lossy().to_string();
                if !entry.file_type()?.is_file() || !fname.ends_with(".md") || fname.starts_with('_') {
                    continue;
                }
                let path = entry.path();
                let raw = fs::read_to_string(&path).unwrap_or_default();
                if !raw.to_lowercase().contains(&q) { continue; }
                if let Ok((page, _)) = read_page_file(&path, &self.get_database(&db.id)?) {
                    hits.push(serde_json::json!({
                        "kind": "page",
                        "id": page.id,
                        "primaryTitle": page.primary_title,
                        "databaseId": page.database_id,
                        "databaseName": db.name,
                    }));
                    if hits.len() >= limit { return Ok(hits); }
                }
            }
        }

        // Docs.
        for doc in self.list_all_docs()? {
            let path = self.root.join(&doc.path);
            let raw = fs::read_to_string(&path).unwrap_or_default();
            let title_match = doc.title.to_lowercase().contains(&q);
            let body_match = raw.to_lowercase().contains(&q);
            if !title_match && !body_match { continue; }
            hits.push(serde_json::json!({
                "kind": "doc",
                "id": doc.id,
                "title": doc.title,
                "icon": doc.icon,
            }));
            if hits.len() >= limit { return Ok(hits); }
        }
        Ok(hits)
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocFrontmatter {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flashcard: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub card_due: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub card_interval: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub card_ease: Option<f64>,
    #[serde(default)]
    pub is_archived: bool,
    #[serde(default)]
    pub is_public: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub share_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Sibling order: position-asc (None last, ties broken alphabetically).
/// Centralised so list-docs and tree-build agree on ordering.
fn cmp_position_then_title(a: &Doc, b: &Doc) -> std::cmp::Ordering {
    let ap = a.position.unwrap_or(f64::INFINITY);
    let bp = b.position.unwrap_or(f64::INFINITY);
    ap.partial_cmp(&bp).unwrap_or(std::cmp::Ordering::Equal)
        .then_with(|| a.title.cmp(&b.title))
}

fn read_doc_file(path: &Path, root: &Path) -> Result<Doc> {
    let raw = fs::read_to_string(path).with_context(|| format!("read {path:?}"))?;
    let (fm_raw, _) = split_frontmatter(&raw)?;
    let fm: DocFrontmatter = serde_yaml::from_str(&fm_raw)
        .with_context(|| format!("parse frontmatter in {path:?}"))?;
    let path_rel = path
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| path.display().to_string());
    Ok(Doc {
        id: fm.id,
        title: fm.title,
        icon: fm.icon,
        parent_id: fm.parent_id,
        position: fm.position,
        flashcard: fm.flashcard,
        card_due: fm.card_due,
        card_interval: fm.card_interval,
        card_ease: fm.card_ease,
        created_at: Some(fm.created_at),
        updated_at: Some(fm.updated_at),
        is_archived: fm.is_archived,
        is_public: fm.is_public,
        share_id: fm.share_id,
        path: path_rel,
    })
}

fn write_doc_file(path: &Path, fm: &DocFrontmatter, body: &str) -> Result<()> {
    let yaml = serde_yaml::to_string(fm)?;
    let body_trimmed = body.trim_end_matches('\n');
    let out = if body_trimmed.is_empty() {
        format!("---\n{yaml}---\n")
    } else {
        format!("---\n{yaml}---\n\n{body_trimmed}\n")
    };
    fs::write(path, out).with_context(|| format!("write {path:?}"))?;
    Ok(())
}

// ── Agents ──────────────────────────────────────────────────────────────
//
// Each agent is a folder under `<vault>/agents/`:
//   agents/<name>/agent.yml      ← metadata (name, model, systemPrompt, ...)
//   agents/<name>/compiled.mjs   ← the JS function body (optional)

const AGENTS_DIR: &str = "agents";

#[derive(Debug, Clone, Default)]
pub struct AgentPatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub model: Option<String>,
    pub system_prompt: Option<String>,
    pub tools: Option<Vec<serde_json::Value>>,
    pub input_schema: Option<serde_json::Value>,
    pub output_schema: Option<Option<serde_json::Value>>,
    pub skill_ids: Option<Vec<String>>,
    pub compiled_script: Option<String>,
    pub timeout: Option<u32>,
}

impl Vault {
    pub fn list_agents(&self) -> Result<Vec<Agent>> {
        let dir = self.root.join(AGENTS_DIR);
        let mut out = Vec::new();
        if !dir.exists() { return Ok(out); }
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() { continue; }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.starts_with('_') { continue; }
            if let Ok(a) = read_agent_dir(&entry.path(), &self.root) {
                out.push(a);
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    pub fn get_agent(&self, agent_id: &str) -> Result<Agent> {
        for a in self.list_agents()? {
            if a.id == agent_id { return Ok(a); }
        }
        Err(anyhow!("no agent with id {agent_id}"))
    }

    pub fn find_agent_by_name(&self, name: &str) -> Result<Agent> {
        let lower = name.to_lowercase();
        for a in self.list_agents()? {
            if a.name == name || a.name.to_lowercase() == lower {
                return Ok(a);
            }
        }
        Err(anyhow!("no agent matching \"{name}\""))
    }

    pub fn create_agent(&self, mut agent: Agent) -> Result<Agent> {
        let dir = self.root.join(AGENTS_DIR);
        fs::create_dir_all(&dir)?;
        if agent.id.is_empty() { agent.id = Uuid::new_v4().to_string(); }
        let folder = dir.join(sanitize_dirname(&agent.name));
        if folder.exists() {
            return Err(anyhow!("agent \"{}\" already exists", agent.name));
        }
        fs::create_dir_all(&folder)?;
        let now = chrono::Utc::now().to_rfc3339();
        agent.created_at.get_or_insert(now.clone());
        agent.updated_at = Some(now);
        agent.path = format!("{AGENTS_DIR}/{}", folder.file_name().unwrap().to_string_lossy());
        write_agent(&folder, &agent)?;
        Ok(agent)
    }

    pub fn update_agent(&self, agent_id: &str, patch: AgentPatch) -> Result<Agent> {
        let mut a = self.get_agent(agent_id)?;
        let folder = self.root.join(&a.path);
        if let Some(name) = patch.name {
            let new_folder = self.root.join(AGENTS_DIR).join(sanitize_dirname(&name));
            if new_folder.exists() && new_folder != folder {
                return Err(anyhow!("agent \"{name}\" already exists"));
            }
            if new_folder != folder {
                fs::rename(&folder, &new_folder)?;
                a.path = format!("{AGENTS_DIR}/{}", new_folder.file_name().unwrap().to_string_lossy());
            }
            a.name = name;
        }
        if let Some(d) = patch.description { a.description = Some(d); }
        if let Some(m) = patch.model { a.model = m; }
        if let Some(s) = patch.system_prompt { a.system_prompt = s; }
        if let Some(t) = patch.tools { a.tools = t; }
        if let Some(s) = patch.input_schema { a.input_schema = s; }
        if let Some(s) = patch.output_schema { a.output_schema = s; }
        if let Some(s) = patch.skill_ids { a.skill_ids = s; }
        if let Some(t) = patch.timeout { a.timeout = t; }
        if let Some(s) = patch.compiled_script {
            a.compiled_script = Some(s);
            a.compiled_at = Some(chrono::Utc::now().to_rfc3339());
            a.compilation_error = None;
        }
        a.updated_at = Some(chrono::Utc::now().to_rfc3339());
        write_agent(&self.root.join(&a.path), &a)?;
        Ok(a)
    }

    pub fn delete_agent(&self, agent_id: &str) -> Result<()> {
        let a = self.get_agent(agent_id)?;
        let folder = self.root.join(&a.path);
        fs::remove_dir_all(&folder).with_context(|| format!("delete {folder:?}"))?;
        Ok(())
    }

    // ── Triggers ─────────────────────────────────────────────────────────

    fn triggers_path(&self, agent: &Agent) -> PathBuf {
        self.root.join(&agent.path).join("triggers.yml")
    }

    pub fn list_triggers(&self, agent_id: &str) -> Result<Vec<Trigger>> {
        let agent = self.get_agent(agent_id)?;
        let path = self.triggers_path(&agent);
        if !path.exists() { return Ok(Vec::new()); }
        let raw = fs::read_to_string(&path)?;
        let mut list: Vec<Trigger> = serde_yaml::from_str(&raw).unwrap_or_default();
        for t in list.iter_mut() { t.agent_id = agent.id.clone(); }
        Ok(list)
    }

    /// Scan EVERY agent and collect all triggers — used by the runtime to
    /// schedule cron jobs and identify webhook routes.
    pub fn list_all_triggers(&self) -> Result<Vec<Trigger>> {
        let mut out = Vec::new();
        for a in self.list_agents()? {
            for t in self.list_triggers(&a.id).unwrap_or_default() {
                out.push(t);
            }
        }
        Ok(out)
    }

    pub fn set_trigger(&self, agent_id: &str, kind: &str, config: serde_json::Value) -> Result<Trigger> {
        let agent = self.get_agent(agent_id)?;
        let path = self.triggers_path(&agent);
        let mut list: Vec<Trigger> = if path.exists() {
            serde_yaml::from_str(&fs::read_to_string(&path)?).unwrap_or_default()
        } else { Vec::new() };
        let trigger = Trigger {
            id: Uuid::new_v4().to_string(),
            agent_id: agent.id.clone(),
            kind: kind.to_string(),
            config,
            created_at: Some(chrono::Utc::now().to_rfc3339()),
        };
        list.push(trigger.clone());
        fs::write(&path, serde_yaml::to_string(&list)?)?;
        Ok(trigger)
    }

    pub fn delete_trigger(&self, trigger_id: &str) -> Result<()> {
        for a in self.list_agents()? {
            let path = self.triggers_path(&a);
            if !path.exists() { continue; }
            let mut list: Vec<Trigger> = serde_yaml::from_str(&fs::read_to_string(&path)?).unwrap_or_default();
            let before = list.len();
            list.retain(|t| t.id != trigger_id);
            if list.len() != before {
                fs::write(&path, serde_yaml::to_string(&list)?)?;
                return Ok(());
            }
        }
        Err(anyhow!("no trigger with id {trigger_id}"))
    }

    // ── Blocks (paragraph-level operations on a page body) ──────────────
    //
    // Each "block" = one paragraph (blank-line-separated chunk of markdown).
    // Block type is sniffed from the first line: `#` → heading, `-`/`*` →
    // list, ``` → code, `>` → quote, else paragraph. Index = position.
    //
    // create_block / update_block / delete_block round-trip through markdown
    // text, so the body file stays human-editable in Obsidian.

    pub fn list_blocks(&self, page_id: &str) -> Result<Vec<serde_json::Value>> {
        let (_, path) = self.find_page_file(page_id)?;
        let raw = fs::read_to_string(&path)?;
        let (_, body) = split_frontmatter(&raw)?;
        Ok(parse_blocks(&body, page_id).into_iter().map(|(idx, kind, text)| {
            serde_json::json!({
                "id": format!("{page_id}:{idx}"),
                "pageId": page_id,
                "position": idx,
                "type": kind,
                "content": text,
            })
        }).collect())
    }

    pub fn create_block(
        &self,
        page_id: &str,
        kind: &str,
        content: &str,
        position: Option<usize>,
    ) -> Result<serde_json::Value> {
        let (_, path) = self.find_page_file(page_id)?;
        let raw = fs::read_to_string(&path)?;
        let (fm_raw, body) = split_frontmatter(&raw)?;
        let mut blocks = parse_blocks(&body, page_id).into_iter().map(|(_, k, t)| (k, t)).collect::<Vec<_>>();
        let new = (kind.to_string(), content.to_string());
        let pos = position.unwrap_or(blocks.len()).min(blocks.len());
        blocks.insert(pos, new);
        let new_body = blocks.iter().map(|(_, t)| t.as_str()).collect::<Vec<_>>().join("\n\n");
        let mut fm: PageFrontmatter = serde_yaml::from_str(&fm_raw)?;
        fm.updated = chrono::Utc::now().to_rfc3339();
        write_page_file(&path, &fm, &new_body)?;
        Ok(serde_json::json!({
            "id": format!("{page_id}:{pos}"),
            "pageId": page_id,
            "position": pos,
            "type": kind,
            "content": content,
        }))
    }

    pub fn update_block(
        &self,
        block_id: &str,
        kind: Option<String>,
        content: Option<String>,
        position: Option<usize>,
    ) -> Result<()> {
        let (page_id, idx) = parse_block_id(block_id)?;
        let (_, path) = self.find_page_file(&page_id)?;
        let raw = fs::read_to_string(&path)?;
        let (fm_raw, body) = split_frontmatter(&raw)?;
        let mut blocks = parse_blocks(&body, &page_id).into_iter().map(|(_, k, t)| (k, t)).collect::<Vec<_>>();
        if idx >= blocks.len() { return Err(anyhow!("block index {idx} out of range")); }
        if let Some(c) = content { blocks[idx].1 = c; }
        if let Some(k) = kind    { blocks[idx].0 = k; }
        if let Some(p) = position {
            if p >= blocks.len() { return Err(anyhow!("position {p} out of range")); }
            let item = blocks.remove(idx);
            blocks.insert(p, item);
        }
        let new_body = blocks.iter().map(|(_, t)| t.as_str()).collect::<Vec<_>>().join("\n\n");
        let mut fm: PageFrontmatter = serde_yaml::from_str(&fm_raw)?;
        fm.updated = chrono::Utc::now().to_rfc3339();
        write_page_file(&path, &fm, &new_body)?;
        Ok(())
    }

    pub fn delete_block(&self, block_id: &str) -> Result<()> {
        let (page_id, idx) = parse_block_id(block_id)?;
        let (_, path) = self.find_page_file(&page_id)?;
        let raw = fs::read_to_string(&path)?;
        let (fm_raw, body) = split_frontmatter(&raw)?;
        let mut blocks = parse_blocks(&body, &page_id).into_iter().map(|(_, k, t)| (k, t)).collect::<Vec<_>>();
        if idx >= blocks.len() { return Err(anyhow!("block index {idx} out of range")); }
        blocks.remove(idx);
        let new_body = blocks.iter().map(|(_, t)| t.as_str()).collect::<Vec<_>>().join("\n\n");
        let mut fm: PageFrontmatter = serde_yaml::from_str(&fm_raw)?;
        fm.updated = chrono::Utc::now().to_rfc3339();
        write_page_file(&path, &fm, &new_body)?;
        Ok(())
    }

    // ── Skills ─────────────────────────────────────────────────────────

    pub fn list_skills(&self) -> Result<Vec<Skill>> {
        let dir = self.root.join("skills");
        let mut out = Vec::new();
        if !dir.exists() { return Ok(out); }
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() { continue; }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.starts_with('_') { continue; }
            if let Ok(s) = read_skill_dir(&entry.path(), &self.root) {
                out.push(s);
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    pub fn get_skill(&self, skill_id: &str) -> Result<Skill> {
        for s in self.list_skills()? {
            if s.id == skill_id || s.name == skill_id { return Ok(s); }
        }
        Err(anyhow!("no skill with id or name {skill_id}"))
    }

    pub fn create_skill(&self, mut skill: Skill) -> Result<Skill> {
        let dir = self.root.join("skills");
        fs::create_dir_all(&dir)?;
        if skill.id.is_empty() { skill.id = Uuid::new_v4().to_string(); }
        if skill.name.is_empty() {
            skill.name = skill.display_name.clone().unwrap_or_else(|| skill.id.clone());
        }
        let folder = dir.join(sanitize_dirname(&skill.name));
        if folder.exists() {
            return Err(anyhow!("skill \"{}\" already exists", skill.name));
        }
        fs::create_dir_all(&folder)?;
        let now = chrono::Utc::now().to_rfc3339();
        skill.created_at.get_or_insert(now.clone());
        skill.updated_at = Some(now);
        skill.path = format!("skills/{}", folder.file_name().unwrap().to_string_lossy());
        write_skill(&folder, &skill)?;
        Ok(skill)
    }

    pub fn update_skill(
        &self,
        skill_id: &str,
        display_name: Option<String>,
        description: Option<String>,
        skill_md: Option<String>,
        tags: Option<Vec<String>>,
    ) -> Result<Skill> {
        let mut s = self.get_skill(skill_id)?;
        let folder = self.root.join(&s.path);
        if let Some(d) = display_name { s.display_name = Some(d); }
        if let Some(d) = description { s.description = Some(d); }
        if let Some(md) = skill_md { s.skill_md = md; }
        if let Some(t) = tags { s.tags = t; }
        s.updated_at = Some(chrono::Utc::now().to_rfc3339());
        write_skill(&folder, &s)?;
        Ok(s)
    }

    pub fn delete_skill(&self, skill_id: &str) -> Result<()> {
        let s = self.get_skill(skill_id)?;
        let folder = self.root.join(&s.path);
        fs::remove_dir_all(&folder)?;
        Ok(())
    }

    // ── Runs ───────────────────────────────────────────────────────────

    pub fn save_run(&self, run: &Run) -> Result<()> {
        let dir = self.root.join(".openspider/runs");
        fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{}.json", run.id));
        fs::write(&path, serde_json::to_string_pretty(run)?)?;
        Ok(())
    }

    pub fn get_run(&self, run_id: &str) -> Result<Run> {
        let path = self.root.join(".openspider/runs").join(format!("{run_id}.json"));
        let raw = fs::read_to_string(&path)
            .with_context(|| format!("no run with id {run_id}"))?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn list_runs(&self, agent_id: Option<&str>, limit: usize) -> Result<Vec<Run>> {
        let dir = self.root.join(".openspider/runs");
        if !dir.exists() { return Ok(Vec::new()); }
        let mut out = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".json") { continue; }
            let raw = fs::read_to_string(entry.path())?;
            if let Ok(run) = serde_json::from_str::<Run>(&raw) {
                if agent_id.map(|aid| run.agent_id == aid).unwrap_or(true) {
                    out.push(run);
                }
            }
        }
        out.sort_by(|a, b| b.started_at.cmp(&a.started_at));
        out.truncate(limit);
        Ok(out)
    }
}

fn read_agent_dir(folder: &Path, root: &Path) -> Result<Agent> {
    let yml = folder.join("agent.yml");
    let raw = fs::read_to_string(&yml).with_context(|| format!("read {yml:?}"))?;
    let mut a: Agent = serde_yaml::from_str(&raw)
        .with_context(|| format!("parse {yml:?}"))?;
    let script_path = folder.join("compiled.mjs");
    if script_path.exists() {
        a.compiled_script = Some(fs::read_to_string(&script_path)?);
    }
    a.path = folder.strip_prefix(root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| folder.display().to_string());
    Ok(a)
}

fn write_agent(folder: &Path, agent: &Agent) -> Result<()> {
    fs::create_dir_all(folder)?;
    // Strip compiled_script before writing yml so it doesn't bloat the file.
    let mut for_yaml = agent.clone();
    let script = for_yaml.compiled_script.take();
    let yml = folder.join("agent.yml");
    fs::write(&yml, serde_yaml::to_string(&for_yaml)?)?;
    if let Some(s) = script {
        fs::write(folder.join("compiled.mjs"), s)?;
    } else {
        // If script was cleared, remove the file.
        let p = folder.join("compiled.mjs");
        if p.exists() { let _ = fs::remove_file(p); }
    }
    Ok(())
}

fn read_skill_dir(folder: &Path, root: &Path) -> Result<Skill> {
    let path = folder.join("SKILL.md");
    let raw = fs::read_to_string(&path).with_context(|| format!("read {path:?}"))?;
    let (fm_raw, body) = split_frontmatter(&raw)?;
    let mut s: Skill = serde_yaml::from_str(&fm_raw)
        .with_context(|| format!("parse frontmatter {path:?}"))?;
    if s.id.is_empty() { s.id = Uuid::new_v4().to_string(); }
    if s.name.is_empty() {
        s.name = folder.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    }
    s.skill_md = if body.trim().is_empty() { raw } else {
        // Reconstruct full SKILL.md (frontmatter + body) for the wire shape.
        format!("---\n{}---\n\n{}", fm_raw, body)
    };
    s.path = folder.strip_prefix(root)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| folder.display().to_string());
    Ok(s)
}

fn write_skill(folder: &Path, skill: &Skill) -> Result<()> {
    fs::create_dir_all(folder)?;
    // If skill_md already starts with frontmatter, write it as-is. Otherwise
    // reconstruct.
    let path = folder.join("SKILL.md");
    let trimmed = skill.skill_md.trim_start();
    let out = if trimmed.starts_with("---") {
        skill.skill_md.clone()
    } else {
        let mut fm_clone = skill.clone();
        fm_clone.skill_md = String::new();
        let yaml = serde_yaml::to_string(&fm_clone)?;
        format!("---\n{yaml}---\n\n{}", skill.skill_md)
    };
    fs::write(&path, out)?;
    Ok(())
}

// ── Files ───────────────────────────────────────────────────────────────
//
// Layout: <vault>/files/<id>          ← raw bytes (uploaded files only)
//         <vault>/files/_metadata/<id>.json  ← {id, name, mimeType, size, url, kind}
//
// URL-only files (registered via s16_create_file with a public URL) skip the
// raw-bytes file and just store metadata pointing at the external URL.

const FILES_DIR: &str = "files";

impl Vault {
    pub fn list_files(&self) -> Result<Vec<File>> {
        let dir = self.root.join(FILES_DIR).join("_metadata");
        let mut out = Vec::new();
        if !dir.exists() { return Ok(out); }
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.ends_with(".json") { continue; }
            let raw = fs::read_to_string(entry.path())?;
            if let Ok(f) = serde_json::from_str::<File>(&raw) {
                out.push(f);
            }
        }
        out.sort_by(|a, b| b.created_at.as_deref().unwrap_or("").cmp(a.created_at.as_deref().unwrap_or("")));
        Ok(out)
    }

    pub fn get_file(&self, file_id: &str) -> Result<File> {
        let path = self.root.join(FILES_DIR).join("_metadata").join(format!("{file_id}.json"));
        let raw = fs::read_to_string(&path).with_context(|| format!("no file with id {file_id}"))?;
        Ok(serde_json::from_str(&raw)?)
    }

    pub fn create_file_url(&self, name: &str, url: &str, mime_type: Option<String>) -> Result<File> {
        let dir = self.root.join(FILES_DIR).join("_metadata");
        fs::create_dir_all(&dir)?;
        let id = Uuid::new_v4().to_string();
        let f = File {
            id: id.clone(),
            name: name.to_string(),
            mime_type,
            size: 0,
            url: url.to_string(),
            kind: "url".into(),
            created_at: Some(chrono::Utc::now().to_rfc3339()),
        };
        fs::write(dir.join(format!("{id}.json")), serde_json::to_string_pretty(&f)?)?;
        Ok(f)
    }

    pub fn upload_file(&self, name: &str, bytes: &[u8], mime_type: Option<String>) -> Result<File> {
        let files_dir = self.root.join(FILES_DIR);
        let meta_dir = files_dir.join("_metadata");
        fs::create_dir_all(&meta_dir)?;
        let id = Uuid::new_v4().to_string();
        let bytes_path = files_dir.join(&id);
        fs::write(&bytes_path, bytes)?;
        let f = File {
            id: id.clone(),
            name: name.to_string(),
            mime_type,
            size: bytes.len() as u64,
            url: format!("file://{}", bytes_path.display()),
            kind: "uploaded".into(),
            created_at: Some(chrono::Utc::now().to_rfc3339()),
        };
        fs::write(meta_dir.join(format!("{id}.json")), serde_json::to_string_pretty(&f)?)?;
        Ok(f)
    }

    pub fn delete_file(&self, file_id: &str) -> Result<()> {
        let f = self.get_file(file_id)?;
        let meta = self.root.join(FILES_DIR).join("_metadata").join(format!("{file_id}.json"));
        let bytes = self.root.join(FILES_DIR).join(file_id);
        if f.kind == "uploaded" && bytes.exists() {
            fs::remove_file(&bytes)?;
        }
        fs::remove_file(&meta)?;
        Ok(())
    }

    // ── Credentials ────────────────────────────────────────────────────
    //
    // Stored as a JSON map at .openspider/credentials.json. v0.5 is plaintext;
    // encryption (chacha20poly1305 with a vault-owned key) lands later.

    fn credentials_path(&self) -> PathBuf { self.root.join(".openspider/credentials.json") }

    fn read_credentials(&self) -> Result<Vec<Credential>> {
        let path = self.credentials_path();
        if !path.exists() { return Ok(Vec::new()); }
        let raw = fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&raw).unwrap_or_default())
    }

    fn write_credentials(&self, creds: &[Credential]) -> Result<()> {
        let path = self.credentials_path();
        if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
        fs::write(&path, serde_json::to_string_pretty(creds)?)?;
        Ok(())
    }

    pub fn list_credentials(&self, service: Option<&str>) -> Result<Vec<Credential>> {
        let all = self.read_credentials()?;
        Ok(match service {
            Some(s) => all.into_iter().filter(|c| c.service == s).collect(),
            None => all,
        })
    }

    pub fn get_credential(&self, credential_id: &str) -> Result<Credential> {
        self.read_credentials()?
            .into_iter()
            .find(|c| c.id == credential_id)
            .ok_or_else(|| anyhow!("no credential with id {credential_id}"))
    }

    pub fn create_credential(&self, service: &str, title: &str, data: serde_json::Value) -> Result<Credential> {
        let mut all = self.read_credentials()?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut data_obj = data;
        // Store a `_meta` block alongside the user's credential payload to
        // mirror the S16 wire shape.
        if let serde_json::Value::Object(map) = &mut data_obj {
            map.insert("_meta".into(), serde_json::json!({
                "service": service,
                "connectedAt": now,
                "connectionType": "manual",
            }));
        }
        let cred = Credential {
            id: Uuid::new_v4().to_string(),
            service: service.into(),
            title: title.into(),
            status: "active".into(),
            connection_type: "manual".into(),
            provider: None,
            capabilities: Vec::new(),
            account_identifier: None,
            credentials: data_obj,
            created_at: Some(now.clone()),
            updated_at: Some(now),
        };
        all.push(cred.clone());
        self.write_credentials(&all)?;
        Ok(cred)
    }

    pub fn update_credential(
        &self,
        credential_id: &str,
        title: Option<String>,
        data: Option<serde_json::Value>,
    ) -> Result<Credential> {
        let mut all = self.read_credentials()?;
        let idx = all.iter().position(|c| c.id == credential_id)
            .ok_or_else(|| anyhow!("no credential with id {credential_id}"))?;
        if let Some(t) = title { all[idx].title = t; }
        if let Some(d) = data { all[idx].credentials = d; }
        all[idx].updated_at = Some(chrono::Utc::now().to_rfc3339());
        let updated = all[idx].clone();
        self.write_credentials(&all)?;
        Ok(updated)
    }

    pub fn delete_credential(&self, credential_id: &str) -> Result<()> {
        let mut all = self.read_credentials()?;
        let before = all.len();
        all.retain(|c| c.id != credential_id);
        if all.len() == before {
            return Err(anyhow!("no credential with id {credential_id}"));
        }
        self.write_credentials(&all)
    }

    // ── Secrets (encrypted KV — v0.5 is plaintext for simplicity) ──────

    fn secrets_path(&self) -> PathBuf { self.root.join(".openspider/secrets.json") }

    fn read_secrets(&self) -> Result<std::collections::BTreeMap<String, String>> {
        let path = self.secrets_path();
        if !path.exists() { return Ok(Default::default()); }
        let raw = fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&raw).unwrap_or_default())
    }

    fn write_secrets(&self, secrets: &std::collections::BTreeMap<String, String>) -> Result<()> {
        let path = self.secrets_path();
        if let Some(parent) = path.parent() { fs::create_dir_all(parent)?; }
        fs::write(&path, serde_json::to_string_pretty(secrets)?)?;
        Ok(())
    }

    pub fn set_secret(&self, key: &str, value: &str) -> Result<()> {
        let mut s = self.read_secrets()?;
        s.insert(key.into(), value.into());
        self.write_secrets(&s)
    }

    pub fn get_secret(&self, key: &str) -> Result<Option<String>> {
        Ok(self.read_secrets()?.get(key).cloned())
    }

    pub fn list_secret_keys(&self) -> Result<Vec<String>> {
        Ok(self.read_secrets()?.keys().cloned().collect())
    }

    pub fn delete_secret(&self, key: &str) -> Result<()> {
        let mut s = self.read_secrets()?;
        if s.remove(key).is_none() {
            return Err(anyhow!("no secret with key {key}"));
        }
        self.write_secrets(&s)
    }
}

/// Markdown-to-HTML conversion using pulldown-cmark.
fn md_to_html(md: &str) -> String {
    use pulldown_cmark::{html, Options, Parser};
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(md, opts);
    let mut out = String::new();
    html::push_html(&mut out, parser);
    out
}

#[derive(Debug, Clone, Default)]
pub struct DatabasePatch {
    pub name: Option<String>,
    pub icon: Option<String>,
    pub description: Option<String>,
    pub is_private: Option<bool>,
    pub property_order: Option<Vec<String>>,
}

/// Persisted in `.openspider/config.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceConfig {
    pub workspace_id: String,
    pub created_at: String,
    /// Optional LLM config for the agent sidecar's `s16.ai()` calls.
    /// Edit the file directly or via `brain config llm` (when shipped).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub llm: Option<LlmConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmConfig {
    pub base_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    pub default_model: String,
}

// ── _schema.yml on-disk shape ────────────────────────────────────────────

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DatabaseSchema {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub is_private: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_template_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub property_order: Option<Vec<String>>,
    #[serde(default)]
    pub properties: Vec<PropertySchema>,
    #[serde(default)]
    pub views: Vec<ViewSchema>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TemplateFrontmatter {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default)]
    pub config: serde_json::Value,
    #[serde(default)]
    pub styles: serde_json::Value,
    #[serde(default)]
    pub is_default: bool,
}

fn substitute_vars(s: &str, vars: &serde_json::Map<String, serde_json::Value>) -> String {
    let mut out = s.to_string();
    for (k, v) in vars {
        let needle = format!("{{{{{k}}}}}");
        let replacement = match v {
            serde_json::Value::String(s) => s.clone(),
            other => serde_json::to_string(other).unwrap_or_default(),
        };
        out = out.replace(&needle, &replacement);
    }
    out
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewSchema {
    pub id: String,
    pub name: String,
    /// table | board | gallery | calendar | list
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub filters: serde_json::Value,
    #[serde(default)]
    pub sorts: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_by: Option<String>,
    #[serde(default)]
    pub visible_properties: Vec<String>,
    #[serde(default)]
    pub config: serde_json::Value,
    #[serde(default)]
    pub position: i32,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PropertySchema {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub config: serde_json::Value,
    #[serde(default)]
    pub position: i32,
    #[serde(default)]
    pub is_primary: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inverse_property_id: Option<String>,
}

fn read_schema(dir: &Path) -> Result<DatabaseSchema> {
    let path = dir.join("_schema.yml");
    if !path.exists() {
        return Ok(DatabaseSchema::default());
    }
    let raw = fs::read_to_string(&path).with_context(|| format!("read {path:?}"))?;
    Ok(serde_yaml::from_str(&raw)?)
}

fn write_schema(dir: &Path, schema: &DatabaseSchema) -> Result<()> {
    let path = dir.join("_schema.yml");
    let raw = serde_yaml::to_string(schema)?;
    fs::write(&path, raw).with_context(|| format!("write {path:?}"))?;
    Ok(())
}

fn schema_to_database(name: String, dir: &Path, schema: DatabaseSchema) -> Database {
    let path_rel = dir
        .strip_prefix(dir.parent().and_then(|p| p.parent()).unwrap_or(dir))
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| format!("databases/{name}"));
    let database_id = schema.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
    let properties = schema
        .properties
        .iter()
        .map(|p| Property {
            id: p.id.clone(),
            database_id: database_id.clone(),
            name: p.name.clone(),
            kind: p.kind.clone(),
            config: p.config.clone(),
            position: p.position,
            is_primary: p.is_primary,
            inverse_property_id: p.inverse_property_id.clone(),
        })
        .collect();
    let views = schema.views.iter().map(|v| View {
        id: v.id.clone(),
        database_id: database_id.clone(),
        name: v.name.clone(),
        kind: v.kind.clone(),
        filters: v.filters.clone(),
        sorts: v.sorts.clone(),
        group_by: v.group_by.clone(),
        visible_properties: v.visible_properties.clone(),
        config: v.config.clone(),
        position: v.position,
    }).collect();
    Database {
        id: database_id,
        name,
        icon: schema.icon,
        description: schema.description,
        is_private: schema.is_private,
        default_template_id: schema.default_template_id,
        property_order: schema.property_order,
        properties,
        views,
        templates: Vec::new(),
        path: path_rel,
    }
}

/// Sanitize a name into a directory-safe form. Doesn't fight too hard;
/// users can edit folder names directly in the vault if needed.
fn sanitize_dirname(s: &str) -> String {
    let s = s.trim();
    s.chars()
        .map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
}
