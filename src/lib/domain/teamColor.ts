// 팀 색 순수 도메인 — JSX 없음. 칸반(도메인)·WBS·멤버 화면이 같은 슬롯을 쓴다.

/** 팀 색 팔레트 — 저장 값(teams.color hex)과 화면 슬롯(category-1..8)의 대응표. 값은 테마 `category-N` 의 라이트 값과 같다.
 *  생성 순 자동 배정(`pickTeamColor`)과 관리 화면의 색 선택(`teamColorOfSlot`)이 이 표의 값만 저장한다 — 임의 hex 는 저장하지 않는다
 *  (다크 대비가 서지 않는다). 화면은 이 hex 를 그리지 않고 팔레트 자리로 슬롯을 고른다(`teamSlot` — SP4 D3). */
export const TEAM_PALETTE = ['#4f46e5', '#0276a8', '#7c3aed', '#a65b00', '#0f766e', '#9d3b8c', '#5b6b00', '#3f5f7a'] as const

/** 고를 수 있는 슬롯 번호(1~8) — 팔레트 자리 + 1 */
export const TEAM_SLOT_COUNT = TEAM_PALETTE.length

/** 정렬순번으로 팔레트에서 색을 고른다 — 순번이 팔레트 길이를 넘으면 순환(아홉째 팀부터 겹친다). */
export function pickTeamColor(sortOrder: number): string {
  return TEAM_PALETTE[((sortOrder % TEAM_PALETTE.length) + TEAM_PALETTE.length) % TEAM_PALETTE.length]
}

/** 슬롯 번호(1~8) → 저장할 hex. 범위 밖·정수가 아니면 null(호출부가 거부한다 — 가까운 값으로 고쳐 저장하지 않는다) */
export function teamColorOfSlot(slot: unknown): string | null {
  return typeof slot === 'number' && Number.isInteger(slot) && slot >= 1 && slot <= TEAM_PALETTE.length ? TEAM_PALETTE[slot - 1] : null
}

/** 팀 화면 색 슬롯(SP4 D3) — 다크 짝이 있는 테마 토큰 category-1..8. 저장 hex 를 inline 으로 그리지 않는다(다크 대비). */
export type TeamSlotStyle = { fg: string; bar: string; chip: string }
/** 슬롯을 정하는 데 필요한 팀 필드 — Team 이 그대로 맞는다 */
export type TeamColorRef = { id: string; code: string; color: string }

/** Tailwind JIT 가 읽도록 클래스는 리터럴로 둔다 */
export const CATEGORY_SLOTS: readonly TeamSlotStyle[] = [
  { fg: 'text-category-1', bar: 'bg-category-1', chip: 'bg-category-1-weak text-category-1' },
  { fg: 'text-category-2', bar: 'bg-category-2', chip: 'bg-category-2-weak text-category-2' },
  { fg: 'text-category-3', bar: 'bg-category-3', chip: 'bg-category-3-weak text-category-3' },
  { fg: 'text-category-4', bar: 'bg-category-4', chip: 'bg-category-4-weak text-category-4' },
  { fg: 'text-category-5', bar: 'bg-category-5', chip: 'bg-category-5-weak text-category-5' },
  { fg: 'text-category-6', bar: 'bg-category-6', chip: 'bg-category-6-weak text-category-6' },
  { fg: 'text-category-7', bar: 'bg-category-7', chip: 'bg-category-7-weak text-category-7' },
  { fg: 'text-category-8', bar: 'bg-category-8', chip: 'bg-category-8-weak text-category-8' },
]
/** 그 범위의 팀 목록에 없는 code(비활성 팀 담당·다른 범위의 전용 팀·공급자가 없는 공유 화면) — 슬롯을 지어내면 같은 팀이 화면마다
 *  다른 색이 된다(계획 P1). 채움 위 글자는 category-fg 그대로 대비가 선다(라이트 흰 글자/gray-600, 다크 cobalt-950/ink-d200) */
export const NEUTRAL_SLOT: TeamSlotStyle = { fg: 'text-neutral', bar: 'bg-neutral', chip: 'bg-neutral-weak text-neutral' }

function stableHash(s: string): number {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return h
}

/** 1~8 — 저장 색이 TEAM_PALETTE 의 i 번째면 i+1(생성 순 배정 pickTeamColor·색 선택 그대로라 워크스페이스 앞 여덟 팀이 서로 다르다),
 *  팔레트 밖(DB 기본값 #6b7280·직접 SQL)이면 팀 id 의 안정 해시. 전환 RPC 는 색을 그대로 복사하므로 전환한 팀의 슬롯도 그대로다 */
export function teamSlotIndex(team: { id: string; color: string }): number {
  const i = (TEAM_PALETTE as readonly string[]).indexOf(String(team.color ?? '').trim().toLowerCase())
  return i >= 0 ? i + 1 : (stableHash(team.id) % CATEGORY_SLOTS.length) + 1
}

export function teamSlot(team: { id: string; color: string }): TeamSlotStyle {
  return CATEGORY_SLOTS[teamSlotIndex(team) - 1]
}

/** code → 슬롯. teams 는 그 범위의 팀(활성) — 없으면 중립 */
export function teamSlotFor(code: string, teams: readonly TeamColorRef[]): TeamSlotStyle {
  const t = teams.find((x) => x.code === code)
  return t ? teamSlot(t) : NEUTRAL_SLOT
}
