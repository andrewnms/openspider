//! `s16_search_workspace` — naive workspace full-text search.
//!
//! Scans every page and doc body for case-insensitive substring match.
//! v0.3 uses in-memory scan; SQLite FTS5 cache lands later when perf matters.

use crate::registry::Tool;
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct SearchWorkspace;

#[async_trait]
impl Tool for SearchWorkspace {
    fn name(&self) -> &'static str { "s16_search_workspace" }
    fn description(&self) -> &'static str { "Full-text substring search across pages and docs." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": { "type": "string" },
                "limit": { "type": "integer" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let query = args.get("query").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("missing required string arg: query"))?;
        let limit = args.get("limit").and_then(|v| v.as_u64()).map(|n| n as usize).unwrap_or(50);
        let hits = state.vault.search_workspace(query, limit)?;
        Ok(json!({ "items": hits }))
    }
}
