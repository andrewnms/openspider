//! Flashcard / FSRS-style review tools.
//!
//! Cards are just docs with `flashcard: true` in their frontmatter. The
//! review state (due / interval / ease) lives alongside it — single source
//! of truth, no separate database. Listing due cards is a `scan_docs`
//! filter; reviewing one updates four frontmatter fields and writes back.

use anyhow::{anyhow, Result};
use async_trait::async_trait;
use serde_json::{json, Value};

use crate::AppState;
use crate::registry::Tool;

pub struct ListDueCards;
#[async_trait]
impl Tool for ListDueCards {
    fn name(&self) -> &'static str { "s16_list_due_cards" }
    fn description(&self) -> &'static str { "List flashcards due for review (card_due ≤ now or unset). Sorted oldest-due first." }
    fn input_schema(&self) -> Value { json!({ "type": "object", "properties": {} }) }
    async fn call(&self, state: &AppState, _args: Value) -> Result<Value> {
        let cards = state.vault.list_due_cards()?;
        Ok(serde_json::to_value(cards)?)
    }
}

pub struct ListAllCards;
#[async_trait]
impl Tool for ListAllCards {
    fn name(&self) -> &'static str { "s16_list_all_cards" }
    fn description(&self) -> &'static str { "List ALL flashcards regardless of due date. Useful for the cards index view." }
    fn input_schema(&self) -> Value { json!({ "type": "object", "properties": {} }) }
    async fn call(&self, state: &AppState, _args: Value) -> Result<Value> {
        let cards = state.vault.list_all_cards()?;
        Ok(serde_json::to_value(cards)?)
    }
}

pub struct SetDocFlashcard;
#[async_trait]
impl Tool for SetDocFlashcard {
    fn name(&self) -> &'static str { "s16_set_doc_flashcard" }
    fn description(&self) -> &'static str { "Toggle a doc's flashcard flag. true marks the doc as a card and queues it for review; false clears the SRS state." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["docId", "isCard"],
            "properties": {
                "docId":  { "type": "string" },
                "isCard": { "type": "boolean" }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = args.get("docId").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("missing docId"))?.to_string();
        let is_card = args.get("isCard").and_then(|v| v.as_bool()).unwrap_or(false);
        Ok(serde_json::to_value(state.vault.set_doc_flashcard(&id, is_card)?)?)
    }
}

pub struct ReviewCard;
#[async_trait]
impl Tool for ReviewCard {
    fn name(&self) -> &'static str { "s16_review_card" }
    fn description(&self) -> &'static str { "Apply an SM-2 review to a flashcard. rating ∈ 1..=4 (1=Again, 2=Hard, 3=Good, 4=Easy). Updates interval/ease/due and persists to frontmatter." }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "required": ["docId", "rating"],
            "properties": {
                "docId":  { "type": "string" },
                "rating": { "type": "integer", "minimum": 1, "maximum": 4 }
            }
        })
    }
    async fn call(&self, state: &AppState, args: Value) -> Result<Value> {
        let id = args.get("docId").and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("missing docId"))?.to_string();
        let rating = args.get("rating").and_then(|v| v.as_u64())
            .ok_or_else(|| anyhow!("missing rating"))? as u8;
        Ok(serde_json::to_value(state.vault.review_card(&id, rating)?)?)
    }
}
