// 프로젝트 준비 체크리스트의 순수 판정(첫 사용 흐름) — 각 단계의 완료를 "확인했어요" 클릭이 아니라 실제 상태로 가른다.
// 재료(SetupInput)는 서버가 읽어 내린다: 설정은 해석기(getProjectConfig)의 키 상태·팀·영역 그대로, 건수는 src/lib/data/projectSetup.ts.
// 화면(ProjectSetupChecklist)은 여기서 나온 단계 목록에 사용자의 "건너뛰기"(브라우저 저장)만 얹는다 — 서버 상태가 완료면 그것이 우선이다.

export const SETUP_STEP_IDS = ['basic', 'levels', 'teams', 'members', 'areas', 'calendar', 'firstData'] as const
export type SetupStepId = (typeof SETUP_STEP_IDS)[number]
/** done = 완료, todo = 아직, unknown = 그 단계의 재료를 읽지 못했다(완료로도 미완료로도 말하지 않는다 — 에러 3원칙) */
export type SetupStepState = 'done' | 'todo' | 'unknown'
export interface SetupStep { id: SetupStepId; state: SetupStepState }

/** 설정 키의 상태(해석기 KeyState 의 status) — 'set' 만 "사람이 정해 저장한 값"이다. default 는 미설정, invalid·required_missing 은 손상 */
type KeyStatus = 'set' | 'default' | 'required_missing' | 'invalid'

export interface SetupInput {
  projectId: string
  /** 프로젝트 행 — 못 읽었으면 null(기본 정보 단계가 unknown) */
  project: { name: string | null; startDate: string | null; endDate: string | null } | null
  /** core.level_labels — 저장된 단계 이름 수(손상·미설정이면 status 로 가른다) */
  levelLabels: { status: KeyStatus; count: number }
  /** 달력 세 키의 상태 */
  calendar: { timezone: KeyStatus; workingDays: KeyStatus; weekStart: KeyStatus }
  /** 해석기의 팀 — 그 워크스페이스 공용(projectId null) ∪ 그 프로젝트 전용. 노출 규칙은 여기서 다시 적용한다 */
  teams: readonly { projectId: string | null; active: boolean }[]
  /** 주간보고 모듈이 이 프로젝트에서 켜져 있는가 — 꺼지면 업무영역 단계를 내지 않는다 */
  weeklyEnabled: boolean
  /** 주간 업무영역(weekly_section) */
  weeklyAreas: readonly { active: boolean }[]
  /** 활성 명단 행 수(계정 없는 외부 인력 포함). null = 조회 실패 */
  rosterCount: number | null
  /** 수락 전(회수·만료 아님) 초대 수. null = 조회 실패 */
  pendingInvites: number | null
  /** 작업 계획 항목 수. null = 조회 실패 */
  wbsItems: number | null
}

const done = (ok: boolean): SetupStepState => (ok ? 'done' : 'todo')

/**
 * 준비 단계와 그 상태 — 순서는 화면 순서다. 모듈이 꺼진 단계(업무영역 ← 주간보고)는 목록에 없다.
 *  - 기본 정보: 이름과 기간(시작·종료 둘 다)
 *  - 단계 이름: core.level_labels 가 저장돼 있고 1개 이상
 *  - 팀: 이 프로젝트가 쓰는 팀(전용 팀이 하나라도 있으면 그것만, 없으면 상속한 공용 팀 — resolveTeamsForProject 와 같은 규칙)에 활성 팀 1개 이상.
 *    전용 팀을 만들었는데 전부 비활성이면 미완료다(그때는 공용 팀을 상속하지 않는다).
 *  - 멤버: 명단 2명 이상(만든 사람 말고 한 명 더), 또는 보낸 초대 1건 이상(수락을 기다리는 중이어도 할 일은 했다)
 *  - 업무영역: 활성 주간 업무영역 1개 이상(주간보고가 켜져 있을 때만)
 *  - 달력: 시간대·근무 요일·주 시작이 모두 저장돼 있다(새 프로젝트는 워크스페이스 기본값을 복사해 저장된 채로 시작한다 — 옛 프로젝트의 미설정을 잡는다)
 *  - 첫 데이터: 작업 계획 항목 1개 이상
 */
export function projectSetupSteps(input: SetupInput): SetupStep[] {
  const own = input.teams.filter((t) => t.projectId === input.projectId)
  const used = own.length > 0 ? own : input.teams.filter((t) => t.projectId === null)
  const cal = input.calendar
  const members: SetupStepState =
    (input.rosterCount !== null && input.rosterCount >= 2) || (input.pendingInvites !== null && input.pendingInvites >= 1) ? 'done'
      : input.rosterCount === null || input.pendingInvites === null ? 'unknown' : 'todo'
  const steps: (SetupStep | null)[] = [
    { id: 'basic', state: input.project === null ? 'unknown'
      : done(!!input.project.name?.trim() && !!input.project.startDate && !!input.project.endDate) },
    { id: 'levels', state: done(input.levelLabels.status === 'set' && input.levelLabels.count >= 1) },
    { id: 'teams', state: done(used.some((t) => t.active)) },
    { id: 'members', state: members },
    input.weeklyEnabled ? { id: 'areas', state: done(input.weeklyAreas.some((a) => a.active)) } : null,
    { id: 'calendar', state: done(cal.timezone === 'set' && cal.workingDays === 'set' && cal.weekStart === 'set') },
    { id: 'firstData', state: input.wbsItems === null ? 'unknown' : done(input.wbsItems >= 1) },
  ]
  return steps.filter((s): s is SetupStep => s !== null)
}

export interface SetupProgress {
  total: number
  /** 완료(서버 상태) 수 */
  done: number
  /** 건너뛴(그리고 서버 상태가 완료가 아닌) 수 */
  skipped: number
  /** 다음에 할 단계 — 아직(todo)이고 건너뛰지 않은 첫 단계. 없으면 null */
  next: SetupStepId | null
  /** 남은 일이 없다 — 모든 단계가 완료이거나 건너뛰었다(unknown 은 남은 일이 아니다: 모르는 것을 할 일로 내밀지 않는다) */
  settled: boolean
}

/** 단계 목록 + 사용자가 건너뛴 단계 → 진행 요약. 서버 상태가 완료면 건너뛰기 표시는 무시한다(완료가 우선) */
export function setupProgress(steps: readonly SetupStep[], skipped: ReadonlySet<string>): SetupProgress {
  const isSkipped = (s: SetupStep) => s.state !== 'done' && skipped.has(s.id)
  const next = steps.find((s) => s.state === 'todo' && !isSkipped(s))?.id ?? null
  return {
    total: steps.length,
    done: steps.filter((s) => s.state === 'done').length,
    skipped: steps.filter(isSkipped).length,
    next,
    settled: next === null,
  }
}

/** 단계가 가리키는 자리 — 설정 화면의 절(#…) 또는 그 일을 하는 화면 */
export function setupStepHref(projectId: string, id: SetupStepId): string {
  const settings = (hash: string) => `/p/${projectId}/settings#${hash}`
  switch (id) {
    case 'basic': return settings('project-general')
    case 'levels': return settings('project-general')
    case 'teams': return settings('project-team')
    case 'members': return `/p/${projectId}/members`
    case 'areas': return settings('project-team')
    case 'calendar': return settings('project-calendar')
    case 'firstData': return `/p/${projectId}/wbs`
  }
}
