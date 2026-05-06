import { useEffect, useState, useRef } from 'react'
import { Search, X } from '../lib/icons'
import { k } from '../lib/mcp'
import { store, useStore } from '../store'

export function SearchPalette() {
  const open = useStore((s) => s.searchOpen)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<Record<string, unknown>>>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
    else { setQuery(''); setResults([]) }
  }, [open])

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const t = setTimeout(() => {
      k.search(query, 20).then((r) => setResults(r.items as Array<Record<string, unknown>>))
       .catch(() => setResults([]))
    }, 150)
    return () => clearTimeout(t)
  }, [query])

  // Esc closes; Enter opens first hit
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') store.setSearchOpen(false)
      if (e.key === 'Enter' && results[0]) {
        openHit(results[0])
        store.setSearchOpen(false)
      }
    }
    if (open) window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [open, results])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 grid place-items-center no-drag"
         style={{ background: 'rgba(0,0,0,0.3)' }}
         onClick={() => store.setSearchOpen(false)}>
      <div className="w-[600px] max-w-[90vw] rounded-xl shadow-2xl overflow-hidden"
           style={{ background: 'var(--color-bg-strong)', border: '1px solid var(--color-border)' }}
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <Search size={16} style={{ color: 'var(--color-text-subtle)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vault…"
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <button onClick={() => store.setSearchOpen(false)} className="opacity-50 hover:opacity-100"><X size={14} /></button>
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {results.length === 0 && query && <div className="px-4 py-6 text-sm text-center" style={{ color: 'var(--color-text-subtle)' }}>No matches.</div>}
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => { openHit(r); store.setSearchOpen(false) }}
              className="w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-[var(--color-border-soft)]"
            >
              <span className="text-xs w-12 mono" style={{ color: 'var(--color-text-subtle)' }}>
                {String(r.kind ?? '?')}
              </span>
              <span className="text-sm flex-1 truncate">
                {String(r.primaryTitle ?? r.title ?? r.name ?? '(untitled)')}
              </span>
              <span className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>
                {String(r.databaseName ?? '')}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function openHit(r: Record<string, unknown>) {
  if (r.kind === 'page' && typeof r.id === 'string' && typeof r.databaseId === 'string') {
    store.open({
      title: String(r.primaryTitle ?? '(untitled)'),
      view: { kind: 'page', pageId: r.id, databaseId: r.databaseId },
    })
  } else if (r.kind === 'doc' && typeof r.id === 'string') {
    store.open({
      title: String(r.title ?? '(untitled)'),
      view: { kind: 'doc', docId: r.id },
    })
  }
}
