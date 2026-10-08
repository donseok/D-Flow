'use client'

import { useMemo, useReducer, useRef, useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Upload, AlertTriangle, CheckCircle2, Trash2, Plus, ArrowRight, RotateCcw, Undo2, Download,
} from 'lucide-react'
import { useToast } from '@/components/ui/Toast'
import { useLocale } from '@/components/providers/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { downloadWbsExport, exportFailureKey } from '@/components/import/downloadWbsExport'
import { ImportRunSummary } from '@/components/import/ImportRunSummary'
import { getWbsBackup } from '@/app/actions/importBackup'
import { backupFileName } from '@/components/import/backupFileName'
import { newUuid } from '@/lib/domain/uuid'
import type { DictKey } from '@/lib/i18n/dict'
import type { ExcelProfile } from '@/lib/excel/profile'
import type { DetectionResult } from '@/lib/excel/detect'
import type { ImportError } from '@/lib/excel/validate'
import { TEAM_DIRECT_MARK } from '@/lib/excel/headerWords'
import type { SkippedHoliday } from '@/lib/domain/holidayImport'
import {
  reducer, initialWizardState, switchHierarchyKind, setOutlineColumn, setLogicalColumn,
  recordToRows, rowsToRecord, deriveMappedPreview, initialProfileChoice, executionIntentKey, commandIdFor,
  preBackupReady, isDefinitiveFailure, expandedExportBlocked, type MarkRow, type ExecuteResult,
  type PreviewColumnRole, type ProfileMismatch, type ProfileMismatchField,
} from '@/lib/domain/importWizard'

/** 논리 열(§B4 ExcelProfile.logical) 8종의 라벨 키 — 셀렉트 목록(name 제외)과 미리보기 배지(name 포함)
 *  양쪽에서 재사용한다. */
const LOGICAL_FIELD_LABEL_KEYS: Record<keyof ExcelProfile['logical'], DictKey> = {
  extraAxis: 'importWizard.fieldExtraAxis',
  code: 'importWizard.fieldCode',
  name: 'importWizard.fieldName',
  deliverable: 'importWizard.fieldDeliverable',
  start: 'importWizard.fieldStart',
  end: 'importWizard.fieldEnd',
  weight: 'importWizard.fieldWeight',
  actualPct: 'importWizard.fieldActualPct',
}

/** 저장 양식·파일 구조 불일치(Task 1b) 경고의 항목 라벨 — 논리 열은 위 라벨을 그대로 쓴다. */
const MISMATCH_FIELD_LABEL_KEYS: Record<ProfileMismatchField, DictKey> = {
  ...LOGICAL_FIELD_LABEL_KEYS,
  sheetName: 'importWizard.mismatchFieldSheet',
  headerRow: 'importWizard.mismatchFieldHeaderRow',
  holidaySheetName: 'importWizard.mismatchFieldHolidaySheet',
  hierarchy: 'importWizard.mismatchFieldHierarchy',
  teamColumns: 'importWizard.mismatchFieldTeamColumns',
  customColumns: 'importWizard.mismatchFieldCustomColumns',
}

/** name 은 outline 전용이라 계층 섹션에서 따로 렌더한다 — 논리 열 셀렉트 목록에서는 제외. */
const LOGICAL_FIELDS: { key: Exclude<keyof ExcelProfile['logical'], 'name'>; labelKey: DictKey }[] =
  (Object.keys(LOGICAL_FIELD_LABEL_KEYS) as (keyof ExcelProfile['logical'])[])
    .filter((k): k is Exclude<keyof ExcelProfile['logical'], 'name'> => k !== 'name')
    .map(key => ({ key, labelKey: LOGICAL_FIELD_LABEL_KEYS[key] }))

/** 미리보기 표의 열 배지 문구(리뷰 Important #2) — role 은 로케일 무관 구조라 여기서 t() 로 붙인다. */
function previewRoleLabel(role: PreviewColumnRole, t: (k: DictKey) => string): string | null {
  if (!role) return null
  if (role.kind === 'hierarchy') return t('importWizard.previewRoleHierarchy')
  if (role.kind === 'logical') return t(LOGICAL_FIELD_LABEL_KEYS[role.field])
  if (role.kind === 'custom') return `${t('importWizard.previewRoleCustom')}: ${role.key}`
  const teamLabel = role.team === TEAM_DIRECT_MARK ? t('importWizard.previewRoleTeamDirect') : role.team
  return `${t('importWizard.previewRoleTeam')}: ${teamLabel}`
}

/** 백업을 파일로 내려받는다(§6.6-2 — 트리만, change_logs 는 대상 아님). 교체 직전 백업(성공 응답의 backup)과 실행 전 백업
 *  (getWbsBackup — SP4 D50)이 같은 꼴이다. label 은 이름 끝에 붙는다(실행 전 백업 = '실행 전'). */
function downloadBackup(projectId: string, backup: { rows: unknown[]; generatedAt: string }, timeZone: string | null, label?: string) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = backupFileName(projectId, backup.generatedAt, timeZone, label)   // 날짜 = 프로젝트 달력 tz(못 읽으면 날짜 없음)
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** wbs.xlsx 양식 — 프로젝트 워크스페이스의 제품명을 안내문에 넣어 내려받는다. */
async function downloadTemplate(toast: ReturnType<typeof useToast>['toast'], failedTitle: string, projectId: string) {
  const res = await fetch(`/api/import/template?projectId=${encodeURIComponent(projectId)}`)
  if (!res.ok) {
    const err = (await res.json().catch(() => null)) as { error?: string } | null
    toast({ title: failedTitle, description: err?.error, variant: 'error' })
    return
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'wbs-양식.xlsx'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** 단계의 스크린리더 문구 — "3단계 중 1단계: 파일 선택(완료)". 완료 표지는 눈에는 체크 아이콘뿐이라 여기서 말한다(B-3 리뷰 P3) */
export function stepSrText(t: (k: DictKey) => string, n: number, total: number, label: string, done: boolean): string {
  return t(done ? 'importWizard.stepSrDone' : 'importWizard.stepSr')
    .replace('{n}', String(n)).replace('{total}', String(total)).replace('{label}', label)
}

/** 눈에 보이는 원 안 숫자·n/3·라벨은 aria-hidden — 스크린리더는 srText 한 줄만 읽는다("1 1/3 파일 선택" 처럼 숫자를 두 번 읽지 않게) */
export function StepBadge({ n, total, label, active, done, srText }: { n: number; total: number; label: string; active: boolean; done: boolean; srText: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          done ? 'bg-success text-success-fg' : active ? 'bg-action text-action-fg' : 'bg-surface-subtle text-fg-muted'
        }`}
      >
        {done ? <CheckCircle2 className="h-4 w-4" /> : n}
      </span>
      <span aria-hidden="true" className="text-meta text-fg-muted tabular-nums">{n}/{total}</span>
      <span aria-hidden="true" className={`text-sm font-semibold ${active || done ? 'text-fg' : 'text-fg-muted'}`}>{label}</span>
      <span className="sr-only">{srText}</span>
    </div>
  )
}

function radioRowClass(active: boolean): string {
  return `flex cursor-pointer items-start gap-3 rounded-2xl border px-4 py-3 transition ${
    active ? 'border-action bg-action-soft' : 'border-border bg-surface hover:border-border-input'
  }`
}

/**
 * 임포트 마법사(§6.2) — 1단계 파일 선택+감지, 2단계 확인·편집 후 실행.
 * 파일은 클라이언트 메모리(fileRef)에만 있고 서버에 임시 저장되지 않는다(inspect/execute 매 요청 재업로드).
 * 실행은 실행 의도의 명령 id 를 싣는다(SP4 §4.4) — 같은 의도의 재시도는 같은 id 라 서버가 이미 적용했으면 duplicate 로 받는다.
 */
export function ImportWizard({
  projectId, currentItemCount, timeZone,
}: {
  projectId: string
  /** 그 프로젝트 달력의 tz(백업 파일 이름의 날짜 — SP5 P8: 서버가 내린다, 기본값 없음). null = 달력을 못 읽음(서버 로그) — 날짜 없는 이름 */
  timeZone: string | null
  /** replace 경고에 실제 삭제 건수를 싣기 위한 값(리뷰 Important #1) — 서버 조회 실패 시 null 로
   *  degrade 되어 온다(page.tsx 가 표시=로깅). null 이면 건수 없는 일반 경고 문구로 대체한다. */
  currentItemCount: number | null
}) {
  const router = useRouter()
  const { toast } = useToast()
  const { t } = useLocale()
  const [state, dispatch] = useReducer(reducer, initialWizardState)
  const [markRows, setMarkRows] = useState<MarkRow[]>([])
  const [exportBusy, setExportBusy] = useState(false)
  const fileRef = useRef<File | null>(null)
  // 실행 의도의 지문 재료 — File 객체는 ref 에 두고, 지문에 드는 이름·크기·수정 시각만 상태로 둔다(렌더마다 키를 계산한다)
  const [fileMeta, setFileMeta] = useState<{ name: string; size: number; lastModified: number } | null>(null)
  const [backupBusy, setBackupBusy] = useState(false)
  const markIdRef = useRef(0)

  const headers = state.detection?.preview.headers ?? []
  const profile = state.profile
  // 계층 방식·논리 열 편집이 표에 즉시 반영돼야 한다(리뷰 Important #2 — replace 비가역성의 유일한
  // 검증면). 원본 재파싱 없이 detection.preview 를 현재 profile 로 재라벨링만 하므로 가볍다.
  const mappedPreview = useMemo(
    () => (state.detection && profile ? deriveMappedPreview(state.detection.preview.headers, state.detection.preview.rows, profile) : null),
    [state.detection, profile],
  )
  // 실행 의도(SP4 §4.4 — RF3): 파일·프로파일(마크 사전 포함 — 서버에 보내는 그 값)·모드·양식 저장 여부. 이 키가 같은 동안의 실행은 한 명령이다.
  const intentKey = useMemo(
    () => (fileMeta && profile
      ? executionIntentKey({
        fileName: fileMeta.name, fileSize: fileMeta.size, lastModified: fileMeta.lastModified,
        profile: { ...profile, ownerMarks: rowsToRecord(markRows) }, mode: state.mode, saveProfile: state.saveProfile,
      })
      : null),
    [fileMeta, profile, markRows, state.mode, state.saveProfile],
  )
  // replace 는 지금 의도로 사전 백업 내려받기를 시작한 뒤에만 실행한다(D50 — 브라우저는 내려받기 완료를 알리지 않는다)
  const backupReady = state.mode !== 'replace' || preBackupReady(state, intentKey)

  function nextMarkId(): number {
    markIdRef.current += 1
    return markIdRef.current
  }

  function updateProfile(next: ExcelProfile) {
    dispatch({ type: 'profileChanged', profile: next })
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    fileRef.current = file
    setFileMeta(file ? { name: file.name, size: file.size, lastModified: file.lastModified } : null)
    dispatch({ type: 'fileSelected', fileName: file?.name ?? '' })
  }

  function startOver() {
    fileRef.current = null
    setFileMeta(null)
    markIdRef.current = 0
    setMarkRows([])
    dispatch({ type: 'reset' })
  }

  /** 리뷰 Important #2 — savedProfile 로 시작했더라도 실제 업로드 파일이 감지한 프로파일로 되돌린다.
   *  reducer 는 profile 필드만 순수하게 되돌리고(테스트 대상), 마크 사전 행 상태(markRows)는 컴포넌트
   *  로컬이라 여기서 같이 재동기화한다(runInspect 의 초기 세팅과 동일 패턴). */
  function resetToDetected() {
    if (!state.detection) return
    dispatch({ type: 'resetToDetected' })
    const rows = recordToRows(state.detection.profile.ownerMarks)
    setMarkRows(rows)
    markIdRef.current = rows.length
  }

  /** Task 1b — 불일치 경고를 본 사용자가 저장 양식을 직접 고른다. 마크 행도 저장 양식 사전으로 맞춘다(resetToDetected 와 같은 패턴). */
  function chooseSavedProfile() {
    if (!state.savedProfile) return
    dispatch({ type: 'useSavedProfile' })
    const rows = recordToRows(state.savedProfile.ownerMarks)
    setMarkRows(rows)
    markIdRef.current = rows.length
  }

  async function runExportProfile() {
    setExportBusy(true)
    try {
      const r = await downloadWbsExport(projectId, { expand: true })
      if (!r.ok) {
        const key = exportFailureKey(r.status, true, r.code)
        toast({ title: t('importWizard.exportProfileFailedHttp'), description: key ? t(key) : undefined, variant: 'error' })
      }
    } finally {
      setExportBusy(false)
    }
  }

  async function runInspect() {
    const file = fileRef.current
    if (!file) { toast({ title: t('importWizard.selectFileFirst'), variant: 'error' }); return }
    dispatch({ type: 'inspectStart' })
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('projectId', projectId)
      const res = await fetch('/api/import/inspect', { method: 'POST', body: fd })
      const data: Record<string, unknown> = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        const detection = data.detection as DetectionResult
        const savedProfile = (data.savedProfile ?? null) as ExcelProfile | null
        const skippedHolidays = Array.isArray(data.skippedHolidays) ? (data.skippedHolidays as SkippedHoliday[]) : []
        dispatch({ type: 'inspectSuccess', detection, savedProfile, skippedHolidays })
        // 마크 행은 reducer 가 고른 출발 프로파일의 사전으로 — 불일치면 감지 결과다(Task 1b).
        const rows = recordToRows(initialProfileChoice(detection, savedProfile).profile.ownerMarks)
        setMarkRows(rows)
        markIdRef.current = rows.length
      } else {
        const msg = typeof data.error === 'string' ? data.error : t('importWizard.inspectFailedHttp')
        dispatch({ type: 'inspectFailure', error: msg })
        toast({ title: msg, variant: 'error' })
      }
    } catch {
      const msg = t('importWizard.networkError')
      dispatch({ type: 'inspectFailure', error: msg })
      toast({ title: msg, variant: 'error' })
    }
  }

  /** 이번 실행(·사전 백업)의 명령 id — 같은 의도면 그 id, 아니면 새로(newUuid). 상태에 실어 재시도가 같은 id 를 쓰게 한다. */
  function beginIntent(key: string): string {
    const commandId = commandIdFor(state, key, () => newUuid())
    dispatch({ type: 'intentChanged', intentKey: key, commandId })
    return commandId
  }

  /** replace 사전 백업(D50) — 지금 트리를 받아 '실행 전' 파일로 내려받기를 시작한다. 실패면 실행은 잠긴 채다. */
  async function runPreBackup() {
    if (intentKey === null) return
    beginIntent(intentKey)
    setBackupBusy(true)
    try {
      const r = await getWbsBackup(projectId)
      if (!r.ok) {
        toast({ title: t('importWizard.preBackupFailed'), description: r.error, variant: 'error' })
        return
      }
      downloadBackup(projectId, r.backup, timeZone, t('importWizard.preBackupFileLabel'))
      dispatch({ type: 'preBackupTaken', generatedAt: r.backup.generatedAt })
    } catch {
      toast({ title: t('importWizard.preBackupFailed'), description: t('importWizard.networkError'), variant: 'error' })
    } finally {
      setBackupBusy(false)
    }
  }

  async function runExecute(registerTeams: boolean) {
    const file = fileRef.current
    if (!file || !profile || intentKey === null) return
    // replace 는 지금 의도의 사전 백업 내려받기를 시작한 뒤에만(D50) — 버튼이 이미 잠겨 있다, 여기는 이중 안전
    if (state.mode === 'replace' && !preBackupReady(state, intentKey)) return
    const commandId = beginIntent(intentKey)
    dispatch({ type: 'executeStart' })
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('projectId', projectId)
      // 실행 의도의 명령 id(SP4 §4.4) — 서버가 이미 적용한 명령이면 다시 적용하지 않고 duplicate 로 답한다
      fd.append('commandId', commandId)
      fd.append('profile', JSON.stringify({ ...profile, ownerMarks: rowsToRecord(markRows) }))
      fd.append('mode', state.mode)
      fd.append('saveProfile', String(state.saveProfile))
      fd.append('registerTeams', String(registerTeams))
      // 상속 프로젝트의 등록 재실행 — 409 확인 창이 보여 준 전환 대상의 토큰을 돌려보낸다(서버가 지금 대상과 같을 때만 전환한다 — A1-5 R3).
      // 확인 창이 없는 첫 실행에는 없다
      if (registerTeams && state.convertToken !== null) fd.append('convertToken', state.convertToken)
      // 저장 양식으로 읽는지와, 불일치를 보고 직접 골랐는지 — 서버가 같은 대조를 다시 해 확인 없는 저장 양식 실행을 409 로 막는다.
      fd.append('useSavedProfile', String(state.profileSource === 'saved'))
      fd.append('confirmProfileMismatch', String(state.profileSource === 'saved' && state.profileMismatch !== null))
      const res = await fetch('/api/import/execute', { method: 'POST', body: fd })
      const data: Record<string, unknown> = await res.json().catch(() => ({}))

      if (res.status === 409 && data.code === 'PROFILE_MISMATCH') {
        // 서버 문구는 한국어 고정(로그·API 용)이라 화면은 코드로 문구를 고른다. 불일치가 없으면 파일 구조를 감지하지 못해 대조할 수 없는 경우다.
        const mismatch = (data.profileMismatch ?? null) as ProfileMismatch | null
        const msg = t(mismatch ? 'importWizard.executeProfileMismatch' : 'importWizard.executeProfileUnverifiable')
        dispatch({ type: 'executeProfileMismatch', error: msg, profileMismatch: mismatch })
        toast({ title: msg, variant: 'error' })
        return
      }

      if (res.status === 409 && Array.isArray(data.needsTeams)) {
        // 등록은 늘 프로젝트 관리자 몫이다(D4 — 슈퍼유저 분기 없음). 상속 프로젝트면 확인 창이 공용 팀 전환을 알린다(D54).
        const commonTeams = Array.isArray(data.commonTeams) ? (data.commonTeams as { code: string; name: string }[]) : []
        dispatch({
          type: 'executeNeedsTeams', teams: data.needsTeams as string[], inheritsCommon: data.inheritsCommon === true, commonTeams,
          convertToken: typeof data.convertToken === 'string' ? data.convertToken : null,
        })
        return
      }
      if (res.ok && data.ok) {
        const result = data as unknown as ExecuteResult
        if (result.backup) downloadBackup(projectId, result.backup, timeZone)
        dispatch({ type: 'executeSuccess', result })
        toast({ title: t('importWizard.executeSuccessToast'), variant: 'success' })
        router.refresh()
      } else if (Array.isArray(data.errors)) {
        const errs = data.errors as ImportError[]
        dispatch({ type: 'executeValidationFailure', errors: errs })
        toast({ title: `${t('importWizard.linkErrorsPrefix')}${errs.length}${t('importWizard.linkErrorsSuffix')}`, variant: 'error' })
      } else {
        const msg = typeof data.error === 'string' ? data.error : t('importWizard.executeFailedHttp')
        // 409 를 뺀 4xx 는 "적용하지 않았다"는 확정 — 다음 실행은 새 id. 5xx·본문을 못 읽은 응답은 적용 여부를 모른다 — 같은 id 로 재시도
        dispatch({ type: 'executeFailure', error: msg, definitive: isDefinitiveFailure(res.status) })
        toast({ title: msg, variant: 'error' })
      }
    } catch {
      // 응답 유실 — 서버가 적용했을 수 있다. 같은 id 로 재시도하면 duplicate 로 받는다
      const msg = t('importWizard.networkError')
      dispatch({ type: 'executeFailure', error: msg, definitive: false })
      toast({ title: msg, variant: 'error' })
    }
  }


  return (
    <div className="space-y-5">
      {/* 단계 표시(#23 — SP4 §5.2, 계획 P9): 순서 목록 하나, 활성 단계 aria-current="step", 각 단계 앞 n/3(눈에만 — 읽기는 StepBadge 의 srText) */}
      <ol className="card flex items-center gap-3 p-4" aria-label={t('importWizard.stepsAria')}>
        {([['select', 'importWizard.step1Label'], ['review', 'importWizard.step2Label'], ['done', 'importWizard.step3Label']] as const).map(([key, label], i, all) => {
          const at = all.findIndex(([k]) => k === state.step)
          const done = i < at || state.step === 'done'
          return (
            <li key={key} className={`flex items-center gap-3 ${i < all.length - 1 ? 'flex-1' : 'flex-none'}`} aria-current={i === at ? 'step' : undefined}>
              <StepBadge n={i + 1} total={all.length} label={t(label)} active={i === at} done={done} srText={stepSrText(t, i + 1, all.length, t(label), done)} />
              {i < all.length - 1 && <span aria-hidden className="h-px flex-1 bg-border" />}
            </li>
          )
        })}
      </ol>

      {state.step === 'select' && (
        <div className="card space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-fg-secondary">{t('importWizard.templateDesc')}</p>
            <button type="button" className="btn btn-ghost shrink-0" disabled={state.busy}
              onClick={() => void downloadTemplate(toast, t('importWizard.templateFailed'), projectId)}>
              <Download className="h-4 w-4" />{t('importWizard.templateButton')}
            </button>
          </div>
          <label className="group flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-border-input bg-surface-subtle px-6 text-center transition hover:border-action hover:bg-action-soft/40">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-surface text-action shadow-sm transition group-hover:border-border-focus">
              <Upload className="h-5 w-5" />
            </span>
            <span className="mt-4 text-sm font-semibold text-fg">{state.fileName || t('importWizard.chooseExcel')}</span>
            <span className="mt-1 text-xs leading-5 text-fg-secondary">{t('importWizard.xlsxOnly')}</span>
            <input
              type="file"
              accept=".xlsx"
              disabled={state.busy}
              onChange={onFileChange}
              aria-label={t('importWizard.chooseExcel')}
              className="mt-4 max-w-full text-xs text-fg-secondary file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-action-soft file:px-3 file:py-2 file:font-semibold file:text-action"
            />
          </label>

          {state.error && (
            <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-danger">
              <AlertTriangle className="h-4 w-4 shrink-0" />{state.error}
            </p>
          )}

          <div className="flex justify-end">
            <button type="button" className="btn btn-primary" disabled={!state.fileName || state.busy} onClick={runInspect}>
              {state.busy ? t('importWizard.inspecting') : t('importWizard.analyze')}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {state.step === 'review' && state.detection && profile && (
        <div className="space-y-5">
          {/* Task 1b — 저장 양식으로 읽으면 열이 밀려 오류 없이 틀린 값이 쓰인다. 감지 결과로 시작하고, 저장 양식은 여기서
              직접 골라야만 쓴다(서버도 확인 플래그 없이는 409). */}
          {state.profileMismatch && (
            <div role="alert" className="rounded-xl border border-danger/30 bg-danger-weak/40 p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-danger">
                <AlertTriangle className="h-3.5 w-3.5" />{t('importWizard.mismatchTitle')}
              </p>
              <p className="mt-1.5 text-xs leading-5 text-fg-secondary">
                {state.profileSource === 'saved' ? t('importWizard.mismatchUsingSaved') : t('importWizard.mismatchUsingDetected')}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-fg-secondary">
                {state.profileMismatch.fields.length > 0 && (
                  <li>{t('importWizard.mismatchFieldsPrefix')}{state.profileMismatch.fields.map(f => t(MISMATCH_FIELD_LABEL_KEYS[f])).join(', ')}</li>
                )}
                {state.profileMismatch.extraTeams.length > 0 && (
                  <li>{t('importWizard.mismatchExtraTeamsPrefix')}{state.profileMismatch.extraTeams.join(', ')}</li>
                )}
                {state.profileMismatch.missingTeams.length > 0 && (
                  <li>{t('importWizard.mismatchMissingTeamsPrefix')}{state.profileMismatch.missingTeams.join(', ')}</li>
                )}
              </ul>
              {state.profileSource === 'detected' && state.savedProfile && (
                <button type="button" className="btn btn-ghost mt-3" disabled={state.busy} onClick={chooseSavedProfile}>
                  {t('importWizard.useSavedProfileButton')}
                </button>
              )}
            </div>
          )}
          {state.detection.warnings.length > 0 && (
            <div role="alert" className="rounded-xl border border-pending/30 bg-pending-weak/40 p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-pending">
                <AlertTriangle className="h-3.5 w-3.5" />{t('importWizard.detectionWarningsTitle')}
              </p>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-fg-secondary">
                {state.detection.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          <SkippedHolidaysNotice items={state.skippedHolidays} t={t} />

          <div className="card space-y-6 p-6">
            {/* 리뷰 Important #2 — savedProfile 을 기본값으로 시작한 경우에도(레거시 프로젝트 +
                새 양식 파일) 업로드 파일이 실제로 감지한 프로파일로 되돌릴 길을 열어 둔다. */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-subtle px-3.5 py-2.5">
              <p className="text-xs leading-5 text-fg-muted">{t('importWizard.resetToDetectedDesc')}</p>
              <button
                type="button"
                className="btn btn-ghost shrink-0"
                disabled={state.busy}
                onClick={resetToDetected}
                aria-label={t('importWizard.resetToDetectedButton')}
              >
                <Undo2 className="h-4 w-4" />{t('importWizard.resetToDetectedButton')}
              </button>
            </div>

            {/* ── 계층 방식 ── */}
            <fieldset className="space-y-2.5">
              <legend className="mb-2 text-xs font-semibold text-fg-secondary">{t('importWizard.hierarchyLegend')}</legend>
              {(['columns', 'outline'] as const).map(kind => {
                const active = profile.hierarchy.kind === kind
                const label = kind === 'columns' ? t('importWizard.hierarchyColumns') : t('importWizard.hierarchyOutline')
                const desc = kind === 'columns' ? t('importWizard.hierarchyColumnsDesc') : t('importWizard.hierarchyOutlineDesc')
                return (
                  <label key={kind} className={radioRowClass(active)}>
                    <input
                      type="radio"
                      name="hierarchy-kind"
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-action)]"
                      checked={active}
                      disabled={state.busy}
                      onChange={() => updateProfile(switchHierarchyKind(profile, kind))}
                      aria-label={label}
                    />
                    <span className="min-w-0">
                      <span className={`block text-sm font-semibold ${active ? 'text-action' : 'text-fg'}`}>{label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-fg-secondary">{desc}</span>
                    </span>
                  </label>
                )
              })}
            </fieldset>

            {profile.hierarchy.kind === 'outline' ? (
              <div className="grid gap-3 pl-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('importWizard.outlineColumnLabel')}</span>
                  <select
                    className="app-input"
                    aria-label={t('importWizard.outlineColumnLabel')}
                    disabled={state.busy}
                    value={String(profile.hierarchy.column)}
                    onChange={e => updateProfile(setOutlineColumn(profile, Number(e.target.value)))}
                  >
                    {headers.map((h, i) => <option key={i} value={i}>{h || `#${i}`}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t('importWizard.fieldName')}</span>
                  <select
                    className="app-input"
                    aria-label={t('importWizard.fieldName')}
                    disabled={state.busy}
                    value={profile.logical.name === null ? '' : String(profile.logical.name)}
                    onChange={e => updateProfile(setLogicalColumn(profile, 'name', e.target.value === '' ? null : Number(e.target.value)))}
                  >
                    <option value="">{t('importWizard.columnNone')}</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `#${i}`}</option>)}
                  </select>
                </label>
              </div>
            ) : (
              <p className="pl-4 text-xs leading-5 text-fg-muted">
                {t('importWizard.columnsHint')}
                {profile.hierarchy.columns.map(c => headers[c] || `#${c}`).join(', ')}
              </p>
            )}

            {/* ── 논리 열 ── */}
            <fieldset className="space-y-2.5">
              <legend className="mb-2 text-xs font-semibold text-fg-secondary">{t('importWizard.logicalLegend')}</legend>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {LOGICAL_FIELDS.map(f => (
                  <label key={f.key} className="block">
                    <span className="mb-1.5 block text-xs font-semibold text-fg-secondary">{t(f.labelKey)}</span>
                    <select
                      className="app-input"
                      aria-label={t(f.labelKey)}
                      disabled={state.busy}
                      value={profile.logical[f.key] === null ? '' : String(profile.logical[f.key])}
                      onChange={e => updateProfile(setLogicalColumn(profile, f.key, e.target.value === '' ? null : Number(e.target.value)))}
                    >
                      <option value="">{t('importWizard.columnNone')}</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h || `#${i}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* ── 마크 사전 ── */}
            <fieldset className="space-y-2.5">
              <legend className="mb-2 text-xs font-semibold text-fg-secondary">{t('importWizard.marksLegend')}</legend>
              <div className="space-y-2">
                {markRows.map(row => (
                  <div key={row.id} className="flex items-center gap-2">
                    <input
                      className="app-input w-24 shrink-0 text-center"
                      value={row.key}
                      maxLength={4}
                      disabled={state.busy}
                      onChange={e => setMarkRows(rows => rows.map(r => (r.id === row.id ? { ...r, key: e.target.value } : r)))}
                      aria-label={t('importWizard.markKeyLabel')}
                    />
                    <select
                      className="app-input"
                      value={row.kind}
                      disabled={state.busy}
                      onChange={e => setMarkRows(rows => rows.map(r => (r.id === row.id ? { ...r, kind: e.target.value as MarkRow['kind'] } : r)))}
                      aria-label={t('importWizard.markKindLabel')}
                    >
                      <option value="primary">{t('importWizard.markPrimary')}</option>
                      <option value="support">{t('importWizard.markSupport')}</option>
                    </select>
                    <button
                      type="button"
                      className="btn btn-ghost h-9 w-9 shrink-0 !px-0"
                      disabled={state.busy}
                      onClick={() => setMarkRows(rows => rows.filter(r => r.id !== row.id))}
                      aria-label={t('importWizard.markDelete')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={state.busy}
                onClick={() => setMarkRows(rows => [...rows, { id: nextMarkId(), key: '', kind: 'primary' }])}
              >
                <Plus className="h-4 w-4" />{t('importWizard.markAdd')}
              </button>
            </fieldset>

            {/* ── 모드 ── */}
            <fieldset className="space-y-2.5">
              <legend className="mb-2 text-xs font-semibold text-fg-secondary">{t('importWizard.modeLegend')}</legend>
              {(['append', 'replace'] as const).map(mode => {
                const active = state.mode === mode
                const label = mode === 'append' ? t('importWizard.modeAppend') : t('importWizard.modeReplace')
                const desc = mode === 'append' ? t('importWizard.modeAppendDesc') : t('importWizard.modeReplaceDesc')
                return (
                  <label key={mode} className={radioRowClass(active)}>
                    <input
                      type="radio"
                      name="import-mode"
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-action)]"
                      checked={active}
                      disabled={state.busy}
                      onChange={() => dispatch({ type: 'modeChanged', mode })}
                      aria-label={label}
                    />
                    <span className="min-w-0">
                      <span className={`block text-sm font-semibold ${active ? 'text-action' : 'text-fg'}`}>{label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-fg-secondary">{desc}</span>
                    </span>
                  </label>
                )
              })}
            </fieldset>

            {state.mode === 'replace' && (
              <div role="alert" className="rounded-xl border border-danger/30 bg-danger-weak/40 p-3.5">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-danger">
                  <AlertTriangle className="h-3.5 w-3.5" />{t('importWizard.replaceWarnTitle')}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-fg-secondary">
                  <li>
                    {currentItemCount !== null
                      ? <>{t('importWizard.replaceWarnDeleteCountPrefix')}{currentItemCount}{t('importWizard.replaceWarnDeleteCountSuffix')}</>
                      : t('importWizard.replaceWarnDelete')}
                  </li>
                  <li>{t('importWizard.replaceWarnChangeLogs')}</li>
                  <li>{t('importWizard.replaceWarnHolidays')}</li>
                  <li>{t('importWizard.replaceWarnBackup')}</li>
                </ul>
              </div>
            )}

            {/* replace 사전 백업(D50) — 지금 트리를 '실행 전' 파일로 내려받기 시작해야 실행이 열린다. 입력(파일·양식·방식·양식 저장)이
                바뀌면 다시 받아야 한다(백업은 그 실행 의도에 묶인다). 읽기에 실패하면 실행하지 않는다. */}
            {state.mode === 'replace' && (
              <div data-pre-backup className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-subtle px-3.5 py-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-fg">{t('importWizard.preBackupTitle')}</p>
                  <p className="mt-0.5 text-xs leading-5 text-fg-secondary">
                    {preBackupReady(state, intentKey) ? t('importWizard.preBackupDone') : t('importWizard.preBackupDesc')}
                  </p>
                </div>
                <button type="button" className="btn btn-ghost shrink-0" disabled={state.busy || backupBusy || intentKey === null}
                  onClick={runPreBackup}>
                  <Download className="h-4 w-4" />
                  {backupBusy ? t('importWizard.preBackupBusy') : t('importWizard.preBackupButton')}
                </button>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-fg">
              <input
                type="checkbox"
                className="h-4 w-4 rounded accent-[var(--color-action)]"
                checked={state.saveProfile}
                disabled={state.busy}
                onChange={e => dispatch({ type: 'saveProfileChanged', saveProfile: e.target.checked })}
                aria-label={t('importWizard.saveProfileLabel')}
              />
              {t('importWizard.saveProfileLabel')}
            </label>
          </div>

          <div className="card space-y-3 p-6">
            <h3 className="text-sm font-semibold text-fg">{t('importWizard.previewTitle')}</h3>
            <p className="text-xs leading-5 text-fg-muted">{t('importWizard.previewHint')}</p>
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[720px] border-collapse text-xs">
                <thead className="bg-surface-subtle">
                  <tr>
                    <th className="border-b border-border px-2 py-1.5 text-left font-semibold text-fg-secondary">{t('importWizard.previewDepthCol')}</th>
                    {mappedPreview?.columns.map(col => {
                      const badge = previewRoleLabel(col.role, t)
                      return (
                        <th
                          key={col.index}
                          className={`border-b border-border px-2 py-1.5 text-left font-semibold ${col.role?.kind === 'hierarchy' ? 'bg-action-soft text-action' : 'text-fg-secondary'}`}
                        >
                          <div>{col.label}</div>
                          {badge && <div className="mt-0.5 text-xs font-normal text-fg-muted">{badge}</div>}
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {mappedPreview?.rows.map((row, ri) => (
                    <tr key={ri} className="odd:bg-surface even:bg-surface-subtle/40">
                      <td className="border-b border-border px-2 py-1.5 text-center text-fg-muted">{row.depth === null ? '?' : row.depth}</td>
                      {mappedPreview.columns.map(col => (
                        <td
                          key={col.index}
                          className={`border-b border-border px-2 py-1.5 text-fg ${col.role?.kind === 'hierarchy' ? 'bg-action-soft/30' : ''}`}
                        >
                          {String(row.cells[col.index] ?? '')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {state.errors && state.errors.length > 0 && (
            <div role="alert" className="rounded-xl border border-danger/30 bg-danger-weak/40 p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-danger">
                <AlertTriangle className="h-3.5 w-3.5" />{t('importWizard.linkErrorsPrefix')}{state.errors.length}{t('importWizard.linkErrorsSuffix')}
              </p>
              <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs leading-5 text-fg-secondary">
                {state.errors.map((er, i) => (
                  <li key={i}>{t('importWizard.excelRowPrefix')}{er.excelRow}{t('importWizard.excelRowSuffix')}{er.message}</li>
                ))}
              </ul>
            </div>
          )}
          {state.error && (
            <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-danger">
              <AlertTriangle className="h-4 w-4 shrink-0" />{state.error}
            </p>
          )}

          <div className="flex items-center justify-between gap-3">
            <button type="button" className="btn btn-ghost" disabled={state.busy} onClick={startOver}>
              <RotateCcw className="h-4 w-4" />{t('importWizard.startOver')}
            </button>
            <button type="button" className="btn btn-primary" disabled={state.busy || backupBusy || !backupReady} onClick={() => runExecute(false)}>
              {state.busy ? t('importWizard.executing') : t('importWizard.execute')}
            </button>
          </div>
        </div>
      )}

      {state.step === 'done' && state.result && (
        <div className="card space-y-5 p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-success-weak text-success">
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-base font-bold text-fg">{t('importWizard.doneTitle')}</h2>
              <p className="text-sm text-fg-secondary">{state.result.count}{t('importWizard.doneCountSuffix')}</p>
            </div>
          </div>
          <ImportRunSummary projectId={projectId} result={state.result} t={t} />

          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div className="panel-soft p-3">
              <dt className="eyebrow">{t('importWizard.doneMode')}</dt>
              <dd className="mt-1 font-semibold text-fg">{state.result.mode === 'append' ? t('importWizard.modeAppend') : t('importWizard.modeReplace')}</dd>
            </div>
            <div className="panel-soft p-3">
              <dt className="eyebrow">{t('importWizard.doneReindexed')}</dt>
              <dd className="mt-1 font-semibold text-fg">{state.result.reindexed}</dd>
            </div>
            <div className="panel-soft p-3">
              <dt className="eyebrow">{t('importWizard.doneProfileSaved')}</dt>
              <dd className="mt-1 font-semibold text-fg">{state.result.profileSaved ? t('importWizard.savedYes') : t('importWizard.savedNo')}</dd>
            </div>
          </dl>

          {state.result.profileSave && !state.result.profileSave.ok && (
            <div role="status" className="rounded-xl border border-pending/30 bg-pending-weak/40 p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-pending">
                <AlertTriangle className="h-3.5 w-3.5" />{t('importWizard.profileSaveFailedTitle')}
              </p>
              <p className="mt-1 text-xs leading-5 text-fg-secondary">
                {t('importWizard.profileSaveFailedDesc').replace('{code}', state.result.profileSave.code)}
              </p>
            </div>
          )}
          {state.result.warnings && state.result.warnings.length > 0 && (
            <div role="status" className="rounded-xl border border-pending/30 bg-pending-weak/40 p-3.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-pending">
                <AlertTriangle className="h-3.5 w-3.5" />{t('importWizard.doneWarningsTitle')}
              </p>
              <ul className="mt-2 space-y-1 text-xs leading-5 text-fg-secondary">
                {state.result.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          <SkippedHolidaysNotice items={state.result.skippedHolidays ?? []} t={t} />

          {/* 리뷰 Important #1 — §6.5 프로파일 익스포트(펼침)가 UI 에서 도달 불가했다. 완료 화면이
              이 프로파일로 다시 내보낼 수 있는 유일하고 자연스러운 지점(방금 쓴 프로파일이 최신 상태).
              라우트는 저장 양식으로 만든다 — 이번에 저장했을 때만 "이 양식 그대로"(exportProfileDesc)가 참이다.
              이번에 저장하지 않았으면 라우트가 프로젝트의 저장 양식(있으면) 또는 표준 양식으로 낸다 — 설명만 다르다(SP4 §4.3).
              그 양식이 아웃라인이면 펼침은 늘 거부되므로(400) 버튼 대신 사유를 보인다(A2-2 리뷰 — 근본 해결은 §9 이월). */}
          {(() => {
            const blocked = expandedExportBlocked(state, state.result.profileSaved)
            return (
              <div className="panel-soft flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm font-semibold text-fg">{t('importWizard.exportProfileTitle')}</p>
                  <p className="mt-0.5 text-xs leading-5 text-fg-secondary">
                    {t(blocked ? 'importWizard.exportProfileUnsupported' : state.result.profileSaved ? 'importWizard.exportProfileDesc' : 'importWizard.exportLayoutDesc')}
                  </p>
                </div>
                {!blocked && (
                  <button
                    type="button"
                    className="btn btn-ghost shrink-0"
                    disabled={exportBusy}
                    onClick={runExportProfile}
                    aria-label={t('importWizard.exportProfileButton')}
                  >
                    <Download className="h-4 w-4" />
                    {exportBusy ? t('importWizard.exportProfileBusy') : t('importWizard.exportProfileButton')}
                  </button>
                )}
              </div>
            )
          })()}

          <div className="flex flex-wrap gap-2">
            <Link href={`/p/${projectId}/wbs`} className="btn btn-primary">
              <ArrowRight className="h-4 w-4" />{t('importWizard.gotoWbs')}
            </Link>
            <button type="button" className="btn btn-ghost" onClick={startOver}>{t('importWizard.importAnother')}</button>
          </div>
        </div>
      )}

      <Modal
        open={state.needsTeams !== null}
        onClose={() => dispatch({ type: 'dismissNeedsTeams' })}
        title={t('importWizard.needsTeamsTitle')}
        eyebrow="TEAMS"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => dispatch({ type: 'dismissNeedsTeams' })}>{t('common.cancel')}</button>
            {/* 등록은 프로젝트 관리자 몫이다(D4) — 이 화면에 온 사람은 이미 그 가드를 지났다. 같은 명령 id 로 다시 보낸다 */}
            <button type="button" className="btn btn-primary" disabled={state.busy} onClick={() => runExecute(true)}>
              {state.busy ? t('importWizard.registering') : t('importWizard.registerTeams')}
            </button>
          </>
        }
      >
        <p className="text-sm leading-6 text-fg">{t('importWizard.needsTeamsDesc')}</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {(state.needsTeams ?? []).map(team => (
            <li key={team} className="badge bg-action-soft px-2 py-1 text-action">{team}</li>
          ))}
        </ul>
        {state.inheritsCommon ? (
          // 상속 프로젝트 — 등록이 공용 팀을 이 프로젝트 팀으로 전환한다(D54). 무엇이 바뀌는지 먼저 알린다
          <div data-teams-convert className="mt-3 space-y-2">
            <p className="text-xs leading-5 text-fg-secondary">
              {t('importWizard.needsTeamsConvert')
                .replace('{n}', String(state.commonTeams.length))
                .replace('{teams}', (state.needsTeams ?? []).join(', '))}
            </p>
            {state.commonTeams.length > 0 && (
              <>
                <p className="text-xs font-semibold text-fg-muted">{t('importWizard.needsTeamsCommonTitle')}</p>
                <ul className="flex flex-wrap gap-2">
                  {state.commonTeams.map(team => (
                    <li key={team.code} className="badge bg-surface-subtle px-2 py-1 text-fg">
                      {team.name === team.code ? team.code : `${team.code} · ${team.name}`}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs leading-5 text-fg-muted">{t('importWizard.needsTeamsProjectScope')}</p>
        )}
      </Modal>
    </div>
  )
}

/** 가져오기 휴일 충돌(SP5 D7) — Holiday 시트의 날짜가 프로젝트의 근무 예외와 겹쳐 휴무로 바꾸지 않은 날짜. 검토(미리보기)·완료(결과) 두 자리 */
function SkippedHolidaysNotice({ items, t }: { items: readonly SkippedHoliday[]; t: (k: DictKey) => string }) {
  if (items.length === 0) return null
  return (
    <div role="status" className="rounded-xl border border-pending/30 bg-pending-weak/40 p-3.5" data-skipped-holidays>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-pending">
        <AlertTriangle className="h-3.5 w-3.5" />{t('importWizard.holidaySkippedTitle')}
      </p>
      <p className="mt-1 text-xs leading-5 text-fg-secondary">{t('importWizard.holidaySkippedDesc')}</p>
      <ul className="mt-2 space-y-1 text-xs leading-5 text-fg-secondary">
        {items.map(h => <li key={h.date} className="tabular-nums">{h.date}{h.name ? ` · ${h.name}` : ''}</li>)}
      </ul>
    </div>
  )
}
