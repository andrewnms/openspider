//! Skill tools — 7 in total. 4 real (list/create/update/delete), 4 stubs
//! for marketplace (lands in v0.8).

use crate::registry::Tool;
use crate::server::AppState;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use openspider_core::Skill;
use serde_json::{json, Value};

pub struct ListSkills;
#[async_trait]
impl Tool for ListSkills {
    fn name(&self) -> &'static str { "s16_list_skills" }
    fn description(&self) -> &'static str { "List skills in the workspace. Returns {own, installed}." }
    async fn call(&self, state: &AppState, _args: Value) -> Result<Value> {
        let own = state.vault.list_skills()?;
        Ok(json!({ "own": own, "installed": [] }))
    }
}

pub struct CreateSkill;
#[async_trait]
impl Tool for CreateSkill {
    fn name(&self) -> &'static str { "s16_create_skill" }
    fn description(&self) -> &'static str { "Create a new skill (SKILL.md with frontmatter)." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["name", "skillMd"],
            "properties": {
                "name":        { "type": "string" },
                "displayName": { "type": "string" },
                "description": { "type": "string" },
                "skillMd":     { "type": "string" },
                "tags":        { "type": "array", "items": { "type": "string" } },
                "type":        { "type": "string" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let mut s = Skill::default();
        s.name = sarg(&args, "name")?;
        s.display_name = args.get("displayName").and_then(|v| v.as_str()).map(String::from);
        s.description = args.get("description").and_then(|v| v.as_str()).map(String::from);
        s.skill_md = args.get("skillMd").and_then(|v| v.as_str()).map(String::from).unwrap_or_default();
        s.tags = args.get("tags").and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        s.kind = args.get("type").and_then(|v| v.as_str()).unwrap_or("general").to_string();
        Ok(serde_json::to_value(state.vault.create_skill(s)?)?)
    }
}

pub struct UpdateSkill;
#[async_trait]
impl Tool for UpdateSkill {
    fn name(&self) -> &'static str { "s16_update_skill" }
    fn description(&self) -> &'static str { "Update an existing skill." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["skillId"],
            "properties": {
                "skillId":     { "type": "string" },
                "displayName": { "type": "string" },
                "description": { "type": "string" },
                "skillMd":     { "type": "string" },
                "tags":        { "type": "array", "items": { "type": "string" } }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "skillId")?;
        let display_name = args.get("displayName").and_then(|v| v.as_str()).map(String::from);
        let description = args.get("description").and_then(|v| v.as_str()).map(String::from);
        let skill_md = args.get("skillMd").and_then(|v| v.as_str()).map(String::from);
        let tags = args.get("tags").and_then(|v| v.as_array()).map(|arr| {
            arr.iter().filter_map(|v| v.as_str().map(String::from)).collect()
        });
        Ok(serde_json::to_value(state.vault.update_skill(&id, display_name, description, skill_md, tags)?)?)
    }
}

pub struct DeleteSkill;
#[async_trait]
impl Tool for DeleteSkill {
    fn name(&self) -> &'static str { "s16_delete_skill" }
    fn description(&self) -> &'static str { "Delete a skill." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["skillId"], "properties": { "skillId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "skillId")?;
        state.vault.delete_skill(&id)?;
        Ok(json!({ "ok": true }))
    }
}

// Marketplace (v0.8): browse + install + uninstall are real, publish is a stub.
//
// The marketplace is a static JSON registry at KBRAIN_MARKETPLACE_URL (defaults
// to OpenSpider's bundled examples). The format matches what s16_marketplace_skills
// returns: { items: [{ id, name, displayName, description, skillMd, ... }] }.

const DEFAULT_MARKETPLACE_URL: &str = "https://raw.githubusercontent.com/kkodo/openspider/main/marketplace/skills.json";

pub struct MarketplaceSkills;
#[async_trait]
impl Tool for MarketplaceSkills {
    fn name(&self) -> &'static str { "s16_marketplace_skills" }
    fn description(&self) -> &'static str {
        "Browse public skills available in the marketplace. Source: KBRAIN_MARKETPLACE_URL or default."
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "search": { "type": "string" },
                "limit":  { "type": "integer" }
            }
        })
    }
    async fn call(&self, _state: &AppState, args: Value) -> Result<Value> {
        let url = std::env::var("KBRAIN_MARKETPLACE_URL").unwrap_or_else(|_| DEFAULT_MARKETPLACE_URL.into());
        let resp = match reqwest::get(&url).await {
            Ok(r) => r,
            Err(e) => return Ok(json!({
                "items": [], "note": format!("marketplace unreachable ({url}): {e}"),
            })),
        };
        if !resp.status().is_success() {
            return Ok(json!({
                "items": [], "note": format!("marketplace HTTP {} from {url}", resp.status()),
            }));
        }
        let json: Value = resp.json().await.unwrap_or(json!({ "items": [] }));
        let mut items = json.get("items").and_then(|v| v.as_array()).cloned().unwrap_or_default();
        if let Some(q) = args.get("search").and_then(|v| v.as_str()) {
            let ql = q.to_lowercase();
            items.retain(|s| {
                let hay = format!("{} {} {}",
                    s.get("name").and_then(|v| v.as_str()).unwrap_or(""),
                    s.get("displayName").and_then(|v| v.as_str()).unwrap_or(""),
                    s.get("description").and_then(|v| v.as_str()).unwrap_or(""),
                ).to_lowercase();
                hay.contains(&ql)
            });
        }
        let limit = args.get("limit").and_then(|v| v.as_u64()).map(|n| n as usize).unwrap_or(50);
        items.truncate(limit);
        Ok(json!({ "items": items, "source": url }))
    }
}

pub struct InstallSkill;
#[async_trait]
impl Tool for InstallSkill {
    fn name(&self) -> &'static str { "s16_install_skill" }
    fn description(&self) -> &'static str {
        "Install a marketplace skill into the workspace by id."
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["skillId"], "properties": { "skillId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "skillId")?;
        // Re-fetch the marketplace to find this skill.
        let url = std::env::var("KBRAIN_MARKETPLACE_URL").unwrap_or_else(|_| DEFAULT_MARKETPLACE_URL.into());
        let json: Value = reqwest::get(&url).await
            .map_err(|e| anyhow!("marketplace unreachable: {e}"))?
            .json().await.map_err(|e| anyhow!("marketplace bad JSON: {e}"))?;
        let items = json.get("items").and_then(|v| v.as_array())
            .ok_or_else(|| anyhow!("marketplace JSON has no items array"))?;
        let item = items.iter().find(|s| s.get("id").and_then(|v| v.as_str()) == Some(id.as_str()))
            .or_else(|| items.iter().find(|s| s.get("name").and_then(|v| v.as_str()) == Some(id.as_str())))
            .ok_or_else(|| anyhow!("no marketplace skill matching {id}"))?;
        let mut skill = openspider_core::Skill::default();
        skill.name = item.get("name").and_then(|v| v.as_str()).unwrap_or(&id).into();
        skill.display_name = item.get("displayName").and_then(|v| v.as_str()).map(String::from);
        skill.description = item.get("description").and_then(|v| v.as_str()).map(String::from);
        skill.skill_md = item.get("skillMd").and_then(|v| v.as_str()).unwrap_or("").into();
        skill.tags = item.get("tags").and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let created = state.vault.create_skill(skill)?;
        Ok(json!({ "ok": true, "skill": created }))
    }
}

pub struct UninstallSkill;
#[async_trait]
impl Tool for UninstallSkill {
    fn name(&self) -> &'static str { "s16_uninstall_skill" }
    fn description(&self) -> &'static str { "Remove an installed marketplace skill from the workspace." }
    fn input_schema(&self) -> Value {
        json!({ "type": "object", "required": ["skillId"], "properties": { "skillId": { "type": "string" } } })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = sarg(&args, "skillId")?;
        // Resolve by id or name (both work via vault.get_skill).
        let s = state.vault.get_skill(&id)?;
        state.vault.delete_skill(&s.id)?;
        Ok(json!({ "ok": true }))
    }
}

pub struct PublishSkill;
#[async_trait]
impl Tool for PublishSkill {
    fn name(&self) -> &'static str { "s16_publish_skill" }
    fn description(&self) -> &'static str {
        "Publish a workspace skill to the marketplace. Receiving end is out of scope for OpenSpider — open a PR to the marketplace repo with the skill JSON."
    }
    async fn call(&self, _state: &AppState, _args: Value) -> Result<Value> {
        Err(anyhow!(
            "OpenSpider doesn't host a marketplace endpoint. Submit your skill JSON via PR to the configured marketplace registry (default: github.com/kkodo/openspider marketplace/skills.json).",
        ))
    }
}

fn sarg(args: &Value, key: &str) -> Result<String> {
    args.get(key).and_then(|v| v.as_str()).map(String::from)
        .ok_or_else(|| anyhow!("missing required string arg: {key}"))
}
