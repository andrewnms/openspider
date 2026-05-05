//! Tool registry — discoverable, schema-aware list of MCP tools.
//!
//! Each tool implements [`Tool`] and is registered via [`Registry::register`].
//! `tools/list` walks the registry; `tools/call` dispatches by name.
//!
//! For v0.1 we register every one of the 140 S16 tools as a stub (returns
//! "not yet implemented") so `bettersync mcp tools` returns the full surface
//! and clients can introspect schemas. Real implementations replace stubs
//! incrementally as we build out.

use crate::server::AppState;
use anyhow::Result;
use async_trait::async_trait;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;

#[async_trait]
pub trait Tool: Send + Sync {
    fn name(&self) -> &'static str;
    fn description(&self) -> &'static str;
    /// JSON Schema for the tool's input arguments.
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": {} })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value>;
}

#[derive(Default)]
pub struct Registry {
    tools: HashMap<&'static str, Arc<dyn Tool>>,
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, tool: Arc<dyn Tool>) {
        self.tools.insert(tool.name(), tool);
    }

    pub fn get(&self, name: &str) -> Option<&Arc<dyn Tool>> {
        self.tools.get(name)
    }

    /// Return the `tools/list` response shape.
    pub fn describe(&self) -> Value {
        let mut tools: Vec<Value> = self
            .tools
            .values()
            .map(|t| {
                json!({
                    "name": t.name(),
                    "description": t.description(),
                    "inputSchema": t.input_schema(),
                })
            })
            .collect();
        tools.sort_by(|a, b| {
            a.get("name").and_then(|v| v.as_str()).unwrap_or("")
                .cmp(b.get("name").and_then(|v| v.as_str()).unwrap_or(""))
        });
        json!({ "tools": tools })
    }
}
