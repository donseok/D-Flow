'use client'
// 다른 팀으로 합치기(팀 유연화 2단계) — 대상 고르기 → 옮겨질 건수 미리보기 → 확인. 공용 팀·프로젝트 팀 관리 화면이 같이 쓴다.
// 병합은 되돌릴 수 없다 — 그래서 대상을 고르면 원본 팀을 가리키는 것의 건수를 먼저 읽어 보이고, 그 건수를 본 뒤에만 확인 단추가 열린다.
// 판정(범위·등급·충돌)은 서버가 한다. 화면은 후보를 "같은 목록의 다른 활성 팀"으로만 좁힌다.
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useLocale } from '@/components/providers/LocaleProvider'
import { teamLabel } from '@/lib/domain/teamLabel'
import type { DictKey } from '@/lib/i18n/dict'
import type { TeamMergeSummary, TeamRefCounts } from '@/lib/teams/teamOps'

interface TeamOption { id: string; code: string; name: string; active: boolean }

type Preview =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; counts: TeamRefCounts }
  | { state: 'error'; error: string }

const IMPACT: readonly { key: keyof TeamRefCounts; msg: DictKey }[] = [
  { key: 'itemOwners', msg: 'settings.teams.mergeImpact.itemOwners' },
  { key: 'memberTeams', msg: 'settings.teams.mergeImpact.memberTeams' },
  { key: 'areaTeams', msg: 'settings.teams.mergeImpact.areaTeams' },
  { key: 'minutes', msg: 'settings.teams.mergeImpact.minutes' },
  { key: 'minuteFolders', msg: 'settings.teams.mergeImpact.minuteFolders' },
  { key: 'invites', msg: 'settings.teams.mergeImpact.invites' },
  { key: 'credentials', msg: 'settings.teams.mergeImpact.credentials' },
]

export function TeamMergeDialog({ source, teams, onClose, onPreview, onMerge, onMerged }: {
  /** 합쳐 없앨(비활성으로 남길) 팀 — null 이면 닫힌 상태 */
  source: TeamOption | null
  /** 같은 목록의 팀 전부 — 대상 후보는 여기서 원본을 뺀 활성 팀 */
  teams: readonly TeamOption[]
  onClose: () => void
  onPreview: (targetId: string) => Promise<{ ok: true; counts: TeamRefCounts } | { ok: false; error: string }>
  onMerge: (targetId: string) => Promise<{ ok: true; summary: TeamMergeSummary } | { ok: false; error: string }>
  /** 병합이 끝났다 — 부모가 알림·새로고침을 한다 */
  onMerged: (target: TeamOption, summary: TeamMergeSummary) => void
}) {
  const { t } = useLocale()
  const [targetId, setTargetId] = useState('')
  const [preview, setPreview] = useState<Preview>({ state: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const mergingRef = useRef(false)
  // 대상을 빠르게 바꿔 고를 때 늦게 온 앞 응답이 지금 고른 대상의 건수를 덮지 않게 한다
  const seq = useRef(0)

  // 다른 팀의 합치기를 열면 앞 선택을 지운다
  const sourceId = source?.id ?? null
  useEffect(() => {
    seq.current += 1
    setTargetId(''); setPreview({ state: 'idle' }); setError(null)
  }, [sourceId])

  if (!source) return null
  const candidates = teams.filter((x) => x.id !== source.id && x.active)
  const target = candidates.find((x) => x.id === targetId) ?? null

  const close = () => { if (!mergingRef.current) onClose() }

  async function pick(id: string) {
    setTargetId(id); setError(null)
    const mine = ++seq.current
    if (!id) { setPreview({ state: 'idle' }); return }
    setPreview({ state: 'loading' })
    const r = await onPreview(id)
    if (mine !== seq.current) return
    // 건수를 못 읽었으면 확인 단추를 열지 않는다 — 무엇이 옮겨지는지 모르는 채 합치게 두지 않는다(표시 = 로깅)
    setPreview(r.ok ? { state: 'ready', counts: r.counts } : { state: 'error', error: r.error })
  }

  async function merge() {
    if (mergingRef.current || !target || preview.state !== 'ready') return
    mergingRef.current = true; setMerging(true); setError(null)
    try {
      const r = await onMerge(target.id)
      if (!r.ok) { setError(r.error || t('settings.teams.mergeFailed')); return }
      onMerged(target, r.summary)
    } finally {
      mergingRef.current = false; setMerging(false)
    }
  }

  const shown = preview.state === 'ready' ? IMPACT.filter(({ key }) => preview.counts[key] > 0) : []
  return (
    <Modal open onClose={close} title={t('settings.teams.mergeDialogTitle')} size="sm"
      footer={
        <>
          <button type="button" className="btn btn-ghost" disabled={merging} onClick={close}>{t('settings.teams.cancel')}</button>
          <button type="button" className="btn btn-primary" data-team-merge-confirm
            disabled={merging || !target || preview.state !== 'ready'} onClick={() => void merge()}>
            {merging ? t('settings.teams.mergeRunning') : t('settings.teams.mergeConfirm')}
          </button>
        </>
      }>
      <div className="space-y-3" data-team-merge={source.id}>
        <p className="text-sm leading-6 text-fg-secondary">{t('settings.teams.mergeDialogDesc').replaceAll('{name}', source.name)}</p>
        {candidates.length === 0 ? (
          <p data-team-merge-none className="rounded-lg bg-surface-subtle px-3 py-2 text-sm text-fg-secondary">{t('settings.teams.mergeNoTarget')}</p>
        ) : (
          <label className="flex flex-col gap-1 text-sm font-medium text-fg">
            {t('settings.teams.mergeTargetLabel')}
            <select data-team-merge-target className="app-input" value={targetId} disabled={merging} onChange={(e) => void pick(e.target.value)}>
              <option value="">{t('settings.teams.mergeTargetPlaceholder')}</option>
              {candidates.map((x) => <option key={x.id} value={x.id}>{teamLabel(x, candidates)}</option>)}
            </select>
          </label>
        )}
        {preview.state === 'loading' && <p role="status" className="text-sm text-fg-muted">{t('settings.teams.mergeLoading')}</p>}
        {preview.state === 'error' && <p role="alert" className="rounded-lg bg-danger-weak px-3 py-2 text-sm text-danger">{preview.error}</p>}
        {preview.state === 'ready' && (
          <div data-team-merge-impact className="rounded-lg border border-border px-3 py-2">
            <p className="text-sm font-medium text-fg">{t('settings.teams.mergeImpactTitle')}</p>
            {shown.length === 0 ? (
              <p className="mt-1 text-sm text-fg-secondary">{t('settings.teams.mergeImpactNone')}</p>
            ) : (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-fg-secondary">
                {shown.map(({ key, msg }) => <li key={key} data-team-merge-count={key}>{t(msg).replace('{n}', String(preview.counts[key]))}</li>)}
              </ul>
            )}
          </div>
        )}
        {error && <p role="alert" className="rounded-lg bg-danger-weak px-3 py-2 text-sm text-danger">{error}</p>}
        <p data-team-merge-warn className="rounded-lg bg-warning-weak px-3 py-2 text-sm leading-6 text-fg">{t('settings.teams.mergeWarn')}</p>
      </div>
    </Modal>
  )
}
