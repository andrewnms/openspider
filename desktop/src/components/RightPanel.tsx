/**
 * Right side: activity rail + collapsible panel (mirror of the left Sidebar).
 *
 *   ┌─────────────────────┬──┐
 *   │  Outline            │📊│   rail = always visible (44px)
 *   │  • Heading 1        │🔗│   panel = open if rightSection != null
 *   │  • Heading 2        │🕸│   Graph icon opens the GraphView as a tab
 *   │                     │  │
 *   └─────────────────────┴──┘
 *
 * Rail icons:
 *   Outline   – tree of headings in the active doc
 *   Backlinks – soft search-based references to the active doc
 *   Graph     – global graph view (opens as a TAB, not as panel content)
 */
import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { ListTree, Link2, Network, Cpu, Sparkles, Plus } from '../lib/icons'
import { store, useStore } from '../store'
import { useActiveEditor, useEditorTick } from '../lib/editorBus'
import { k, type Agent, type Skill } from '../lib/mcp'
import { appPrompt } from '../lib/dialog'

const RAIL_WIDTH  = 44
const PANEL_WIDTH = 280

export function RightPanel() {
  const dockVisible = useStore((s) => s.dockVisible)
  const rightSec    = useStore((s) => s.rightSection)
  const activeTab   = useStore((s) => s.activeTabId)
  const tabs        = useStore((s) => s.tabs)

  // The active doc id we point Outline + Backlinks at.
  const activeDocId = useMemo(() => {
    const t = tabs.find((x) => x.id === activeTab)
    return t?.view.kind === 'doc' ? t.view.docId : null
  }, [activeTab, tabs])

  // Total dock width = panel (when section is open) + rail (when dock is on).
  // Animating the OUTER container's width gives a smooth slide-in/out that
  // pulls both pieces together — same pattern as the left Sidebar.
  const dockWidth = !dockVisible
    ? 0
    : RAIL_WIDTH + (rightSec === null ? 0 : PANEL_WIDTH)

  return (
    <motion.div
      initial={false}
      animate={{ width: dockWidth }}
      transition={{ type: 'spring', stiffness: 320, damping: 32, mass: 0.9 }}
      className="shrink-0 h-full overflow-hidden"
      style={{
        background: 'var(--color-bg-soft)',
        borderLeft: dockVisible ? '1px solid var(--color-border)' : 'none',
      }}
    >
      <div
        className="flex h-full"
        style={{ width: RAIL_WIDTH + PANEL_WIDTH }}
      >
        {/* Panel (animated) — sits LEFT of the rail since the rail is on the
           outer edge of the window. */}
        <motion.div
          initial={false}
          animate={{ width: rightSec === null ? 0 : PANEL_WIDTH, opacity: rightSec === null ? 0 : 1 }}
          transition={{
            width:   { type: 'spring', stiffness: 360, damping: 34 },
            opacity: { duration: 0.12 },
          }}
          className="overflow-hidden h-full"
          style={{ borderRight: rightSec === null ? 'none' : '1px solid var(--color-border)' }}
        >
          <div className="h-full flex flex-col" style={{ width: PANEL_WIDTH }}>
            <PanelHeader section={rightSec} />
            <div className="flex-1 overflow-y-auto">
              {rightSec === 'outline'   && <OutlineBody />}
              {rightSec === 'backlinks' && <BacklinksBody activeDocId={activeDocId} />}
              {rightSec === 'agents'    && <AgentsDrawerBody />}
              {rightSec === 'skills'    && <SkillsDrawerBody />}
            </div>
          </div>
        </motion.div>

        {/* Rail (always at fixed width) */}
        <Rail rightSec={rightSec} activeTab={activeTab} />
      </div>
    </motion.div>
  )
}

function Rail({ rightSec, activeTab }: { rightSec: string | null; activeTab: string | null }) {
  // All four upper buttons toggle a drawer panel — Agents/Skills sit at
  // the top because they're the most-used "switch context" rails; Outline
  // and Backlinks below them are doc-scoped. Graph stays at the bottom
  // because it's the only one that opens a workspace tab (no panel body).
  const graphActive = activeTab === '{"kind":"graph"}'
  return (
    <nav
      className="shrink-0 h-full flex flex-col items-center py-2"
      style={{ width: RAIL_WIDTH }}
    >
      <RailBtn
        icon={<Cpu size={16} />}
        label="Agents"
        active={rightSec === 'agents'}
        onClick={() => store.setRightSection('agents')}
      />
      <RailBtn
        icon={<Sparkles size={16} />}
        label="Skills"
        active={rightSec === 'skills'}
        onClick={() => store.setRightSection('skills')}
      />

      {/* Visual divider — separates "what's in this workspace" (above)
         from "what's in this doc" (below). Subtle but the eye picks it up. */}
      <div className="my-1.5 w-5 h-px" style={{ background: 'var(--color-border)' }} />

      <RailBtn
        icon={<ListTree size={16} />}
        label="Outline"
        active={rightSec === 'outline'}
        onClick={() => store.setRightSection('outline')}
      />
      <RailBtn
        icon={<Link2 size={16} />}
        label="Backlinks"
        active={rightSec === 'backlinks'}
        onClick={() => store.setRightSection('backlinks')}
      />

      <div className="flex-1" />

      <RailBtn
        icon={<Network size={16} />}
        label="Graph"
        active={graphActive}
        onClick={() => store.open({ title: 'Graph', icon: '🕸', view: { kind: 'graph' } })}
      />
    </nav>
  )
}

/* ────────── Panel header ─────────────────────────────────────────────
   Each drawer gets a slim 36px header with a label and (for Agents/Skills)
   a "+" affordance that scaffolds a new item without leaving the rail. */
function PanelHeader({ section }: { section: 'outline' | 'backlinks' | 'agents' | 'skills' | null }) {
  const labels: Record<string, string> = {
    outline:   'Outline',
    backlinks: 'Backlinks',
    agents:    'Agents',
    skills:    'Skills',
  }
  const label = section ? labels[section] : ''
  const showCreate = section === 'agents' || section === 'skills'
  return (
    <header className="h-9 px-3 flex items-center shrink-0 gap-2"
            style={{ borderBottom: '1px solid var(--color-border)' }}>
      <span className="text-[11px] uppercase tracking-wider font-semibold flex-1"
            style={{ color: 'var(--color-text-subtle)' }}>
        {label}
      </span>
      {showCreate && (
        <motion.button
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.92 }}
          transition={{ duration: 0.08 }}
          onClick={() => section === 'agents' ? createAgent() : createSkill()}
          title={section === 'agents' ? 'New agent' : 'New skill'}
          className="w-5 h-5 grid place-items-center rounded hover:bg-[var(--color-border-soft)]"
          style={{ color: 'var(--color-text-subtle)' }}
        >
          <Plus size={12} />
        </motion.button>
      )}
    </header>
  )
}

async function createAgent() {
  const name = await appPrompt('Agent name?'); if (!name) return
  const created = await k.createAgent({
    name,
    model: 'x-ai/grok-4-fast',
    compiledScript: 's16.log("hello!"); return { ok: true };',
  })
  store.open({ title: created.name, icon: '🤖', view: { kind: 'agent', agentId: created.id } })
}
async function createSkill() {
  const name = await appPrompt('Skill name (kebab-case)?'); if (!name) return
  const created = await k.createSkill({
    name, displayName: name, description: '',
    skillMd: `# ${name}\n\nWrite the skill here.\n`,
  })
  store.open({ title: created.displayName ?? created.name, icon: '✨', view: { kind: 'skill', skillId: created.id } })
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
      className="w-8 h-8 grid place-items-center rounded my-0.5"
      style={{
        background: active ? 'var(--color-accent)' : 'transparent',
        color:      active ? '#fff' : 'var(--color-text-muted)',
      }}
    >
      {icon}
    </motion.button>
  )
}

/* ────────── Outline body ────────── */

type Heading = { id: string; level: number; text: string }

function OutlineBody() {
  const editor = useActiveEditor()
  const tick   = useEditorTick()

  const headings: Heading[] = useMemo(() => {
    void tick
    if (!editor) return []
    try {
      const doc = editor.document as Array<{
        id: string; type: string; props?: { level?: number }; content?: unknown
      }>
      const out: Heading[] = []
      for (const block of doc) {
        if (block.type !== 'heading') continue
        const level = block.props?.level ?? 1
        const text = inlineText(block.content)
        if (!text) continue
        out.push({ id: block.id, level, text })
      }
      return out
    } catch { return [] }
  }, [editor, tick])

  return (
    <div className="px-1 py-2">
      {headings.length === 0 ? (
        <Empty msg="No headings yet. Add an H1 / H2 / H3 to see them appear here." />
      ) : (
        headings.map((h) => (
          <motion.button
            key={h.id}
            onClick={() => jumpToHeading(editor, h.id)}
            whileHover={{ x: 2 }}
            transition={{ duration: 0.08 }}
            className="w-full text-left flex items-baseline gap-1.5 px-2 py-1 rounded hover:bg-[var(--color-border-soft)]"
            style={{
              paddingLeft: 8 + (h.level - 1) * 12,
              color: 'var(--color-text)',
              fontSize: h.level === 1 ? 13 : h.level === 2 ? 12.5 : 12,
              fontWeight: h.level === 1 ? 600 : h.level === 2 ? 500 : 400,
              lineHeight: 1.4,
            }}
          >
            <span className="mono shrink-0 text-[10px]" style={{ color: 'var(--color-text-subtle)' }}>H{h.level}</span>
            <span className="truncate">{h.text}</span>
          </motion.button>
        ))
      )}
    </div>
  )
}

/* ────────── Backlinks body ────────── */

type Backlink = { id: string; title: string; icon?: string; snippet: string }

function BacklinksBody({ activeDocId }: { activeDocId: string | null }) {
  const [hits, setHits]         = useState<Backlink[] | null>(null)
  const [docTitle, setDocTitle] = useState<string | null>(null)

  useEffect(() => {
    if (!activeDocId) { setHits(null); setDocTitle(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const doc = await k.getDoc(activeDocId)
        if (cancelled) return
        setDocTitle(doc.title)
        const r = await k.search(doc.title, 30)
        if (cancelled) return
        const items = (r.items as Array<Record<string, unknown>>)
          .filter((h) => h.kind === 'doc' && String(h.id ?? '') !== activeDocId)
          .slice(0, 50)
          .map((h) => ({
            id:      String(h.id),
            title:   String(h.title ?? '(untitled)'),
            icon:    h.icon ? String(h.icon) : undefined,
            snippet: typeof h.snippet === 'string' ? h.snippet : '',
          }))
        setHits(items)
      } catch {
        if (!cancelled) setHits([])
      }
    })()
    return () => { cancelled = true }
  }, [activeDocId])

  if (!activeDocId) return <Empty msg="Open a doc to see what links to it." />
  if (hits === null) return <Empty msg="Searching for backlinks…" />
  if (hits.length === 0) return (
    <Empty msg={`No docs reference “${docTitle ?? 'this doc'}” yet.`} />
  )

  return (
    <div className="px-1 py-2">
      {hits.map((b) => (
        <motion.button
          key={b.id}
          onClick={() => store.open({ title: b.title, icon: b.icon, view: { kind: 'doc', docId: b.id } })}
          whileHover={{ x: 2 }}
          transition={{ duration: 0.08 }}
          className="w-full text-left px-3 py-2 rounded hover:bg-[var(--color-border-soft)]"
        >
          <div className="flex items-center gap-2">
            <span style={{ width: 14, textAlign: 'center' }}>{b.icon ?? '📄'}</span>
            <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>
              {b.title}
            </span>
          </div>
          {b.snippet && (
            <div className="text-[11px] mt-1 line-clamp-2 leading-snug"
                 style={{ color: 'var(--color-text-muted)' }}>
              {b.snippet}
            </div>
          )}
        </motion.button>
      ))}
    </div>
  )
}

/* ────────── Agents drawer body ──────────────────────────────────────
   Compact list view — one tap on a row opens the agent's detail tab.
   Optimistic refresh on focus so users who create from the "+" header
   button see the newcomer immediately. */
function AgentsDrawerBody() {
  const [agents, setAgents] = useState<Agent[] | null>(null)
  useEffect(() => {
    let cancelled = false
    const load = () => k.listAgents()
      .then((xs) => { if (!cancelled) setAgents(xs) })
      .catch(() => { if (!cancelled) setAgents([]) })
    load()
    // Poll lightly when the drawer is open — covers the "+" creation case
    // and any external creates from bettersync without forcing a full sub.
    const t = window.setInterval(load, 4000)
    return () => { cancelled = true; window.clearInterval(t) }
  }, [])

  if (agents === null) return <Empty msg="Loading agents…" />
  if (agents.length === 0) return (
    <Empty msg="No agents yet. Tap + above to scaffold one." />
  )

  return (
    <div className="px-1 py-2">
      {agents.map((a) => (
        <motion.button
          key={a.id}
          onClick={() => store.open({ title: a.name, icon: '🤖', view: { kind: 'agent', agentId: a.id } })}
          whileHover={{ x: 2 }}
          transition={{ duration: 0.08 }}
          className="w-full text-left px-3 py-2 rounded hover:bg-[var(--color-border-soft)]"
        >
          <div className="flex items-center gap-2">
            <span style={{ width: 16, textAlign: 'center' }}>🤖</span>
            <span className="text-sm font-medium truncate flex-1" style={{ color: 'var(--color-text)' }}>
              {a.name}
            </span>
          </div>
          {a.description ? (
            <div className="text-[11px] mt-0.5 line-clamp-2 leading-snug pl-6"
                 style={{ color: 'var(--color-text-muted)' }}>
              {a.description}
            </div>
          ) : a.model && (
            <div className="text-[10px] mt-0.5 mono pl-6"
                 style={{ color: 'var(--color-text-subtle)' }}>
              {a.model}
            </div>
          )}
        </motion.button>
      ))}
    </div>
  )
}

/* ────────── Skills drawer body ────────── */
function SkillsDrawerBody() {
  const [own, setOwn]             = useState<Skill[] | null>(null)
  const [installed, setInstalled] = useState<Skill[]>([])

  useEffect(() => {
    let cancelled = false
    const load = () => k.listSkills()
      .then((r) => { if (!cancelled) { setOwn(r.own); setInstalled(r.installed) } })
      .catch(() => { if (!cancelled) { setOwn([]); setInstalled([]) } })
    load()
    const t = window.setInterval(load, 4000)
    return () => { cancelled = true; window.clearInterval(t) }
  }, [])

  if (own === null) return <Empty msg="Loading skills…" />
  if (own.length === 0 && installed.length === 0) return (
    <Empty msg="No skills yet. Tap + above to write one." />
  )

  return (
    <div className="px-1 py-2">
      {own.length > 0 && (
        <>
          <SubHeader>Own</SubHeader>
          {own.map((s) => <SkillRow key={s.id} skill={s} />)}
        </>
      )}
      {installed.length > 0 && (
        <>
          <SubHeader className="mt-3">Installed</SubHeader>
          {installed.map((s) => <SkillRow key={s.id} skill={s} />)}
        </>
      )}
    </div>
  )
}

function SkillRow({ skill }: { skill: Skill }) {
  return (
    <motion.button
      onClick={() => store.open({
        title: skill.displayName ?? skill.name,
        icon: '✨',
        view: { kind: 'skill', skillId: skill.id },
      })}
      whileHover={{ x: 2 }}
      transition={{ duration: 0.08 }}
      className="w-full text-left px-3 py-2 rounded hover:bg-[var(--color-border-soft)]"
    >
      <div className="flex items-center gap-2">
        <span style={{ width: 16, textAlign: 'center' }}>✨</span>
        <span className="text-sm font-medium truncate flex-1" style={{ color: 'var(--color-text)' }}>
          {skill.displayName ?? skill.name}
        </span>
      </div>
      {skill.description && (
        <div className="text-[11px] mt-0.5 line-clamp-2 leading-snug pl-6"
             style={{ color: 'var(--color-text-muted)' }}>
          {skill.description}
        </div>
      )}
    </motion.button>
  )
}

function SubHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider font-semibold ${className ?? ''}`}
      style={{ color: 'var(--color-text-subtle)' }}
    >
      {children}
    </div>
  )
}

/* ────────── helpers ────────── */

function Empty({ msg }: { msg: string }) {
  return (
    <div className="px-3 py-3 text-xs leading-snug" style={{ color: 'var(--color-text-subtle)' }}>
      {msg}
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inlineText(content: any): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((c) => inlineText(c)).join('')
  if (typeof content === 'object') {
    if ('text' in content && typeof content.text === 'string') return content.text
    if ('content' in content) return inlineText(content.content)
  }
  return ''
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function jumpToHeading(editor: any, blockId: string) {
  if (!editor) return
  try {
    editor.setTextCursorPosition(blockId, 'start')
    editor.focus()
    const dom = document.querySelector(`[data-id="${blockId}"]`)
    if (dom) (dom as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (e) {
    console.warn('outline jump failed', e)
  }
}
