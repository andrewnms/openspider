import { useEffect, useState } from 'react'
import { Activity } from '../lib/icons'
import { k, type Run } from '../lib/mcp'

export function RunsView() {
  const [runs, setRuns] = useState<Run[]>([])
  useEffect(() => { k.listRuns(undefined, 50).then(setRuns) }, [])

  return (
    <div className="h-full overflow-auto px-8 py-8" style={{ background: 'var(--color-bg-strong)' }}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center mb-6">
          <Activity size={24} className="mr-2" />
          <h1 className="text-2xl font-bold">Recent runs</h1>
        </div>

        <div className="rounded-lg" style={{ border: '1px solid var(--color-border)' }}>
          {runs.map((r, i) => (
            <div key={r.id} className="grid grid-cols-[120px_120px_1fr_auto] items-center px-4 py-2 text-sm"
                 style={{ borderBottom: i === runs.length - 1 ? 'none' : '1px solid var(--color-border-soft)' }}>
              <span className="mono text-xs"
                    style={{ color: r.status === 'success' ? 'var(--color-success)' : r.status === 'failed' ? 'var(--color-danger)' : 'var(--color-text-subtle)' }}>
                ● {r.status}
              </span>
              <span className="font-medium truncate">{r.agentName ?? r.agentId.slice(0, 8)}</span>
              <span style={{ color: 'var(--color-text-muted)' }}>
                {r.scriptLogs?.[0] ?? r.error ?? r.output?.slice(0, 80) ?? '—'}
              </span>
              <span className="text-xs mono" style={{ color: 'var(--color-text-subtle)' }}>
                {r.startedAt.replace('T', ' ').split('.')[0]}
              </span>
            </div>
          ))}
          {runs.length === 0 && <div className="px-4 py-12 text-center text-sm" style={{ color: 'var(--color-text-subtle)' }}>No runs yet.</div>}
        </div>
      </div>
    </div>
  )
}
