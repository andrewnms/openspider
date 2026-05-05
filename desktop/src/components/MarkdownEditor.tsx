/**
 * Markdown editor: Tiptap (ProseMirror) + tiptap-markdown for round-trip.
 * Plus a custom WikiLink extension that renders [[Title]] / [[Title|uuid]]
 * as clickable inline chips. Click → resolve target → open in a tab.
 */
import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { Node, mergeAttributes, Extension, type InputRule } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { k } from '../lib/mcp'
import { store } from '../store'

/* ────────── Wiki-link extension ──────────────────────────────────────── */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wikiLink: { insertWikiLink: (title: string, uuid?: string) => ReturnType }
  }
}

const WikiLink = Node.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      title: { default: '' },
      uuid:  { default: null as string | null },
    }
  },

  parseHTML() {
    return [{
      tag: 'a[data-wiki-link]',
      getAttrs: (el) => {
        const t = el.getAttribute('data-title') ?? ''
        const u = el.getAttribute('data-uuid') ?? null
        return { title: t, uuid: u }
      },
    }]
  },

  renderHTML({ HTMLAttributes }) {
    const title = HTMLAttributes.title ?? ''
    const uuid  = HTMLAttributes.uuid
    return ['a',
      mergeAttributes({
        'data-wiki-link': 'true',
        'data-title': title,
        'data-uuid':  uuid ?? '',
        class: 'wiki-link',
        href: '#',
      }),
      `${title}`,
    ]
  },

  // Save back as plain markdown text [[title|uuid]] / [[title]].
  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void }, node: { attrs: { title: string; uuid: string | null } }) {
          const { title, uuid } = node.attrs
          state.write(uuid ? `[[${title}|${uuid}]]` : `[[${title}]]`)
        },
        parse: {
          /* parsing handled below via input rule + a regex pre-pass */
        },
      },
    }
  },

  addInputRules() {
    const type = this.type
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rule: any = {
      find: /\[\[([^\]|]+?)(?:\|([0-9a-f-]+))?\]\]$/,
      handler: ({ state, range, match }: { state: any; range: { from: number; to: number }; match: RegExpMatchArray }) => {
        const title = match[1].trim()
        const uuid  = match[2] ?? null
        const tr = state.tr.replaceWith(range.from, range.to, type.create({ title, uuid }))
        tr.insertText(' ')
      },
      undoable: true,
    }
    return [rule] as InputRule[]
  },
})

/** After Markdown.serialize() runs, parse [[…]] in the resulting text into
 *  WikiLink nodes. We do this by intercepting the markdown.set() value when
 *  we LOAD content. Cleaner than fighting tiptap-markdown's parser pipeline. */
function preprocessMarkdownLoad(md: string): string {
  // No-op: WikiLink input rule handles user typing. For initial load we
  // convert [[…]] to inline-html `<a data-wiki-link …>` so Tiptap's HTML
  // parser materializes the node.
  return md.replace(/\[\[([^\]|\n]+?)(?:\|([0-9a-f-]+))?\]\]/g, (_, title, uuid) => {
    const safe = String(title).replace(/"/g, '&quot;')
    const u = uuid ? String(uuid).replace(/"/g, '&quot;') : ''
    return `<a data-wiki-link="true" data-title="${safe}" data-uuid="${u}" class="wiki-link" href="#">${safe}</a>`
  })
}

/* ────────── Wiki-link autocomplete (suggestion on `[[`) ─────────────── */

type WikiSuggestionItem = {
  title: string
  uuid:  string
  kind:  'page' | 'doc'
  databaseId?: string
}

const WIKI_SUGGESTION_KEY = new PluginKey('wikiSuggestion')

/** Returns a Tiptap Extension that fires a popup when the user types `[[`.
 *  The popup is a simple positioned div populated with results from openspider
 *  search. Selecting one inserts a WikiLink node with the canonical uuid. */
function makeWikiSuggestion(setPopup: (p: PopupState | null) => void) {
  return Extension.create({
    name: 'wikiSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          char: '[[',
          allowSpaces: true,
          startOfLine: false,
          pluginKey: WIKI_SUGGESTION_KEY,
          command: ({ editor, range, props }) => {
            const item = props as WikiSuggestionItem
            // Replace the trigger range ("[[query") with a WikiLink node + space.
            editor.chain()
              .focus()
              .deleteRange(range)
              .insertContent({
                type: 'wikiLink',
                attrs: { title: item.title, uuid: item.uuid },
              })
              .insertContent(' ')
              .run()
          },
          items: async ({ query }) => {
            // Query workspace search; map hits into suggestion items.
            try {
              const r = await k.search(query || '', 8)
              const hits = r.items as Array<Record<string, unknown>>
              const out: WikiSuggestionItem[] = []
              for (const h of hits) {
                if (h.kind === 'page' && typeof h.id === 'string' && typeof h.databaseId === 'string') {
                  out.push({ title: String(h.primaryTitle ?? '(untitled)'), uuid: h.id, kind: 'page', databaseId: h.databaseId })
                } else if (h.kind === 'doc' && typeof h.id === 'string') {
                  out.push({ title: String(h.title ?? '(untitled)'), uuid: h.id, kind: 'doc' })
                }
              }
              return out
            } catch { return [] }
          },
          render: () => {
            // Light-weight portal: position a div, mutate items list, expose
            // arrow/Enter handlers via `onKeyDown`.
            let selected = 0
            let items: WikiSuggestionItem[] = []
            let onSelect: ((idx: number) => void) | null = null

            return {
              onStart: (props) => {
                items = props.items as WikiSuggestionItem[]
                selected = 0
                onSelect = (idx: number) => props.command(items[idx])
                const r = props.clientRect?.()
                if (r) setPopup({ x: r.left, y: r.bottom + 4, items, selected, onSelect })
              },
              onUpdate: (props) => {
                items = props.items as WikiSuggestionItem[]
                if (selected >= items.length) selected = 0
                onSelect = (idx: number) => props.command(items[idx])
                const r = props.clientRect?.()
                if (r) setPopup({ x: r.left, y: r.bottom + 4, items, selected, onSelect })
              },
              onKeyDown: ({ event }) => {
                if (event.key === 'ArrowDown') { selected = (selected + 1) % Math.max(items.length, 1); setPopup({ items, selected, onSelect: onSelect!, x: 0, y: 0, _stick: true }); return true }
                if (event.key === 'ArrowUp')   { selected = (selected - 1 + items.length) % Math.max(items.length, 1); setPopup({ items, selected, onSelect: onSelect!, x: 0, y: 0, _stick: true }); return true }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  if (items[selected]) { onSelect?.(selected); return true }
                }
                if (event.key === 'Escape') { setPopup(null); return true }
                return false
              },
              onExit: () => { setPopup(null) },
            }
          },
        }),
      ]
    },
  })
}

type PopupState = {
  x: number
  y: number
  items: WikiSuggestionItem[]
  selected: number
  onSelect: (idx: number) => void
  _stick?: boolean // when true, ignore x/y (keep last anchor)
}

/* ────────── Wiki-link click resolver ──────────────────────────────────── */

async function openWikiTarget(title: string, uuid: string | null) {
  // Try uuid-based lookup first (stable). Search both pages and docs.
  if (uuid) {
    try { const p = await k.getPage(uuid); store.open({ title: p.primaryTitle, view: { kind: 'page', pageId: p.id, databaseId: p.databaseId } }); return } catch { /* */ }
    try { const d = await k.getDoc(uuid);  store.open({ title: d.title, icon: d.icon, view: { kind: 'doc', docId: d.id } }); return } catch { /* */ }
  }
  // Title-based fallback via search.
  const r = await k.search(title, 5)
  const hit = (r.items as Array<Record<string, unknown>>).find(
    (h) => String(h.primaryTitle ?? h.title ?? '') === title,
  ) ?? r.items[0]
  if (!hit) return
  const h = hit as Record<string, unknown>
  if (h.kind === 'page' && typeof h.id === 'string' && typeof h.databaseId === 'string') {
    store.open({ title: String(h.primaryTitle), view: { kind: 'page', pageId: h.id, databaseId: h.databaseId } })
  } else if (h.kind === 'doc' && typeof h.id === 'string') {
    store.open({ title: String(h.title), view: { kind: 'doc', docId: h.id } })
  }
}

/* ────────── React component ──────────────────────────────────────────── */

export function MarkdownEditor({
  value, onChange, placeholder = 'Start writing…',
}: { value: string; onChange: (md: string) => void; placeholder?: string }) {
  const initialRef = useRef(preprocessMarkdownLoad(value))
  const valueRef = useRef(value)
  const [popup, setPopup] = useState<PopupState | null>(null)
  const popupAnchor = useRef<{ x: number; y: number } | null>(null)
  // Keep last anchor when only selection is updating (arrow nav)
  if (popup && !popup._stick) popupAnchor.current = { x: popup.x, y: popup.y }
  const drawX = popup?._stick ? popupAnchor.current?.x ?? 0 : popup?.x ?? 0
  const drawY = popup?._stick ? popupAnchor.current?.y ?? 0 : popup?.y ?? 0

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder }),
      Markdown.configure({
        html: true,
        linkify: true,
        breaks: true,
        transformPastedText: true,
      }),
      WikiLink,
      makeWikiSuggestion(setPopup),
    ],
    content: initialRef.current,
    onUpdate: ({ editor }) => {
      // tiptap-markdown attaches getMarkdown() under storage.markdown
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m = (editor.storage as any).markdown as { getMarkdown?: () => string } | undefined
      const md = m?.getMarkdown?.() ?? editor.getHTML()
      valueRef.current = md
      onChange(md)
    },
    editorProps: {
      attributes: {
        class: 'tiptap prose-base focus:outline-none w-full max-w-none',
      },
      handleClick: (_view, _pos, event) => {
        const t = event.target as HTMLElement
        if (t?.closest('a[data-wiki-link]')) {
          event.preventDefault()
          const a = t.closest('a[data-wiki-link]') as HTMLAnchorElement
          const title = a.getAttribute('data-title') ?? ''
          const uuid  = a.getAttribute('data-uuid') || null
          void openWikiTarget(title, uuid)
          return true
        }
        return false
      },
    },
  })

  // Keep editor in sync if `value` changes from outside (eg. switching tabs).
  useEffect(() => {
    if (!editor) return
    if (value !== valueRef.current) {
      valueRef.current = value
      editor.commands.setContent(preprocessMarkdownLoad(value), { emitUpdate: false })
    }
  }, [value, editor])

  return (
    <>
      <EditorContent editor={editor as Editor | null} />
      {popup && popup.items.length > 0 && (
        <div
          className="fixed z-50 w-64 rounded-lg shadow-xl overflow-hidden no-drag"
          style={{
            left: drawX,
            top:  drawY,
            background: 'var(--color-bg-strong)',
            border: '1px solid var(--color-border)',
          }}
        >
          {popup.items.map((it, i) => (
            <button
              key={`${it.kind}:${it.uuid}`}
              onClick={() => popup.onSelect(i)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm"
              style={{
                background: i === popup.selected ? 'var(--color-accent-soft)' : 'transparent',
                color: i === popup.selected ? 'var(--color-accent)' : 'var(--color-text)',
              }}
            >
              <span className="text-xs uppercase tracking-wider w-12"
                    style={{ color: 'var(--color-text-subtle)' }}>{it.kind}</span>
              <span className="flex-1 truncate">{it.title}</span>
            </button>
          ))}
        </div>
      )}
    </>
  )
}

// Suppress unused-imports until we need them.
void useImperativeHandle; void forwardRef
