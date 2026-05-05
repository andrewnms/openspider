import { X } from 'lucide-react'
import { store, useStore } from '../store'

export function Tabs() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)

  if (tabs.length === 0) return <div className="h-10 drag-region" />

  return (
    <div
      className="h-10 flex items-stretch drag-region overflow-x-auto"
      style={{ background: 'var(--color-bg-soft)', borderBottom: '1px solid var(--color-border)' }}
    >
      {tabs.map((t) => {
        const active = t.id === activeTabId
        return (
          <div
            key={t.id}
            className="no-drag flex items-center gap-2 px-3 text-sm cursor-pointer shrink-0 border-r"
            style={{
              borderRightColor: 'var(--color-border)',
              background: active ? 'var(--color-bg-strong)' : 'transparent',
              color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
              borderBottom: active ? '2px solid var(--color-accent)' : '2px solid transparent',
            }}
            onClick={() => store.activate(t.id)}
          >
            {t.icon && <span className="text-xs">{t.icon}</span>}
            <span className="truncate max-w-[200px]">{t.title}</span>
            <button
              className="opacity-50 hover:opacity-100 ml-1"
              onClick={(e) => { e.stopPropagation(); store.close(t.id) }}
              title="Close"
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
      <div className="flex-1 drag-region" />
    </div>
  )
}
