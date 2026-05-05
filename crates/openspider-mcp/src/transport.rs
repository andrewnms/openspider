//! JSON-RPC 2.0 envelope + S16-style SSE single-event response.
//!
//! S16's MCP transport is "stateless SSE": every POST returns a `text/event-
//! stream` body that contains exactly one `message` event whose `data:` line
//! is the JSON-RPC reply. We mirror that exactly so bettersync's parser
//! (`src/client.mjs:parseSseSingle`) doesn't need to change.

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

impl JsonRpcResponse {
    pub fn ok(id: Value, result: Value) -> Self {
        Self { jsonrpc: "2.0", id, result: Some(result), error: None }
    }
    pub fn err(id: Value, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(JsonRpcError { code, message: message.into(), data: None }),
        }
    }
}

/// Wrap a JSON-RPC response as a single SSE `message` event so the response
/// body matches the S16 wire format byte-for-byte (modulo whitespace).
pub fn to_sse_single(resp: &JsonRpcResponse) -> String {
    let payload = serde_json::to_string(resp).unwrap_or_else(|_| "{}".into());
    format!("event: message\ndata: {payload}\n\n")
}

/// Wrap a tool's return value the way S16 does: `result.content = [{type:
/// "text", text: <stringified-json>}]`. bettersync's `client.call()`
/// auto-parses that text back into JSON.
pub fn wrap_tool_result(value: &Value) -> Value {
    serde_json::json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string(value).unwrap_or_else(|_| "null".into()),
        }],
    })
}
