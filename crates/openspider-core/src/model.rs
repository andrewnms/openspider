//! Domain types — mirror the S16 MCP response shapes so existing clients
//! (bettersync, the s16-mcp-api skill) understand them without adapters.
//!
//! Field naming uses camelCase to match the S16 wire format. Optional
//! fields default to None / empty so older `_schema.yml` files keep working.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A database, returned by `s16_list_databases` (slim) and `s16_get_database`
/// (full, with properties + views + templates). One database per
/// `<vault>/databases/<Name>/` folder, schema in `_schema.yml`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Database {
    pub id: String,
    pub name: String,
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

    /// Only populated by full reads (`get_database`). Empty on list responses.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<Property>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub views: Vec<View>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub templates: Vec<TemplateStub>,

    /// Vault-relative path to the database folder, e.g. "databases/Conversations".
    /// Not part of the S16 wire format — internal bookkeeping.
    #[serde(skip)]
    pub path: String,
}

/// A column. Every property has a stable UUID so renames don't break refs.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Property {
    pub id: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub database_id: String,
    pub name: String,
    /// One of: title, text, number, select, multi_select, status, relation,
    /// date, email, url, phone, checkbox, created_time, last_edited_time, etc.
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub config: Value,
    #[serde(default)]
    pub position: i32,
    #[serde(default)]
    pub is_primary: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inverse_property_id: Option<String>,
}

/// A database view (table / board / gallery / calendar / list).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub id: String,
    pub database_id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub filters: Value,
    #[serde(default)]
    pub sorts: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_by: Option<String>,
    #[serde(default)]
    pub visible_properties: Vec<String>,
    #[serde(default)]
    pub config: Value,
    #[serde(default)]
    pub position: i32,
}

/// A page template. Stored under `databases/<name>/_templates/<id>.md`
/// with frontmatter holding metadata and the body holding the template content.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TemplateStub {
    pub id: String,
    pub database_id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Markdown content with optional `{{variable}}` placeholders.
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub config: Value,
    #[serde(default)]
    pub styles: Value,
    #[serde(default)]
    pub is_default: bool,
}

/// A sidebar doc. Flat markdown file under `<vault>/docs/<Title>.md` with
/// frontmatter holding id/title/icon/parentId. Hierarchy is logical via
/// `parentId` rather than filesystem nesting (simpler to move and rename).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Doc {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// Sibling-order key. Lower = earlier. None → falls back to alphabetical
    /// at the end of the ordered set. Set by drag-drop / "Create above/below".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub is_archived: bool,
    #[serde(default)]
    pub is_public: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub share_id: Option<String>,
    /// Vault-relative path for internal lookup; not serialized to S16 wire format.
    #[serde(skip)]
    pub path: String,
}

/// An AI agent. Stored as `<vault>/agents/<name>/agent.yml` plus a
/// sibling `compiled.mjs` holding the JS function body.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub model_params: serde_json::Value,
    #[serde(default)]
    pub tools: Vec<serde_json::Value>,
    #[serde(default)]
    pub input_schema: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<serde_json::Value>,
    #[serde(default)]
    pub skill_ids: Vec<String>,
    #[serde(default)]
    pub timeout: u32, // seconds; 0 = use platform default
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compiled_script: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compiled_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compilation_error: Option<String>,
    #[serde(default)]
    pub is_locked: bool,
    #[serde(default = "default_access_level")]
    pub access_level: String,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub created_by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    /// Vault-relative folder path. Internal bookkeeping.
    #[serde(skip)]
    pub path: String,
}

fn default_access_level() -> String { "admin".into() }
fn default_status() -> String { "active".into() }

/// A reusable instruction set ("skill") that can be attached to agents.
/// Stored as `<vault>/skills/<name>/SKILL.md` with frontmatter.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default = "default_skill_type")]
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default = "default_skill_version")]
    pub version: String,
    #[serde(default)]
    pub skill_md: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub is_public: bool,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default)]
    pub created_by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    #[serde(skip)]
    pub path: String,
}

fn default_skill_type() -> String { "general".into() }
fn default_skill_version() -> String { "1.0.0".into() }

/// A publishable mini-site. Stored at `<vault>/sites/<slug>/site.yml` plus
/// per-page subfolders.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Site {
    pub id: String,
    pub name: String,
    pub slug: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub is_published: bool,
    #[serde(default)]
    pub is_archived: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    /// Optional: pages list embedded when fetching via get_site.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pages: Vec<SitePageMeta>,
}

/// A page inside a site. Stored at
/// `<vault>/sites/<slug>/pages/<page-slug>/page.yml` + files.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SitePage {
    pub id: String,
    pub site_id: String,
    pub slug: String,
    pub title: String,
    #[serde(default)]
    pub is_home: bool,
    #[serde(default)]
    pub is_published: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub share_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub public_url: Option<String>,
    #[serde(default)]
    pub entry_path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_css: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_js: Option<String>,
    #[serde(default)]
    pub seo: Value,
    #[serde(default)]
    pub allowed_databases: Vec<String>,
    /// Files dictionary: { "/index.html": "...", "/styles.css": "..." }
    /// Only populated when get_site_page (full read) is called.
    #[serde(default, skip_serializing_if = "std::collections::BTreeMap::is_empty")]
    pub files: std::collections::BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// Slim page metadata, returned in `Site.pages`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SitePageMeta {
    pub id: String,
    pub slug: String,
    pub title: String,
    #[serde(default)]
    pub is_home: bool,
    #[serde(default)]
    pub is_published: bool,
    #[serde(default)]
    pub entry_path: String,
}

/// A reusable site component (workspace-scoped in OpenSpider).
/// Stored as JSON files under `<vault>/sites/_components/<id>.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SiteComponent {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub scope: String, // "workspace" in OpenSpider; system/public for parity
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub props_schema: Value,
    #[serde(default)]
    pub default_props: Value,
    #[serde(default)]
    pub tree: Value,
    #[serde(default)]
    pub code: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// A file uploaded for use in sites (logo, image, etc.).
/// Stored at `<vault>/sites/<slug>/assets/<filename>`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SiteAsset {
    pub id: String,
    pub site_id: String,
    pub name: String,
    pub url: String,
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// An agent trigger (cron / event / webhook / gmail / agent_change).
/// Stored as an array entry in `agents/<name>/triggers.yml`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Trigger {
    pub id: String,
    pub agent_id: String,
    /// One of: cron, event, webhook, gmail, agent_change
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub config: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// A workspace file. Stored at `<vault>/files/<id>` (raw bytes), with a
/// metadata sidecar at `<vault>/files/_metadata/<id>.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct File {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub size: u64,
    /// Either a local path (`file://<vault>/files/<id>`) or an external URL.
    pub url: String,
    #[serde(default)]
    pub kind: String, // "uploaded" | "url"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// A workspace credential (API key, OAuth token, bot token).
/// Stored as JSON inside `.openspider/credentials.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Credential {
    pub id: String,
    pub service: String,
    pub title: String,
    #[serde(default = "default_cred_status")]
    pub status: String,
    #[serde(default = "default_cred_connection_type")]
    pub connection_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account_identifier: Option<String>,
    /// Service-specific data (apiKey, accessToken, refreshToken, etc.)
    #[serde(default)]
    pub credentials: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

fn default_cred_status() -> String { "active".into() }
fn default_cred_connection_type() -> String { "manual".into() }

/// One execution of an agent. Persisted to `<vault>/.openspider/runs/<id>.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub agent_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    /// pending | running | success | failed | cancelled
    pub status: String,
    #[serde(default)]
    pub input_data: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub input_prompt: Option<String>,
    #[serde(default)]
    pub trigger_type: String,
    #[serde(default)]
    pub trigger_context: serde_json::Value,
    #[serde(default)]
    pub script_logs: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default)]
    pub tokens_used: u64,
    pub started_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(default)]
    pub created_at: String,
}

/// A page (database row). One markdown file per page under
/// `<vault>/databases/<DatabaseName>/<Title>.md` with YAML frontmatter
/// holding the property values.
///
/// Wire shape mirrors the S16 page response: `propertiesCache` is keyed by
/// property **ID** (not name), even though the on-disk frontmatter is keyed
/// by name for human readability.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub id: String,
    pub database_id: String,
    pub primary_title: String,
    /// Cell values keyed by property ID (UUID).
    #[serde(default)]
    pub properties_cache: serde_json::Map<String, Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated: Option<String>,
    #[serde(default)]
    pub is_archived: bool,
    #[serde(default)]
    pub is_public: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub share_id: Option<String>,
    /// Vault-relative path. Internal bookkeeping, not in S16 wire format.
    #[serde(skip)]
    pub path: String,
}
