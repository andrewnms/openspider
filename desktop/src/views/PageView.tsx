import { useEffect, useState, useRef } from 'react'
import { k, type Page, type Database, type Property } from '../lib/mcp'
import { MarkdownEditor } from '../components/MarkdownEditor'

/**
 * Markdown editor for a single database page. v1 is a textarea-as-editor —
 * BlockSuite/Tiptap can drop in here later without the rest of the app
 * caring. Properties panel on the right edits frontmatter cells.
 */
export function PageView({ pageId, databaseId }: { pageId: string; databaseId: string }) {
  const [page, setPage] = useState<Page | null>(null)
  const [db, setDb] = useState<Database | null>(null)
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle')
  const dirtyRef = useRef(false)
  const titleRef = useRef('')

  useEffect(() => {
    let alive = true
    Promise.all([k.getPage(pageId), k.getDatabase(databaseId), k.getPageContent(pageId)])
      .then(([p, d, html]) => {
        if (!alive) return
        setPage(p); setDb(d); titleRef.current = p.primaryTitle
        // The MCP returns HTML; strip basic tags so the textarea reads cleanly.
        // Real fix is a markdown editor that owns roundtripping.
        setContent(htmlToMarkdownish(typeof html === 'string' ? html : ''))
      })
    return () => { alive = false }
  }, [pageId, databaseId])

  // Debounced autosave on content change
  useEffect(() => {
    if (!page || !dirtyRef.current) return
    const t = setTimeout(async () => {
      setSaving('saving')
      await k.updatePageContent(page.id, content)
      setSaving('saved')
      setTimeout(() => setSaving('idle'), 1200)
      dirtyRef.current = false
    }, 600)
    return () => clearTimeout(t)
  }, [content, page])

  async function saveTitle(newTitle: string) {
    if (!page || !db) return
    const titleProp = (db.properties ?? []).find((p) => p.isPrimary)
    if (!titleProp) return
    await k.updatePage(page.id, { properties: { [titleProp.name]: newTitle } })
  }

  if (!page || !db) return <div className="p-8" style={{ color: 'var(--color-text-subtle)' }}>Loading…</div>

  const titleProp = (db.properties ?? []).find((p) => p.isPrimary)
  const otherProps = (db.properties ?? []).filter((p) => !p.isPrimary)
                     .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

  return (
    <div className="h-full grid grid-cols-[1fr_280px]" style={{ background: 'var(--color-bg-strong)' }}>
      {/* Editor column */}
      <div className="overflow-auto px-12 py-10">
        <div className="max-w-3xl mx-auto">
          <input
            defaultValue={titleRef.current}
            onChange={(e) => { titleRef.current = e.target.value }}
            onBlur={(e) => saveTitle(e.target.value)}
            className="w-full text-3xl font-bold bg-transparent border-none outline-none"
            placeholder="Untitled"
          />
          <div className="text-xs mt-2 mb-6" style={{ color: 'var(--color-text-subtle)' }}>
            {db.icon} {db.name}
            <span className="ml-3">{saveLabel(saving)}</span>
          </div>
          <MarkdownEditor
            value={content}
            onChange={(md) => { dirtyRef.current = true; setContent(md) }}
            placeholder="Start writing… (try [[Page Name]] for wiki links)"
          />
        </div>
      </div>

      {/* Properties panel */}
      <aside className="overflow-auto p-6 space-y-4 text-sm"
             style={{ background: 'var(--color-bg-soft)', borderLeft: '1px solid var(--color-border)' }}>
        <div className="text-[11px] uppercase tracking-wider font-semibold"
             style={{ color: 'var(--color-text-subtle)' }}>Properties</div>
        {titleProp && <PropertyRow propDef={titleProp} value={page.primaryTitle} readOnly />}
        {otherProps.map((p) => (
          <PropertyRow
            key={p.id}
            propDef={p}
            value={page.propertiesCache?.[p.id]}
            onChange={async (v) => {
              await k.bulkUpdateCells(page.id, db.id, { [p.name]: v })
              const fresh = await k.getPage(page.id)
              setPage(fresh)
            }}
          />
        ))}
      </aside>
    </div>
  )
}

function PropertyRow({
  propDef, value, readOnly, onChange,
}: { propDef: Property; value: unknown; readOnly?: boolean; onChange?: (v: unknown) => void | Promise<void> }) {
  const [draft, setDraft] = useState<string>(value == null ? '' : String(value))
  useEffect(() => { setDraft(value == null ? '' : String(value)) }, [value])

  if (readOnly) {
    return (
      <div>
        <div className="text-xs mb-1" style={{ color: 'var(--color-text-subtle)' }}>{propDef.name}</div>
        <div className="text-sm">{draft || '—'}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="text-xs mb-1" style={{ color: 'var(--color-text-subtle)' }}>{propDef.name}</div>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={async () => {
          if (draft === (value == null ? '' : String(value))) return
          await onChange?.(coerceForType(draft, propDef.type))
        }}
        className="w-full bg-transparent border-b border-transparent hover:border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none py-0.5"
      />
    </div>
  )
}

function coerceForType(s: string, type: string): unknown {
  if (s === '') return null
  if (type === 'number') { const n = Number(s); return isNaN(n) ? null : n }
  if (type === 'checkbox') return s === 'true' || s === '1'
  if (type === 'multi_select' || type === 'relation') return s.split(',').map(x => x.trim()).filter(Boolean)
  return s
}

function saveLabel(state: 'idle' | 'saving' | 'saved') {
  if (state === 'saving') return 'Saving…'
  if (state === 'saved')  return '✓ Saved'
  return ''
}

/** Lossy HTML→pseudo-markdown so the textarea is editable. Real fix: a real
 *  markdown editor that owns the round trip. v1 acceptable for short bodies. */
function htmlToMarkdownish(html: string): string {
  return html
    .replace(/<\/h([1-6])>/g, '\n')
    .replace(/<h1[^>]*>/g,  '# ')
    .replace(/<h2[^>]*>/g,  '## ')
    .replace(/<h3[^>]*>/g,  '### ')
    .replace(/<\/p>/g, '\n\n')
    .replace(/<p[^>]*>/g, '')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<li[^>]*>/g, '- ')
    .replace(/<\/li>/g, '\n')
    .replace(/<\/?(ul|ol)[^>]*>/g, '')
    .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
    .replace(/<em>(.*?)<\/em>/g, '*$1*')
    .replace(/<code>(.*?)<\/code>/g, '`$1`')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
