import { useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { Tabs } from './components/Tabs'
import { SearchPalette } from './components/SearchPalette'
import { useStore, store } from './store'
import { HomeView } from './views/HomeView'
import { DatabaseView } from './views/DatabaseView'
import { PageView } from './views/PageView'
import { DocView } from './views/DocView'
import { AgentsListView, AgentView } from './views/AgentsView'
import { SkillsListView, SkillView } from './views/SkillsView'
import { SitesListView } from './views/SitesView'
import { RunsView } from './views/RunsView'
import { SettingsView } from './views/SettingsView'

export default function App() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const active = tabs.find((t) => t.id === activeTabId)

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        store.setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [])

  return (
    <div className="h-full w-full flex" style={{ background: 'var(--color-bg)' }}>
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
        </div>
      </main>
      <SearchPalette />
    </div>
  )
}
