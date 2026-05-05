/**
 * Tiny global store for the active selection + open tabs. We don't need
 * Redux/Zustand for this — a single object with subscribers is enough.
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

type Tab = { id: string; title: string; icon?: string; view: ViewKind }
type State = {
  tabs:        Tab[]
  activeTabId: string | null
  searchOpen:  boolean
}

const listeners = new Set<() => void>()
let state: State = { tabs: [], activeTabId: null, searchOpen: false }

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

export const store = {
  open(tab: Omit<Tab, 'id'>) {
    const id = JSON.stringify(tab.view)
    const existing = state.tabs.find((t) => t.id === id)
    if (existing) {
      state = { ...state, activeTabId: existing.id }
    } else {
      state = { ...state, tabs: [...state.tabs, { ...tab, id }], activeTabId: id }
    }
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
  setSearchOpen(v: boolean) { state = { ...state, searchOpen: v }; notify() },
}
