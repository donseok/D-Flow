/** 임포트 마법사(B8) 상태 전이 — 순수 함수만 둔다. `ImportWizard` 컴포넌트가 그대로 소비한다.
 *  네트워크 호출(inspect/execute)·파일 보관(File 객체)은 컴포넌트 쪽 책임 — 여기는 상태 계산만. */

import type { ExcelProfile } from '@/lib/excel/profile'
import type { DetectionResult } from '@/lib/excel/detect'
import type { ImportError } from '@/lib/excel/validate'
import { TEAM_DIRECT_MARK } from '@/lib/excel/headerWords'
import type { SkippedHoliday } from './holidayImport'

export type ImportMode = 'append' | 'replace'

/** `/api/import/execute` 200 응답 바디(§B6·SP4 §4.4) — ok 는 판별에만 쓰고 이 타입엔 담지 않는다. */
export interface ExecuteResult {
  /** 결과 종류(SP4 §4.4 #9) — duplicate 는 같은 명령 id 의 재전송이 저장된 결과(건수·모드)를 받은 것이다(백업 없음) */
  kind: 'applied' | 'duplicate'
  /** 이 실행의 명령 id — 마법사가 실행 의도마다 뽑아 보낸 값(재전송은 같은 값) */
  commandId: string
  count: number
  mode: ImportMode
  reindexed: number
  backup?: { rows: unknown[]; generatedAt: string }
  profileSaved: boolean
  /** 양식 저장 실패 사유(W5) — 가져오기 자체는 성공. 완료 화면이 경고로 보인다. error 는 코드의 고정 문구다. */
  profileSave?: { ok: false; code: string; error: string }
  /** 근무 예외와 겹쳐 휴무로 덮지 않은 날짜(SP5 D7) — 있을 때만 */
  skippedHolidays?: SkippedHoliday[]
  warnings?: string[]
}

export type WizardStep = 'select' | 'review' | 'done'

/** 좌표가 다를 수 있는 프로파일 항목 — 논리 열 키 + 시트·헤더 행·휴일 시트·계층 열·팀 열 위치. */
export type ProfileMismatchField =
  | 'sheetName' | 'headerRow' | 'holidaySheetName' | 'hierarchy' | keyof ExcelProfile['logical'] | 'teamColumns' | 'customColumns'

/** 저장 양식과 업로드 파일이 감지한 양식의 구조 차이(Task 1b). 저장 양식으로 읽으면 값이 다른 열에서 읽히고(fields)
 *  양식 밖 팀의 담당이 사라진다(extraTeams) — 파싱은 오류 없이 끝나 틀린 값이 그대로 쓰인다(에러 3원칙 ①). */
export interface ProfileMismatch {
  fields: ProfileMismatchField[]
  /** 파일에는 있는데 저장 양식에 없는 팀 — 저장 양식으로 읽으면 그 담당이 빠진다. */
  extraTeams: string[]
  /** 저장 양식에는 있는데 파일에 없는 팀. */
  missingTeams: string[]
}

const LOGICAL_KEYS: readonly (keyof ExcelProfile['logical'])[] =
  ['extraAxis', 'code', 'name', 'deliverable', 'start', 'end', 'weight', 'actualPct']

function sameHierarchy(a: ExcelProfile['hierarchy'], b: ExcelProfile['hierarchy']): boolean {
  if (a.kind === 'outline' || b.kind === 'outline') {
    return a.kind === 'outline' && b.kind === 'outline' && a.column === b.column
  }
  return a.columns.length === b.columns.length && a.columns.every((c, i) => c === b.columns[i])
}

/** 저장 양식(saved)과 감지 양식(detected)의 좌표·팀 열 비교. null = 같은 구조(마크 사전은 열을 옮기지 않아 비교하지 않는다).
 *  팀은 코드 기준 집합으로 보고, 양쪽에 있는 팀의 열이 다르면 'teamColumns' 다. 팀명 직접 방식('*')은 팀이 아니라
 *  열 하나라 열 위치(있음·없음 포함)만 본다. inspect(알림)·execute(최종 관문)·마법사(기본 선택)가 같은 판정을 쓴다. */
export function compareProfiles(saved: ExcelProfile, detected: ExcelProfile): ProfileMismatch | null {
  const fields: ProfileMismatchField[] = []
  if (saved.sheetName !== detected.sheetName) fields.push('sheetName')
  if (saved.headerRow !== detected.headerRow) fields.push('headerRow')
  if (saved.holidaySheetName !== detected.holidaySheetName) fields.push('holidaySheetName')
  if (!sameHierarchy(saved.hierarchy, detected.hierarchy)) fields.push('hierarchy')
  for (const k of LOGICAL_KEYS) if (saved.logical[k] !== detected.logical[k]) fields.push(k)

  const teamCols = (p: ExcelProfile) => new Map(p.teamColumns.filter(([, t]) => t !== TEAM_DIRECT_MARK).map(([c, t]) => [t, c]))
  const starCol = (p: ExcelProfile) => p.teamColumns.find(([, t]) => t === TEAM_DIRECT_MARK)?.[0] ?? null
  const savedTeams = teamCols(saved)
  const detectedTeams = teamCols(detected)
  const moved = [...savedTeams].some(([t, c]) => detectedTeams.has(t) && detectedTeams.get(t) !== c)
  if (moved || starCol(saved) !== starCol(detected)) fields.push('teamColumns')

  const savedCustom = new Map(saved.customColumns ?? [])
  const detectedCustom = new Map(detected.customColumns ?? [])
  const customMoved = [...savedCustom].some(([c, k]) => detectedCustom.has(c) && detectedCustom.get(c) !== k)
    || savedCustom.size !== detectedCustom.size
    || [...savedCustom.keys()].some((c) => !detectedCustom.has(c))
  if (customMoved) fields.push('customColumns')

  const extraTeams = [...detectedTeams.keys()].filter(t => !savedTeams.has(t))
  const missingTeams = [...savedTeams.keys()].filter(t => !detectedTeams.has(t))

  return fields.length || extraTeams.length || missingTeams.length ? { fields, extraTeams, missingTeams } : null
}

/** 2단계의 출발 프로파일 — 저장 양식이 파일 구조와 같을 때만 저장 양식, 아니면 감지 결과. reducer 와 컴포넌트(마크 행 초기화)가
 *  같이 쓴다. */
export function initialProfileChoice(detection: DetectionResult, savedProfile: ExcelProfile | null): {
  profile: ExcelProfile; profileSource: 'saved' | 'detected'; profileMismatch: ProfileMismatch | null
} {
  const profileMismatch = savedProfile ? compareProfiles(savedProfile, detection.profile) : null
  return savedProfile && !profileMismatch
    ? { profile: savedProfile, profileSource: 'saved', profileMismatch }
    : { profile: detection.profile, profileSource: 'detected', profileMismatch }
}

export interface WizardState {
  step: WizardStep
  fileName: string | null
  detection: DetectionResult | null
  /** inspect 가 돌려준 저장 양식(없거나 손상이면 null) — "저장된 양식 사용" 버튼이 되돌아갈 원본. */
  savedProfile: ExcelProfile | null
  /** 저장 양식과 파일 구조의 차이(compareProfiles). 있으면 감지 결과로 시작하고 저장 양식은 명시 선택으로만 쓴다. */
  profileMismatch: ProfileMismatch | null
  /** 지금 편집 중인 profile 의 출발점 — execute 에 useSavedProfile·confirmProfileMismatch 로 실린다. */
  profileSource: 'saved' | 'detected'
  profile: ExcelProfile | null
  mode: ImportMode
  /** execute 의 saveProfile — 기본 켜짐, 저장 양식과 불일치면 inspectSuccess 가 끈다. */
  saveProfile: boolean
  busy: boolean
  error: string | null
  errors: ImportError[] | null
  needsTeams: string[] | null
  /** 409 NEEDS_TEAMS 의 상속 여부(SP4 D54) — 참이면 등록이 이 프로젝트가 쓰던 공용 팀을 같은 code·이름·색의 이 프로젝트 팀으로
   *  전환한 뒤 미등록 팀을 더한다(확인 창이 그 사실을 알린다). 등록은 늘 프로젝트 관리자 몫이다(D4 — 슈퍼유저 분기 없음). needsTeams 와 함께 지운다. */
  inheritsCommon: boolean
  /** 상속 중인 활성 공용 팀 — 전환 확인 창의 목록. needsTeams 와 함께 지운다. */
  commonTeams: { code: string; name: string }[]
  /** 409 가 준 전환 동의 토큰(A1-5 R3 — 확인 창이 보여 준 전환 대상의 지문). 상속 프로젝트의 등록 재실행이 그대로 돌려보낸다.
   *  전용 팀 프로젝트는 null. needsTeams 와 함께 지운다(토큰은 그 확인 창의 것이다). */
  convertToken: string | null
  /** 실행 의도(intentKey)의 명령 id(SP4 §4.4 — 같은 id 2회 = 1벌). 같은 의도의 재시도·needsTeams 재실행은 이 id 를 다시 쓰고,
   *  성공·확정 실패(isDefinitiveFailure·링크 오류) 뒤에는 null — 다음 실행은 새 id. 파일 재선택·처음부터 다시에도 남는다(RF3). */
  commandId: string | null
  /** commandId·preBackup 이 묶인 실행 의도(executionIntentKey). 컴포넌트가 실행·사전 백업 직전에 intentChanged 로 싣는다. */
  intentKey: string | null
  /** replace 사전 백업(D50) — intentKey 의 의도로 내려받기를 시작한 백업. 의도가 바뀌거나 실행이 성공하면 null. */
  preBackup: { generatedAt: string } | null
  /** 미리보기 — 감지 라우트의 휴일 충돌(SP5 D7). 파일을 바꾸면 비운다 */
  skippedHolidays: SkippedHoliday[]
  result: ExecuteResult | null
}

export const initialWizardState: WizardState = {
  step: 'select',
  fileName: null,
  detection: null,
  savedProfile: null,
  profileMismatch: null,
  profileSource: 'detected',
  profile: null,
  mode: 'append',
  saveProfile: true,
  busy: false,
  error: null,
  errors: null,
  needsTeams: null,
  inheritsCommon: false,
  commonTeams: [],
  convertToken: null,
  commandId: null,
  intentKey: null,
  preBackup: null,
  skippedHolidays: [],
  result: null,
}

export type WizardAction =
  | { type: 'fileSelected'; fileName: string }
  | { type: 'inspectStart' }
  | { type: 'inspectSuccess'; detection: DetectionResult; savedProfile: ExcelProfile | null; skippedHolidays?: SkippedHoliday[] }
  | { type: 'inspectFailure'; error: string }
  | { type: 'profileChanged'; profile: ExcelProfile }
  | { type: 'modeChanged'; mode: ImportMode }
  | { type: 'saveProfileChanged'; saveProfile: boolean }
  | { type: 'intentChanged'; intentKey: string; commandId: string }
  | { type: 'preBackupTaken'; generatedAt: string }
  | { type: 'executeStart' }
  | { type: 'executeNeedsTeams'; teams: string[]; inheritsCommon: boolean; commonTeams: { code: string; name: string }[]; convertToken?: string | null }
  | { type: 'dismissNeedsTeams' }
  | { type: 'executeFailure'; error: string; definitive: boolean }
  | { type: 'executeValidationFailure'; errors: ImportError[] }
  | { type: 'executeSuccess'; result: ExecuteResult }
  | { type: 'executeProfileMismatch'; error: string; profileMismatch: ProfileMismatch | null }
  | { type: 'reset' }
  | { type: 'resetToDetected' }
  | { type: 'useSavedProfile' }

/** 키 순서와 무관한 직렬화 — 같은 내용이면 같은 문자열(마크 사전 Record 의 편집 순서가 지문을 바꾸지 않게). 배열 순서는 의미라 그대로 둔다. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/** 실행 의도의 지문(SP4 §4.4·RF3) — 파일(이름·크기·수정 시각)·프로파일(마크 사전 포함 — 서버에 보내는 그 값)·모드·양식 저장 여부.
 *  이 값이 같은 동안의 실행은 한 명령(같은 명령 id)이다. registerTeams 는 넣지 않는다 — needsTeams 뒤 등록 재실행은 같은 명령이다. */
export function executionIntentKey(input: {
  fileName: string; fileSize: number; lastModified: number; profile: ExcelProfile | null; mode: ImportMode; saveProfile: boolean
}): string {
  return stableJson([input.fileName, input.fileSize, input.lastModified, input.profile, input.mode, input.saveProfile])
}

/** 이번 실행(·사전 백업)의 명령 id — 같은 의도에 id 가 있으면 그것, 아니면 mint()(컴포넌트는 newUuid). 고른 id 는 intentChanged 로 싣는다. */
export function commandIdFor(state: Pick<WizardState, 'intentKey' | 'commandId'>, intentKey: string, mint: () => string): string {
  return state.intentKey === intentKey && state.commandId !== null ? state.commandId : mint()
}

/** replace 실행을 열어도 되는가(D50) — 지금 의도로 사전 백업 내려받기를 시작했을 때만(브라우저는 내려받기 완료를 알리지 않는다 —
 *  시작한 클릭이 기준이다). 의도를 모르면(파일·프로파일 없음) 닫힌다. */
export function preBackupReady(state: Pick<WizardState, 'intentKey' | 'preBackup'>, intentKey: string | null): boolean {
  return intentKey !== null && state.preBackup !== null && state.intentKey === intentKey
}

/** 완료 화면의 펼침 내보내기가 늘 거부되는가(A2-2 리뷰 정확성 P2) — 라우트는 저장 양식이 있으면 그 양식으로, 없으면 표준 양식으로 만들고,
 *  아웃라인 저장 양식 + 펼침은 400(sub-act 는 부모 code 를 승계해 아웃라인 깊이를 늘릴 근거가 없다 — exportWithProfile 머리 주석)이다.
 *  판정 양식 = 이번에 저장했으면 방금 보낸 양식, 아니면 2단계 진입 때 받은 프로젝트의 저장 양식. 근본 해결(아웃라인 펼침)은 스펙 §9 이월. */
export function expandedExportBlocked(state: Pick<WizardState, 'profile' | 'savedProfile'>, profileSaved: boolean): boolean {
  const layout = profileSaved ? state.profile : state.savedProfile
  return layout?.hierarchy.kind === 'outline'
}

/** 서버가 "적용하지 않았다"고 확정한 응답인가 — 409 를 뺀 4xx(입력·권한·COMMAND_REUSED). 409(needsTeams·PROFILE_MISMATCH)는 확인 뒤
 *  같은 명령을 다시 보내는 단계이고, 5xx·네트워크 실패·본문을 못 읽은 응답은 적용 여부를 모른다 — 같은 id 로 재시도해 duplicate 로 받는다. */
export function isDefinitiveFailure(status: number): boolean {
  return status >= 400 && status < 500 && status !== 409
}

/** 409 확인 창을 닫은 상태 */
const NO_TEAMS_PROMPT: Pick<WizardState, 'needsTeams' | 'inheritsCommon' | 'commonTeams' | 'convertToken'> =
  { needsTeams: null, inheritsCommon: false, commonTeams: [], convertToken: null }
/** 화면을 처음으로 되돌려도 남기는 실행 의도 — 응답을 잃은 뒤 같은 파일·같은 입력으로 다시 실행하면 같은 id 여야 두 벌이 되지 않는다(RF3).
 *  다른 파일·다른 입력이면 지문이 달라 새 id 다. */
const keptIntent = (s: WizardState): Pick<WizardState, 'commandId' | 'intentKey' | 'preBackup'> =>
  ({ commandId: s.commandId, intentKey: s.intentKey, preBackup: s.preBackup })

/** 2단계 진입 기본값 계약(§6.2): 저장 양식이 파일 구조와 같을 때만 savedProfile, 아니면 detection.profile(Task 1b —
 *  다른 구조의 파일을 저장 양식으로 읽으면 오류 없이 틀린 값이 쓰인다). 저장 양식은 useSavedProfile 로만 고른다. */
export function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'fileSelected':
      // 파일을 바꾸면 이전 감지·편집 결과는 전부 무효 — 처음부터 다시 진행한다. 실행 의도는 남긴다(keptIntent).
      return { ...initialWizardState, ...keptIntent(state), fileName: action.fileName }
    case 'inspectStart':
      return { ...state, busy: true, error: null }
    case 'inspectSuccess': {
      const choice = initialProfileChoice(action.detection, action.savedProfile)
      return {
        ...state,
        busy: false,
        step: 'review',
        detection: action.detection,
        savedProfile: action.savedProfile,
        ...choice,
        // 불일치면 양식 저장은 기본 꺼짐 — 켜 둔 채 실행하면 감지 양식이 저장 양식을 조용히 덮어쓴다. 사용자가 켜면 저장한다.
        saveProfile: choice.profileMismatch === null,
        skippedHolidays: action.skippedHolidays ?? [],
        error: null,
      }
    }
    case 'inspectFailure':
      return { ...state, busy: false, error: action.error }
    case 'profileChanged':
      return { ...state, profile: action.profile }
    case 'modeChanged':
      return { ...state, mode: action.mode }
    case 'saveProfileChanged':
      return { ...state, saveProfile: action.saveProfile }
    case 'intentChanged':
      // 같은 의도 — id 가 있으면 그대로(재시도·등록 재실행), 확정 실패로 비웠으면 새 id 만 받는다(사전 백업은 그 의도의 것이라 남긴다).
      // 다른 의도 — 새 id, 받아 둔 사전 백업은 다른 입력의 것이라 버린다.
      if (state.intentKey === action.intentKey) return state.commandId !== null ? state : { ...state, commandId: action.commandId }
      return { ...state, intentKey: action.intentKey, commandId: action.commandId, preBackup: null }
    case 'preBackupTaken':
      // 묶을 의도가 없으면 무시한다 — 컴포넌트는 백업을 받기 직전에 intentChanged 를 보낸다
      return state.intentKey === null ? state : { ...state, preBackup: { generatedAt: action.generatedAt } }
    case 'executeStart':
      return { ...state, busy: true, error: null, errors: null, ...NO_TEAMS_PROMPT }
    case 'executeNeedsTeams':
      // 409 는 영수증을 남기지 않는다 — 등록 재실행은 같은 의도·같은 id(commandId 를 지우지 않는다)
      return { ...state, busy: false, needsTeams: action.teams, inheritsCommon: action.inheritsCommon, commonTeams: action.commonTeams, convertToken: action.convertToken ?? null }
    case 'dismissNeedsTeams':
      return { ...state, ...NO_TEAMS_PROMPT }
    case 'executeFailure':
      // 확정 실패는 아무것도 적용되지 않았다 — 다음 실행은 새 id(같은 id 를 다시 쓰면 COMMAND_REUSED 일 수 있다). 그 밖은 같은 id 로 재시도
      return { ...state, busy: false, error: action.error, ...NO_TEAMS_PROMPT, commandId: action.definitive ? null : state.commandId }
    case 'executeValidationFailure':
      // 링크 오류(400)도 확정 실패다
      return { ...state, busy: false, errors: action.errors, ...NO_TEAMS_PROMPT, commandId: null }
    case 'executeProfileMismatch':
      return { ...state, busy: false, error: action.error, profileMismatch: action.profileMismatch ?? state.profileMismatch }
    case 'executeSuccess':
      // 적용됐다(applied·duplicate) — 같은 입력으로 다시 실행하면 새 명령이다(옛 id 면 duplicate 만 받는다). 트리가 바뀌었으니 사전 백업도 버린다
      return {
        ...state, busy: false, step: 'done', result: action.result, error: null, errors: null, ...NO_TEAMS_PROMPT,
        commandId: null, intentKey: null, preBackup: null,
      }
    case 'reset':
      // 처음부터 다시 — 화면은 초기로, 실행 의도는 남긴다(fileSelected 와 같은 이유)
      return { ...initialWizardState, ...keptIntent(state) }
    // 리뷰 Important #2 — savedProfile 로 시작한 2단계에서도 업로드 파일이 실제로 감지한 프로파일로
    // 되돌릴 길이 있어야 한다(레거시 프로젝트가 새 양식 파일을 저장된 옛 프로파일로 잘못 해석해
    // 임포트를 막아버리는 사고 방지). detection 이 없으면(있을 수 없는 상태지만) 무변화.
    case 'resetToDetected':
      return state.detection ? { ...state, profile: state.detection.profile, profileSource: 'detected' } : state
    // 불일치 경고를 본 사용자가 저장 양식을 직접 고른다 — execute 에 확인 플래그가 실린다(서버가 최종 관문).
    case 'useSavedProfile':
      return state.savedProfile ? { ...state, profile: state.savedProfile, profileSource: 'saved' } : state
    default:
      return state
  }
}


/** 계층 방식 전환 — columns↔outline. 반대편에 없던 필드는 합리적 기본값으로 재구성한다.
 *  columns 로 돌아가면 name 은 다시 null(계층 열 자체가 이름의 출처 — profile.ts 규약). */
export function switchHierarchyKind(profile: ExcelProfile, kind: 'columns' | 'outline'): ExcelProfile {
  if (profile.hierarchy.kind === kind) return profile
  if (kind === 'outline') {
    const column = profile.hierarchy.kind === 'columns' ? profile.hierarchy.columns[0] : 0
    return { ...profile, hierarchy: { kind: 'outline', column } }
  }
  const column = profile.hierarchy.kind === 'outline' ? profile.hierarchy.column : 0
  return { ...profile, hierarchy: { kind: 'columns', columns: [column] }, logical: { ...profile.logical, name: null } }
}

/** 아웃라인 코드 열 편집. columns 모드에서는 무의미하므로 무시(호출부가 outline 일 때만 부른다). */
export function setOutlineColumn(profile: ExcelProfile, column: number): ExcelProfile {
  if (profile.hierarchy.kind !== 'outline') return profile
  return { ...profile, hierarchy: { kind: 'outline', column } }
}

/** 논리 열 편집 — 8개 필드(extraAxis/code/name/deliverable/start/end/weight/actualPct) 공용. */
export function setLogicalColumn(
  profile: ExcelProfile,
  field: keyof ExcelProfile['logical'],
  column: number | null,
): ExcelProfile {
  return { ...profile, logical: { ...profile.logical, [field]: column } }
}

/** 마크 사전 편집 행 — 컴포넌트는 ownerMarks(Record)를 직접 편집하지 않고 이 행 배열을 들고 있는다.
 *  이유: 텍스트 입력 중(키를 한 글자씩 고칠 때) React key 가 객체 키 자체면 매 타이핑마다
 *  리스트 아이템이 통째로 리마운트돼 포커스를 잃는다 — id 는 값과 무관하게 고정. */
export interface MarkRow { id: number; key: string; kind: 'primary' | 'support' }

export function recordToRows(marks: ExcelProfile['ownerMarks']): MarkRow[] {
  return Object.entries(marks).map(([key, kind], i) => ({ id: i, key, kind }))
}

/** 빈 키 행은 버리고, 같은 키가 중복되면 나중 행이 이긴다(Object.fromEntries 관례 — 사전 삭제 UX). */
export function rowsToRecord(rows: MarkRow[]): ExcelProfile['ownerMarks'] {
  return Object.fromEntries(
    rows.map((r): [string, 'primary' | 'support'] => [r.key.trim(), r.kind]).filter(([key]) => key !== ''),
  )
}

/* ── 미리보기 표 파생(리뷰 Important #2) — replace 는 되돌릴 수 없어 이 표가 실행 전 유일한
 *  검증면이다: 계층 방식·논리 열 편집이 표에 즉시 반영돼야 한다. 아래는 로케일 무관 구조만 만들고
 *  라벨 문구는 컴포넌트가 role 을 보고 t() 로 붙인다(도메인 모듈은 i18n 을 모른다 — 기존 관례). ── */

export type PreviewColumnRole =
  | { kind: 'hierarchy' }
  | { kind: 'logical'; field: keyof ExcelProfile['logical'] }
  | { kind: 'team'; team: string }
  | null

export interface MappedPreviewColumn { index: number; label: string; role: PreviewColumnRole }
export interface MappedPreviewRow { depth: number | null; cells: unknown[] }
export interface MappedPreview { columns: MappedPreviewColumn[]; rows: MappedPreviewRow[] }

// detect.ts/parseWithProfile.ts 와 동일 패턴(둘 다 비export 라 각자 복제해 왔다 — Plan C 통합 때 단일화).
const OUTLINE_RE = /^\d+([.\-]\d+)*$/

function isBlankPreviewCell(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
}

/** 행 하나의 계층 깊이를 판정한다. columns 모드는 정확히 1열만 채워져야 판정 가능(0/2개+ 채움은 null —
 *  편집 중 일시적으로 모호해질 수 있어 에러로 막지 않고 "?"로 보여준다). outline 모드는 코드 형식이
 *  아니면 null. parseWithProfile.linkByDepth 와 달리 실행을 막지 않는 표시 전용 판정이다. */
function computeRowDepth(row: unknown[], profile: ExcelProfile): number | null {
  if (profile.hierarchy.kind === 'columns') {
    const cols = profile.hierarchy.columns
    const filled = cols.filter(c => !isBlankPreviewCell(row[c]))
    return filled.length === 1 ? cols.indexOf(filled[0]) : null
  }
  const raw = String(row[profile.hierarchy.column] ?? '').trim()
  if (!OUTLINE_RE.test(raw)) return null
  return (raw.match(/[.\-]/g) ?? []).length
}

/** `detection.preview`(헤더+상위 10행 원본)를 현재 profile 매핑 기준으로 다시 라벨링한다.
 *  ArrayBuffer 재업로드+`parseWithProfile` 전체 재파싱은 쓰지 않는다 — 이미 서버가 돌려준 원본
 *  10행만으로 "이 열이 무엇에 매핑됐는지" 표시하는 데는 충분하고, 값 자체는 실행 시 서버가 다시
 *  정본으로 파싱하므로 여기서 날짜/숫자 변환까지 복제할 이유가 없다(파일당 1회면 충분한 파싱을
 *  편집 키 입력마다 반복하지 않는다). 열 우선순위: 계층 > 논리 > 팀(한 열이 여러 역할과 겹치는
 *  건 정상 프로파일에서는 없지만, 편집 중 일시적으로 겹칠 수 있어 결정적 우선순위를 둔다). */
export function deriveMappedPreview(headers: string[], rows: unknown[][], profile: ExcelProfile): MappedPreview {
  const maxCol = Math.max(headers.length, ...rows.map(r => r.length), 0)
  const hierarchySet = new Set<number>(
    profile.hierarchy.kind === 'columns' ? profile.hierarchy.columns : [profile.hierarchy.column],
  )
  const logicalByCol = new Map<number, keyof ExcelProfile['logical']>()
  for (const [field, col] of Object.entries(profile.logical) as [keyof ExcelProfile['logical'], number | null][]) {
    if (col !== null && !logicalByCol.has(col)) logicalByCol.set(col, field)
  }
  const teamByCol = new Map<number, string>()
  for (const [col, name] of profile.teamColumns) if (!teamByCol.has(col)) teamByCol.set(col, name)

  const columns: MappedPreviewColumn[] = []
  for (let c = 0; c < maxCol; c++) {
    let role: PreviewColumnRole = null
    if (hierarchySet.has(c)) role = { kind: 'hierarchy' }
    else if (logicalByCol.has(c)) role = { kind: 'logical', field: logicalByCol.get(c)! }
    else if (teamByCol.has(c)) role = { kind: 'team', team: teamByCol.get(c)! }
    columns.push({ index: c, label: headers[c] || `#${c}`, role })
  }

  const rowsOut: MappedPreviewRow[] = rows.map(r => ({ depth: computeRowDepth(r, profile), cells: r }))

  return { columns, rows: rowsOut }
}
