//! Secret tools — 3 in total. Stored as JSON map at .openspider/secrets.json.
//! Plain-text in v0.5; encryption with chacha20poly1305 lands in v0.5.1+.

use crate::registry::Tool;
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct SetSecret;
#[async_trait]
impl Tool for SetSecret {
    fn name(&self) -> &'static str { "s16_set_secret" }
    fn description(&self) -> &'static str { "Store an encrypted secret. Overwrites if key exists." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["key", "value"],
            "properties": {
                "key":   { "type": "string" },
                "value": { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let key = sarg(&args, "key")?;
        let value = sarg(&args, "value")?;
        state.vault.set_secret(&key, &value)?;
        Ok(json!({ "ok": true, "key": key }))
    }
}

pub struct ListSecrets;
#[async_trait]
impl Tool for ListSecrets {
    fn name(&self) -> &'static str { "s16_list_secrets" }
    fn description(&self) -> &'static str { "List all secret keys (values not returned)." }
    async fn call(&self, state: &AppState, _args: Value) -> Result<Value> {
        let keys = state.vault.list_secret_keys()?;
        Ok(json!({ "keys": keys }))
    }
}

pub struct DeleteSecret;
#[async_trait]
impl Tool for DeleteSecret {
    fn name(&self) -> &'static str { "s16_delete_secret" }
    fn description(&self) -> &'static str { "Delete a secret by key." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["key"], "properties": { "key": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let key = sarg(&args, "key")?;
        state.vault.delete_secret(&key)?;
        Ok(json!({ "ok": true }))
    }
}

fn sarg(args: &Value, key: &str) -> Result<String> {
    args.get(key).and_then(|v| v.as_str()).map(String::from)
        .ok_or_else(|| anyhow!("missing required string arg: {key}"))
}
