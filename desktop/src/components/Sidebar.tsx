/**
 * Left sidebar — VSCode/SiYuan-style activity rail + expandable panel.
 *
 *   ┌──┬─────────────────────┐
 *   │📄│  Docs                │   rail = always visible (44px)
 *   │🗂│  ───────             │   panel = collapsible (256px / 0)
 *   │🤖│  • Banana            │
 *   │🌐│  • README            │
 *   │  │  • New doc           │
 *   │⚡│                       │
 *   │⚙ │                       │
 *   │⊟│                       │   bottom icons = runs / settings / hide
 *   └──┴─────────────────────┘
 *
 * Click an icon → switches the panel to that section AND opens the panel.
 * Click the *active* icon → collapses the panel (rail stays visible).
 */
import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import {
  Database as DBIcon, FileText, Cpu, Globe, Activity, Settings,
  ChevronRight, Plus, PanelLeftClose, PanelLeftOpen, Sparkles,
} from '../lib/icons'
import { k, type Database, type Agent, type Skill } from '../lib/mcp'
import { store, useStore, type SidebarSection } from '../store'
import { appPrompt } from '../lib/dialog'
import { DocTree } from './DocTree'

const RAIL_WIDTH  = 44
const PANEL_WIDTH = 256

export function Sidebar() {
  const activeTabId = useStore((s) => s.activeTabId)
  const collapsed   = useStore((s) => s.sidebarCollapsed)
  const section     = useStore((s) => s.sidebarSection)
  const dockVisible = useStore((s) => s.dockVisible)

  // Total dock width = rail (when dock is on) + panel (when section is open).
  // Animating ONE outer width gives us a smooth slide-out that pulls both the
  // rail and the panel together, while the panel-collapse remains its own
  // sub-animation when only the section toggles.
  const dockWidth = !dockVisible
    ? 0
    : RAIL_WIDTH + (collapsed ? 0 : PANEL_WIDTH)

  return (
    <motion.div
      initial={false}
      animate={{ width: dockWidth }}
      transition={{ type: 'spring', stiffness: 320, damping: 32, mass: 0.9 }}
      className="shrink-0 h-full overflow-hidden"
      style={{
        background: 'var(--color-bg-soft)',
        borderRight: dockVisible ? '1px solid var(--color-border)' : 'none',
      }}
    >
      <div
        className="flex h-full"
        // Hold the inner rail+panel at their full width so the container clip
        // animates around them — no reflow / re-layout while shrinking.
        style={{ width: RAIL_WIDTH + PANEL_WIDTH }}
      >
        <Rail collapsed={collapsed} section={section} />

        <motion.div
          initial={false}
          animate={{ width: collapsed ? 0 : PANEL_WIDTH, opacity: collapsed ? 0 : 1 }}
          transition={{
            width:   { type: 'spring', stiffness: 360, damping: 34 },
            opacity: { duration: 0.12 },
          }}
          className="overflow-hidden h-full"
          style={{ borderLeft: '1px solid var(--color-border)' }}
        >
          <div className="h-full flex flex-col" style={{ width: PANEL_WIDTH }}>
            <PanelHeader section={section} />
            <div className="flex-1 overflow-y-auto px-2 pb-3 text-sm">
              {section === 'docs'      && <DocTree activeTabId={activeTabId} refreshTick={0} />}
              {section === 'databases' && <DatabasesList activeTabId={activeTabId} />}
              {section === 'ai'        && <AISection activeTabId={activeTabId} />}
              {section === 'sites'     && <SitesList />}
            </div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  )
}

/* ────────── Rail ────────── */

function Rail({ collapsed, section }: { collapsed: boolean; section: SidebarSection }) {
  const activeTabId = useStore((s) => s.activeTabId)
  return (
    <nav
      className="shrink-0 h-full flex flex-col items-center py-2"
      style={{ width: RAIL_WIDTH }}
    >
      {/* Brand pip */}
      <div className="w-7 h-7 rounded-md grid place-items-center text-white mb-3"
           style={{ background: 'var(--color-text)' }}>
        <span style={{ fontSize: 14, lineHeight: 1 }}>🕷</span>
      </div>

      {/* Top icons — sections */}
      <RailBtn
        icon={<FileText size={16} />}
        label="Docs"
        active={!collapsed && section === 'docs'}
        onClick={() => store.setSidebarSection('docs')}
      />
      <RailBtn
        icon={<DBIcon size={16} />}
        label="Databases"
        active={!collapsed && section === 'databases'}
        onClick={() => store.setSidebarSection('databases')}
      />
      <RailBtn
        icon={<Cpu size={16} />}
        label="AI"
        active={!collapsed && section === 'ai'}
        onClick={() => store.setSidebarSection('ai')}
      />
      <RailBtn
        icon={<Globe size={16} />}
        label="Sites"
        active={!collapsed && section === 'sites'}
        onClick={() => store.setSidebarSection('sites')}
      />

      <div className="flex-1" />

      {/* Bottom icons — global tabs */}
      <RailBtn
        icon={<Activity size={16} />}
        label="Recent runs"
        active={activeTabId === '{"kind":"runs"}'}
        onClick={() => store.open({ title: 'Recent runs', icon: '🏃', view: { kind: 'runs' } })}
      />
      <RailBtn
        icon={<Settings size={16} />}
        label="Settings"
        active={activeTabId === '{"kind":"settings"}'}
        onClick={() => store.open({ title: 'Settings', icon: '⚙️', view: { kind: 'settings' } })}
      />
      <RailBtn
        icon={collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        label={collapsed ? 'Show dock (⌘\\)' : 'Hide dock (⌘\\)'}
        onClick={() => store.toggleSidebar()}
      />
    </nav>
  )
}

function RailBtn({
  icon, label, active, onClick,
}: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void }) {
  return (
    <motion.button
      title={label}
      onClick={onClick}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.92 }}
      transition={{ duration: 0.08 }}
      className="w-8 h-8 grid place-items-center rounded my-0.5 relative"
      style={{
        background: active ? 'var(--color-accent)' : 'transparent',
        color:      active ? '#fff' : 'var(--color-text-muted)',
      }}
    >
      {icon}
    </motion.button>
  )
}

/* ────────── Panel header (label + new-item action) ────────── */

function PanelHeader({ section }: { section: SidebarSection }) {
  const title =
    section === 'docs'      ? 'Doc Tree' :
    section === 'databases' ? 'Databases' :
    section === 'ai'        ? 'AI' :
    'Sites'
  const Icon =
    section === 'docs'      ? FileText :
    section === 'databases' ? DBIcon :
    section === 'ai'        ? Cpu :
    Globe
  return (
    <header
      className="px-3 flex items-center gap-2 shrink-0"
      style={{ height: 44, borderBottom: '1px solid var(--color-border)' }}
    >
      <Icon size={14} style={{ color: 'var(--color-text-subtle)' }} />
      <span
        className="text-[14px] font-semibold tracking-tight"
        style={{ color: 'var(--color-text)' }}
      >
        {title}
      </span>
    </header>
  )
}

/* ────────── Panel sections ────────── */

function DatabasesList({ activeTabId }: { activeTabId: string | null }) {
  const [dbs, setDbs] = useState<Database[]>([])
  useEffect(() => { k.listDatabases().then(setDbs).catch(() => setDbs([])) }, [activeTabId])
  return (
    <div className="pt-1">
      {dbs.map((d) => {
        const id = JSON.stringify({ kind: 'database', databaseId: d.id })
        const active = activeTabId === id
        return (
          <button
            key={d.id}
            onClick={() => store.open({ title: d.name, icon: d.icon, view: { kind: 'database', databaseId: d.id } })}
            className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-left hover:bg-[var(--color-border-soft)]"
            style={{
              background: active ? 'var(--color-accent-soft)' : 'transparent',
              color:      active ? 'var(--color-accent)'      : 'var(--color-text)',
              fontWeight: active ? 500 : 400,
            }}
          >
            <span style={{ width: 14, textAlign: 'center' }}>{d.icon ?? '·'}</span>
            <span className="flex-1 truncate text-sm">{d.name}</span>
          </button>
        )
      })}
      <NewItemRow label="New database" onClick={async () => {
        const name = await appPrompt('Database name?')
        if (!name) return
        const created = await k.createDatabase(name, '📋')
        setDbs((xs) => [...xs, created])
        store.open({ title: created.name, icon: '📋', view: { kind: 'database', databaseId: created.id } })
      }} />
    </div>
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
    <div className="pt-1 space-y-3">
      <div>
        <SectionLabel text="Agents" />
        <button
          onClick={() => store.open({ title: 'Agents', icon: '🤖', view: { kind: 'agents' } })}
          className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-left hover:bg-[var(--color-border-soft)]"
          style={{
            background: activeTabId === '{"kind":"agents"}' ? 'var(--color-accent-soft)' : 'transparent',
            color:      activeTabId === '{"kind":"agents"}' ? 'var(--color-accent)'      : 'var(--color-text)',
          }}
        >
          <Cpu size={14} />
          <span className="flex-1 text-sm">All agents</span>
          <span className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{agents.length}</span>
        </button>
        {agents.slice(0, 6).map((a) => {
          const id = JSON.stringify({ kind: 'agent', agentId: a.id })
          const active = activeTabId === id
          return (
            <button
              key={a.id}
              onClick={() => store.open({ title: a.name, icon: '🤖', view: { kind: 'agent', agentId: a.id } })}
              className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-left hover:bg-[var(--color-border-soft)]"
              style={{
                background: active ? 'var(--color-accent-soft)' : 'transparent',
                color:      active ? 'var(--color-accent)'      : 'var(--color-text)',
                paddingLeft: 24,
              }}
            >
              <span className="flex-1 truncate text-sm">{a.name}</span>
            </button>
          )
        })}
      </div>

      <div>
        <SectionLabel text="Skills" />
        <button
          onClick={() => store.open({ title: 'Skills', icon: '✨', view: { kind: 'skills' } })}
          className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-left hover:bg-[var(--color-border-soft)]"
          style={{
            background: activeTabId === '{"kind":"skills"}' ? 'var(--color-accent-soft)' : 'transparent',
            color:      activeTabId === '{"kind":"skills"}' ? 'var(--color-accent)'      : 'var(--color-text)',
          }}
        >
          <Sparkles size={14} />
          <span className="flex-1 text-sm">All skills</span>
          <span className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{skills.length}</span>
        </button>
        {skills.slice(0, 6).map((s) => {
          const id = JSON.stringify({ kind: 'skill', skillId: s.id })
          const active = activeTabId === id
          return (
            <button
              key={s.id}
              onClick={() => store.open({ title: s.displayName ?? s.name, icon: '✨', view: { kind: 'skill', skillId: s.id } })}
              className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-left hover:bg-[var(--color-border-soft)]"
              style={{
                background: active ? 'var(--color-accent-soft)' : 'transparent',
                color:      active ? 'var(--color-accent)'      : 'var(--color-text)',
                paddingLeft: 24,
              }}
            >
              <span className="flex-1 truncate text-sm">{s.displayName ?? s.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SitesList() {
  return (
    <div className="pt-1">
      <button
        onClick={() => store.open({ title: 'Sites', icon: '🌐', view: { kind: 'sites' } })}
        className="w-full flex items-center gap-2 px-2 py-1 rounded-md text-left hover:bg-[var(--color-border-soft)]"
        style={{ color: 'var(--color-text)' }}
      >
        <Globe size={14} />
        <span className="flex-1 text-sm">All sites</span>
      </button>
    </div>
  )
}

function SectionLabel({ text }: { text: string }) {
  return (
    <div className="px-2 pt-0.5 pb-1 flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold"
         style={{ color: 'var(--color-text-subtle)' }}>
      <ChevronRight size={10} className="rotate-90 opacity-60" />
      {text}
    </div>
  )
}

function NewItemRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full text-left px-2 py-1 mt-1 rounded-md text-sm hover:bg-[var(--color-border-soft)]"
      style={{ color: 'var(--color-text-subtle)' }}
    >
      <Plus size={14} />
      <span>{label}</span>
    </button>
  )
}
