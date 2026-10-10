// 프로젝트 생애 상태 — 날짜 + 실제 WBS 진행을 결합한 **파생값**이다(저장된 수동 상태 필드는 없다).
// 배경 1: 날짜만 보던 판정은 종료일이 지나면 실적 50%여도 '완료'로 표시했다.
// 배경 2(사용자 테스트 BUG-35): 날짜가 먼저였던 판정은 기간이 없거나 시작일 전이면 WBS 가 진행 중·전부 완료여도 '시작 전'이었다
// (홈에서 진척 100% 인 프로젝트가 '시작 전'). 작업 상태는 실적 입력만으로 바뀌는데 프로젝트만 날짜에 묶여 있었다 — 이제 WBS 가 먼저다.

// 'unknown' = WBS 조회 자체가 실패해 완료 여부를 알 수 없음. 실패를 'WBS 없음'으로 폴백하면
// 종료일 지난 미완 프로젝트가 '완료'로 둔갑하므로(아래 done 분기), 모름은 모름으로 표시한다.
export type ProjectLifecycleStatus = 'ready' | 'active' | 'overdue' | 'done' | 'unknown'

export interface ProjectCompletion {
  hasWbs: boolean
  allDone: boolean
  /** 잎 작업이 하나라도 진행됐는가(실적 > 0 또는 진행 단계 — leafStarted). 생략은 false(옛 호출부 — 날짜 판정 그대로) */
  anyStarted?: boolean
}

export interface CompletionRow {
  id: string
  parentId: string | null
  projectId: string
  actualPct: number | null
  /** 업무 흐름 단계(as·ip·im·xx). 읽지 않은 호출부는 생략 — 실적만으로 판정한다 */
  stage?: string | null
}

/** 진행으로 치는 단계 — 작업 중(ip)·검수 대기(im)·완료(xx). 할당됨(as)·미착수(null)는 아직 시작이 아니다 */
const STARTED_STAGES: ReadonlySet<string> = new Set(['ip', 'im', 'xx'])

/** 잎 작업 하나가 진행됐는가 — 실적이 0 보다 크거나(원시값) 진행 단계다 */
export function leafStarted(actualPct: number | null | undefined, stage?: string | null): boolean {
  return (actualPct ?? 0) > 0 || (stage != null && STARTED_STAGES.has(stage))
}

/**
 * 판정 순서(한 규칙 — 프로젝트 목록·홈 위젯·포트폴리오가 같이 쓴다):
 *  1. WBS 가 있고 잎이 전부 완료 → 'done'(날짜와 무관 — 일찍 끝낸 프로젝트도 완료다).
 *  2. 종료일이 지났다 → 진척을 모르면 'unknown', WBS 가 없으면 날짜 기준 'done', 미완이 남았으면 'overdue'(기존 지연 규칙).
 *  3. 잎이 하나라도 진행됐다 → 'active'(기간이 없거나 시작일 전이어도).
 *  4. 그 밖은 날짜: 기간이 없거나 시작일 전이면 'ready', 기간 안이면 'active'.
 */
export function projectLifecycleStatus(
  start: string | null,
  end: string | null,
  today: string,
  completion: ProjectCompletion | null,   // null = 조회 실패(모름) — '완료'로 위장하지 않는다
): ProjectLifecycleStatus {
  if (completion?.hasWbs && completion.allDone) return 'done'
  if (start && end && today > end) {
    if (!completion) return 'unknown'
    // WBS가 없으면 판단 근거가 없으므로 날짜 기준(done)을 유지한다.
    if (!completion.hasWbs) return 'done'
    return 'overdue'
  }
  if (completion?.anyStarted) return 'active'
  if (!start || !end) return 'ready'
  if (today < start) return 'ready'
  return 'active'
}

// done 판정은 원시값 >= 100 (statusOf와 동일 규약 — 반올림 금지)
export function computeCompletionMap(rows: CompletionRow[]): Record<string, ProjectCompletion> {
  const parents = new Set<string>()
  for (const r of rows) if (r.parentId) parents.add(r.parentId)
  const map: Record<string, ProjectCompletion> = {}
  for (const r of rows) {
    if (parents.has(r.id)) continue // 리프만 (자식 유무 판정 — level 아님)
    const cur = map[r.projectId] ?? { hasWbs: false, allDone: true, anyStarted: false }
    cur.hasWbs = true
    if ((r.actualPct ?? 0) < 100) cur.allDone = false
    if (leafStarted(r.actualPct, r.stage)) cur.anyStarted = true
    map[r.projectId] = cur
  }
  return map
}
