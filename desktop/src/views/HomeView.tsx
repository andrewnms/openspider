import { Sparkles, Database, FileText, Cpu, Globe } from 'lucide-react'
import { store } from '../store'

export function HomeView() {
  const cards = [
    { icon: <Database size={20} />, title: 'Databases', desc: 'Typed tables, properties, relations.', view: { kind: 'database' as const, databaseId: '' } },
    { icon: <FileText size={20} />, title: 'Docs',      desc: 'Markdown notes with wiki-links.',       view: { kind: 'doc' as const, docId: '' } },
    { icon: <Cpu size={20} />,      title: 'Agents',    desc: 'Compiled JS that runs on triggers.',     view: { kind: 'agents' as const } },
    { icon: <Sparkles size={20} />, title: 'Skills',    desc: 'Reusable instructions for agents.',      view: { kind: 'skills' as const } },
    { icon: <Globe size={20} />,    title: 'Sites',     desc: 'Publishable mini-websites with VFS.',    view: { kind: 'sites' as const } },
  ]
  return (
    <div className="h-full grid place-items-center" style={{ background: 'var(--color-bg-strong)' }}>
      <div className="max-w-2xl text-center px-8">
        <div className="text-5xl mb-3">🕷</div>
        <h1 className="text-3xl font-bold mb-2">Welcome to your local OpenSpider.</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--color-text-muted)' }}>
          Pick a section in the sidebar, or jump in:
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {cards.map((c) => (
            <button
              key={c.title}
              onClick={() => store.open({ title: c.title, view: c.view as never })}
              className="text-left p-4 rounded-lg hover:shadow-md transition-shadow"
              style={{ background: 'var(--color-bg-soft)', border: '1px solid var(--color-border)' }}
            >
              <div style={{ color: 'var(--color-accent)' }}>{c.icon}</div>
              <div className="font-semibold mt-2">{c.title}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>{c.desc}</div>
            </button>
          ))}
        </div>
        <div className="mt-8 text-xs mono" style={{ color: 'var(--color-text-subtle)' }}>
          ⌘K to search · ⌘N for new doc · ⌘W to close tab
        </div>
      </div>
    </div>
  )
}
