//! openspider-core — vault data model + filesystem I/O + SQLite cache.
//!
//! The vault is the source of truth (markdown + YAML frontmatter on disk).
//! The cache is rebuildable from a vault scan, so cache corruption is never
//! fatal — `brain reindex` regenerates it.

pub mod model;
pub mod vault;

pub use model::{
    Agent, Credential, Database, Doc, File, Page, Property, Run, Site, SiteAsset, SiteComponent,
    SitePage, SitePageMeta, Skill, TemplateStub, Trigger, View,
};
pub use vault::{
    AgentPatch, DatabasePatch, DocPatch, ListDocsOpts, ListPagesOpts, LlmConfig, PagePatch,
    PropertyPatch, Vault, WorkspaceConfig,
};
