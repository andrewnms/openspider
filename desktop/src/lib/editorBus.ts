/**
 * Tiny pub/sub for the "currently focused editor."
 *
 * The MarkdownEditor component publishes its BlockNote instance here on mount;
 * panels like the OutlinePanel subscribe to read headings, jump to blocks, etc.
 *
 * Why a global bus instead of React context? Outline lives at the App layer,
 * the editor lives inside DocView/MarkdownEditor. A context would force one
 * Provider per editor mount/unmount and a re-render of the entire tree on
 * every keystroke when we wire up live updates. A flat subscriber set lets
 * us scope re-renders to just the panels that care.
 */
import { useEffect, useState } from 'react'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = any  // BlockNote's editor type isn't exported in a stable way

let current: AnyEditor | null = null
const listeners = new Set<() => void>()
const tickListeners = new Set<() => void>()  // fires on content updates too

export function setActiveEditor(ed: AnyEditor | null) {
  current = ed
  for (const l of listeners) l()
}

export function getActiveEditor(): AnyEditor | null { return current }

/** Notify subscribers that the *contents* changed (not just identity). */
export function pingEditorContent() {
  for (const l of tickListeners) l()
}

/** Hook returning the active editor; re-renders when identity changes. */
export function useActiveEditor(): AnyEditor | null {
  const [, force] = useState(0)
  useEffect(() => {
    const cb = () => force((n) => n + 1)
    listeners.add(cb)
    return () => { listeners.delete(cb) }
  }, [])
  return current
}

/** Hook that re-renders whenever pingEditorContent() fires. */
export function useEditorTick(): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const cb = () => setTick((n) => n + 1)
    tickListeners.add(cb)
    return () => { tickListeners.delete(cb) }
  }, [])
  return tick
}
