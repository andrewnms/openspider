/**
 * Top chrome bar above the tabs row.
 *
 * Layout (left → right):
 *   [traffic-lights gap] [sidebar toggle] [back] [forward] [daily-note]
 *      ⋯ flex-1 drag region ⋯
 *   [agents tab] [skills tab] | [search] [outline toggle] [theme toggle]
 *
 * Everything is no-drag except the empty middle, so the window stays draggable
 * by the bar itself.
 */
import { motion } from 'motion/react'
import {
  ArrowLeft, ArrowRight,
  Calendar, Search, Sun, Moon,
} from '../lib/icons'
import { store, useStore } from '../store'
import { k } from '../lib/mcp'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'

export function TitleBar() {
  const theme       = useStore((s) => s.theme)
  const navBackLen  = useStore((s) => s.navBack.length)
  const navFwdLen   = useStore((s) => s.navFwd.length)

  return (
    <header
      className="h-10 drag-region flex items-center gap-1 px-2 shrink-0"
      style={{
        background: 'var(--color-bg-soft)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      {/* Reserve space for macOS traffic lights */}
      <div style={{ width: 60 }} />

      {/* Left cluster: nav + workspace */}
      <div className="flex items-center gap-0.5 no-drag">
        <ChromeBtn
          title="Back (⌘[)"
          disabled={navBackLen === 0}
          onClick={() => store.back()}
        >
          <ArrowLeft size={15} />
        </ChromeBtn>
        <ChromeBtn
          title="Forward (⌘])"
          disabled={navFwdLen === 0}
          onClick={() => store.forward()}
        >
          <ArrowRight size={15} />
        </ChromeBtn>
        <Sep />
        <ChromeBtn title="Daily Note (⌘⇧D)" onClick={openDailyNote}>
          <Calendar size={15} />
        </ChromeBtn>
        <Sep />
        <WorkspaceSwitcher />
      </div>

      {/* Drag handle */}
      <div className="flex-1 h-full" />

      {/* Right cluster: global actions only.
         Agents/Skills moved to the right-rail in RightPanel; this top bar
         is now strictly navigation + search + theme + window controls. */}
      <div className="flex items-center gap-0.5 no-drag">
        <ChromeBtn title="Search (⌘K)" onClick={() => store.setSearchOpen(true)}>
          <Search size={15} />
        </ChromeBtn>
        <ChromeBtn
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          onClick={() => store.toggleTheme()}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </ChromeBtn>
      </div>
    </header>
  )
}

/* ────────── helpers ────────── */

function ChromeBtn({
  children, title, onClick, disabled,
}: {
  children: React.ReactNode; title: string; onClick?: () => void; disabled?: boolean
}) {
  return (
    <motion.button
      title={title}
      onClick={onClick}
      disabled={disabled}
      whileHover={disabled ? undefined : { scale: 1.08 }}
      whileTap={disabled ? undefined : { scale: 0.92 }}
      transition={{ duration: 0.08 }}
      className="w-7 h-7 grid place-items-center rounded-md hover:bg-[var(--color-border-soft)]"
      style={{
        color: 'var(--color-text-muted)',
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </motion.button>
  )
}

function Sep() {
  return <div className="w-px h-4 mx-1" style={{ background: 'var(--color-border)' }} />
}

/* ────────── Daily-note action ────────── */

async function openDailyNote() {
  // Path convention matches SiYuan's daily-note layout. We compute today's
  // local date and look up an existing doc whose title is YYYY-MM-DD; if
  // missing, we create one. Wrapping doc folders (Daily Notes / YYYY / MM /…)
  // come later when we ship the doc-tree feature; for now everything lands at
  // the root and just gets the date as title.
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm   = String(d.getMonth() + 1).padStart(2, '0')
  const dd   = String(d.getDate()).padStart(2, '0')
  const title = `${yyyy}-${mm}-${dd}`

  try {
    const docs = await k.listDocs()
    const existing = docs.find((doc) => doc.title === title)
    if (existing) {
      store.open({ title: existing.title, icon: existing.icon ?? '📅', view: { kind: 'doc', docId: existing.id } })
      return
    }
    const created = await k.createDoc(title, { icon: '📅' })
    store.open({ title: created.title, icon: created.icon ?? '📅', view: { kind: 'doc', docId: created.id } })
  } catch (e) {
    console.error('daily note failed', e)
  }
}
