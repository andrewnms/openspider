/**
 * Tiny global store for app shell state (tabs, sidebars, theme, navigation).
 *
 * No Redux/Zustand. A single mutable object + subscriber set is enough for
 * a desktop app this size. Persisted slices land in localStorage.
 */
import { useEffect, useState } from 'react'

export type ViewKind =
  | { kind: 'home' }
  | { kind: 'database'; databaseId: string }
  | { kind: 'page';     pageId: string; databaseId: string }
  | { kind: 'doc';      docId: string }
  | { kind: 'agents' }
  | { kind: 'agent';    agentId: string }
  | { kind: 'skills' }
  | { kind: 'skill';    skillId: string }
  | { kind: 'sites' }
  | { kind: 'runs' }
  | { kind: 'settings' }
  | { kind: 'graph' }

export type Tab = { id: string; title: string; icon?: string; view: ViewKind }
export type RecentDoc = { id: string; title: string; icon?: string; openedAt: number }
export type Theme = 'light' | 'dark'

export type SidebarSection = 'docs' | 'databases' | 'sites'
export type RightSection   = 'outline' | 'backlinks' | 'agents' | 'skills'

type State = {
  tabs:        Tab[]
  activeTabId: string | null
  searchOpen:  boolean
  recentOpen:  boolean
  /** Master toggle for ALL chrome rails + panels. One button (in the status
   *  bar) flips this. When false the rails AND panels both go away — only
   *  the title bar, tabs, main content, and status bar remain visible. */
  dockVisible: boolean
  /** Left panel collapsed (rail still visible if dockVisible). */
  sidebarCollapsed: boolean
  /** Which section's tree is shown in the left panel (when it's open). */
  sidebarSection:   SidebarSection
  /** Right panel section. `null` = panel hidden but rail still visible. */
  rightSection:     RightSection | null
  theme:       Theme
  navBack:     ViewKind[]    // history stack
  navFwd:      ViewKind[]    // forward stack
  recentDocs:  RecentDoc[]
}

const PERSIST_KEY = 'os.shell.v1'

function loadPersisted(): Partial<State> {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch { return {} }
}
function persist() {
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify({
      dockVisible:      state.dockVisible,
      sidebarCollapsed: state.sidebarCollapsed,
      sidebarSection:   state.sidebarSection,
      rightSection:     state.rightSection,
      theme:            state.theme,
      recentDocs:       state.recentDocs.slice(0, 30),
    }))
  } catch { /* */ }
}

const persisted = loadPersisted()
const listeners = new Set<() => void>()
let state: State = {
  tabs: [],
  activeTabId: null,
  searchOpen: false,
  recentOpen: false,
  dockVisible:      persisted.dockVisible      ?? true,
  sidebarCollapsed: persisted.sidebarCollapsed ?? false,
  // Migrate stale persisted 'ai' (the section was retired when Agents/Skills
  // moved to the right rail) — fall through to 'docs' for those users.
  sidebarSection:
    (persisted.sidebarSection === 'docs' ||
     persisted.sidebarSection === 'databases' ||
     persisted.sidebarSection === 'sites')
      ? persisted.sidebarSection
      : 'docs',
  rightSection:     persisted.rightSection     ?? 'outline',
  theme:            persisted.theme            ?? 'light',
  navBack: [],
  navFwd:  [],
  recentDocs: persisted.recentDocs ?? [],
}

function notify() { for (const l of listeners) l() }

export function useStore<T>(selector: (s: State) => T): T {
  const [, force] = useState(0)
  useEffect(() => {
    const cb = () => force((n) => n + 1)
    listeners.add(cb)
    return () => { listeners.delete(cb) }
  }, [])
  return selector(state)
}

export function getState(): State { return state }

function activateView(view: ViewKind) {
  const id = JSON.stringify(view)
  return state.tabs.find((t) => t.id === id)
}

function rememberRecent(tab: Tab) {
  // Only docs go into the recent-docs palette for now. Could add pages later.
  if (tab.view.kind !== 'doc') return
  const docId = tab.view.docId
  const next: RecentDoc[] = [
    { id: docId, title: tab.title, icon: tab.icon, openedAt: Date.now() },
    ...state.recentDocs.filter((d) => d.id !== docId),
  ].slice(0, 30)
  state = { ...state, recentDocs: next }
}

export const store = {
  open(tab: Omit<Tab, 'id'>) {
    const id = JSON.stringify(tab.view)
    const existing = state.tabs.find((t) => t.id === id)
    // Push the *previous* active view onto the back stack so back/forward work.
    if (state.activeTabId && state.activeTabId !== id) {
      const prev = state.tabs.find((t) => t.id === state.activeTabId)
      if (prev) {
        state = {
          ...state,
          navBack: [...state.navBack, prev.view].slice(-50),
          navFwd:  [],
        }
      }
    }
    if (existing) {
      state = { ...state, activeTabId: existing.id }
    } else {
      const newTab: Tab = { ...tab, id }
      state = { ...state, tabs: [...state.tabs, newTab], activeTabId: id }
      rememberRecent(newTab)
    }
    persist()
    notify()
  },

  close(id: string) {
    const idx = state.tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    const next = state.tabs.filter((t) => t.id !== id)
    let activeTabId = state.activeTabId
    if (activeTabId === id) {
      activeTabId = next[idx]?.id ?? next[idx - 1]?.id ?? null
    }
    state = { ...state, tabs: next, activeTabId }
    notify()
  },

  activate(id: string) { state = { ...state, activeTabId: id }; notify() },

  // ── ui ─────────────────────────────────────────────
  setSearchOpen(v: boolean) { state = { ...state, searchOpen: v }; notify() },
  setRecentOpen(v: boolean) { state = { ...state, recentOpen: v }; notify() },
  /** The single dock toggle (status bar bottom-left). Hides BOTH activity
   *  rails AND their panels — full-screen mode. */
  toggleDock() {
    state = { ...state, dockVisible: !state.dockVisible }; persist(); notify()
  },
  toggleSidebar() {
    state = { ...state, sidebarCollapsed: !state.sidebarCollapsed }; persist(); notify()
  },
  /** Click a left-rail icon. If it's already the active section AND the panel
   *  is open, collapse the panel. Otherwise switch to it and open the panel. */
  setSidebarSection(section: SidebarSection) {
    if (state.sidebarSection === section && !state.sidebarCollapsed) {
      state = { ...state, sidebarCollapsed: true }
    } else {
      state = { ...state, sidebarSection: section, sidebarCollapsed: false }
    }
    persist(); notify()
  },
  /** Click a right-rail icon. Same toggle semantics. `null` closes the panel. */
  setRightSection(section: RightSection | null) {
    if (state.rightSection === section) {
      state = { ...state, rightSection: null }
    } else {
      state = { ...state, rightSection: section }
    }
    persist(); notify()
  },
  setTheme(t: Theme) {
    state = { ...state, theme: t }; persist()
    document.documentElement.setAttribute('data-theme', t)
    notify()
  },
  toggleTheme() {
    store.setTheme(state.theme === 'light' ? 'dark' : 'light')
  },

  // ── navigation ─────────────────────────────────────
  back() {
    const prevView = state.navBack[state.navBack.length - 1]
    if (!prevView) return
    const currentTab = state.tabs.find((t) => t.id === state.activeTabId)
    const newBack = state.navBack.slice(0, -1)
    const newFwd  = currentTab ? [currentTab.view, ...state.navFwd].slice(0, 50) : state.navFwd
    state = { ...state, navBack: newBack, navFwd: newFwd }
    // open WITHOUT pushing onto back stack — temporary direct activation
    const id = JSON.stringify(prevView)
    const existing = state.tabs.find((t) => t.id === id)
    if (existing) {
      state = { ...state, activeTabId: existing.id }
    }
    notify()
  },
  forward() {
    const nextView = state.navFwd[0]
    if (!nextView) return
    const currentTab = state.tabs.find((t) => t.id === state.activeTabId)
    const newFwd = state.navFwd.slice(1)
    const newBack = currentTab ? [...state.navBack, currentTab.view].slice(-50) : state.navBack
    state = { ...state, navBack: newBack, navFwd: newFwd }
    const id = JSON.stringify(nextView)
    const existing = state.tabs.find((t) => t.id === id)
    if (existing) {
      state = { ...state, activeTabId: existing.id }
    }
    notify()
  },
  canBack(): boolean { return state.navBack.length > 0 },
  canForward(): boolean { return state.navFwd.length > 0 },

  // Force-feed a recent-doc record (used after we look up the title via MCP).
  rememberRecentDoc(doc: { id: string; title: string; icon?: string }) {
    const next: RecentDoc[] = [
      { ...doc, openedAt: Date.now() },
      ...state.recentDocs.filter((d) => d.id !== doc.id),
    ].slice(0, 30)
    state = { ...state, recentDocs: next }; persist(); notify()
  },
}

// Apply persisted theme on module load so we never flash light → dark.
if (typeof document !== 'undefined') {
  document.documentElement.setAttribute('data-theme', state.theme)
}

void activateView // not exposed; kept for future use
