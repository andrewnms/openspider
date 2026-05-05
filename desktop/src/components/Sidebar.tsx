import { useEffect, useState } from 'react'
import {
  Database as DBIcon, FileText, Cpu, Sparkles, Globe, Activity, Settings,
  ChevronRight, Plus, Search, Folder,
} from 'lucide-react'
import { k, type Database, type Doc, type Agent, type Skill } from '../lib/mcp'
import { store, useStore } from '../store'

export function Sidebar() {
  const activeTabId = useStore((s) => s.activeTabId)

  return (
    <aside
      className="w-64 shrink-0 h-full flex flex-col"
      style={{ background: 'var(--color-bg-soft)', borderRight: '1px solid var(--color-border)' }}
    >
      {/* Drag region for the title bar */}
      <div className="h-10 drag-region flex items-center justify-end px-3 gap-2">
        <button
          onClick={() => store.setSearchOpen(true)}
          className="no-drag flex items-center gap-2 text-xs px-2 py-1 rounded-md hover:bg-[var(--color-border-soft)]"
          style={{ color: 'var(--color-text-muted)' }}
          title="Search (⌘K)"
        >
          <Search size={14} />
          <span className="hidden lg:inline">Search</span>
        </button>
      </div>

      <div className="px-3 pt-1 pb-4 flex items-center gap-2">
        <div className="w-7 h-7 rounded-md grid place-items-center text-white"
             style={{ background: '#000' }}>
          <span style={{ fontSize: 16, lineHeight: 1 }}>🕷</span>
        </div>
        <div className="flex-1">
          <div className="font-semibold text-sm">OpenSpider</div>
          <div className="text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>v1.0 · local vault</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-4 space-y-3 text-sm">
        <Section title="Databases" icon={<DBIcon size={13} />}>
          <DatabasesList activeTabId={activeTabId} />
        </Section>
        <Section title="Docs" icon={<FileText size={13} />}>
          <DocsList activeTabId={activeTabId} />
        </Section>
        <Section title="AI" icon={<Cpu size={13} />}>
          <AISection activeTabId={activeTabId} />
        </Section>
        <Section title="Sites" icon={<Globe size={13} />}>
          <SitesList activeTabId={activeTabId} />
        </Section>

        <div className="pt-2" style={{ borderTop: '1px solid var(--color-border-soft)' }}>
          <SidebarRow
            icon={<Activity size={14} />}
            label="Recent runs"
            active={activeTabId === '{"kind":"runs"}'}
            onClick={() => store.open({ title: 'Recent runs', icon: '🏃', view: { kind: 'runs' } })}
          />
          <SidebarRow
            icon={<Settings size={14} />}
            label="Settings"
            active={activeTabId === '{"kind":"settings"}'}
            onClick={() => store.open({ title: 'Settings', icon: '⚙️', view: { kind: 'settings' } })}
          />
        </div>
      </nav>
    </aside>
  )
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 w-full text-left text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--color-text-subtle)' }}
      >
        <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        {icon}
        <span>{title}</span>
      </button>
      {open && <div className="ml-1 mt-0.5">{children}</div>}
    </div>
  )
}

function SidebarRow({
  icon, label, active, onClick, indent = 0,
}: { icon?: React.ReactNode; label: React.ReactNode; active?: boolean; onClick?: () => void; indent?: number }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-2 py-1 w-full text-left rounded-md hover:bg-[var(--color-border-soft)]"
      style={{
        paddingLeft: 8 + indent * 12,
        background: active ? 'var(--color-accent-soft)' : 'transparent',
        color: active ? 'var(--color-accent)' : 'var(--color-text)',
        fontWeight: active ? 500 : 400,
      }}
    >
      <span className="shrink-0" style={{ color: active ? 'var(--color-accent)' : 'var(--color-text-subtle)' }}>{icon}</span>
      <span className="flex-1 truncate text-sm">{label}</span>
    </button>
  )
}

function DatabasesList({ activeTabId }: { activeTabId: string | null }) {
  const [dbs, setDbs] = useState<Database[]>([])
  useEffect(() => { k.listDatabases().then(setDbs).catch(() => setDbs([])) }, [activeTabId])
  return (
    <>
      {dbs.map((d) => {
        const id = JSON.stringify({ kind: 'database', databaseId: d.id })
        return (
          <SidebarRow
            key={d.id}
            indent={0}
            icon={<span style={{ width: 14, display: 'inline-block', textAlign: 'center' }}>{d.icon ?? '·'}</span>}
            label={d.name}
            active={activeTabId === id}
            onClick={() => store.open({ title: d.name, icon: d.icon, view: { kind: 'database', databaseId: d.id } })}
          />
        )
      })}
      <NewItemRow label="New database" onClick={async () => {
        const name = prompt('Database name?')
        if (!name) return
        const created = await k.createDatabase(name, '📋')
        setDbs((xs) => [...xs, created])
        store.open({ title: created.name, icon: '📋', view: { kind: 'database', databaseId: created.id } })
      }} />
    </>
  )
}

function DocsList({ activeTabId }: { activeTabId: string | null }) {
  const [docs, setDocs] = useState<Doc[]>([])
  useEffect(() => { k.listDocs().then(setDocs).catch(() => setDocs([])) }, [activeTabId])
  return (
    <>
      {docs.map((d) => {
        const id = JSON.stringify({ kind: 'doc', docId: d.id })
        return (
          <SidebarRow
            key={d.id}
            icon={<span style={{ width: 14, display: 'inline-block', textAlign: 'center' }}>{d.icon ?? '📄'}</span>}
            label={d.title}
            active={activeTabId === id}
            onClick={() => store.open({ title: d.title, icon: d.icon, view: { kind: 'doc', docId: d.id } })}
          />
        )
      })}
      <NewItemRow label="New doc" onClick={async () => {
        const title = prompt('Doc title?')
        if (!title) return
        const created = await k.createDoc(title, { icon: '📄' })
        setDocs((xs) => [...xs, created])
        store.open({ title: created.title, icon: created.icon, view: { kind: 'doc', docId: created.id } })
      }} />
    </>
  )
}

function AISection({ activeTabId }: { activeTabId: string | null }) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  useEffect(() => {
    k.listAgents().then(setAgents).catch(() => setAgents([]))
    k.listSkills().then((r) => setSkills(r.own)).catch(() => setSkills([]))
  }, [activeTabId])
  return (
    <>
      <SidebarRow
        icon={<Cpu size={14} />}
        label={`Agents (${agents.length})`}
        active={activeTabId === '{"kind":"agents"}'}
        onClick={() => store.open({ title: 'Agents', icon: '🤖', view: { kind: 'agents' } })}
      />
      <SidebarRow
        icon={<Sparkles size={14} />}
        label={`Skills (${skills.length})`}
        active={activeTabId === '{"kind":"skills"}'}
        onClick={() => store.open({ title: 'Skills', icon: '✨', view: { kind: 'skills' } })}
      />
    </>
  )
}

function SitesList({ activeTabId }: { activeTabId: string | null }) {
  void activeTabId
  return (
    <SidebarRow
      icon={<Globe size={14} />}
      label="All sites"
      onClick={() => store.open({ title: 'Sites', icon: '🌐', view: { kind: 'sites' } })}
    />
  )
}

function NewItemRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full text-left px-2 py-1 rounded-md text-sm hover:bg-[var(--color-border-soft)]"
      style={{ color: 'var(--color-text-subtle)' }}
    >
      <Plus size={14} />
      <span>{label}</span>
    </button>
  )
}

// (silence unused import warnings until we use them in later iterations)
void Folder
