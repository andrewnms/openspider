/**
 * Top-level error boundary.
 *
 * If any view subtree crashes, we want the user to see a recoverable error
 * card instead of a blank window. The "Reload" button reaches outside React
 * and asks the WKWebView to reload the document — cheaper than persisting
 * arbitrary state through a remount.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null; info: ErrorInfo | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App-level error caught:', error, info)
    this.setState({ error, info })
  }

  reset = () => this.setState({ error: null, info: null })
  reload = () => window.location.reload()

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div
        className="h-full w-full grid place-items-center"
        style={{ background: 'var(--color-bg)' }}
      >
        <div
          className="max-w-[520px] w-full mx-6 p-6"
          style={{
            background: 'var(--color-bg-strong)',
            border: '1px solid var(--color-border)',
            borderRadius: '0.5rem',
            boxShadow: '0 12px 32px -8px rgba(15,15,15,0.18)',
          }}
        >
          <div className="text-[11px] uppercase tracking-wider font-semibold mb-2"
               style={{ color: 'var(--color-danger)' }}>
            ⚠ Something broke
          </div>
          <h1 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text)' }}>
            The view crashed.
          </h1>
          <p className="text-sm leading-snug mb-4" style={{ color: 'var(--color-text-muted)' }}>
            Your data is safe — it's still on disk. Try recovering or reloading.
          </p>

          <pre
            className="mono text-[11px] leading-snug overflow-auto p-3 mb-4"
            style={{
              background: 'var(--color-bg-soft)',
              border: '1px solid var(--color-border)',
              borderRadius: '0.33em',
              color: 'var(--color-text-muted)',
              maxHeight: 180,
            }}
          >
            {this.state.error.message}
            {this.state.error.stack && '\n\n' + this.state.error.stack.split('\n').slice(0, 6).join('\n')}
          </pre>

          <div className="flex justify-end gap-2">
            <button
              onClick={this.reset}
              className="px-3 py-1.5 text-sm font-medium rounded hover:bg-[var(--color-border-soft)]"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Try again
            </button>
            <button
              onClick={this.reload}
              className="px-3 py-1.5 text-sm font-medium text-white rounded"
              style={{ background: 'var(--color-accent)' }}
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
