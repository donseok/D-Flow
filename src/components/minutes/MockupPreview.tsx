'use client'
import { useState } from 'react'
import { useLocale } from '@/components/providers/LocaleProvider'
import type { MockupComponent, MockupScreen, MockupSpec } from '@/lib/domain/mockup'

/**
 * 와이어프레임 목업 미리보기 — 명세(검증을 지난 MockupSpec)를 고정 부품으로만 그린다. 글은 모두 텍스트 노드라 HTML 이 실행되지 않는다.
 * 화면 탭으로 오가고, goto 가 있는 버튼·탭을 누르면 그 화면으로 이동하며 이전 화면으로 돌아갈 수 있다. 색은 테마 토큰만 쓴다.
 */
function Part({
  c,
  screensById,
  go,
}: {
  c: MockupComponent
  screensById: ReadonlyMap<string, MockupScreen>
  go: (id: string | null) => void
}) {
  const { t } = useLocale()
  const [activeTab, setActiveTab] = useState(0)
  const box = 'rounded border border-border-input bg-surface px-2.5 py-1.5 text-sm'
  const targetScreen = c.goto ? screensById.get(c.goto) : undefined

  switch (c.type) {
    case 'heading':
      return <h3 className="text-base font-semibold text-fg">{c.text}</h3>
    case 'text':
      return <p className="text-sm text-fg-secondary">{c.text}</p>
    case 'badge': {
      const badges = c.items.length > 0 ? c.items : c.text ? [c.text] : []
      return (
        <div className="flex flex-wrap gap-1.5">
          {badges.map((b, n) => (
            <span key={n} className="rounded-full border border-border bg-surface-subtle px-2.5 py-0.5 text-xs font-medium text-fg-secondary">
              {b}
            </span>
          ))}
        </div>
      )
    }
    case 'stats': {
      const stats = c.items.length > 0 ? c.items : c.text ? [c.text] : []
      return (
        <div className="grid gap-2 sm:grid-cols-3">
          {stats.map((s, n) => (
            <div key={n} className="rounded-lg border border-border bg-surface-subtle px-3 py-2 text-xs font-medium text-fg">
              {s}
            </div>
          ))}
        </div>
      )
    }
    case 'input': {
      if (c.items.length > 0) {
        return (
          <div className="grid gap-2 sm:grid-cols-2">
            {c.items.map((label, n) => (
              <div key={n} className="space-y-0.5">
                <div className="text-xs text-fg-muted">{label}</div>
                <div className={`${box} text-fg-disabled`}>&nbsp;</div>
              </div>
            ))}
          </div>
        )
      }
      return (
        <div className="space-y-0.5">
          <div className="text-xs text-fg-muted">{c.text}</div>
          <div className={`${box} text-fg-disabled`}>&nbsp;</div>
        </div>
      )
    }
    case 'select':
      return (
        <div className="space-y-0.5">
          <div className="text-xs text-fg-muted">{c.text}</div>
          <div className={`${box} text-fg-muted`}>{c.items[0] ?? '▾'} ▾</div>
        </div>
      )
    case 'button':
      return (
        <button
          type="button"
          disabled={!c.goto}
          onClick={() => go(c.goto)}
          className="btn btn-ghost h-9 border border-border-input text-sm"
        >
          <span>{c.text}</span>
          {targetScreen && (
            <span className="ml-1 text-xs text-fg-muted">
              {t('min.mockup.gotoPrefix')} {targetScreen.title}
            </span>
          )}
        </button>
      )
    case 'list':
      return (
        <div className="space-y-1">
          {c.text && <div className="text-xs font-medium text-fg-muted">{c.text}</div>}
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-fg-secondary">
            {c.items.map((i, n) => <li key={n}>{i}</li>)}
          </ul>
        </div>
      )
    case 'table':
      return (
        <div className="space-y-1 overflow-x-auto">
          {c.text && <div className="text-xs font-medium text-fg-muted">{c.text}</div>}
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {c.items.map((i, n) => (
                  <th key={n} className="border border-border bg-surface-subtle px-2 py-1 text-left font-medium text-fg">{i}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1].map(r => (
                <tr key={r}>
                  {c.items.map((_, n) => (
                    <td key={n} className="border border-border px-2 py-1 text-fg-disabled">&nbsp;</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'card':
      return (
        <div
          onClick={c.goto ? () => go(c.goto) : undefined}
          className={`rounded border border-border bg-surface-subtle px-3 py-2 text-sm text-fg space-y-1 ${c.goto ? 'cursor-pointer hover:border-border-focus' : ''}`}
        >
          <div className="flex items-center justify-between gap-2">
            {c.text && <div className="font-medium">{c.text}</div>}
            {targetScreen && (
              <span className="text-xs text-fg-muted">
                {t('min.mockup.gotoPrefix')} {targetScreen.title}
              </span>
            )}
          </div>
          {c.items.length > 0 && (
            <ul className="list-disc pl-4 text-xs text-fg-secondary space-y-0.5">
              {c.items.map((item, n) => <li key={n}>{item}</li>)}
            </ul>
          )}
        </div>
      )
    case 'tabs':
      return (
        <div className="flex flex-wrap gap-1 border-b border-border">
          {c.items.map((i, n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setActiveTab(n)
                if (c.goto) go(c.goto)
              }}
              className={`px-3 py-1.5 text-sm ${n === activeTab ? 'border-b-2 border-border-focus font-medium text-fg' : 'text-fg-muted'}`}
            >
              {i}
            </button>
          ))}
        </div>
      )
    case 'image':
      return (
        <div className="flex h-24 items-center justify-center rounded border border-dashed border-border-input bg-surface-subtle text-xs text-fg-muted">
          {c.text || 'image'}
        </div>
      )
  }
}

export function MockupPreview({ spec }: { spec: MockupSpec }) {
  const { t } = useLocale()
  const [current, setCurrent] = useState(spec.screens[0].id)
  const [history, setHistory] = useState<string[]>([])
  const screensById = new Map(spec.screens.map(s => [s.id, s]))
  const screen = screensById.get(current) ?? spec.screens[0]

  const selectTab = (id: string) => {
    if (id !== screen.id) {
      setHistory(prev => [...prev.slice(-10), screen.id])
      setCurrent(id)
    }
  }

  const go = (id: string | null) => {
    if (id && screensById.has(id) && id !== screen.id) {
      setHistory(prev => [...prev.slice(-10), screen.id])
      setCurrent(id)
    }
  }

  const goBack = () => {
    setHistory(prev => {
      const target = prev.at(-1)
      if (target && screensById.has(target)) setCurrent(target)
      return prev.slice(0, -1)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label={t('min.mockup.screens')} className="flex flex-wrap gap-1">
          {spec.screens.map(s => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === screen.id}
              onClick={() => selectTab(s.id)}
              className={`rounded border px-2.5 py-1 text-sm ${
                s.id === screen.id
                  ? 'border-border-focus bg-surface-selected font-medium text-fg'
                  : 'border-border text-fg-secondary'
              }`}
            >
              {s.title}
            </button>
          ))}
        </div>
        {history.length > 0 && (
          <button type="button" onClick={goBack} className="btn btn-ghost h-8 px-2.5 text-xs">
            {t('min.mockup.back')}
          </button>
        )}
      </div>

      {screen.summary && (
        <p className="rounded-lg border border-border bg-surface-subtle px-3 py-1.5 text-xs text-fg-secondary">
          {screen.summary}
        </p>
      )}

      <div data-testid="mockup-screen" className="space-y-3 rounded border border-border bg-surface p-4">
        {screen.components.length === 0
          ? <p className="text-sm text-fg-muted">{t('min.mockup.empty')}</p>
          : screen.components.map((c, n) => <Part key={`${screen.id}-${n}`} c={c} screensById={screensById} go={go} />)}
      </div>
    </div>
  )
}
