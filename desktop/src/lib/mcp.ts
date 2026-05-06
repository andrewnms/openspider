/**
 * MCP client for openspider. Talks JSON-RPC over POST, parses single-event SSE
 * responses (the same format openspider's axum server emits to match S16's wire
 * shape).
 *
 * In Tauri builds the endpoint comes from a Tauri command; in the browser it
 * defaults to localhost:7700 so the same code runs against a remote openspider.
 */
import { invoke } from '@tauri-apps/api/core'

let _id = 0
let _endpoint: string | null = null
let _token: string = 'kb_localdev'

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export async function getEndpoint(): Promise<string> {
  if (_endpoint) return _endpoint
  if (isTauri) {
    try { _endpoint = await invoke<string>('get_mcp_endpoint') }
    catch { _endpoint = 'http://127.0.0.1:7700/mcp' }
  } else {
    _endpoint = 'http://127.0.0.1:7700/mcp'
  }
  return _endpoint!
}

export function setEndpoint(url: string, token = 'kb_localdev') {
  _endpoint = url
  _token = token
}

/** Raw JSON-RPC call. Throws on protocol errors. */
async function rpc<T = unknown>(method: string, params: unknown = {}): Promise<T> {
  const endpoint = await getEndpoint()
  const id = ++_id
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 400)}`)
  const text = await resp.text()
  const dataLine = text.split('\n').find((l) => l.startsWith('data:'))
  if (!dataLine) throw new Error(`no SSE data line in response: ${text.slice(0, 200)}`)
  const env = JSON.parse(dataLine.slice(5).trim())
  if (env.error) throw new Error(`MCP error: ${env.error.message ?? JSON.stringify(env.error)}`)
  return env.result as T
}

/** Call a tool by name, unwrap openspider's `result.content[0].text` (parsed JSON). */
export async function call<T = unknown>(toolName: string, args: Record<string, unknown> = {}): Promise<T> {
  type Wrapped = { content?: Array<{ type: string; text: string }> }
  const result = await rpc<Wrapped>('tools/call', { name: toolName, arguments: args })
  const c = result?.content
  if (Array.isArray(c) && c.length === 1 && c[0].type === 'text') {
    try { return JSON.parse(c[0].text) as T }
    catch { return c[0].text as unknown as T }
  }
  return result as unknown as T
}

/** Surface every tool the server exposes. */
export async function listTools(): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
  type R = { tools: Array<{ name: string; description: string; inputSchema: unknown }> }
  const r = await rpc<R>('tools/list')
  return r.tools
}

// ─────────────────────────── Typed wrappers ───────────────────────────────

export type Database = {
  id: string
  name: string
  icon?: string
  description?: string
  isPrivate?: boolean
  defaultTemplateId?: string | null
  properties?: Property[]
  views?: View[]
}
export type Property = {
  id: string; databaseId?: string; name: string; type: string; config?: unknown
  position?: number; isPrimary?: boolean; inversePropertyId?: string | null
}
export type View = {
  id: string; databaseId?: string; name: string; type: string
  filters?: unknown; sorts?: unknown; groupBy?: string | null
  visibleProperties?: string[]; config?: unknown; position?: number
}
export type Page = {
  id: string; databaseId: string; primaryTitle: string
  propertiesCache?: Record<string, unknown>
  created?: string; updated?: string
  isArchived?: boolean; isPublic?: boolean; shareId?: string | null
}
export type Doc = {
  id: string; title: string; icon?: string; parentId?: string | null
  /** Sibling-order key. Lower = earlier. Undefined = falls back to alphabetical
   *  at the end of the ordered set. Set via drag-drop / "Create above/below". */
  position?: number | null
  /** Flashcard / SRS state. Only present when the doc has been marked as a card. */
  flashcard?: boolean
  cardDue?: string         // ISO-8601 next review timestamp
  cardInterval?: number    // days until next review
  cardEase?: number        // SM-2 ease factor
  isArchived?: boolean; isPublic?: boolean; shareId?: string | null
  createdAt?: string; updatedAt?: string
}
export type Agent = {
  id: string; name: string; description?: string; model?: string
  systemPrompt?: string; tools?: unknown[]; skillIds?: string[]
  inputSchema?: unknown; outputSchema?: unknown
  compiledScript?: string; compiledAt?: string | null
  status?: string; createdAt?: string; updatedAt?: string
}
export type Skill = {
  id: string; name: string; displayName?: string; description?: string
  type?: string; version?: string; skillMd?: string; tags?: string[]
  isPublic?: boolean; createdAt?: string; updatedAt?: string
}
export type Run = {
  id: string; agentId: string; agentName?: string; status: string
  inputData?: unknown; output?: string | null; error?: string | null
  scriptLogs?: string[]; tokensUsed?: number
  startedAt: string; finishedAt?: string | null
}
export type Trigger = {
  id: string; agentId: string; type: string; config?: unknown; createdAt?: string
}
export type Site = {
  id: string; name: string; slug: string; icon?: string
  isPublished?: boolean; pages?: Array<{ id: string; slug: string; title: string; isHome?: boolean; isPublished?: boolean }>
}

export const k = {
  // databases
  listDatabases: () => call<Database[]>('s16_list_databases'),
  getDatabase:   (id: string) => call<Database>('s16_get_database', { databaseId: id }),
  createDatabase: (name: string, icon?: string, description?: string) =>
    call<Database>('s16_create_database', { name, ...(icon ? { icon } : {}), ...(description ? { description } : {}) }),
  updateDatabase: (id: string, patch: Record<string, unknown>) =>
    call<Database>('s16_update_database', { databaseId: id, ...patch }),
  deleteDatabase: (id: string) => call<{ ok: true }>('s16_delete_database', { databaseId: id }),

  // properties
  createProperty: (databaseId: string, name: string, type: string, config?: unknown) =>
    call<Property>('s16_create_property', { databaseId, name, type, ...(config ? { config } : {}) }),
  updateProperty: (id: string, patch: Record<string, unknown>) =>
    call<Property>('s16_update_property', { propertyId: id, ...patch }),
  deleteProperty: (id: string) => call<{ ok: true }>('s16_delete_property', { propertyId: id }),

  // pages
  listPages: (databaseId: string, opts: { limit?: number; search?: string } = {}) =>
    call<{ items: Page[] }>('s16_list_pages', { databaseId, ...opts }),
  getPage: (id: string) => call<Page>('s16_get_page', { pageId: id }),
  getPageContent: (id: string) => call<string>('s16_get_page_content', { pageId: id }),
  createPage: (databaseId: string, title?: string, properties?: Record<string, unknown>, content?: string) =>
    call<Page>('s16_create_page', { databaseId, ...(title ? { title } : {}), ...(properties ? { properties } : {}), ...(content ? { content, contentFormat: 'markdown' } : {}) }),
  updatePage: (id: string, patch: { properties?: Record<string, unknown>; content?: string }) =>
    call<Page>('s16_update_page', { pageId: id, ...patch, ...(patch.content ? { contentFormat: 'markdown' } : {}) }),
  updatePageContent: (id: string, content: string) =>
    call<{ ok: true }>('s16_update_page_content', { pageId: id, content, contentFormat: 'markdown' }),
  deletePage: (id: string) => call<{ ok: true }>('s16_delete_page', { pageId: id }),
  archivePage: (id: string) => call<{ ok: true }>('s16_archive_page', { pageId: id }),
  bulkUpdateCells: (pageId: string, databaseId: string, cells: Record<string, unknown>) =>
    call<{ ok: true }>('s16_bulk_update_cells', { pageId, databaseId, cells }),

  // docs
  listDocs: (parentId?: string | null) =>
    call<Doc[]>('s16_list_docs', parentId ? { parentId } : {}),
  listAllDocs: () => call<Doc[]>('s16_list_all_docs'),
  getDoc: (id: string) => call<Doc>('s16_get_doc', { docId: id }),
  getDocContent: (id: string) => call<string>('s16_get_doc_content', { docId: id }),
  createDoc: (title: string, opts: { icon?: string; parentId?: string; content?: string } = {}) =>
    call<Doc>('s16_create_doc', { title, ...opts, ...(opts.content ? { contentFormat: 'markdown' } : {}) }),
  updateDoc: (id: string, patch: { title?: string; icon?: string; content?: string }) =>
    call<Doc>('s16_update_doc', { docId: id, ...patch, ...(patch.content ? { contentFormat: 'markdown' } : {}) }),
  updateDocContent: (id: string, content: string) =>
    call<{ ok: true }>('s16_update_doc_content', { docId: id, content, contentFormat: 'markdown' }),
  deleteDoc: (id: string) => call<{ ok: true }>('s16_delete_doc', { docId: id }),
  duplicateDoc: (id: string) => call<Doc>('s16_duplicate_doc', { docId: id }),
  // History — auto-snapshots + restore. Snapshot is captured server-side
  // when content changes and the most recent snapshot is older than 60s.
  listDocHistory:    (id: string) =>
    call<{ items: string[] }>('s16_list_doc_history', { docId: id }),
  getDocSnapshot:    (id: string, timestamp: string) =>
    call<{ content: string }>('s16_get_doc_snapshot', { docId: id, timestamp }),
  restoreDocSnapshot:(id: string, timestamp: string) =>
    call<Doc>('s16_restore_doc_snapshot', { docId: id, timestamp }),

  // Flashcards / SRS — cards are docs with `flashcard: true` in frontmatter.
  listDueCards: () => call<Doc[]>('s16_list_due_cards'),
  listAllCards: () => call<Doc[]>('s16_list_all_cards'),
  setDocFlashcard: (id: string, isCard: boolean) =>
    call<Doc>('s16_set_doc_flashcard', { docId: id, isCard }),
  reviewCard: (id: string, rating: 1 | 2 | 3 | 4) =>
    call<Doc>('s16_review_card', { docId: id, rating }),
  moveDoc: (id: string, newParentId: string | null, position?: number | null) =>
    call<Doc>('s16_move_doc', {
      docId: id, newParentId,
      // Only forward `position` when caller specified one. Undefined leaves
      // the existing key untouched on the backend; null clears it back to
      // alphabetical-fallback ordering.
      ...(position === undefined ? {} : { position }),
    }),

  // agents + runs
  listAgents: () => call<Agent[]>('s16_list_agents'),
  getAgent:   (id: string) => call<Agent>('s16_get_agent', { agentId: id }),
  createAgent: (input: Partial<Agent> & { name: string }) => call<Agent>('s16_create_agent', input),
  updateAgent: (id: string, patch: Partial<Agent>) => call<Agent>('s16_update_agent', { agentId: id, ...patch }),
  deleteAgent: (id: string) => call<{ ok: true }>('s16_delete_agent', { agentId: id }),
  runAgent:    (id: string, inputData: Record<string, unknown> = {}) =>
    call<Run>('s16_run_agent', { agentId: id, inputData }),
  listRuns:    (agentId?: string, limit = 20) => call<Run[]>('s16_list_runs', { ...(agentId ? { agentId } : {}), limit }),

  // skills
  listSkills:  () => call<{ own: Skill[]; installed: Skill[] }>('s16_list_skills'),
  createSkill: (input: { name: string; displayName?: string; description?: string; skillMd: string; tags?: string[] }) =>
    call<Skill>('s16_create_skill', input),
  updateSkill: (id: string, patch: Partial<Skill>) => call<Skill>('s16_update_skill', { skillId: id, ...patch }),
  deleteSkill: (id: string) => call<{ ok: true }>('s16_delete_skill', { skillId: id }),

  // triggers
  setTrigger:   (agentId: string, type: string, config: Record<string, unknown>) =>
    call<Trigger>('s16_set_trigger', { agentId, type, config }),
  deleteTrigger:(triggerId: string) => call<{ ok: true }>('s16_delete_trigger', { triggerId }),

  // sites
  listSites: () => call<Site[]>('s16_list_sites'),
  getSite:   (id: string) => call<Site>('s16_get_site', { siteId: id }),
  createSite:(name: string, slug?: string, icon?: string) =>
    call<Site>('s16_create_site', { name, ...(slug ? { slug } : {}), ...(icon ? { icon } : {}) }),
  listSitePages: (siteId: string) =>
    call<Array<{ id: string; siteId: string; slug: string; title: string; isHome?: boolean; isPublished?: boolean; entryPath?: string }>>('s16_list_site_pages', { siteId }),
  createSitePage: (siteId: string, slug: string, title: string, isHome = false) =>
    call<{ id: string; slug: string; title: string }>('s16_create_site_page', { siteId, slug, title, isHome }),
  publishSitePage: (pageId: string, isPublished: boolean) =>
    call<{ isPublished: boolean; publicUrl?: string; shareId?: string }>('s16_publish_site_page', { pageId, isPublished }),
  listSitePageFiles: (pageId: string) =>
    call<{ paths: string[]; entryPath: string; filesVersion: string }>('s16_list_site_page_files', { pageId }),
  readSitePageFile: (pageId: string, path: string) =>
    call<{ path: string; content: string }>('s16_read_site_page_file', { pageId, path }),
  writeSitePageFile: (pageId: string, path: string, content: string) =>
    call<{ ok: true }>('s16_write_site_page_file', { pageId, path, content }),
  deleteSitePageFile: (pageId: string, path: string) =>
    call<{ ok: true }>('s16_delete_site_page_file', { pageId, path }),

  // search
  search: (query: string, limit = 30) => call<{ items: unknown[] }>('s16_search_workspace', { query, limit }),
}
