import { useEffect, useState } from 'react'
import { Database as DBIcon, FileText, Cpu, Sparkles, Globe, Plus, Activity, ChevronRight } from '../lib/icons'
import { k, type Database, type Doc, type Agent, type Run } from '../lib/mcp'
import { store } from '../store'
import { appPrompt } from '../lib/dialog'

/**
 * Home: a useful dashboard, not a static menu.
 *
 * - Lists existing databases and docs (clicking opens the actual record)
 * - Empty state for each: an explicit "create" CTA, no broken navigation
 * - Recent runs surfaced at the bottom for quick triage
 */
export function HomeView() {
  const [dbs,    setDbs]    = useState<Database[] | null>(null)
  const [docs,   setDocs]   = useState<Doc[]      | null>(null)
  const [agents, setAgents] = useState<Agent[]    | null>(null)
  const [runs,   setRuns]   = useState<Run[]      | null>(null)

  useEffect(() => {
    k.listDatabases().then(setDbs).catch(() => setDbs([]))
    k.listAllDocs().then(setDocs).catch(() => setDocs([]))
    k.listAgents().then(setAgents).catch(() => setAgents([]))
    k.listRuns(undefined, 5).then(setRuns).catch(() => setRuns([]))
  }, [])

  return (
    <div className="h-full overflow-auto" style={{ background: 'var(--color-bg-strong)' }}>
      <div className="max-w-3xl mx-auto px-8 pt-12 pb-16">
        <div className="flex items-center gap-3 mb-1">
          <div className="text-3xl">🕷</div>
          <div>
            <h1 className="text-2xl font-bold leading-tight">Welcome to OpenSpider.</h1>
            <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Your local Brain. Pick something to open, or create something new.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3 mt-8">
          <SectionCard
            icon={<DBIcon size={18} />}
            title="Databases"
            count={dbs?.length}
            empty="No databases yet."
            createLabel="New database"
            onCreate={async () => {
              const name = await appPrompt('Database name?'); if (!name) return
              const created = await k.createDatabase(name, '📋')
              setDbs((xs) => [...(xs ?? []), created])
              store.open({ title: created.name, icon: '📋', view: { kind: 'database', databaseId: created.id } })
            }}
          >
            {dbs?.slice(0, 4).map((d) => (
              <Row
                key={d.id}
                icon={d.icon ?? '·'}
                label={d.name}
                onClick={() => store.open({ title: d.name, icon: d.icon, view: { kind: 'database', databaseId: d.id } })}
              />
            ))}
            {dbs && dbs.length > 4 && (
              <div className="text-xs px-2 pt-1" style={{ color: 'var(--color-text-subtle)' }}>
                +{dbs.length - 4} more in the sidebar
              </div>
            )}
          </SectionCard>

          <SectionCard
            icon={<FileText size={18} />}
            title="Docs"
            count={docs?.length}
            empty="No docs yet."
            createLabel="New doc"
            onCreate={async () => {
              const title = await appPrompt('Doc title?'); if (!title) return
              const created = await k.createDoc(title, { icon: '📄' })
              setDocs((xs) => [...(xs ?? []), created])
              store.open({ title: created.title, icon: created.icon, view: { kind: 'doc', docId: created.id } })
            }}
          >
            {docs?.slice(0, 4).map((d) => (
              <Row
                key={d.id}
                icon={d.icon ?? '📄'}
                label={d.title}
                onClick={() => store.open({ title: d.title, icon: d.icon, view: { kind: 'doc', docId: d.id } })}
              />
            ))}
            {docs && docs.length > 4 && (
              <div className="text-xs px-2 pt-1" style={{ color: 'var(--color-text-subtle)' }}>
                +{docs.length - 4} more in the sidebar
              </div>
            )}
          </SectionCard>

          <SectionCard
            icon={<Cpu size={18} />}
            title="Agents"
            count={agents?.length}
            empty="No agents yet."
            createLabel="New agent"
            onCreate={() => store.open({ title: 'Agents', icon: '🤖', view: { kind: 'agents' } })}
          >
            {agents?.slice(0, 4).map((a) => (
              <Row
                key={a.id}
                icon="🤖"
                label={a.name}
                onClick={() => store.open({ title: a.name, icon: '🤖', view: { kind: 'agent', agentId: a.id } })}
              />
            ))}
          </SectionCard>

          <SectionCard
            icon={<Sparkles size={18} />}
            title="Skills"
            count={undefined}
            empty="Manage reusable agent instructions."
            createLabel="Open skills"
            onCreate={() => store.open({ title: 'Skills', icon: '✨', view: { kind: 'skills' } })}
          />

          <SectionCard
            icon={<Globe size={18} />}
            title="Sites"
            count={undefined}
            empty="Publishable mini-sites with virtual file system."
            createLabel="Open sites"
            onCreate={() => store.open({ title: 'Sites', icon: '🌐', view: { kind: 'sites' } })}
          />

          <SectionCard
            icon={<Sparkles size={18} />}
            title="Import"
            count={undefined}
            empty="Bulk-create docs from JSON / NDJSON / chat exports."
            createLabel="Open import"
            onCreate={() => store.open({ title: 'Import', icon: '📥', view: { kind: 'import' } })}
          />

          <SectionCard
            icon={<Activity size={18} />}
            title="Runs"
            count={runs?.length}
            empty="Agent runs will show up here."
            createLabel="View runs"
            onCreate={() => store.open({ title: 'Recent runs', icon: '🏃', view: { kind: 'runs' } })}
          >
            {runs?.slice(0, 3).map((r) => (
              <div key={r.id} className="px-2 py-1 text-xs flex items-center gap-2">
                <span className="mono"
                      style={{ color: r.status === 'success' ? 'var(--color-success)' : r.status === 'failed' ? 'var(--color-danger)' : 'var(--color-text-subtle)' }}>
                  ●
                </span>
                <span className="flex-1 truncate">{r.agentName ?? r.agentId.slice(0, 8)}</span>
                <span style={{ color: 'var(--color-text-subtle)' }}>{r.startedAt.split('T')[1]?.split('.')[0]}</span>
              </div>
            ))}
          </SectionCard>
        </div>

        <div className="mt-8 text-xs mono text-center" style={{ color: 'var(--color-text-subtle)' }}>
          ⌘K to search · drop into a section in the sidebar to see everything
        </div>
      </div>
    </div>
  )
}

function SectionCard({
  icon, title, count, empty, createLabel, onCreate, children,
}: {
  icon: React.ReactNode
  title: string
  count: number | undefined
  empty: string
  createLabel: string
  onCreate: () => void
  children?: React.ReactNode
}) {
  const hasItems = !!children && (Array.isArray(children) ? children.length > 0 : true)
  return (
    <div className="rounded-lg p-4 flex flex-col gap-2"
         style={{ background: 'var(--color-bg-soft)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span style={{ color: 'var(--color-accent)' }}>{icon}</span>
        <span className="flex-1">{title}</span>
        {count !== undefined && <span className="text-xs mono" style={{ color: 'var(--color-text-subtle)' }}>{count}</span>}
      </div>
      {hasItems && (
        <div className="flex flex-col -mx-1">{children}</div>
      )}
      {!hasItems && (count === undefined || count === 0) && (
        <div className="text-xs" style={{ color: 'var(--color-text-subtle)' }}>{empty}</div>
      )}
      <button
        onClick={onCreate}
        className="self-start text-xs flex items-center gap-1 mt-1 px-2 py-1 rounded hover:bg-[var(--color-border-soft)]"
        style={{ color: 'var(--color-accent)' }}
      >
        <Plus size={12} /> {createLabel}
      </button>
    </div>
  )
}

function Row({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-2 py-1 rounded text-sm text-left hover:bg-[var(--color-border-soft)]"
    >
      <span style={{ width: 16, display: 'inline-block', textAlign: 'center' }}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <ChevronRight size={12} style={{ color: 'var(--color-text-subtle)' }} />
    </button>
  )
}
