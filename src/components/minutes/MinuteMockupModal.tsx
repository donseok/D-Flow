'use client'
import { useState } from 'react'
import { AlertTriangle, FileText, LayoutTemplate, LoaderCircle, RefreshCw } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { useLocale } from '@/components/providers/LocaleProvider'
import { DesignSpecPreview } from './DesignSpecPreview'
import { MockupPreview } from './MockupPreview'
import type { DesignSpec, MockupSpec } from '@/lib/domain/mockup'
import type { MinuteDesignSpecResult, MinuteMockupResult } from '@/app/actions/minuteMockup'

export type BlueprintTab = 'spec' | 'mockup'

/**
 * 회의록 → 프로그램 설계서 추출 · 와이어프레임 화면 목업 통합 창.
 * - 설계서 탭과 화면 목업 탭을 한 창에서 바로 오갈 수 있고, 아직 불러오지 않은 탭을 누르면 즉시 생성한다.
 * - 하단 피드백 입력란으로 보완 지시를 적어 다시 생성하면 세션 내 버전(v1, v2…)으로 쌓여 전후를 비교할 수 있다.
 * - 단일 spec 만 넘기는 호출(<MinuteMockupModal spec={...} onClose={...} />)도 그대로 지원한다.
 */
export function MinuteMockupModal({
  spec,
  designSpec,
  initialTab,
  onLoadSpec,
  onLoadMockup,
  onClose,
}: {
  spec?: MockupSpec | null
  designSpec?: DesignSpec | null
  initialTab?: BlueprintTab
  onLoadSpec?: (feedback?: string, currentDraft?: DesignSpec | null) => Promise<MinuteDesignSpecResult>
  onLoadMockup?: (feedback?: string, currentDraft?: MockupSpec | null) => Promise<MinuteMockupResult>
  onClose: () => void
}) {
  const { t } = useLocale()
  const startTab: BlueprintTab = initialTab ?? (designSpec && !spec ? 'spec' : 'mockup')
  const [tab, setTab] = useState<BlueprintTab>(startTab)

  const [specVersions, setSpecVersions] = useState<DesignSpec[]>(designSpec ? [designSpec] : [])
  const [specIndex, setSpecIndex] = useState(0)
  const [mockupVersions, setMockupVersions] = useState<MockupSpec[]>(spec ? [spec] : [])
  const [mockupIndex, setMockupIndex] = useState(0)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')

  const currentSpec = specVersions[specIndex] ?? null
  const currentMockup = mockupVersions[mockupIndex] ?? null
  const canSwitchTabs = Boolean((specVersions.length > 0 || onLoadSpec) && (mockupVersions.length > 0 || onLoadMockup))
  const canRegenerate = tab === 'spec' ? Boolean(onLoadSpec) : Boolean(onLoadMockup)

  async function switchTab(next: BlueprintTab) {
    if (next === tab || busy) return
    setError(null)
    setTab(next)
    if (next === 'spec' && specVersions.length === 0 && onLoadSpec) {
      setBusy(true)
      try {
        const res = await onLoadSpec()
        if (res.ok) {
          setSpecVersions([res.value])
          setSpecIndex(0)
        } else {
          setError(res.error)
        }
      } catch {
        setError(t('min.spec.failed'))
      } finally {
        setBusy(false)
      }
    } else if (next === 'mockup' && mockupVersions.length === 0 && onLoadMockup) {
      setBusy(true)
      try {
        const res = await onLoadMockup()
        if (res.ok) {
          setMockupVersions([res.value])
          setMockupIndex(0)
        } else {
          setError(res.error)
        }
      } catch {
        setError(t('min.mockup.failed'))
      } finally {
        setBusy(false)
      }
    }
  }

  async function onRegenerate(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const trimmed = feedback.trim()
    setError(null)
    setBusy(true)
    try {
      if (tab === 'spec' && onLoadSpec) {
        const res = await onLoadSpec(trimmed, currentSpec)
        if (res.ok) {
          const nextIdx = specVersions.length
          setSpecVersions(prev => [...prev, res.value])
          setSpecIndex(nextIdx)
          setFeedback('')
        } else {
          setError(res.error)
        }
      } else if (tab === 'mockup' && onLoadMockup) {
        const res = await onLoadMockup(trimmed, currentMockup)
        if (res.ok) {
          const nextIdx = mockupVersions.length
          setMockupVersions(prev => [...prev, res.value])
          setMockupIndex(nextIdx)
          setFeedback('')
        } else {
          setError(res.error)
        }
      }
    } catch {
      setError(tab === 'spec' ? t('min.spec.failed') : t('min.mockup.failed'))
    } finally {
      setBusy(false)
    }
  }

  const versions = tab === 'spec' ? specVersions : mockupVersions
  const activeVersionIndex = tab === 'spec' ? specIndex : mockupIndex
  const setVersionIndex = tab === 'spec' ? setSpecIndex : setMockupIndex
  const modalTitle = tab === 'spec' ? t('min.spec.title') : t('min.mockup.title')

  return (
    <Modal
      open
      onClose={() => { if (!busy) onClose() }}
      title={modalTitle}
      size="lg"
      notice={
        <div className="space-y-2">
          {error && (
            <p role="alert" className="flex items-start gap-1.5 text-sm text-danger">
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </p>
          )}
          {canRegenerate && (
            <form onSubmit={e => void onRegenerate(e)} className="flex items-center gap-2">
              <input
                type="text"
                value={feedback}
                disabled={busy}
                onChange={e => setFeedback(e.target.value)}
                placeholder={t('min.blueprint.feedbackPlaceholder')}
                className="app-input h-9 flex-1 text-xs"
              />
              <button
                type="submit"
                disabled={busy}
                className="btn btn-primary h-9 shrink-0 px-3 text-xs"
              >
                {busy
                  ? <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />
                  : <RefreshCw aria-hidden className="h-3.5 w-3.5" />}
                {busy ? t('min.blueprint.regenerating') : t('min.blueprint.regenerate')}
              </button>
            </form>
          )}
          <p className="text-xs text-fg-muted">{t('min.mockup.notice')}</p>
        </div>
      }
    >
      <div className="space-y-4">
        {(canSwitchTabs || versions.length > 1) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2.5">
            {canSwitchTabs ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  data-testid="blueprint-tab-spec"
                  disabled={busy}
                  onClick={() => void switchTab('spec')}
                  className={`btn h-8 px-3 text-xs ${tab === 'spec' ? 'btn-primary' : 'btn-ghost'}`}
                >
                  <FileText aria-hidden className="h-3.5 w-3.5" />
                  {t('min.blueprint.tabSpec')}
                </button>
                <button
                  type="button"
                  data-testid="blueprint-tab-mockup"
                  disabled={busy}
                  onClick={() => void switchTab('mockup')}
                  className={`btn h-8 px-3 text-xs ${tab === 'mockup' ? 'btn-primary' : 'btn-ghost'}`}
                >
                  <LayoutTemplate aria-hidden className="h-3.5 w-3.5" />
                  {t('min.blueprint.tabMockup')}
                </button>
              </div>
            ) : <span />}

            {versions.length > 1 && (
              <div className="flex items-center gap-1">
                {versions.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={busy}
                    onClick={() => setVersionIndex(idx)}
                    className={`rounded border px-2 py-0.5 text-xs ${
                      idx === activeVersionIndex
                        ? 'border-border-focus bg-surface-selected font-semibold text-fg'
                        : 'border-border text-fg-muted'
                    }`}
                  >
                    v{idx + 1}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {busy && ((tab === 'spec' && !currentSpec) || (tab === 'mockup' && !currentMockup)) ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-fg-secondary">
            <LoaderCircle aria-hidden className="h-4 w-4 animate-spin text-action" />
            <span>{t('min.blueprint.loadingTab')}</span>
          </div>
        ) : tab === 'spec' ? (
          currentSpec ? <DesignSpecPreview spec={currentSpec} /> : null
        ) : (
          currentMockup ? <MockupPreview key={mockupIndex} spec={currentMockup} /> : null
        )}
      </div>
    </Modal>
  )
}
