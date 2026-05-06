/**
 * Inline AI menu for the editor.
 *
 * Two entry points:
 *   - Floating "✨ Ask AI" button that anchors to the current text selection
 *     (only shown when the selection is non-empty).
 *   - Open programmatically via `openAIMenuForSelection()` — the slash menu
 *     calls this for the "AI writing" item.
 *
 * Streaming results are rendered into the editor live: we capture the cursor
 * position, then feed each token into BlockNote's `insertInlineContent` so
 * the user watches the AI write in real time.
 */
import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles, Square, X } from '../lib/icons'
import { useActiveEditor } from '../lib/editorBus'
import {
  AI_ACTIONS, isAIConfigured, streamChat,
  type AIAction,
} from '../lib/ai'
import { appPrompt, appAlert } from './../lib/dialog'

/* ────────── Module-level open() so other components can trigger ────── */

type MenuRequest = { x: number; y: number; selection: string; context: string }
let setRequest: ((r: MenuRequest | null) => void) | null = null

export function openAIMenuForSelection(req: MenuRequest) {
  setRequest?.(req)
}

/* ────────── Component ────────── */

export function AIMenu() {
  const editor = useActiveEditor()
  const [request, setRequestState] = useState<MenuRequest | null>(null)
  const [running, setRunning]      = useState(false)
  const [streamed, setStreamed]    = useState('')
  const abortRef                   = useRef<AbortController | null>(null)
  const ref                        = useRef<HTMLDivElement>(null)

  // Auto-show the floating "✨ Ask AI" trigger when selection becomes non-empty.
  const [trigger, setTrigger] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    setRequest = setRequestState
    return () => { setRequest = null }
  }, [])

  // Watch the active editor for selection changes; show the trigger when text
  // is highlighted (NOT a caret-only selection).
  useEffect(() => {
    if (!editor) return
    function update() {
      try {
        const sel = window.getSelection?.()
        if (!sel || sel.isCollapsed || !sel.rangeCount) { setTrigger(null); return }
        const range = sel.getRangeAt(0)
        if (!range || range.collapsed) { setTrigger(null); return }
        const rect = range.getBoundingClientRect()
        if (rect.width === 0 && rect.height === 0) { setTrigger(null); return }
        // Anchor the button just to the right of the selection's end.
        setTrigger({ x: rect.right + 6, y: rect.top - 4 })
      } catch { setTrigger(null) }
    }
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [editor])

  // Esc closes the menu while open.
  useEffect(() => {
    if (!request) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { abortRef.current?.abort(); setRequestState(null) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [request])

  function openFromTrigger() {
    if (!trigger) return
    const sel = window.getSelection?.()?.toString() ?? ''
    if (!sel) return
    setRequestState({
      x: trigger.x, y: trigger.y + 22,
      selection: sel,
      context: getDocumentContext(editor),
    })
  }

  async function runAction(action: AIAction) {
    if (!request) return
    if (!isAIConfigured()) {
      await appAlert('Configure your AI endpoint + model in Settings → AI first.')
      return
    }
    let promptOverride: string | undefined
    if (action.id === 'custom') {
      const p = await appPrompt('What should the AI do with this selection?')
      if (!p) return
      promptOverride = p
    }

    setRunning(true)
    setStreamed('')
    abortRef.current?.abort()
    abortRef.current = new AbortController()

    const messages = action.build({
      selection: request.selection,
      context:   request.context,
      promptOverride,
    })

    let acc = ''
    try {
      acc = await streamChat(messages, (delta) => {
        acc += delta
        setStreamed(acc)
      }, { signal: abortRef.current.signal })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.includes('aborted')) return
      await appAlert(`AI failed: ${msg}`)
      setRunning(false)
      return
    }

    // Insert the result into the editor based on the action's mode.
    try {
      if (!editor) return
      if (action.mode === 'replace') {
        // Best-effort: BlockNote's selected text replacement.
        editor.insertInlineContent?.(acc)
      } else if (action.mode === 'append' || action.mode === 'insertAfter') {
        // Insert below the current selection as a new paragraph.
        const cursorBlock = editor.getTextCursorPosition?.()
        if (cursorBlock) {
          editor.insertBlocks?.(
            [{ type: 'paragraph', content: acc }],
            cursorBlock.block,
            'after',
          )
        } else {
          editor.insertInlineContent?.(acc)
        }
      }
    } catch (e) {
      console.error('AI insert failed', e)
    }

    setRunning(false)
    setRequestState(null)
  }

  return (
    <>
      {/* Floating trigger button when text is selected */}
      <AnimatePresence>
        {trigger && !request && (
          <motion.button
            initial={{ opacity: 0, scale: 0.9, y: -2 }}
            animate={{ opacity: 1, scale: 1,   y: 0 }}
            exit={{    opacity: 0, scale: 0.9, y: -2 }}
            transition={{ duration: 0.1 }}
            onMouseDown={(e: React.MouseEvent) => { e.preventDefault(); openFromTrigger() }}
            className="fixed z-40 flex items-center gap-1 px-2 py-1 text-xs font-medium shadow-lg"
            style={{
              left: trigger.x, top: trigger.y,
              background: 'var(--color-accent)',
              color: '#fff',
              borderRadius: '0.33em',
            }}
            title="Ask AI (about the selection)"
          >
            <Sparkles size={11} />
            Ask AI
          </motion.button>
        )}
      </AnimatePresence>

      {/* Action menu / streaming preview */}
      <AnimatePresence>
        {request && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: -4 }}
            animate={{ opacity: 1, scale: 1,    y: 0 }}
            exit={{    opacity: 0, scale: 0.97, y: -4 }}
            transition={{ duration: 0.12, ease: [0.16, 1, 0.3, 1] }}
            ref={ref}
            className="fixed z-50 w-[320px]"
            style={{
              left: Math.min(request.x, window.innerWidth - 340),
              top:  Math.min(request.y, window.innerHeight - 360),
              background: 'var(--color-bg-strong)',
              border: '1px solid var(--color-border)',
              borderRadius: '0.5rem',
              boxShadow: '0 12px 32px -8px rgba(15,15,15,0.32)',
            }}
            onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <header className="px-3 py-2 flex items-center gap-2"
                    style={{ borderBottom: '1px solid var(--color-border-soft)' }}>
              <Sparkles size={13} style={{ color: 'var(--color-accent)' }} />
              <span className="text-[11px] uppercase tracking-wider font-semibold flex-1"
                    style={{ color: 'var(--color-text-subtle)' }}>
                Artificial Intelligence
              </span>
              <button
                onClick={() => { abortRef.current?.abort(); setRequestState(null) }}
                className="opacity-50 hover:opacity-100"
              ><X size={13} /></button>
            </header>

            {!running && !streamed && (
              <div className="py-1 max-h-[320px] overflow-y-auto">
                {AI_ACTIONS.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => runAction(a)}
                    className="w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-[var(--color-border-soft)]"
                  >
                    <div className="text-sm" style={{ color: 'var(--color-text)' }}>{a.label}</div>
                    {a.hint && (
                      <div className="text-[11px]" style={{ color: 'var(--color-text-subtle)' }}>{a.hint}</div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {(running || streamed) && (
              <div className="px-3 py-3">
                <div className="text-[11px] uppercase tracking-wider font-semibold mb-2"
                     style={{ color: 'var(--color-text-subtle)' }}>
                  {running ? 'Generating…' : 'Done'}
                </div>
                <div
                  className="text-sm leading-snug max-h-[260px] overflow-y-auto whitespace-pre-wrap"
                  style={{ color: 'var(--color-text)' }}
                >
                  {streamed || '·'}
                </div>
                <div className="flex justify-end gap-2 mt-3">
                  {running && (
                    <button
                      onClick={() => { abortRef.current?.abort(); setRunning(false) }}
                      className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-[var(--color-border-soft)]"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      <Square size={10} /> Stop
                    </button>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/* ────────── helpers ────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getDocumentContext(editor: any): string {
  if (!editor) return ''
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = (editor.storage as any)?.markdown as { getMarkdown?: () => string } | undefined
    const md = m?.getMarkdown?.()
    if (md) return md.slice(-2000) // last ~2k chars as context
    // BlockNote variant
    if (editor.blocksToMarkdownLossy) {
      // best-effort sync access; if async, fall back to ''
      return ''
    }
  } catch { /* */ }
  return ''
}
