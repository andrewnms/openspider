/**
 * Promise-based dialog system. Replaces window.prompt/confirm/alert which
 * are disabled in the Tauri WKWebView.
 *
 * Usage:
 *   const name = await appPrompt('Database name?')
 *   if (await appConfirm('Delete this?')) ...
 *   await appAlert('Saved.')
 *
 * Render <DialogHost /> ONCE near the top of the app.
 *
 * Aesthetic: zen-minimal, Notion-ish. Soft shadow, hairline border,
 * 0.33em corner radius. No chrome.
 */
import { useEffect, useRef, useState } from 'react'

const RADIUS = '0.33em'

type DialogState =
  | { kind: 'prompt';  message: string; defaultValue?: string; okLabel?: string }
  | { kind: 'confirm'; message: string; okLabel?: string; danger?: boolean }
  | { kind: 'alert';   message: string; okLabel?: string }

type Resolver = (value: string | boolean | null) => void

let setDialogState: ((s: DialogState | null) => void) | null = null
let activeResolver: Resolver | null = null

function show(state: DialogState, resolver: Resolver) {
  if (!setDialogState) {
    if (state.kind === 'prompt')  return resolver(window.prompt(state.message, state.defaultValue ?? ''))
    if (state.kind === 'confirm') return resolver(window.confirm(state.message))
    window.alert(state.message); return resolver(null)
  }
  activeResolver?.(null)
  activeResolver = resolver
  setDialogState(state)
}

export function appPrompt(message: string, defaultValue = '', okLabel?: string): Promise<string | null> {
  return new Promise((resolve) => {
    show(
      { kind: 'prompt', message, defaultValue, okLabel },
      (v) => resolve(typeof v === 'string' ? v : null),
    )
  })
}

export function appConfirm(message: string, opts: { okLabel?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    show(
      { kind: 'confirm', message, ...opts },
      (v) => resolve(v === true),
    )
  })
}

export function appAlert(message: string, okLabel?: string): Promise<void> {
  return new Promise((resolve) => {
    show(
      { kind: 'alert', message, okLabel },
      () => resolve(),
    )
  })
}

/* ────────── React host ──────────────────────────────────────────────── */

export function DialogHost() {
  const [state, setState] = useState<DialogState | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDialogState = setState
    return () => { setDialogState = null }
  }, [])

  useEffect(() => {
    if (state?.kind === 'prompt') {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [state])

  if (!state) return null

  function close(value: string | boolean | null) {
    const r = activeResolver
    activeResolver = null
    setState(null)
    r?.(value)
  }

  function submit() {
    if (state?.kind === 'prompt')        close(inputRef.current?.value ?? '')
    else if (state?.kind === 'confirm')  close(true)
    else                                 close(null)
  }

  const okLabel =
    state.okLabel ??
    (state.kind === 'prompt'  ? 'Create' :
     state.kind === 'confirm' ? 'OK'     : 'OK')

  const isDanger = state.kind === 'confirm' && state.danger

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center no-drag"
      style={{ background: 'rgba(15,15,15,0.32)' }}
      onMouseDown={() => close(null)}
      onKeyDown={(e) => { if (e.key === 'Escape') close(null) }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[440px] max-w-[92vw] no-drag"
        style={{
          background: 'var(--color-bg-strong)',
          border: '1px solid var(--color-border)',
          borderRadius: RADIUS,
          boxShadow:
            '0 1px 2px rgba(15,15,15,0.04), 0 12px 32px -8px rgba(15,15,15,0.18)',
        }}
      >
        {/* Body */}
        <div className="px-5 pt-5 pb-4">
          <div
            className="text-[15px] font-medium leading-snug"
            style={{ color: 'var(--color-text)' }}
          >
            {state.message}
          </div>

          {state.kind === 'prompt' && (
            <input
              ref={inputRef}
              defaultValue={state.defaultValue ?? ''}
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === 'Enter')  { e.preventDefault(); submit() }
                if (e.key === 'Escape') { e.preventDefault(); close(null) }
              }}
              className="w-full mt-3 px-3 py-2 text-[14px] outline-none transition-colors"
              style={{
                color: 'var(--color-text)',
                background: 'var(--color-bg-soft)',
                border: '1px solid var(--color-border)',
                borderRadius: RADIUS,
              }}
              onFocus={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent)'
              }}
              onBlur={(e) => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)'
              }}
            />
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end items-center gap-2 px-4 pb-4">
          {state.kind !== 'alert' && (
            <button
              onClick={() => close(null)}
              className="px-3 py-1.5 text-[13px] font-medium transition-colors"
              style={{
                color: 'var(--color-text-muted)',
                borderRadius: RADIUS,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-soft)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              Cancel
            </button>
          )}
          <button
            autoFocus={state.kind !== 'prompt'}
            onClick={submit}
            className="px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors"
            style={{
              background: isDanger ? 'var(--color-danger)' : 'var(--color-accent)',
              borderRadius: RADIUS,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.filter = 'brightness(0.92)'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.filter = 'none'
            }}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
