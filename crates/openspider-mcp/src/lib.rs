//! openspider-mcp — MCP-over-HTTP server.
//!
//! Single endpoint: `POST /mcp` accepts JSON-RPC 2.0 envelopes and returns
//! `text/event-stream` responses (one `message` event per call). This matches
//! the S16 transport so existing clients (bettersync, the s16-mcp-api skill,
//! Claude Code's MCP integration) work unchanged.

pub mod oauth;
pub mod registry;
pub mod runner;
pub mod scheduler;
pub mod server;
pub mod tools;
pub mod transport;

pub use server::{serve, AppState};
