/**
 * Database table cell that switches between display and edit mode based on
 * the property type. Save on Enter / blur, cancel on Escape.
 *
 * Behavior by `type`:
 *   text/email/url/phone/number → single-line input
 *   title                       → single-line input (also used for primary)
 *   select / status             → dropdown of options from `propertyConfig.options`
 *   checkbox                    → click toggles
 *   multi_select / relation     → comma-separated input → string[]
 *   date                        → date input
 *   anything else               → readonly text
 */
import { useEffect, useRef, useState } from 'react'

export type CellEditProps = {
  value:    unknown
  type:     string
  options?: Array<{ name: string }>     // for select/multi_select/status
  primary?: boolean
  onSave:   (newValue: unknown) => void | Promise<void>
}

export function EditableCell({ value, type, options, primary, onSave }: CellEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState<string>(formatForInput(value, type))
  const inputRef              = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(formatForInput(value, type)) }, [value, type])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  // Checkbox: no edit mode, just toggle on click.
  if (type === 'checkbox') {
    const checked = !!value
    return (
      <button
        onClick={(e) => { e.stopPropagation(); void onSave(!checked) }}
        className="text-sm"
      >
        {checked ? '✓' : '·'}
      </button>
    )
  }

  if (!editing) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); setEditing(true) }}
        onDoubleClick={(e) => { e.stopPropagation(); setEditing(true) }}
        className="w-full text-left"
      >
        <CellDisplay value={value} type={type} primary={primary} />
      </button>
    )
  }

  // Edit mode: pick the right control.
  const commit = async (raw: string) => {
    setEditing(false)
    const next = parseFromInput(raw, type)
    if (sameValue(next, value)) return
    await onSave(next)
  }
  const cancel = () => { setDraft(formatForInput(value, type)); setEditing(false) }

  if ((type === 'select' || type === 'status') && options && options.length > 0) {
    return (
      <select
        ref={inputRef as unknown as React.RefObject<HTMLSelectElement>}
        autoFocus
        defaultValue={String(value ?? '')}
        onChange={(e) => commit(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="bg-transparent border rounded px-1 py-0.5 text-sm w-full"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <option value="">—</option>
        {options.map((o) => <option key={o.name} value={o.name}>{o.name}</option>)}
      </select>
    )
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Enter')  { e.preventDefault(); commit(draft) }
        if (e.key === 'Escape') { e.preventDefault(); cancel() }
      }}
      type={inputType(type)}
      className="bg-transparent border rounded px-1 py-0.5 text-sm w-full focus:border-[var(--color-accent)] outline-none"
      style={{ borderColor: 'var(--color-border)' }}
    />
  )
}

/* ── helpers ───────────────────────────────────────────────────────────── */

function CellDisplay({ value, type, primary }: { value: unknown; type: string; primary?: boolean }) {
  if (value == null || value === '') {
    return <span style={{ color: 'var(--color-text-subtle)' }}>—</span>
  }
  if (type === 'select' || type === 'status') {
    return <span className="text-xs px-2 py-0.5 rounded-full"
      style={{ background: 'var(--color-accent-soft)', color: 'var(--color-accent)' }}>{String(value)}</span>
  }
  if ((type === 'multi_select' || type === 'relation') && Array.isArray(value)) {
    return <div className="flex gap-1 flex-wrap">
      {value.map((x, i) => (
        <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-bg-soft)]">
          {String(x).replace(/^\[\[|\]\]$/g, '').split('|')[0]}
        </span>
      ))}
    </div>
  }
  const s = String(value)
  return <span className={primary ? 'font-medium' : ''}>{s.length > 80 ? s.slice(0, 80) + '…' : s}</span>
}

function formatForInput(value: unknown, type: string): string {
  if (value == null) return ''
  if (type === 'multi_select' || type === 'relation') {
    if (Array.isArray(value)) return value.map(String).join(', ')
  }
  return String(value)
}

function parseFromInput(s: string, type: string): unknown {
  const trimmed = s.trim()
  if (trimmed === '') return null
  if (type === 'number') { const n = Number(trimmed); return isNaN(n) ? null : n }
  if (type === 'multi_select' || type === 'relation') {
    return trimmed.split(',').map(x => x.trim()).filter(Boolean)
  }
  return trimmed
}

function inputType(type: string): string {
  if (type === 'number') return 'number'
  if (type === 'email')  return 'email'
  if (type === 'url')    return 'url'
  if (type === 'date')   return 'date'
  if (type === 'phone')  return 'tel'
  return 'text'
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((x, i) => x === b[i])
  return false
}
