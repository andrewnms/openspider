//! Auto-generated stubs from the S16 tools/list dump. Every tool returns
//! `not_implemented` when called but `tools/list` includes the full surface
//! with real descriptions + input schemas. This means clients can introspect
//! the API while we incrementally replace stubs with real implementations.

use crate::registry::{Registry, Tool};
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;

#[derive(Debug, Deserialize)]
struct ToolMeta {
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default, rename = "inputSchema")]
    input_schema: Value,
}

struct Stub {
    name: &'static str,
    description: &'static str,
    input_schema: Value,
}

#[async_trait]
impl Tool for Stub {
    fn name(&self) -> &'static str { self.name }
    fn description(&self) -> &'static str { self.description }
    fn input_schema(&self) -> Value { self.input_schema.clone() }
    async fn call(&self, _state: &AppState, _args: Value) -> Result<Value> {
        Err(anyhow!(
            "{}: not yet implemented in OpenSpider — try a later version or use bettersync against S16",
            self.name
        ))
    }
}

pub fn register_all(reg: &mut Registry, catalog_json: &str) -> Result<()> {
    let tools: Vec<ToolMeta> = serde_json::from_str(catalog_json)?;
    for t in tools {
        // Box::leak gives us a 'static str for the trait. We do this once per
        // tool at startup so total leak = 140 strings = trivial.
        let name: &'static str = Box::leak(t.name.into_boxed_str());
        let description: &'static str = Box::leak(t.description.into_boxed_str());
        reg.register(Arc::new(Stub {
            name,
            description,
            input_schema: t.input_schema,
        }));
    }
    Ok(())
}
