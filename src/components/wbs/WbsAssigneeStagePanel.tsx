'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { User } from 'lucide-react'
import type { ProjectMember } from '@/lib/domain/types'
import { useTeamCodes } from '@/components/app/TeamsProvider'
import { useLocale } from '@/components/providers/LocaleProvider'
import {
  approveWbsStep, getWbsAssigneeStage, setWbsAssignee, setWbsAssigneeCascade, setWbsStage, setWbsDevWorkflow,
} from '@/app/actions/wbsAssign'
import { WbsSpecPanel } from './WbsSpecPanel'
import { AssigneeComboBox } from './AssigneeComboBox'
import { useDebouncedSave } from './useDebouncedSave'
import { PendingSaveChip } from './PendingSaveChip'
import { ConflictResolver } from '@/components/ui/ConflictResolver'
import type { DictKey } from '@/lib/i18n/dict'
import { STAGE_CODES, type StageCode } from '@/lib/domain/stageLabels'
import { useStageLabel } from './StageLabelsProvider'

type Stage = StageCode
/** 서버 확정 값이자 debounce 저장 필드 — getWbsAssigneeStage 의 반환 형태 그대로다. */
type AssigneeStage = { assigneeMemberId: string | null; stage: string | null; devWorkflow: boolean }
/**
 * 서버 확정 값 + 표시 재료(위임 여부, 개발 워크플로 토글 권한). delegated·canDevWorkflow 는
 * 저장 필드가 아니라 서버가 실어 보내는 판정값이다(스펙 §3.5 의 stageLocked 과 같은 관례).
 */
type Loaded = AssigneeStage & {
  delegated?: boolean; canDevWorkflow?: boolean
  /** SP5b W1 — 대기 승인 단계(유효 단계 ≥2 면 xx 직행 대신 단계 승인) */
  approval?: { step: string; index: number; total: number; label: string | null } | null
}
/** 담당·단계·dev workflow 액션 반환의 합집합. count·cascadeFailed 는 cascade 계열만 실어 온다. */
type AssigneeStageResult = {
  ok: boolean; error?: string; count?: number; cascadeFailed?: boolean; orderCreated?: boolean
  /** 값 CAS 의 충돌(SPU1) — 쓰지 않았다. latest 는 서버의 현재 값: 담당자면 명단 id(null=미지정), 단계면 단계 코드(null=단계 없음) */
  conflict?: boolean; latest?: string | null
  /** 일괄 OFF 에서 위임 때문에 대상에서 빠진 항목 수(setWbsDevWorkflow). */
  skippedDelegated?: number
}
const STAGE_KEYS: Record<Stage, DictKey> = {
  as: 'wbs.stageAs', ip: 'wbs.stageIp', im: 'wbs.stageIm', xx: 'wbs.stageXx',
}
const STAGES: readonly Stage[] = STAGE_CODES

/**
 * 선택된 WBS 항목의 담당자(로스터 축)·단계 편집 — §2.5.
 *
 * RowDetailPanel 내부 섹션으로 임베드된다(리뷰 라운드 1 — 별도 fixed 오버레이가
 * RowDetailPanel(aria-modal) 뒤에 숨어 키보드·스크린리더로 도달 불가했다. 하나의
 * 항목에 dialog 하나만 뜨도록 이 컴포넌트는 더는 자체 오버레이/닫기 버튼을 갖지 않고
 * 호출부(RowDetailPanel)가 배치를 맡는다).
 *
 * ComputedItem 을 확장하지 않고 RowDetailPanel의 getChangeLogs 관례처럼 선택 변경 시
 * 클라이언트에서 별도 로드한다. 편집은 프로젝트 관리자만(editable=false 면 읽기 전용).
 */
export function WbsAssigneeStagePanel({
  itemId, members, editable, hasChildren = false,
}: {
  itemId: string
  members: ProjectMember[]
  editable: boolean
  /** 하위 항목이 있으면 "미지정 하위 항목에도 적용" 체크박스를 노출한다(스테이징 피드백). */
  hasChildren?: boolean
}) {
  const router = useRouter()
  const { t } = useLocale()
  const teamCodes = useTeamCodes()
  const assigneeLabelId = useId()
  const [loaded, setLoaded] = useState<Loaded | 'error' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [cascade, setCascade] = useState(true)
  const [cascadeResult, setCascadeResult] = useState<number | null>(null)
  const [cascadeWarn, setCascadeWarn] = useState(false)
  const [devCascade, setDevCascade] = useState(true)
  const [devWorkflowResult, setDevWorkflowResult] = useState<number | null>(null)
  const [devWorkflowWarn, setDevWorkflowWarn] = useState(false)
  const [devWorkflowSkipped, setDevWorkflowSkipped] = useState<number | null>(null)
  const [approving, setApproving] = useState(false)
  // 담당자 저장 충돌(SPU1, 개정 §5.8) — 내가 고른 값·서버의 현재 값·패널을 열 때 본 값. 조용히 덮지도 버리지도 않고 비교로 잇는다.
  const [assigneeConflict, setAssigneeConflict] = useState<{ mine: string | null; latest: string | null; base: string | null } | null>(null)
  // 단계 저장 충돌(0048) — 담당자와 같은 꼴. 값은 단계 코드(null = 단계 없음)
  const [stageConflict, setStageConflict] = useState<{ mine: string | null; latest: string | null; base: string | null } | null>(null)
  const [conflictBusy, setConflictBusy] = useState(false)
  // debounce 훅의 실패 콜백은 문구만 받는다 — 충돌은 저장 thunk 가 여기 적어 두고 onFailed 가 꺼내 비교를 띄운다
  // (분리 flush 는 onFailed 를 부르지 않는다 — 남은 메모가 다른 항목의 실패에 붙지 않게 항목 id 를 같이 적고 저장마다 새로 쓴다)
  const conflictNoteRef = useRef<{ itemId: string; mine: string | null; latest: string | null; base: string | null } | null>(null)
  const stageConflictNoteRef = useRef<{ itemId: string; mine: string | null; latest: string | null; base: string | null } | null>(null)
  // 내 담당자·워크플로 저장은 서버에서 단계도 옮길 수 있다(배정↔as 자동 전이). 그 저장이 나간 순간의 loaded 를 적어 둔다 —
  // 같은 스냅샷을 보고 고른 단계 저장은 "본 단계"가 내 손으로 낡았으므로 기대값을 다시 읽는다(남이 아니라 내가 바꾼 것을 충돌로 띄우지 않게)
  const loadedRef = useRef<Loaded | 'error' | null>(null)
  const stageMovedUnderRef = useRef<Loaded | null>(null)
  // 전파 체크는 저장이 실제로 나가는 순간(flush)의 값을 쓴다 — 담당을 고른 뒤 5초 안에 전파 체크를
  // 바꿔도 반영되도록. commit 클로저는 set 시점에 잡히므로 ref 로 읽는다.
  const cascadeRef = useRef(cascade)
  const devCascadeRef = useRef(devCascade)
  useEffect(() => { cascadeRef.current = cascade }, [cascade])
  useEffect(() => { devCascadeRef.current = devCascade }, [devCascade])

  useEffect(() => {
    let alive = true
    setLoaded(null)
    setErr(null)
    setAssigneeConflict(null)
    setStageConflict(null)
    getWbsAssigneeStage(itemId).then(r => { if (alive) setLoaded(r ?? 'error') })
    return () => { alive = false }
  }, [itemId])

  // 담당 콤보박스·단계 select·dev workflow 체크박스는 debounce 저장(2026-09-14). 종전엔 변경 하나마다
  // 서버 액션 + router.refresh() 가 나가 WBS 페이지 전체가 다시 렌더됐다. 마지막 변경 뒤 SAVE_DEBOUNCE_MS
  // 가 지나면(또는 패널 닫힘·항목 변경·「지금 저장」) 모아서 순서대로 저장하고 refresh 는 1회만 부른다.
  // 화면은 quick.view 로 낙관 표시하고, 실패한 필드는 대기에서 빠져 loaded(서버 확정 값)로 돌아간다.
  const stageName = useStageLabel()   // 프로젝트의 단계 이름(SP5b W2) — 없는 칸은 사전 이름
  /** 담당자 저장 — base 는 내가 본 서버 값(기대값). 전파 체크는 저장이 나가는 순간의 값을 쓴다 */
  const saveAssignee = (memberId: string | null, base: string | null) => (hasChildren && cascadeRef.current && memberId !== null)
    ? setWbsAssigneeCascade(itemId, memberId, base)
    : setWbsAssignee(itemId, memberId, undefined, base)
  // 훅은 set 시점의 commit 을 잡아 둔다 — 그때의 loaded 가 곧 사용자가 보고 고른 값이다
  const seenAssignee = loaded && loaded !== 'error' ? loaded.assigneeMemberId : null
  const seenLoaded = loaded && loaded !== 'error' ? loaded : null
  useEffect(() => { loadedRef.current = loaded }, [loaded])
  const markStageMaybeMoved = (res: AssigneeStageResult) => {
    if (res.ok && loadedRef.current && loadedRef.current !== 'error') stageMovedUnderRef.current = loadedRef.current
  }
  /** 단계 저장 — base 는 내가 본 서버 단계(기대값). 서버가 이미 내 값이면(응답만 잃은 재시도 등) 충돌이 아니라 반영된 것이다 */
  const saveStage = async (stage: Stage | null, base: string | null): Promise<AssigneeStageResult> => {
    const res: AssigneeStageResult = await setWbsStage(itemId, stage, undefined, undefined, base as Stage | null)
    return res.conflict && (res.latest ?? null) === stage ? { ok: true } : res
  }
  const quick = useDebouncedSave<AssigneeStage, AssigneeStageResult>({
    scope: itemId,
    baseline: loaded && loaded !== 'error' ? loaded : null,
    commit: {
      assigneeMemberId: async memberId => {
        const res: AssigneeStageResult = await saveAssignee(memberId, seenAssignee)
        conflictNoteRef.current = res.conflict ? { itemId, mine: memberId, latest: res.latest ?? null, base: seenAssignee } : null
        markStageMaybeMoved(res)
        return res
      },
      stage: async stage => {
        let base = seenLoaded?.stage ?? null
        if (seenLoaded && stageMovedUnderRef.current === seenLoaded) {
          // 선행 조회가 실패하면 쓰지 않는다 — 낡은 기대값으로 거짓 충돌을 내거나 대조 없이 덮는 것보다 낫다
          const fresh = await getWbsAssigneeStage(itemId)
          if (!fresh) return { ok: false, error: t('wbs.assigneeStageLoadFail') }
          base = fresh.stage
        }
        const res = await saveStage(stage as Stage | null, base)
        stageConflictNoteRef.current = res.conflict ? { itemId, mine: stage, latest: res.latest ?? null, base } : null
        return res
      },
      // OFF 는 ready 주문 취소를 동반하는 서버 동작(브리프) — 확인 모달 없이 실행하고 결과 문구로만
      // 알린다(브라우저 confirm() 은 자동화를 막아 세션 규칙상 금지).
      devWorkflow: async enabled => {
        const res: AssigneeStageResult = await setWbsDevWorkflow(itemId, enabled, hasChildren && devCascadeRef.current)
        markStageMaybeMoved(res)
        return res
      },
    },
    onSaved: (key, value, res) => {
      if (key === 'assigneeMemberId') {
        if (typeof res.count === 'number' && res.count > 0) setCascadeResult(res.count)
        // 하위 UPDATE 만 실패한 부분 성공(리뷰 라운드 2) — 본인 반영은 확정됐으므로 성공 취급하되
        // "하위 일괄 적용은 실패했다"는 사실은 별도 경고로 알린다(assigneeCascadeFail 키 재사용).
        if (res.cascadeFailed) setCascadeWarn(true)
      } else if (key === 'stage') {
        const stage = value as string | null
        setLoaded(prev => (prev && prev !== 'error' ? { ...prev, stage } : prev))
      } else {
        if (typeof res.count === 'number' && res.count > 0) setDevWorkflowResult(res.count)
        // 일괄 OFF 에서 위임된 항목은 워크플로에 남는다 — 몇 건이 빠졌는지 말해 주지 않으면
        // 사람은 "일부가 안 됐다"를 실패로 오해한다.
        if (typeof res.skippedDelegated === 'number' && res.skippedDelegated > 0) setDevWorkflowSkipped(res.skippedDelegated)
        if (res.cascadeFailed) setDevWorkflowWarn(true)
      }
    },
    onFailed: (key, value, error) => {
      const note = key === 'assigneeMemberId' ? conflictNoteRef.current : null
      if (note && note.itemId === itemId) {
        // 충돌 — 오류 문구 대신 비교를 띄운다. 기준(loaded)은 서버의 현재 값으로 옮겨 화면이 낡은 담당자를 보이지 않게 한다
        conflictNoteRef.current = null
        setLoaded(prev => (prev && prev !== 'error' ? { ...prev, assigneeMemberId: note.latest } : prev))
        setAssigneeConflict(note)
        return
      }
      const stageNote = key === 'stage' ? stageConflictNoteRef.current : null
      if (stageNote && stageNote.itemId === itemId) {
        // 단계도 같다 — 기준을 서버의 현재 단계로 옮기고 비교를 띄운다
        stageConflictNoteRef.current = null
        setLoaded(prev => (prev && prev !== 'error' ? { ...prev, stage: stageNote.latest } : prev))
        setStageConflict(stageNote)
        return
      }
      const usedCascade = key === 'assigneeMemberId' && hasChildren && cascadeRef.current && value !== null
      setErr(error || (usedCascade ? t('wbs.assigneeCascadeFail') : t('wbs.errGeneric')))
    },
    onFlushed: async ({ saved, detached }) => {
      // 배정·dev workflow 성공은 서버가 stage 도 함께 바꿀 수 있다(배정↔as 자동 전이·자동 발행) —
      // 부분 낙관 갱신 대신 전체 재조회로 loaded 를 교체한다(F2, 최종 리뷰). 재조회 실패는 기존 로딩
      // 관례대로 'error'. 분리 flush(패널이 닫혔거나 항목이 바뀜)면 재조회할 패널이 없다.
      if (!detached && saved.some(k => k === 'assigneeMemberId' || k === 'devWorkflow')) {
        const refreshed = await getWbsAssigneeStage(itemId)
        setLoaded(refreshed ?? 'error')
      }
      router.refresh()
    },
  })

  function onAssigneeChange(memberId: string | null) {
    setErr(null); setCascadeResult(null); setCascadeWarn(false)
    quick.set('assigneeMemberId', memberId)
  }
  function onStageChange(stage: Stage | null) {
    setErr(null)
    quick.set('stage', stage)
  }
  function onDevWorkflowChange(enabled: boolean) {
    setErr(null); setDevWorkflowResult(null); setDevWorkflowWarn(false); setDevWorkflowSkipped(null)
    quick.set('devWorkflow', enabled)
  }

  const memberName = (id: string | null) => id ? members.find(m => m.id === id)?.name ?? id : null
  /** 비교에서 '내 값으로 저장' — 방금 본 서버 값(latest)을 기대값으로 한 번만 다시 쓴다. 또 어긋나면 비교를 새 값으로 다시 연다 */
  async function keepMineAssignee() {
    if (!assigneeConflict) return
    const { mine, latest } = assigneeConflict
    setConflictBusy(true); setErr(null)
    const res: AssigneeStageResult = await saveAssignee(mine, latest)
    setConflictBusy(false)
    if (res.conflict) {
      setLoaded(prev => (prev && prev !== 'error' ? { ...prev, assigneeMemberId: res.latest ?? null } : prev))
      setAssigneeConflict({ mine, latest: res.latest ?? null, base: latest })
      return
    }
    setAssigneeConflict(null)
    if (!res.ok) { setErr(res.error || t('wbs.errGeneric')); return }
    if (typeof res.count === 'number' && res.count > 0) setCascadeResult(res.count)
    if (res.cascadeFailed) setCascadeWarn(true)
    setLoaded((await getWbsAssigneeStage(itemId)) ?? 'error')   // 배정은 단계도 바꿀 수 있다 — 통째로 다시 읽는다(onFlushed 와 같은 이유)
    router.refresh()
  }
  /** 비교에서 '서버 값 받기' — 쓰지 않고 다시 읽는다 */
  async function takeLatestAssignee() {
    setAssigneeConflict(null)
    setLoaded((await getWbsAssigneeStage(itemId)) ?? 'error')
    router.refresh()
  }
  const assigneeText = (id: string | null) => memberName(id) ?? t('wbs.assigneeUnassignedOption')
  /** 단계 비교에서 '내 값으로 저장' — 담당자와 같다: 방금 본 서버 단계(latest)를 기대값으로 한 번만 다시 쓴다 */
  async function keepMineStage() {
    if (!stageConflict) return
    const { mine, latest } = stageConflict
    setConflictBusy(true); setErr(null)
    const res = await saveStage(mine as Stage | null, latest)
    setConflictBusy(false)
    if (res.conflict) {
      setLoaded(prev => (prev && prev !== 'error' ? { ...prev, stage: res.latest ?? null } : prev))
      setStageConflict({ mine, latest: res.latest ?? null, base: latest })
      return
    }
    setStageConflict(null)
    if (!res.ok) { setErr(res.error || t('wbs.errGeneric')); return }
    setLoaded(prev => (prev && prev !== 'error' ? { ...prev, stage: mine } : prev))
    router.refresh()
  }
  /** 단계 비교에서 '서버 값 받기' — 쓰지 않고 다시 읽는다 */
  async function takeLatestStage() {
    setStageConflict(null)
    setLoaded((await getWbsAssigneeStage(itemId)) ?? 'error')
    router.refresh()
  }
  // 비교에 보일 단계 이름 — 드롭다운과 같은 화면 이름(프로젝트 라벨 → 사전)
  const stageText = (code: string | null) => code && STAGE_KEYS[code as Stage]
    ? stageName(code, t(STAGE_KEYS[code as Stage])) : stageName(null, t('wbs.stageNoneOption'))
  // 담당자와 단계가 한 flush 에서 둘 다 어긋나면 비교는 하나씩 — 담당자를 먼저 정하고 나면 단계가 뜬다
  const conflictFields = assigneeConflict
    ? [{ key: 'assignee', label: t('wbs.assigneeLabel'),
        mine: assigneeText(assigneeConflict.mine), latest: assigneeText(assigneeConflict.latest), base: assigneeText(assigneeConflict.base) }]
    : stageConflict
      ? [{ key: 'stage', label: t('wbs.stageLabel'),
          mine: stageText(stageConflict.mine), latest: stageText(stageConflict.latest), base: stageText(stageConflict.base) }]
      : []
  // 낙관 표시값 — 대기 중인 변경이 있으면 그 값, 없으면 서버 확정 값. loaded 가 객체일 때만 쓰인다.
  const view: AssigneeStage = quick.view ?? { assigneeMemberId: null, stage: null, devWorkflow: false }
  // 위임된 작업은 단계를 승인·반려로만 바꾼다(잠금). 위임 없이 reported 주문만 남은 드문 경우는 서버 거부 문구가 드러낸다.
  const delegated = loaded !== null && loaded !== 'error' && loaded.delegated === true
  // 개발 워크플로 토글은 관리자 전용이 아니다(2026-09-16) — 담당자·서브트리 관리자도 한다.
  // editable(관리자 전체 폼)과 별개의 축이라 서버 판정값을 그대로 쓴다.
  const canDevWorkflow = loaded !== null && loaded !== 'error' && loaded.canDevWorkflow === true
  // SP5b W1(D18) — 승인 단계가 둘 이상이면 xx 는 단계 승인으로만 간다(서버가 approval_required 로 거부할 값을 권하지 않는다).
  // 승인 버튼은 검수 대기(im)에서만, 승인 자격(관리자·서브트리 관리자, admin 단계는 관리자)은 액션이 다시 판정한다
  const approval = loaded !== null && loaded !== 'error' ? loaded.approval ?? null : null
  const multiStep = approval !== null && approval.total >= 2

  async function onApproveStep() {
    if (!approval) return
    setErr(null); setApproving(true)
    const r = await approveWbsStep(itemId, approval.step)
    setApproving(false)
    if (!r.ok) setErr(r.stale ? t('wbs.approveStepStale') : (r.error ?? t('wbs.errGeneric')))
    const refreshed = await getWbsAssigneeStage(itemId)
    setLoaded(refreshed ?? 'error')
    if (r.ok) router.refresh()
  }

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-border bg-surface-subtle/40 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-fg-muted">
            <User className="h-3.5 w-3.5" /> {t('wbs.assigneeStagePanelTitle')}
          </div>
          <PendingSaveChip
            isPending={quick.isPending} saving={quick.saving} remainingMs={quick.remainingMs}
            onSaveNow={() => void quick.flush()}
          />
        </div>

        <div className="mt-2 space-y-2">
          {loaded === null ? (
            <p className="text-xs text-fg-muted">{t('common.loading')}</p>
          ) : loaded === 'error' ? (
            <p className="text-xs font-medium text-danger">{t('wbs.assigneeStageLoadFail')}</p>
          ) : (
            <>
              {/* 담당·단계를 2열 한 행으로(2026-08-28). 종전엔 라벨+컨트롤이 세로로 6줄 쌓여
                  이 섹션만으로 패널 한 화면을 먹었다. 전파 체크는 각자 소속 컨트롤 바로 아래 둔다 —
                  한 줄로 몰면 무엇에 걸리는 전파인지 화면에서 사라진다. */}
              <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2">
                <div>
                  {/* <label> 아님 — 안의 콤보박스가 role=listbox/option 을 갖는 상호작용 콘텐츠라
                      <label> 로 감싸면 옵션 클릭이 label 활성화(입력 재포커스)와 충돌한다.
                      aria-labelledby 로만 라벨을 연결한다. */}
                  <span id={assigneeLabelId} className="mb-1 block text-meta font-semibold text-fg-secondary">{t('wbs.assigneeLabel')}</span>
                  {editable ? (
                    <AssigneeComboBox
                      members={members}
                      value={view.assigneeMemberId}
                      onChange={onAssigneeChange}
                      categoryOrder={teamCodes}
                      unassignedLabel={t('wbs.assigneeUnassignedOption')}
                      placeholder={t('wbs.assigneeSearchPlaceholder')}
                      noResultsLabel={t('wbs.assigneeSearchNoResults')}
                      ariaLabelledBy={assigneeLabelId}
                    />
                  ) : (
                    <p className="text-[13px] text-fg">{memberName(view.assigneeMemberId) ?? t('wbs.assigneeUnassignedOption')}</p>
                  )}
                  {editable && hasChildren && (
                    <label className="mt-1 flex items-center gap-1.5 text-meta text-fg-secondary">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-border"
                        checked={cascade}
                        onChange={e => setCascade(e.target.checked)}
                      />
                      {t('wbs.assigneeCascadeLabel')}
                    </label>
                  )}
                </div>

                <label className="block">
                  <span className="mb-1 block text-meta font-semibold text-fg-secondary">{t('wbs.stageLabel')}</span>
                  {/* 단계는 개발 워크플로 항목의 것이다(스펙 2026-09-15 §3.5) — 꺼진 항목은 드롭다운을 두지 않는다
                      (서버가 not_workflow 로 거부할 값을 권하지 않는다). */}
                  {editable && view.devWorkflow ? (
                    <select
                      value={view.stage ?? ''}
                      onChange={e => onStageChange((e.target.value || null) as Stage | null)}
                      disabled={delegated}
                      title={delegated ? t('wbs.stageLockedByOrder') : undefined}
                      className="app-input h-9 text-xs"
                    >
                      <option value="">{stageName(null, t('wbs.stageNoneOption'))}</option>
                      {/* 개발 워크플로 단계는 최종단계의 것이다 — 상위 항목에서는 서버(setWbsStage)가
                          거절하므로 고를 수 있게 두면 화면이 거절당할 값을 권하는 꼴이 된다.
                          '미착수'는 남긴다: 이미 잘못 찍힌 값을 지울 길이 여기뿐이다. */}
                      {!hasChildren && STAGES.map(s => (
                        <option key={s} value={s} disabled={s === 'xx' && multiStep && view.stage !== 'xx'}>{stageName(s, t(STAGE_KEYS[s]))}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-[13px] text-fg">
                      {view.stage && STAGE_KEYS[view.stage as Stage] ? stageName(view.stage, t(STAGE_KEYS[view.stage as Stage])) : stageName(null, t('wbs.stageNoneOption'))}
                    </p>
                  )}
                  {editable && view.devWorkflow && hasChildren && (
                    <p className="mt-1 text-meta text-fg-muted">{t('wbs.stageLeafOnlyHint')}</p>
                  )}
                  {editable && view.devWorkflow && multiStep && !hasChildren && (
                    <p data-stage-xx-needs-approval className="mt-1 text-meta text-fg-muted">{t('wbs.stageXxNeedsApproval')}</p>
                  )}
                  {editable && view.devWorkflow && delegated && (
                    <p data-stage-locked className="mt-1 text-meta text-fg-muted">{t('wbs.stageLockedByOrder')}</p>
                  )}
                  {editable && !view.devWorkflow && (
                    <p data-stage-not-workflow className="mt-1 text-meta text-fg-muted">{t('wbs.stageNotWorkflow')}</p>
                  )}
                </label>
              </div>

              {/* dev_workflow — NULL 진입점 토글. 권한이 없으면 현재값을 disabled 체크박스로
                  보여준다(브리프). 위임된 작업은 끄지 못한다 — 서버가 같은 이유로 거부하므로
                  화면에서 미리 잠그고 사유를 적는다. OFF 는 ready 주문 취소를 동반하는 서버
                  동작이라 confirm() 없이 즉시 실행하고 결과 문구로 알린다(브라우저 모달 금지). */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <label className="flex items-center gap-1.5 text-meta text-fg-secondary">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-border"
                    checked={view.devWorkflow}
                    onChange={e => onDevWorkflowChange(e.target.checked)}
                    disabled={!canDevWorkflow || delegated}
                  />
                  {t('wbs.devWorkflowLabel')}
                </label>
                {editable && hasChildren && (
                  <label className="flex items-center gap-1.5 text-meta text-fg-secondary">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 rounded border-border"
                      checked={devCascade}
                      onChange={e => setDevCascade(e.target.checked)}
                    />
                    {t('wbs.devWorkflowCascadeLabel')}
                  </label>
                )}
              </div>

              {approval && view.stage === 'im' && !delegated && canDevWorkflow && !quick.isPending && (
                <button type="button" data-approve-step={approval.step} onClick={() => void onApproveStep()} disabled={approving}
                  className="btn btn-primary h-8 px-3 text-xs">
                  {t('wbs.approveStep').replace('{i}', String(approval.index)).replace('{n}', String(approval.total))
                    .replace('{label}', approval.label ?? t('wbs.approveStepDefault'))}
                </button>
              )}

              {canDevWorkflow && delegated && (
                <p data-dev-workflow-locked className="text-meta text-fg-muted">
                  {t('wbs.devWorkflowLockedByDelegation')}
                </p>
              )}

              {/* 결과·경고는 있을 때만 자리를 차지한다 */}
              {cascadeResult !== null && (
                <p className="text-meta font-medium text-action">
                  {t('wbs.assigneeCascadeResult').replace('{n}', String(cascadeResult))}
                </p>
              )}
              {cascadeWarn && (
                <p className="text-meta font-medium text-danger" role="alert">{t('wbs.assigneeCascadeFail')}</p>
              )}
              {devWorkflowResult !== null && (
                <p className="text-meta font-medium text-action">
                  {t('wbs.devWorkflowResult').replace('{n}', String(devWorkflowResult))}
                </p>
              )}
              {devWorkflowSkipped !== null && (
                <p data-dev-workflow-skipped className="text-meta text-fg-muted">
                  {t('wbs.devWorkflowSkippedDelegated').replace('{n}', String(devWorkflowSkipped))}
                </p>
              )}
              {devWorkflowWarn && (
                <p className="text-meta font-medium text-danger" role="alert">{t('wbs.devWorkflowFail')}</p>
              )}

              {!editable && <p className="text-meta text-fg-muted">{t('wbs.assigneeStageReadOnly')}</p>}
              {err && <p className="text-xs font-medium text-danger" role="alert">{err}</p>}
            </>
          )}
        </div>
      </section>

      {/* 명세(Task 12A, 결정 B) — 이 패널의 섹션으로 편입, 별도 오버레이 아님(리뷰 라운드 1 관례). */}
      {/* 선행·후행 항목 — 명세에서 분리한 독립 섹션(실행 순서 축). */}

      <WbsSpecPanel itemId={itemId} editable={editable} />
      <ConflictResolver
        open={conflictFields.length > 0}
        fields={conflictFields}
        onKeepMine={() => void (assigneeConflict ? keepMineAssignee() : keepMineStage())}
        onTakeLatest={() => void (assigneeConflict ? takeLatestAssignee() : takeLatestStage())}
        onContinue={() => (assigneeConflict ? setAssigneeConflict(null) : setStageConflict(null))} busy={conflictBusy}
      />
    </div>
  )
}
