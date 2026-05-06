import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { RightPanel } from './components/RightPanel'
import { StatusBar } from './components/StatusBar'
import { Tabs } from './components/Tabs'
import { SearchPalette } from './components/SearchPalette'
import { RecentPalette } from './components/RecentPalette'
import { WorkspacePicker } from './components/WorkspacePicker'
import { AIMenu } from './components/AIMenu'
import { DialogHost } from './lib/dialog'
import { useStore, store } from './store'
import { k } from './lib/mcp'

import { HomeView } from './views/HomeView'
import { DatabaseView } from './views/DatabaseView'
import { PageView } from './views/PageView'
import { DocView } from './views/DocView'
import { AgentsListView, AgentView } from './views/AgentsView'
import { SkillsListView, SkillView } from './views/SkillsView'
import { SitesListView } from './views/SitesView'
import { RunsView } from './views/RunsView'
import { SettingsView } from './views/SettingsView'
import { GraphView } from './views/GraphView'
import { CardsView } from './views/CardsView'

export default function App() {
  const tabs        = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const active      = tabs.find((t) => t.id === activeTabId)

  // Global shortcuts. ⌘ and Ctrl behave identically so the app feels right
  // on every platform we may eventually ship to.
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta) return

      // Don't hijack arrow-style nav shortcuts when the user is typing into
      // an editable field — palette/sidebar/theme shortcuts still work.
      const target = e.target as HTMLElement | null
      const isTyping = !!target && (
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      )

      switch (e.key.toLowerCase()) {
        case 'k':                          // ⌘K — search
          e.preventDefault(); store.setSearchOpen(true); break
        case 'e':                          // ⌘E — recent docs
          e.preventDefault(); store.setRecentOpen(true); break
        case '\\':                         // ⌘\ — toggle the entire dock (both rails + panels)
          e.preventDefault(); store.toggleDock(); break
        case '[':                          // ⌘[ — back
          if (isTyping) return
          e.preventDefault(); store.back(); break
        case ']':                          // ⌘] — forward
          if (isTyping) return
          e.preventDefault(); store.forward(); break
        case 'd':                          // ⌘⇧D — daily note
          if (!e.shiftKey) return
          e.preventDefault(); openDailyNote(); break
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [])

  return (
    <div
      className="h-full w-full flex flex-col"
      style={{ background: 'var(--color-bg)' }}
    >
      <TitleBar />

      <div className="flex-1 flex min-h-0">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0">
          <Tabs />
          <div className="flex-1 overflow-hidden">
            {!active && <HomeView />}
            {active?.view.kind === 'home'     && <HomeView />}
            {active?.view.kind === 'database' && <DatabaseView databaseId={active.view.databaseId} />}
            {active?.view.kind === 'page'     && <PageView pageId={active.view.pageId} databaseId={active.view.databaseId} />}
            {active?.view.kind === 'doc'      && <DocView docId={active.view.docId} />}
            {active?.view.kind === 'agents'   && <AgentsListView />}
            {active?.view.kind === 'agent'    && <AgentView agentId={active.view.agentId} />}
            {active?.view.kind === 'skills'   && <SkillsListView />}
            {active?.view.kind === 'skill'    && <SkillView skillId={active.view.skillId} />}
            {active?.view.kind === 'sites'    && <SitesListView />}
            {active?.view.kind === 'runs'     && <RunsView />}
            {active?.view.kind === 'settings' && <SettingsView />}
            {active?.view.kind === 'graph'    && <GraphView />}
            {active?.view.kind === 'cards'    && <CardsView />}
          </div>
        </main>
        <RightPanel />
      </div>

      <StatusBar />

      <SearchPalette />
      <RecentPalette />
      <AIMenu />
      <DialogHost />
      <WorkspacePicker />
      <ToastHost />
    </div>
  )
}

/** Lightweight global toast — listens for `os:toast` CustomEvents and pops
 *  a 1.2s pill in the bottom-right. Used by the doc-tree menu's Copy actions
 *  (and any other "did this just work?" feedback we add later). One slot,
 *  newest wins; if you fire two in quick succession the second replaces. */
function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let timer: number | null = null
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent).detail
      setMsg(typeof detail === 'string' ? detail : String(detail ?? ''))
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => setMsg(null), 1200)
    }
    window.addEventListener('os:toast', onToast)
    return () => {
      window.removeEventListener('os:toast', onToast)
      if (timer) window.clearTimeout(timer)
    }
  }, [])
  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.12 }}
          className="fixed bottom-12 right-6 z-[200] px-3 py-2 text-xs font-medium shadow-lg"
          style={{
            background: 'var(--color-text)',
            color:      'var(--color-bg-strong)',
            borderRadius: '0.5rem',
          }}
        >
          ✓ {msg}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Daily-note shortcut handler. Same convention as the title-bar button. */
async function openDailyNote() {
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
