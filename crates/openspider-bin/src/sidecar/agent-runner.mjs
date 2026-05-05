#!/usr/bin/env node
/**
 * openspider agent sidecar.
 *
 * Spawned by the Rust process as `node agent-runner.mjs <input.json>`.
 *
 * The input JSON contains:
 *   {
 *     "agent":          { id, name, compiledScript, model, systemPrompt, ... },
 *     "inputData":      {...},
 *     "inputPrompt":    null | string,
 *     "skills":         [{ id, name, displayName, content, source }, ...],
 *     "openspiderEndpoint": "http://127.0.0.1:7700/mcp",
 *     "openspiderToken":    "kb_localdev",
 *     "llm":            { baseUrl, apiKey, defaultModel } | null
 *   }
 *
 * On stdout: NDJSON events:
 *   {"type":"log","msg":"..."}
 *   {"type":"return","value":...}
 *   {"type":"error","msg":"...","stack":"..."}
 */
import { readFileSync } from 'node:fs'

const inputPath = process.argv[2]
if (!inputPath) { emitError('agent-runner: missing input path arg'); process.exit(2) }
let input
try { input = JSON.parse(readFileSync(inputPath, 'utf8')) }
catch (e) { emitError(`agent-runner: bad input json: ${e.message}`); process.exit(2) }

const { agent, inputData = {}, inputPrompt = null, skills = [], openspiderEndpoint, openspiderToken, llm } = input

if (!agent?.compiledScript) {
  emitError(`agent "${agent?.name || agent?.id}" has no compiledScript`)
  process.exit(2)
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

// ── MCP client (calls back to openspider) ────────────────────────────────────
let _rpcId = 0
async function mcpCall(toolName, args = {}) {
  const id = ++_rpcId
  const body = JSON.stringify({
    jsonrpc: '2.0', id, method: 'tools/call',
    params: { name: toolName, arguments: args },
  })
  const resp = await fetch(openspiderEndpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openspiderToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body,
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 500)}`)
  }
  const text = await resp.text()
  // Parse single SSE event: "event: message\ndata: <json>\n\n"
  const dataLine = text.split('\n').find(l => l.startsWith('data:'))
  if (!dataLine) throw new Error(`no SSE data in response: ${text.slice(0, 200)}`)
  const env = JSON.parse(dataLine.slice(5).trim())
  if (env.error) throw new Error(`MCP error: ${env.error.message || JSON.stringify(env.error)}`)
  const content = env.result?.content
  if (Array.isArray(content) && content.length === 1 && content[0].type === 'text') {
    try { return JSON.parse(content[0].text) }
    catch { return content[0].text }
  }
  return env.result
}

// ── LLM call (for s16.ai) ────────────────────────────────────────────────
async function llmChat({ model, messages, temperature = 0.7, maxTokens = 1024 }) {
  if (!llm?.baseUrl) throw new Error('s16.ai called but no LLM configured. Set llm.baseUrl/apiKey/defaultModel in .openspider/config.json.')
  const url = `${llm.baseUrl.replace(/\/$/, '')}/chat/completions`
  const headers = { 'Content-Type': 'application/json' }
  if (llm.apiKey) headers['Authorization'] = `Bearer ${llm.apiKey}`
  const body = JSON.stringify({
    model: model || llm.defaultModel,
    messages,
    temperature,
    max_tokens: maxTokens,
  })
  const resp = await fetch(url, { method: 'POST', headers, body })
  if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}: ${(await resp.text()).slice(0, 500)}`)
  const j = await resp.json()
  return j.choices?.[0]?.message?.content || ''
}

// ── s16 mock ─────────────────────────────────────────────────────────────
function emitLog(msg) {
  process.stdout.write(JSON.stringify({ type: 'log', msg: String(msg) }) + '\n')
}
function emitError(msg, stack) {
  process.stdout.write(JSON.stringify({ type: 'error', msg: String(msg), stack: stack || null }) + '\n')
}
function emitReturn(value) {
  process.stdout.write(JSON.stringify({ type: 'return', value }) + '\n')
}

const localStore = new Map()
const sharedStore = new Map()
const kv = (m) => ({
  get: async (k) => m.has(k) ? m.get(k) : null,
  set: async (k, v) => { m.set(k, v) },
  delete: async (k) => { m.delete(k) },
  list: async () => Array.from(m.keys()),
})

const s16 = {
  log: emitLog,
  ai: async (prompt, opts = {}) => llmChat({
    model: opts.model,
    messages: [{ role: 'user', content: prompt }],
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
  }),
  httpRequest: async (url, opts = {}) => {
    const headers = { ...(opts.headers || {}) }
    let body = opts.body
    if (body && typeof body === 'object' && !(body instanceof Buffer)) {
      body = JSON.stringify(body)
      if (!('Content-Type' in headers || 'content-type' in headers)) headers['Content-Type'] = 'application/json'
    }
    const r = await fetch(url, { method: opts.method || 'GET', headers, body })
    const ct = r.headers.get('content-type') || ''
    let respBody
    if (ct.includes('json')) { respBody = await r.json().catch(() => null) }
    else { respBody = await r.text() }
    const respHeaders = {}
    for (const [k, v] of r.headers.entries()) respHeaders[k] = v
    return { status: r.status, body: respBody, headers: respHeaders }
  },

  /* ── DB / pages / docs / etc., all routed to openspider MCP ────────────── */
  listDatabases: () => mcpCall('s16_list_databases'),
  getDatabaseSchema: (id) => mcpCall('s16_get_database', { databaseId: id }),
  readDatabase: (id, opts = {}) => mcpCall('s16_list_pages', { databaseId: id, ...opts }),
  getPage: (id) => mcpCall('s16_get_page', { pageId: id }),
  updateCell: (pageId, propertyId, value) => mcpCall('s16_update_cell', { pageId, propertyId, value }),
  createPage: (databaseId, title, opts = {}) =>
    mcpCall('s16_create_page', { databaseId, ...(title !== undefined ? { title } : {}), ...opts }),
  setPageContent: (pageId, content, contentFormat) =>
    mcpCall('s16_update_page_content', { pageId, content, ...(contentFormat ? { contentFormat } : {}) }),
  bulkUpdateCells: (pageId, databaseId, cells) =>
    mcpCall('s16_bulk_update_cells', { pageId, databaseId, cells }),
  deletePage: (pageId) => mcpCall('s16_delete_page', { pageId }),
  duplicatePage: (pageId) => mcpCall('s16_duplicate_page', { pageId }),
  listRelations: (pageId, propertyId) => mcpCall('s16_list_relations', { pageId, propertyId }),
  addRelation: (sp, tp, pid) => mcpCall('s16_add_relation', { sourcePageId: sp, targetPageId: tp, propertyId: pid }),
  removeRelation: (sp, tp, pid) => mcpCall('s16_remove_relation', { sourcePageId: sp, targetPageId: tp, propertyId: pid }),

  createDatabase: (input) => mcpCall('s16_create_database', input),
  updateDatabase: (databaseId, patch) => mcpCall('s16_update_database', { databaseId, ...patch }),
  deleteDatabase: (databaseId) => mcpCall('s16_delete_database', { databaseId }),
  createProperty: (input) => mcpCall('s16_create_property', input),
  updateProperty: (propertyId, patch) => mcpCall('s16_update_property', { propertyId, ...patch }),
  deleteProperty: (propertyId) => mcpCall('s16_delete_property', { propertyId }),

  searchWorkspace: (query, limit) =>
    mcpCall('s16_search_workspace', { query, ...(limit ? { limit } : {}) }),

  /* ── Credentials & secrets — local-only stubs in v0.4 ──────────────── */
  getCredential: async () => null,
  listCredentials: async () => [],
  listMcpTools: async () => [],
  callMcpTool: async () => { throw new Error('callMcpTool not implemented in OpenSpider') },
  getSecret: async () => null,

  /* ── KV stores — in-memory for this run only ──────────────────────── */
  store: kv(localStore),
  sharedStore: kv(sharedStore),

  /* ── Webhook respond (no-op) ──────────────────────────────────────── */
  respond: () => {},
  uploadFile: async () => { throw new Error('uploadFile not implemented in OpenSpider') },

  /* ── Docs ────────────────────────────────────────────────────────── */
  createDoc: (input) => mcpCall('s16_create_doc', input),
  updateDoc: (docId, patch) => mcpCall('s16_update_doc', { docId, ...patch }),
  setDocContent: (docId, content, contentFormat) =>
    mcpCall('s16_update_doc_content', { docId, content, ...(contentFormat ? { contentFormat } : {}) }),
  getDoc: (docId) => mcpCall('s16_get_doc', { docId }),
  listDocs: (opts = {}) => mcpCall('s16_list_docs', opts),
  deleteDoc: (docId) => mcpCall('s16_delete_doc', { docId }),

  /* ── Blocks (defer to v0.6) ─────────────────────────────────────── */
}

const context = {
  inputData,
  inputPrompt,
  skills,
  triggerType: 'manual',
  triggerContext: { runner: 'openspider', via: 'sidecar' },
}

try {
  const fn = new AsyncFunction('s16', 'context', agent.compiledScript)
  const value = await fn(s16, context)
  emitReturn(value)
} catch (err) {
  emitError(err.message || String(err), err.stack)
  process.exit(1)
}
