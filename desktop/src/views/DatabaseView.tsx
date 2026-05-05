import { useEffect, useState } from 'react'
import { Plus, MoreHorizontal } from 'lucide-react'
import { k, type Database, type Page } from '../lib/mcp'
import { store } from '../store'
import { EditableCell } from '../components/EditableCell'

export function DatabaseView({ databaseId }: { databaseId: string }) {
  const [db, setDb] = useState<Database | null>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    k.getDatabase(databaseId).then(setDb).catch(() => setDb(null))
    k.listPages(databaseId, { limit: 200 }).then((r) => setPages(r.items)).catch(() => setPages([]))
  }, [databaseId, refreshTick])

  if (!db) return <Loading />

  // Properties in display order: title first, then by `position`.
  const props = (db.properties ?? []).slice().sort((a, b) => {
    if (a.isPrimary) return -1
    if (b.isPrimary) return 1
    return (a.position ?? 0) - (b.position ?? 0)
  })

  async function addRow() {
    const title = prompt('Title for new row?')
    if (!title) return
    await k.createPage(databaseId, title)
    setRefreshTick((n) => n + 1)
  }

  async function addProperty() {
    const name = prompt('Property name?')
    if (!name) return
    const type = prompt('Property type? (text, number, select, multi_select, date, checkbox, email, url, phone, relation)', 'text')
    if (!type) return
    await k.createProperty(databaseId, name, type)
    setRefreshTick((n) => n + 1)
  }

  return (
    <div className="h-full overflow-auto" style={{ background: 'var(--color-bg-strong)' }}>
      <header className="px-8 pt-8 pb-4 sticky top-0 z-10" style={{ background: 'var(--color-bg-strong)' }}>
        <div className="flex items-center gap-3">
          <span className="text-3xl">{db.icon ?? '📋'}</span>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">{db.name}</h1>
            {db.description && <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>{db.description}</p>}
          </div>
          <button
            onClick={addRow}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md font-medium text-white"
            style={{ background: 'var(--color-accent)' }}
          >
            <Plus size={14} /> New row
          </button>
        </div>
        <div className="text-xs mt-2" style={{ color: 'var(--color-text-subtle)' }}>
          {pages.length} row{pages.length === 1 ? '' : 's'} · {props.length} propert{props.length === 1 ? 'y' : 'ies'}
        </div>
      </header>

      <div className="px-8 pb-8">
        <table className="w-full text-sm border-collapse" style={{ borderTop: '1px solid var(--color-border)' }}>
          <thead>
            <tr style={{ color: 'var(--color-text-muted)' }}>
              {props.map((p) => (
                <th key={p.id} className="text-left font-medium py-2 px-3 text-xs uppercase tracking-wider"
                    style={{ borderBottom: '1px solid var(--color-border)' }}>
                  {p.name}
                </th>
              ))}
              <th className="py-2 px-3 text-xs uppercase tracking-wider w-10" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <button onClick={addProperty} title="Add property"
                        className="hover:bg-[var(--color-border-soft)] rounded p-1"><Plus size={12} /></button>
              </th>
            </tr>
          </thead>
          <tbody>
            {pages.map((page) => (
              <tr key={page.id} className="hover:bg-[var(--color-border-soft)]">
                {props.map((p, i) => {
                  const v = i === 0
                    ? page.primaryTitle
                    : page.propertiesCache?.[p.id]
                  // Cast config since it's `unknown` on the typed wrapper.
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const opts = (p.config as any)?.options as Array<{ name: string }> | undefined
                  return (
                    <td key={p.id} className="py-2 px-3"
                        style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
                      <EditableCell
                        value={v}
                        type={p.type}
                        options={opts}
                        primary={p.isPrimary}
                        onSave={async (next) => {
                          await k.bulkUpdateCells(page.id, db.id, { [p.name]: next })
                          setRefreshTick((n) => n + 1)
                        }}
                      />
                    </td>
                  )
                })}
                <td className="py-2 px-3 w-10" style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
                  <div className="flex items-center gap-1 justify-end">
                    <button
                      title="Open page"
                      onClick={() => store.open({
                        title: page.primaryTitle || '(untitled)',
                        icon: db.icon,
                        view: { kind: 'page', pageId: page.id, databaseId: db.id },
                      })}
                      className="opacity-50 hover:opacity-100 px-1"
                    >↗</button>
                    <button onClick={(e) => e.stopPropagation()} className="opacity-50 hover:opacity-100">
                      <MoreHorizontal size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {pages.length === 0 && (
              <tr><td colSpan={props.length + 1} className="py-12 text-center" style={{ color: 'var(--color-text-subtle)' }}>
                No rows yet. Click "New row" to add one.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Loading() { return <div className="p-8" style={{ color: 'var(--color-text-subtle)' }}>Loading…</div> }
