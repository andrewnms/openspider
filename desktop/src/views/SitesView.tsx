import { useEffect, useState } from 'react'
import { Globe, Plus, Save, Trash2, Eye, FileCode } from 'lucide-react'
import { k, type Site } from '../lib/mcp'
import { store, useStore } from '../store'

/**
 * Sites view: three-pane VFS editor.
 *
 *   ┌────────────┬────────────┬────────────────────┐
 *   │ Sites      │ Pages /    │ File content       │
 *   │ + new      │ Files      │ (text editor)      │
 *   └────────────┴────────────┴────────────────────┘
 *
 * Selection state lives in the URL/tab params via store.open(...) when the
 * site/page changes. For now keep it in component-local state — switching
 * sites is rare and we don't need shareable deep links yet.
 */
export function SitesListView() {
  const tabId    = useStore((s) => s.activeTabId)
  const [sites, setSites]               = useState<Site[]>([])
  const [refresh, setRefresh]           = useState(0)
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null)
  const [activePageId, setActivePageId] = useState<string | null>(null)
  const [activePath,   setActivePath]   = useState<string | null>(null)

  useEffect(() => {
    k.listSites().then((s) => {
      setSites(s)
      if (!activeSiteId && s[0]) setActiveSiteId(s[0].id)
    })
  }, [refresh, tabId])

  return (
    <div className="h-full grid grid-cols-[220px_280px_1fr]" style={{ background: 'var(--color-bg-strong)' }}>
      <SitesColumn
        sites={sites}
        activeSiteId={activeSiteId}
        onSelect={(id) => { setActiveSiteId(id); setActivePageId(null); setActivePath(null) }}
        onCreate={async () => {
          const name = prompt('Site name?'); if (!name) return
          const slug = prompt('URL slug?', name.toLowerCase().replace(/\s+/g, '-')) || undefined
          const created = await k.createSite(name, slug ?? undefined, '🌐')
          setRefresh((n) => n + 1)
          setActiveSiteId(created.id)
        }}
      />
      <PagesColumn
        siteId={activeSiteId}
        activePageId={activePageId}
        onSelect={(id) => { setActivePageId(id); setActivePath(null) }}
        onChanged={() => setRefresh((n) => n + 1)}
      />
      <FilesPane
        pageId={activePageId}
        activePath={activePath}
        onSelectPath={setActivePath}
      />
    </div>
  )
}

/* ─────────────────────────── columns ─────────────────────────────────── */

function SitesColumn({
  sites, activeSiteId, onSelect, onCreate,
}: { sites: Site[]; activeSiteId: string | null; onSelect: (id: string) => void; onCreate: () => void }) {
  return (
    <aside className="overflow-auto p-3 flex flex-col"
           style={{ background: 'var(--color-bg-soft)', borderRight: '1px solid var(--color-border)' }}>
      <div className="flex items-center mb-3">
        <Globe size={16} className="mr-1.5" />
        <h2 className="text-sm font-semibold flex-1">Sites</h2>
        <button onClick={onCreate} title="New site"
                className="hover:bg-[var(--color-border-soft)] p-1 rounded"><Plus size={14} /></button>
      </div>
      <div className="space-y-0.5">
        {sites.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left hover:bg-[var(--color-border-soft)]"
            style={{
              background: activeSiteId === s.id ? 'var(--color-accent-soft)' : 'transparent',
              color:      activeSiteId === s.id ? 'var(--color-accent)'      : 'var(--color-text)',
            }}
          >
            <span>{s.icon ?? '🌐'}</span>
            <span className="flex-1 truncate">{s.name}</span>
            {s.isPublished && <span className="text-[10px] px-1 rounded mono"
                                    style={{ background: 'var(--color-success)', color: 'white' }}>pub</span>}
          </button>
        ))}
        {sites.length === 0 && (
          <div className="text-xs px-2 py-3" style={{ color: 'var(--color-text-subtle)' }}>
            No sites yet. Click + to add one.
          </div>
        )}
      </div>
    </aside>
  )
}

function PagesColumn({
  siteId, activePageId, onSelect, onChanged,
}: { siteId: string | null; activePageId: string | null; onSelect: (id: string) => void; onChanged: () => void }) {
  type Page = { id: string; siteId: string; slug: string; title: string; isHome?: boolean; isPublished?: boolean; entryPath?: string }
  const [pages, setPages]     = useState<Page[]>([])
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (!siteId) { setPages([]); return }
    k.listSitePages(siteId).then(setPages).catch(() => setPages([]))
  }, [siteId, refresh])

  if (!siteId) {
    return <div className="p-6 text-sm" style={{ color: 'var(--color-text-subtle)', borderRight: '1px solid var(--color-border)', background: 'var(--color-bg-soft)' }}>
      Select a site on the left.
    </div>
  }

  return (
    <aside className="overflow-auto p-3 flex flex-col"
           style={{ background: 'var(--color-bg-soft)', borderRight: '1px solid var(--color-border)' }}>
      <div className="flex items-center mb-3">
        <FileCode size={16} className="mr-1.5" />
        <h2 className="text-sm font-semibold flex-1">Pages</h2>
        <button
          onClick={async () => {
            const slug  = prompt('Page slug?'); if (!slug) return
            const title = prompt('Page title?', slug); if (!title) return
            await k.createSitePage(siteId, slug, title)
            setRefresh((n) => n + 1)
            onChanged()
          }}
          title="New page"
          className="hover:bg-[var(--color-border-soft)] p-1 rounded"><Plus size={14} /></button>
      </div>
      <div className="space-y-0.5">
        {pages.map((p) => (
          <div key={p.id} className="rounded text-sm" style={{
            background: activePageId === p.id ? 'var(--color-accent-soft)' : 'transparent',
          }}>
            <button
              onClick={() => onSelect(p.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-left"
              style={{ color: activePageId === p.id ? 'var(--color-accent)' : 'var(--color-text)' }}
            >
              <span>{p.isHome ? '🏠' : '📄'}</span>
              <div className="flex-1 truncate">
                <div className="truncate">{p.title}</div>
                <div className="text-[10px] mono truncate" style={{ color: 'var(--color-text-subtle)' }}>{p.slug}</div>
              </div>
              {p.isPublished && <span className="text-[10px] px-1 rounded mono"
                                      style={{ background: 'var(--color-success)', color: 'white' }}>pub</span>}
            </button>
            {activePageId === p.id && (
              <div className="px-2 pb-1 flex gap-1">
                <button
                  onClick={async () => {
                    const r = await k.publishSitePage(p.id, !p.isPublished)
                    if (r.publicUrl) console.log('public URL:', r.publicUrl)
                    setRefresh((n) => n + 1)
                  }}
                  className="text-[10px] flex items-center gap-0.5 px-1.5 py-0.5 rounded hover:bg-[var(--color-border-soft)]"
                  style={{ color: 'var(--color-text-muted)' }}
                ><Eye size={10} /> {p.isPublished ? 'unpublish' : 'publish'}</button>
              </div>
            )}
          </div>
        ))}
        {pages.length === 0 && (
          <div className="text-xs px-2 py-3" style={{ color: 'var(--color-text-subtle)' }}>
            No pages yet.
          </div>
        )}
      </div>
    </aside>
  )
}

function FilesPane({
  pageId, activePath, onSelectPath,
}: { pageId: string | null; activePath: string | null; onSelectPath: (p: string) => void }) {
  const [paths, setPaths]     = useState<string[]>([])
  const [entry, setEntry]     = useState<string>('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (!pageId) { setPaths([]); return }
    k.listSitePageFiles(pageId).then((r) => { setPaths(r.paths); setEntry(r.entryPath) })
                               .catch(() => setPaths([]))
  }, [pageId, refresh])

  if (!pageId) {
    return <div className="p-6 text-sm grid place-items-center" style={{ color: 'var(--color-text-subtle)' }}>
      Select a page to edit its files.
    </div>
  }

  return (
    <div className="grid grid-cols-[200px_1fr] h-full">
      {/* file list */}
      <div className="overflow-auto p-3" style={{ borderRight: '1px solid var(--color-border)' }}>
        <div className="flex items-center mb-3">
          <h3 className="text-xs uppercase tracking-wider font-semibold flex-1"
              style={{ color: 'var(--color-text-subtle)' }}>Files</h3>
          <button
            onClick={async () => {
              const path = prompt('New file path? (e.g. /about.html)', '/new.html')
              if (!path) return
              await k.writeSitePageFile(pageId, path, '<!-- new file -->')
              setRefresh((n) => n + 1)
              onSelectPath(path)
            }}
            className="hover:bg-[var(--color-border-soft)] p-1 rounded"><Plus size={12} /></button>
        </div>
        <div className="space-y-0.5">
          {paths.map((p) => (
            <button
              key={p}
              onClick={() => onSelectPath(p)}
              className="w-full flex items-center gap-1.5 px-2 py-1 rounded text-sm text-left mono"
              style={{
                background: activePath === p ? 'var(--color-accent-soft)' : 'transparent',
                color:      activePath === p ? 'var(--color-accent)' : 'var(--color-text)',
              }}
            >
              <span className="truncate">{p}</span>
              {p === entry && <span className="text-[9px]" style={{ color: 'var(--color-text-subtle)' }}>(entry)</span>}
            </button>
          ))}
          {paths.length === 0 && (
            <div className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>No files yet.</div>
          )}
        </div>
      </div>
      {/* editor */}
      <FileEditor
        key={`${pageId}::${activePath ?? ''}`}
        pageId={pageId}
        path={activePath}
        isEntry={activePath === entry}
        onDeleted={() => { setRefresh((n) => n + 1); onSelectPath('') }}
      />
    </div>
  )
}

function FileEditor({
  pageId, path, isEntry, onDeleted,
}: { pageId: string; path: string | null; isEntry: boolean; onDeleted: () => void }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving]   = useState<'idle' | 'saving' | 'saved'>('idle')

  useEffect(() => {
    if (!path) { setContent(''); return }
    setLoading(true)
    k.readSitePageFile(pageId, path).then((r) => setContent(r.content)).finally(() => setLoading(false))
  }, [pageId, path])

  if (!path) {
    return <div className="grid place-items-center text-sm" style={{ color: 'var(--color-text-subtle)' }}>
      Pick a file on the left.
    </div>
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center gap-3 px-4 py-2"
              style={{ background: 'var(--color-bg-soft)', borderBottom: '1px solid var(--color-border)' }}>
        <span className="mono text-sm flex-1 truncate">{path}</span>
        <span className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>
          {saving === 'saving' ? 'Saving…' : saving === 'saved' ? '✓ Saved' : ''}
        </span>
        <button
          onClick={async () => {
            setSaving('saving')
            await k.writeSitePageFile(pageId, path, content)
            setSaving('saved'); setTimeout(() => setSaving('idle'), 1200)
          }}
          className="text-xs flex items-center gap-1 px-2 py-1 rounded text-white"
          style={{ background: 'var(--color-accent)' }}
        ><Save size={12} /> Save</button>
        <button
          onClick={async () => {
            if (isEntry) { alert("Can't delete the entry file."); return }
            if (!confirm(`Delete ${path}?`)) return
            await k.deleteSitePageFile(pageId, path)
            onDeleted()
          }}
          disabled={isEntry}
          title={isEntry ? "Can't delete the entry file" : 'Delete file'}
          className="text-xs flex items-center gap-1 px-2 py-1 rounded hover:bg-[var(--color-border-soft)] disabled:opacity-30"
          style={{ color: 'var(--color-danger)' }}
        ><Trash2 size={12} /></button>
      </header>
      <textarea
        value={loading ? 'Loading…' : content}
        readOnly={loading}
        onChange={(e) => setContent(e.target.value)}
        className="flex-1 p-4 mono text-sm bg-transparent border-none outline-none resize-none"
        style={{ background: 'var(--color-bg-strong)' }}
      />
    </div>
  )
}

// silence unused-store hint
void store
