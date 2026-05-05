//! Minimal OAuth 2.0 authorization-code flow for credentials.
//!
//! v0.8 design: providers are configured in `<vault>/.openspider/oauth-providers.json`.
//! Each entry: `{ "google": { "clientId": "...", "clientSecret": "...",
//! "authUrl": "https://...", "tokenUrl": "https://...", "scope": "..." }, ... }`.
//!
//! `s16_start_credential_oauth` builds the authorize URL, returns it + a
//! sessionId. The user opens the URL in a browser, consents, and is
//! redirected to `http://<bind>/oauth/callback?code=...&state=<sessionId>`,
//! which the axum route handles. We exchange the code for a token, store
//! the result as a credential, and mark the session "completed".
//!
//! `s16_get_credential_auth_session` polls the in-memory session map.

use anyhow::{anyhow, Context, Result};
use openspider_core::Vault;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub client_id: String,
    pub client_secret: String,
    pub auth_url: String,
    pub token_url: String,
    #[serde(default)]
    pub scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub id: String,
    pub service: String,
    /// pending | completed | failed
    pub status: String,
    pub authorization_url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credential_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at: String,
}

/// Shared state for active OAuth sessions. Cleared on process restart.
pub type SessionStore = Arc<Mutex<HashMap<String, AuthSession>>>;

pub fn new_session_store() -> SessionStore {
    Arc::new(Mutex::new(HashMap::new()))
}

fn read_providers(vault: &Vault) -> Result<HashMap<String, ProviderConfig>> {
    let path = vault.root.join(".openspider/oauth-providers.json");
    if !path.exists() { return Ok(HashMap::new()); }
    let raw = fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

pub fn start(
    vault: &Vault,
    sessions: &SessionStore,
    self_endpoint: &str,
    service: &str,
) -> Result<AuthSession> {
    let providers = read_providers(vault)?;
    let provider = providers.get(service)
        .ok_or_else(|| anyhow!(
            "no OAuth config for service \"{service}\". Add it to {}/oauth-providers.json with clientId/clientSecret/authUrl/tokenUrl/scope.",
            vault.root.join(".openspider").display()
        ))?;
    let session_id = Uuid::new_v4().to_string();
    let base = self_endpoint.trim_end_matches("/mcp");
    let redirect_uri = format!("{base}/oauth/callback");
    let auth_url = format!(
        "{}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}",
        provider.auth_url,
        urlencoded(&provider.client_id),
        urlencoded(&redirect_uri),
        urlencoded(&provider.scope),
        urlencoded(&session_id),
    );
    let session = AuthSession {
        id: session_id.clone(),
        service: service.to_string(),
        status: "pending".into(),
        authorization_url: auth_url,
        credential_id: None,
        error: None,
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    sessions.lock().unwrap().insert(session_id, session.clone());
    Ok(session)
}

pub fn get(sessions: &SessionStore, session_id: &str) -> Result<AuthSession> {
    sessions.lock().unwrap().get(session_id).cloned()
        .ok_or_else(|| anyhow!("no OAuth session with id {session_id}"))
}

/// Handle `/oauth/callback?code=...&state=<sessionId>`. Exchanges code for
/// tokens, stores credential, updates session.
pub async fn handle_callback(
    vault: &Vault,
    sessions: &SessionStore,
    self_endpoint: &str,
    state_id: &str,
    code: &str,
) -> Result<AuthSession> {
    let mut session = get(sessions, state_id)?;
    let providers = read_providers(vault)?;
    let provider = providers.get(&session.service)
        .ok_or_else(|| anyhow!("OAuth config missing for {}", session.service))?
        .clone();

    let base = self_endpoint.trim_end_matches("/mcp");
    let redirect_uri = format!("{base}/oauth/callback");
    let body = [
        ("grant_type", "authorization_code"),
        ("code", code),
        ("client_id", provider.client_id.as_str()),
        ("client_secret", provider.client_secret.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
    ];
    let client = reqwest::Client::new();
    let resp = client.post(&provider.token_url)
        .header("Accept", "application/json")
        .form(&body)
        .send().await
        .with_context(|| format!("POST {}", provider.token_url))?;

    if !resp.status().is_success() {
        let s = resp.status();
        let text = resp.text().await.unwrap_or_default();
        let err = format!("token exchange HTTP {s}: {}", text.chars().take(300).collect::<String>());
        session.status = "failed".into();
        session.error = Some(err.clone());
        sessions.lock().unwrap().insert(state_id.to_string(), session.clone());
        return Err(anyhow!("{err}"));
    }

    let token_payload: serde_json::Value = resp.json().await
        .map_err(|e| anyhow!("token response not JSON: {e}"))?;

    // Store the whole token payload as a credential.
    let cred = vault.create_credential(
        &session.service,
        &format!("{} (OAuth)", session.service),
        json!({
            "accessToken":  token_payload.get("access_token"),
            "refreshToken": token_payload.get("refresh_token"),
            "tokenType":    token_payload.get("token_type"),
            "expiresIn":    token_payload.get("expires_in"),
            "scope":        token_payload.get("scope"),
            "idToken":      token_payload.get("id_token"),
        }),
    )?;
    session.status = "completed".into();
    session.credential_id = Some(cred.id);
    sessions.lock().unwrap().insert(state_id.to_string(), session.clone());
    Ok(session)
}

fn urlencoded(s: &str) -> String {
    // Minimal percent-encoding; enough for the few special chars in OAuth URLs.
    s.bytes().flat_map(|b| {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            vec![b]
        } else {
            format!("%{b:02X}").into_bytes()
        }
    }).map(|b| b as char).collect()
}
