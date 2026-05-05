# OpenSpider

A local-first, MCP-compatible Brain. Your data is plain markdown + YAML files
on disk. Your agents are JavaScript. Your AI calls go to whichever LLM you
configure. No paid gateway. No lock-in. Single binary or single .app.

```
spider init  ./my-vault
spider serve --vault ./my-vault
```

That's it. The MCP server is reachable at `http://127.0.0.1:7700/mcp`,
talking the same wire protocol as S16 Brain (single-event SSE over JSON-RPC).
Anything that speaks that protocol — bettersync, Claude Code's MCP integration,
your own scripts — works against it unchanged.

> Every node a spider. The whole network a web. Tangle yours into someone
> else's any time you want, untangle it just as easily.

## Hello world

### As a desktop app (recommended)

```bash
# Build the .app bundle
cd desktop && npm install && npm run tauri build
# Drop into /Applications
mv src-tauri/target/release/bundle/macos/OpenSpider.app /Applications/
# Launch
open -a OpenSpider
```

### As a CLI

```bash
# Build + install the spider binary
cargo install --path crates/openspider-bin

# Initialize a vault and start the server
spider init   ~/my-vault
spider serve  --vault ~/my-vault
```

### Drive it from a separate process

```bash
npm install -g @kkodo/bettersync@latest

bettersync auth login --token kb_localdev --endpoint http://127.0.0.1:7700/mcp
bettersync db create "Companies" --icon 🏢
bettersync page create $(bettersync db list --json | jq -r '.[0].id') --title "Acme Corp"

# Look at what's on disk
ls ~/Library/Application\ Support/OpenSpider/vault/databases/Companies/
# → _schema.yml  Acme Corp.md
```

Open `Acme Corp.md` in any text editor. Or Obsidian. Or VS Code. The data is
yours.

## What works (139 of 140 S16 MCP tools)

| Resource | Status |
|---|---|
| Databases (8) | ✅ Full CRUD |
| Properties (6) | ✅ Full CRUD + select options |
| Pages / rows (15) | ✅ Markdown frontmatter round-trip |
| Relations (4) | ✅ Two-way relations + backfill |
| Docs (17) | ✅ Hierarchy + trash + backlinks |
| Search (1) | ✅ Substring scan (FTS5 cache later) |
| Agents (10) | ✅ Compiled JS in Node sidecar |
| Runs (4) | ✅ History + await |
| Skills (7) | ✅ CRUD + marketplace install |
| Triggers (2) | ✅ Cron fires; webhook receiver mounted |
| Files (4) | ✅ Local file storage |
| Credentials (8) | ✅ Manual + OAuth flows |
| Secrets (3) | ✅ Plain JSON store |
| Sites (25) | ✅ Per-page virtual file system |
| Templates (7) | ✅ {{variable}} substitution |
| Views (5) | ✅ table/board/gallery/calendar/list |
| Blocks (4) | ✅ Paragraph-level CRUD |
| Public-share reads (5) | ✅ Lookup by shareId |
| Remote MCP (2) | ✅ Proxies through credential |
| Reference (1) | guide stubbed |
| Waitlist (3) | ⚠️ Single-tenant; no waitlist concept |

The lone deliberate stub: **`s16_publish_skill`**. OpenSpider doesn't host a
marketplace endpoint. Submit your skill via PR to the configured marketplace
registry instead.

## How it works

```
   bettersync ──→ OpenSpider MCP (Rust, axum on :7700)
                       ├─ POST /mcp                  (JSON-RPC, 140 tools)
                       ├─ POST /webhook/:agentId     (fires agent)
                       ├─ GET  /oauth/callback       (OAuth code exchange)
                       │
                       ├─ vault/  (markdown + YAML on disk)
                       │   ├─ databases/<name>/_schema.yml + <Page>.md
                       │   ├─ docs/<title>.md
                       │   ├─ agents/<name>/agent.yml + compiled.mjs
                       │   ├─ skills/<name>/SKILL.md
                       │   ├─ sites/<slug>/pages/<page>/...
                       │   ├─ files/...
                       │   └─ .openspider/  (config, credentials, runs, sidecar)
                       │
                       └─ scheduler (tokio task) — fires cron triggers
                       └─ runner — spawns Node sidecar per agent run
```

The vault is the source of truth. There's no DB to migrate, no cache to rebuild,
no proprietary format. `tar -czf vault.tgz vault/` is your full export.

## Configuration

### LLM (for agents that call `s16.ai`)

Edit `<vault>/.openspider/config.json`:

```json
{
  "workspace_id": "...",
  "llm": {
    "baseUrl": "https://api.groq.com/openai/v1",
    "apiKey": "gsk_...",
    "defaultModel": "llama-3.3-70b-versatile"
  }
}
```

Any OpenAI-compatible endpoint works (Groq, OpenRouter, OpenAI, Together,
Fireworks, local Ollama).

### OAuth providers (for `s16_start_credential_oauth`)

Drop a `<vault>/.openspider/oauth-providers.json`:

```json
{
  "github": {
    "clientId": "Iv1.your-app",
    "clientSecret": "...",
    "authUrl": "https://github.com/login/oauth/authorize",
    "tokenUrl": "https://github.com/login/oauth/access_token",
    "scope": "read:user repo"
  }
}
```

The callback URL is `http://<addr>/oauth/callback`.

### Marketplace registry

Set `KBRAIN_MARKETPLACE_URL=https://your-registry/skills.json` to point at
your own registry. Default registry is in this repo at
`marketplace/skills.json`.

## Migrating from kbrain

OpenSpider was developed under the working name **kbrain** through v1.0. The
on-disk layout is identical except the hidden config dir was renamed
`.kbrain/` → `.openspider/`.

```bash
# 1. Move the vault to the new default path
mv ~/Library/Application\ Support/kbrain/vault \
   ~/Library/Application\ Support/OpenSpider/vault

# 2. Rename the config dir inside the vault
cd ~/Library/Application\ Support/OpenSpider/vault
mv .kbrain .openspider
```

The `bettersync brain ...` command alias still works (it dispatches to the
same handlers as `bettersync spider ...`) so existing scripts don't break.

## Why

S16 Brain is great. Compiled agents that mostly run for free, MCP everywhere,
Notion-shaped data model. But you're locked into one runtime, one hosted
service, one place where your data lives. OpenSpider is that runtime, but
local, single-binary, and your data is markdown files you can read and edit
with any tool you already have.

The interface (the MCP wire protocol) is the contract. The implementation
underneath is a swappable detail. Anything that talks the same MCP works
against either backend, no client code changes.

## Status

Pre-release. v1.0 means "139 of 140 tools work and we trust them with our
own data." Not stable in the sense of "no breaking changes coming." Use it,
but pin a commit and read the changelog.

## License

MIT.
