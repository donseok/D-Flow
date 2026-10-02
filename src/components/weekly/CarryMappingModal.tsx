'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { StatusMessage } from '@/components/ui/StatusMessage'
import { orderAreas, WEEKLY_CELL_LABEL, WEEKLY_CELL_MAX, type WeeklyArea } from '@/lib/domain/weeklySheet'
import { CARRY_SKIP, type CarryMapping, type CarryOverflow, type CarryPending } from '@/lib/domain/weeklyCarry'

/** 이월 매핑 라운드의 대기 영역을 모은다(스펙 §5.1·D31) — 넘침만 돌아온 응답(대기 목록이 빔)에도 사용자가 고칠 줄이 창에
 *  남아야 한다. 같은 영역은 새 응답의 값(이름·칸)으로 바꾸고 자리를 지킨다. 새 영역은 응답 순서대로 뒤에 붙인다. */
export function mergeCarrySources(prev: readonly CarryPending[], next: readonly CarryPending[]): CarryPending[] {
  const fresh = new Map(next.map(p => [p.areaId, p]))
  const seen = new Set(prev.map(p => p.areaId))
  return [...prev.map(p => fresh.get(p.areaId) ?? p), ...next.filter(p => !seen.has(p.areaId))]
}

/** 이월 매핑 창(스펙 §5.1, D31·Q37) — "비활성 영역 X — 대기 N칸: [영역 선택 ▾ | 옮기지 않음]" 목록과 넘침 목록.
 *  선택지는 지금 활성인 주간 영역(영역 순)과 '옮기지 않음'이다. 대기 영역을 모두 고르기 전에는 보내지 않는다 — 빠진 영역은
 *  서버가 다시 대기로 돌려준다. 고른 값의 뜻(지금 활성인 이 프로젝트 영역인지)은 서버의 carryOverRows 가 판정한다.
 *  화면은 라운드마다 key 로 창을 새로 연다 — 고른 값의 초기값은 mapping(직전 라운드에 보낸 매핑)에서만 온다. */
export function CarryMappingModal({ open, pending, overflow, areas, mapping = {}, busy, onSubmit, onClose }: {
  open: boolean
  /** 고를 영역(지금 비활성인 원본 영역) — 화면이 라운드마다 모은 목록(mergeCarrySources) */
  pending: readonly CarryPending[]
  /** 매핑으로 모인 칸이 상한을 넘은 활성 영역(D31 — 자르지 않고 거부했다) */
  overflow: readonly CarryOverflow[]
  /** 프로젝트의 주간 영역(비활성 포함) — 선택지는 활성 영역만 */
  areas: readonly WeeklyArea[]
  /** 직전 라운드에 보낸 매핑 — 다시 대기로 온 영역은 화면이 빼고 넘긴다 */
  mapping?: CarryMapping
  busy: boolean
  onSubmit: (mapping: CarryMapping) => void
  onClose: () => void
}) {
  const [choice, setChoice] = useState<Record<string, string>>(() => Object.fromEntries(
    pending.filter(p => Object.hasOwn(mapping, p.areaId)).map(p => [p.areaId, mapping[p.areaId]])))
  const targets = orderAreas(areas.filter(a => a.active))
  const complete = pending.length > 0 && pending.every(p => (choice[p.areaId] ?? '') !== '')
  // 보내는 매핑은 지금 창의 대기 영역만 — 목록 밖 키는 서버가 무시하지만(§4.1.1 키 규칙) 싣지 않는다
  const submit = () => onSubmit(Object.fromEntries(pending.map(p => [p.areaId, choice[p.areaId]])))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="이월할 내용의 업무영역 고르기"
      size="lg"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>취소</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || !complete}>이 매핑으로 이월</button>
        </>
      }
    >
      <p className="text-sm leading-6 text-ink-muted">
        이전 주차의 차주계획에 지금은 비활성인 업무영역의 내용이 있습니다. 옮길 영역을 고르거나 &lsquo;옮기지 않음&rsquo;을 고르세요 —
        옮기지 않아도 이전 주차 시트의 내용은 그대로 남습니다.
      </p>
      {overflow.length > 0 && (
        // 창의 실행(이월)이 막혔다 — blocking 이라 StatusMessage 가 경고(alert) 영역으로 알린다. 넘친 칸 목록은 detail 에 그대로 둔다.
        <div className="mt-4">
          <StatusMessage
            kind="partial_error"
            blocking
            compact
            title={`옮긴 내용이 칸 상한(${WEEKLY_CELL_MAX.toLocaleString('ko-KR')}자)을 넘어 시트를 만들지 않았습니다 — 다른 영역이나 ‘옮기지 않음’을 고르세요.`}
            detail={
              <ul className="mt-1 list-disc pl-5">
                {overflow.map(o => (
                  <li key={`${o.areaId}:${o.cell}`} data-carry-overflow={o.areaId}>
                    {o.areaName} · {WEEKLY_CELL_LABEL[o.cell]} {o.length.toLocaleString('ko-KR')}자
                  </li>
                ))}
              </ul>
            }
          />
        </div>
      )}
      <ul className="mt-4 space-y-3">
        {pending.map(p => (
          <li key={p.areaId} data-carry-source={p.areaId} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-ink">비활성 영역 {p.areaName} — 대기 {p.cells.length}칸</span>
            <select
              className="app-input"
              aria-label={`${p.areaName} 대기 내용을 옮길 영역`}
              value={choice[p.areaId] ?? ''}
              disabled={busy}
              onChange={e => { const v = e.target.value; setChoice(c => ({ ...c, [p.areaId]: v })) }}
            >
              <option value="">영역 선택</option>
              {targets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              <option value={CARRY_SKIP}>옮기지 않음</option>
            </select>
          </li>
        ))}
      </ul>
    </Modal>
  )
}
