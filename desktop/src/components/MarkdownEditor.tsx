/**
 * Notion-style block editor backed by BlockNote (MPL 2.0 — commercial-friendly).
 *
 * BlockNote ships the entire Notion-feel out of the box: slash menu, side
 * menu (drag handle + add button), formatting toolbar, multi-column layout,
 * etc. We keep the same `value: string, onChange: (md: string) => void`
 * contract that DocView already passes, so the rest of the app is untouched.
 *
 * Slash menu: BlockNote's defaults + our custom items (AI writing, today's
 * date, daily-note link, doc / database refs). Disabling the default menu
 * via the `<BlockNoteView slashMenu={false}>` prop lets us own the trigger
 * with `<SuggestionMenuController>` and merge defaults with custom entries.
 */
import { useCallback, useEffect, useRef } from 'react'
import {
  useCreateBlockNote,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  type DefaultReactSuggestionItem,
} from '@blocknote/react'
import { BlockNoteView } from '@blocknote/mantine'
import { filterSuggestionItems } from '@blocknote/core'
import '@blocknote/core/fonts/inter.css'
import '@blocknote/mantine/style.css'
import { setActiveEditor, pingEditorContent } from '../lib/editorBus'
import { useStore, store } from '../store'
import { k } from '../lib/mcp'
import { isAIConfigured } from '../lib/ai'
import { openAIMenuForSelection } from './AIMenu'
import { appPrompt, appAlert } from '../lib/dialog'

export function MarkdownEditor({
  value, onChange, placeholder,
}: { value: string; onChange: (md: string) => void; placeholder?: string }) {
  // Track the last value we serialized so we can ignore echoes from our own
  // setContent and avoid infinite update loops between editor → onChange →
  // parent state → value prop.
  const lastSerializedRef = useRef<string>(value)
  const readyRef = useRef(false)

  // Theme follows the global store so light/dark switches in real time.
  const theme = useStore((s) => s.theme)

  const editor = useCreateBlockNote({
    initialContent: undefined,
  })

  // Initial markdown → blocks parse (and any external value change).
  useEffect(() => {
    let cancelled = false
    if (value === lastSerializedRef.current && readyRef.current) return
    ;(async () => {
      const blocks = await editor.tryParseMarkdownToBlocks(value || '')
      if (cancelled) return
      editor.replaceBlocks(editor.document, blocks)
      lastSerializedRef.current = value
      readyRef.current = true
      pingEditorContent()
    })()
    return () => { cancelled = true }
  }, [value, editor])

  // Serialize blocks → markdown on every edit, push to parent + ping panels.
  useEffect(() => {
    return editor.onChange(async () => {
      if (!readyRef.current) return
      pingEditorContent()
      const md = await editor.blocksToMarkdownLossy()
      if (md === lastSerializedRef.current) return
      lastSerializedRef.current = md
      onChange(md)
    })
  }, [editor, onChange])

  // Publish the editor instance for sibling panels.
  useEffect(() => {
    setActiveEditor(editor)
    return () => { setActiveEditor(null) }
  }, [editor])

  // Build the merged slash-menu item list. Defaults from BlockNote + the
  // custom additions defined below. Memoized via useCallback because
  // SuggestionMenuController calls it on every keystroke.
  const getSlashItems = useCallback(async (query: string) => {
    const defaults = getDefaultReactSlashMenuItems(editor)
    const custom = customSlashItems(editor)
    return filterSuggestionItems([...custom, ...defaults], query)
  }, [editor])

  void placeholder

  return (
    <div className="bn-host" style={{ minHeight: '60vh' }}>
      <BlockNoteView editor={editor} theme={theme} slashMenu={false}>
        <SuggestionMenuController
          triggerCharacter="/"
          getItems={getSlashItems}
        />
      </BlockNoteView>
    </div>
  )
}

/* ────────── Custom slash items ──────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function customSlashItems(editor: any): DefaultReactSuggestionItem[] {
  return [
    {
      title: 'AI writing',
      subtext: isAIConfigured()
        ? 'Continue / summarise / rewrite with your LLM'
        : 'Configure in Settings → AI first',
      aliases: ['ai', 'gpt', 'llm', 'write'],
      group: 'AI',
      icon: <span style={{ fontSize: 14 }}>✨</span>,
      onItemClick: async () => {
        if (!isAIConfigured()) {
          await appAlert('Configure your AI endpoint + model in Settings → AI first.')
          store.open({ title: 'Settings', icon: '⚙️', view: { kind: 'settings' } })
          return
        }
        // Pull a small context window — last 1000 chars of the doc — and use
        // the cursor's current block as the "selection" for the AI menu.
        try {
          const md = await editor.blocksToMarkdownLossy?.() ?? ''
          openAIMenuForSelection({
            x: window.innerWidth / 2 - 160,
            y: window.innerHeight / 3,
            selection: '',
            context:   md.slice(-1500),
          })
        } catch {
          openAIMenuForSelection({
            x: window.innerWidth / 2 - 160,
            y: window.innerHeight / 3,
            selection: '',
            context:   '',
          })
        }
      },
    },
    {
      title: "Today's date",
      subtext: 'Insert YYYY-MM-DD at the cursor',
      aliases: ['date', 'today', 'now'],
      group: 'Insert',
      icon: <span style={{ fontSize: 14 }}>📅</span>,
      onItemClick: () => {
        const d = new Date()
        const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        editor.insertInlineContent?.(stamp + ' ')
      },
    },
    {
      title: 'Daily note',
      subtext: "Open or create today's daily note",
      aliases: ['daily', 'journal'],
      group: 'Insert',
      icon: <span style={{ fontSize: 14 }}>📓</span>,
      onItemClick: async () => {
        const d = new Date()
        const title = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        try {
          const docs = await k.listDocs()
          const existing = docs.find((doc) => doc.title === title)
          const doc = existing ?? await k.createDoc(title, { icon: '📅' })
          store.open({ title: doc.title, icon: doc.icon ?? '📅', view: { kind: 'doc', docId: doc.id } })
        } catch (e) {
          console.error('daily note failed', e)
        }
      },
    },
    {
      title: 'Doc link',
      subtext: 'Insert a [[wiki link]] to another doc',
      aliases: ['link', 'doc', 'ref', 'wiki'],
      group: 'Insert',
      icon: <span style={{ fontSize: 14 }}>🔗</span>,
      onItemClick: async () => {
        const docs = await k.listAllDocs().catch(() => [])
        if (docs.length === 0) {
          await appAlert('No docs to link to yet. Create one first.')
          return
        }
        const titles = docs.map((d) => d.title).join(' · ')
        const pick = await appPrompt(
          'Type the exact title of the doc to link to:',
          docs[0].title,
        )
        if (!pick) return
        const match = docs.find((d) => d.title.toLowerCase() === pick.toLowerCase())
        if (!match) {
          await appAlert(`No doc named "${pick}". Available: ${titles.slice(0, 200)}…`)
          return
        }
        editor.insertInlineContent?.(`[[${match.title}]] `)
      },
    },
    {
      title: 'Database link',
      subtext: 'Reference a database by name',
      aliases: ['database', 'db', 'table'],
      group: 'Insert',
      icon: <span style={{ fontSize: 14 }}>📋</span>,
      onItemClick: async () => {
        const dbs = await k.listDatabases().catch(() => [])
        if (dbs.length === 0) {
          await appAlert('No databases yet. Create one from the sidebar first.')
          return
        }
        const pick = await appPrompt(
          'Type the database name to link:',
          dbs[0].name,
        )
        if (!pick) return
        const match = dbs.find((d) => d.name.toLowerCase() === pick.toLowerCase())
        if (!match) {
          await appAlert(`No database named "${pick}".`)
          return
        }
        editor.insertInlineContent?.(`[[${match.name}]] `)
      },
    },
  ]
}
