//! axum HTTP server. Single endpoint: `POST /mcp` (with `GET /` for health).

use crate::oauth::{self, SessionStore};
use crate::registry::Registry;
use crate::scheduler;
use crate::transport::{to_sse_single, wrap_tool_result, JsonRpcRequest, JsonRpcResponse};
use axum::{
    extract::{Path, Query, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use std::collections::HashMap;
use openspider_core::Vault;
use serde_json::Value;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tracing::{error, info};

#[derive(Clone)]
pub struct AppState {
    pub vault: Arc<Vault>,
    pub registry: Arc<Registry>,
    /// Endpoint the sidecar should call back to for s16.* MCP operations.
    pub self_endpoint: String,
    /// Token the sidecar should present (OpenSpider doesn't enforce; future versions will).
    pub self_token: String,
    /// In-memory OAuth session store. Pending sessions live here until the
    /// callback completes them.
    pub oauth_sessions: SessionStore,
}

pub async fn serve(state: AppState, addr: &str) -> anyhow::Result<()> {
    // Spawn the cron scheduler. Single background task; checks every 20s.
    scheduler::spawn(
        state.vault.clone(),
        state.self_endpoint.clone(),
        state.self_token.clone(),
    );

    // Local-only desktop server: allow any origin so the Tauri WKWebView
    // (origin `tauri://localhost`) can POST to it. Without this the browser
    // CORS preflight blocks every request silently.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/", get(root))
        .route("/mcp", post(handle_mcp))
        .route("/webhook/:agent_id", post(handle_webhook))
        .route("/oauth/callback", get(handle_oauth_callback))
        .layer(cors)
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    info!("openspider MCP listening on http://{addr}/mcp");
    info!("openspider webhooks on    http://{addr}/webhook/{{agentId}}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn handle_oauth_callback(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let state_id = match params.get("state") {
        Some(s) => s.clone(),
        None => return (StatusCode::BAD_REQUEST, "missing state").into_response(),
    };
    let code = match params.get("code") {
        Some(c) => c.clone(),
        None => return (StatusCode::BAD_REQUEST, "missing code").into_response(),
    };
    match oauth::handle_callback(
        &state.vault, &state.oauth_sessions, &state.self_endpoint, &state_id, &code,
    ).await {
        Ok(s) => (StatusCode::OK, format!(
            "<h1>Connected!</h1><p>Service: {}</p><p>You can close this tab.</p>",
            s.service,
        )).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, format!("OAuth callback failed: {e}")).into_response(),
    }
}

async fn handle_webhook(
    Path(agent_id): Path<String>,
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Response {
    match scheduler::handle_webhook(
        &state.vault, &agent_id, body, &state.self_endpoint, &state.self_token,
    ).await {
        Ok(run) => (StatusCode::OK, Json(run)).into_response(),
        Err(e) => (StatusCode::BAD_REQUEST, format!("error: {e}")).into_response(),
    }
}

async fn root() -> &'static str {
    "openspider — MCP server (POST /mcp)\n"
}

async fn handle_mcp(
    State(state): State<AppState>,
    Json(req): Json<JsonRpcRequest>,
) -> Response {
    let resp = dispatch(&state, req).await;
    let body = to_sse_single(&resp);
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/event-stream")],
        body,
    )
        .into_response()
}

async fn dispatch(state: &AppState, req: JsonRpcRequest) -> JsonRpcResponse {
    let id = req.id.clone();
    match req.method.as_str() {
        "tools/list" => JsonRpcResponse::ok(id, state.registry.describe()),
        "tools/call" => {
            let name = req.params.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let args = req.params.get("arguments").cloned().unwrap_or(Value::Null);
            let Some(tool) = state.registry.get(name) else {
                return JsonRpcResponse::err(id, -32601, format!("unknown tool: {name}"));
            };
            match tool.call(state, args).await {
                Ok(value) => JsonRpcResponse::ok(id, wrap_tool_result(&value)),
                Err(e) => {
                    error!("tool {name} failed: {e:#}");
                    JsonRpcResponse::err(id, -32000, format!("{e:#}"))
                }
            }
        }
        other => JsonRpcResponse::err(id, -32601, format!("unsupported method: {other}")),
    }
}
