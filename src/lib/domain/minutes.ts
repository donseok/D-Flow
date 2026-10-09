import type { ExplorerLeaf, FolderNode, MinuteFolder, TeamCode } from './types'
import { isStoragePathFor } from './storagePath'
import { SIGNED_URL_TTL_SEC } from './signedUrl'

export const MINUTE_TITLE_MAX = 200
export const MINUTE_BODY_MAX = 100_000          // body_md 실효 한도(자)
export const MINUTE_BODY_FILE_MAX = 1_048_576   // 원시 .md 파일 안전망(1MB)
export const MINUTES_ATTACHMENT_MAX_BYTES = 20_971_520 // 첨부 개당 20MB(버킷 file_size_limit와 일치)
export const MINUTES_ATTACHMENTS_MAX_COUNT = 10
/** 회의록 파일 서명 URL 의 유효 시간(초) — 공용 SIGNED_URL_TTL_SEC 와 같은 값(클릭 때 발급). 발급할 때마다
 *  RLS("minutes bucket read")를 다시 검사한다 — 권한을 회수하면 새 URL 은 즉시 막히지만 이미 발급한 URL 은 이 시간까지
 *  유효하다(회수 창). 보관(archived) 상태는 발급을 막지 않는다 — 보관은 편집 잠금이지 열람 잠금이 아니다.
 *  actions/minutes.ts 는 'use server' 라 상수를 여기 둔다. */
export const MINUTE_FILE_URL_TTL_SEC = SIGNED_URL_TTL_SEC

/* ── 팀 없는 회의록(0052): team_code 빈 문자열 + team_id null ── */

/** "팀 없음"의 팀 코드 — 열은 NOT NULL 이라 빈 문자열로 적는다. 팀 code 는 빈 값을 못 쓰므로(teams_code_check) 어떤 팀과도 겹치지 않는다 */
export const NO_TEAM: TeamCode = ''

/** 팀 없는 회의록인가 — 사용자가 팀을 정하지 않았다(또는 해제했다). 팀 행이 지워진 옛 회의록(team_id null 이지만 team_code 원문이 남은 것)은
 *  여기에 들지 않는다: 그쪽은 옛 code 로 보인다. teamId 를 모르는 호출부(목록 밖 화면)는 code 만 넘긴다 */
export function isNoTeam(m: { teamCode: string; teamId?: string | null }): boolean {
  return m.teamCode === NO_TEAM && (m.teamId ?? null) === null
}

/* ── 최상위 폴더(SP5 B2): 종류는 minute_folders.kind, 팀 루트의 팀은 team_id ── */

/** 최상위 일반 폴더 이름이 그 범위의 팀 이름과 겹치는가 — 팀 루트 이름(= 팀 이름)을 선점하면 지연 생성되는 팀 루트가
 *  이름 유일 인덱스에 막힌다(DB 가드 MINUTE_FOLDER_NAME_RESERVED 의 앞단 안내). teamNames 는 그 범위의 비활성 포함 전체 팀 이름 */
export function isTeamRootName(name: string, teamNames: readonly string[]): boolean {
  const n = name.trim()
  return teamNames.some(t => t.trim() === n)
}

/** 팀 루트(kind = team_root)인가 — 편철 앵커. 개명·이동·삭제는 DB 가드가 막는다(이름은 팀 개명이 따라간다) */
export function isTeamRootFolder(f: Pick<MinuteFolder, 'kind'>): boolean {
  return f.kind === 'team_root'
}

/** 세션이 관리할 수 없는 최상위 폴더(팀 루트·사용자 지정 루트)인가 — 끌기·개명·삭제 단추를 숨긴다 */
export function isLockedRootFolder(f: Pick<MinuteFolder, 'kind'>): boolean {
  return f.kind === 'team_root' || f.kind === 'custom_root'
}

/* ── 담당 하위 구분(업로드 편철): 팀 루트의 실제 하위 폴더에서 동적 유도 ── */

/** 트리 표시와 동일한 정렬(sort asc → name ko asc) — buildFolderTree 의 bySort 와 일치해야
 *  모달의 하위 구분 탭 순서와 탐색기 트리 순서가 어긋나지 않는다. */
const byFolderOrder = (a: MinuteFolder, b: MinuteFolder) =>
  a.sort - b.sort || a.name.localeCompare(b.name, 'ko')

/** 팀(code)의 루트 폴더 id — kind = team_root 이고 그 팀 code 인 것. 범위를 가리지 않으므로 호출부가 범위로 거른 폴더를 넘긴다 */
export function teamRootFolderIdOf(folders: MinuteFolder[], team: TeamCode): string | null {
  return folders.find(f => isTeamRootFolder(f) && f.teamCode === team)?.id ?? null
}

/** 팀 루트의 직계 하위 폴더 — 하위 구분의 원천. 시드·사용자 폴더를 가리지 않으므로 폴더
 *  생성/개명/삭제가 챗 필터 칩·업로드·수정 모달의 하위 구분 옵션에 그대로 반영된다. */
export function teamChildFoldersOf(folders: MinuteFolder[], team: TeamCode): MinuteFolder[] {
  const rootId = teamRootFolderIdOf(folders, team)
  if (!rootId) return []
  return folders.filter(f => f.parentId === rootId).sort(byFolderOrder)
}

/** 폴더 하위 트리 id(자기 자신 포함) — 챗 폴더 필터의 검색 범위. BFS·순환 가드.
 *  부재 id 도 자기 자신 1개로 반환한다 — 빈 배열을 돌려주면 호출부의 "필터 없음" 분기와
 *  구분되지 않아 필터가 소리 없이 전체로 넓어진다(fail-closed). */
export function folderSubtreeIds(
  folders: readonly Pick<MinuteFolder, 'id' | 'parentId'>[], rootId: string,
): string[] {
  const children = new Map<string, string[]>()
  for (const f of folders) {
    if (f.parentId === null) continue
    const arr = children.get(f.parentId)
    if (arr) arr.push(f.id); else children.set(f.parentId, [f.id])
  }
  const out = new Set<string>([rootId])
  const queue = [rootId]
  while (queue.length) {
    for (const c of children.get(queue.pop()!) ?? []) {
      if (!out.has(c)) { out.add(c); queue.push(c) }
    }
  }
  return [...out]
}

/** 팀별 하위 구분 — 팀 루트의 실제 하위 폴더명. 하위 폴더가 없으면(팀 루트 부재 포함)
 *  자기 자신 1개(상위 폴더=하위 폴더).
 *  @deprecated §6 폴더 중심 재편으로 (팀, 하위 구분) 2단 모델이 폐지되어 프로덕션 사용처가 0이다.
 *  편철 폴더는 FolderPickModal 로 직접 고르고 team 은 teamSubOfFolder 로 파생한다. */
export function subgroupsOf(folders: MinuteFolder[], team: TeamCode): string[] {
  const names = teamChildFoldersOf(folders, team).map(f => f.name)
  return names.length > 0 ? names : [team]
}

/** 목록 검증 — 해당 팀의 하위 구분이 아니면 null(추측 금지).
 *  @deprecated §6 재편으로 프로덕션 사용처 0 — subgroupFolderId(deprecated) 전용. */
export function resolveTeamSub(folders: MinuteFolder[], team: TeamCode, sub: string): string | null {
  const names = subgroupsOf(folders, team)
  const trimmed = sub.trim()
  if (names.includes(trimmed)) return trimmed
  return null
}

/** (팀, 하위 구분) → 편철 대상 폴더 id. 하위 구분과 동명인 루트 직계 하위 폴더(시드·사용자
 *  불문)가 있으면 그 폴더, 없으면(자기 자신 하위·목록 밖 값 포함) 팀 루트로 — 목록 밖 값을
 *  대표 하위로 수렴시키면 요청과 다른 형제로 오편철되므로 추측 없이 루트로 강등한다.
 *  루트조차 없으면 null(서버 자동 편철 폴백). 루트 매칭만 시드 한정 — 동명 사용자 **루트**
 *  폴더(스쿼팅) 배제.
 *  @deprecated §6 재편으로 프로덕션 사용처 0. **이 함수가 3단 이상 경로를 2단으로 강등시키던
 *  주범**이다(루트 직계 자식 id 를 반환) — 되살리지 말 것. 편철은 폴더를 직접 고르게 한다. */
export function subgroupFolderId(
  folders: MinuteFolder[], team: TeamCode, sub: string,
): string | null {
  const rootId = teamRootFolderIdOf(folders, team)
  if (!rootId) return null
  const name = resolveTeamSub(folders, team, sub)
  if (name === null) return rootId
  const child = folders.find(f => f.parentId === rootId && f.name === name)
  return child?.id ?? rootId
}

/** 폴더 id → (팀, 하위 구분) 역해석 — 모달의 초기값. 조상 체인을 걸어 올라가(순환 가드)
 *  팀 루트(kind)에 닿으면, 루트 직전에 지나온 직계 하위 폴더의 이름이 하위 구분. 팀 루트 자체에
 *  편철된 경우는 하위 폴더가 없는 팀만 자기 자신이고, 하위가 있는 팀은 sub null(하위 미지정,
 *  추측 금지): 대표 폴백을 초기 선택으로 쓰면 실소속과 다른 하위가 '선택됨'으로 보이는 허위
 *  표시가 된다. 팀 루트 체인 밖(일반·지정 루트 폴더 등)은 null. */
export function teamSubOfFolder(
  folders: MinuteFolder[], folderId: string | null,
): { team: TeamCode; sub: string | null } | null {
  if (!folderId) return null
  const byId = new Map(folders.map(f => [f.id, f]))
  const seen = new Set<string>()
  let cur = byId.get(folderId)
  let below: MinuteFolder | undefined            // cur 직전에 지나온 폴더(= cur 의 직계 하위)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    if (isTeamRootFolder(cur)) {
      const team = cur.teamCode                  // 루트 이름은 팀 이름이다 — 팀은 team_id(조인한 code)로만 본다
      if (!team) return null                     // 팀을 못 읽었다 — 추측하지 않는다
      if (below) return { team, sub: below.name }
      const rootId = cur.id
      const hasChildren = folders.some(f => f.parentId === rootId)
      return { team, sub: hasChildren ? null : team }
    }
    below = cur
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return null
}

/** 폴더가 회의록의 팀을 어떻게 정하는가(0052) — 조상 체인의 최상위 폴더 종류로 가른다.
 *  - team: 팀 루트 아래 — 팀은 그 루트의 팀이다(폴더가 팀의 유일한 출처, §6.3)
 *  - free: 지정 루트(custom_root) 아래 — 폴더는 팀을 정하지 않는다. 팀은 속성일 뿐이라 팀 없이도 편철한다
 *  - null: 판정 불가(없는 폴더·끊긴 체인·팀을 못 읽은 루트·최상위 일반 폴더) — 추측하지 않는다 */
export function folderTeamRule(
  folders: MinuteFolder[], folderId: string,
): { kind: 'team'; team: TeamCode } | { kind: 'free' } | null {
  const byId = new Map(folders.map(f => [f.id, f]))
  const seen = new Set<string>()
  let cur = byId.get(folderId)
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    if (isTeamRootFolder(cur)) return cur.teamCode ? { kind: 'team', team: cur.teamCode } : null
    if (cur.kind === 'custom_root') return { kind: 'free' }
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export interface MinuteInput {
  minuteDate: string     // 'YYYY-MM-DD'
  teamCode: TeamCode
  title: string
  bodyMd: string
  meetingId: string | null
  /** 회의 선택 없이도 프로젝트 지식에 귀속할 수 있다. meetingId가 있으면 같은 프로젝트여야 한다. */
  projectId?: string | null
  /** 반복 회의의 실제 개최일. 생략하면 연결된 회의록의 minuteDate를 사용한다. */
  meetingOccurrenceDate?: string | null
}

/** 담당 팀을 뺀 입력 검증. 담당 팀은 회의록이 속할 범위(프로젝트·워크스페이스)의 팀이어야 해서 그 범위가
 *  정해진 뒤 validateMinuteTeam 으로 따로 본다 — create/updateMeta·외부 API 는 입력을 먼저 거르고 범위를 나중에 안다. */
export function validateMinuteFields(input: MinuteInput): string | null {
  const title = input.title.trim()
  if (!title) return '제목을 입력하세요.'
  if (title.length > MINUTE_TITLE_MAX) return `제목은 ${MINUTE_TITLE_MAX}자 이하여야 합니다.`
  if (!DATE_RE.test(input.minuteDate)) return '날짜 형식이 올바르지 않습니다.'
  if (input.meetingOccurrenceDate && !DATE_RE.test(input.meetingOccurrenceDate))
    return '회의 개최일 형식이 올바르지 않습니다.'
  if (input.bodyMd.length > MINUTE_BODY_MAX) return '본문은 100,000자 이하여야 합니다.'
  return null
}

/** 담당 팀 검증 — teamCodes 는 회의록이 속할 범위의 활성 팀(activeTeamCodesForMinuteScope).
 *  빈 값(NO_TEAM)은 "팀 없음"이라 통과한다(0052). 값이 있으면 지금처럼 그 범위의 활성 팀이어야 한다 — 공백뿐인 값·모르는 코드는 거부
 *  (오타를 조용히 팀 없음으로 삼키지 않는다). */
export function validateMinuteTeam(teamCode: TeamCode, teamCodes: readonly TeamCode[]): string | null {
  if (teamCode === NO_TEAM) return null
  return teamCodes.includes(teamCode) ? null : '잘못된 담당입니다.'
}

/** Storage 키 길이 상한(`storagePath.ts` 의 `fileNameOk`·Task 7 SQL 과 같은 값) — sanitize 뒤 이 안으로 잘라낸다. */
const SANITIZED_NAME_MAX = 200
/** 확장자 보존 길이 상한(점 제외) — 원본 파일명이 아주 길어도 확장자가 통째로 잘리지 않게 한다. */
const SANITIZED_EXT_MAX = 16

/**
 * 원본 표시명과 별개로 Supabase Storage 객체 키에 사용할 ASCII 파일명.
 * `SANITIZED_NAME_MAX` 자를 넘기면 확장자를 보존하며 잘라낸다 — `makeStoragePath`(storagePath.ts)의
 * 200자 상한과 같은 값이라, sanitize 출력은 항상 그 상한을 통과한다.
 */
export function sanitizeFileName(name: string): string {
  const safe = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/\.{2,}/g, '.')

  return truncateFileName(safe && !/^[._-]+$/.test(safe) ? safe : 'file', SANITIZED_NAME_MAX, SANITIZED_EXT_MAX)
}

/** `SANITIZED_NAME_MAX` 를 넘는 이름을 확장자를 보존하며 잘라낸다. 이미 상한 이내면 그대로 반환. */
function truncateFileName(name: string, maxLen: number, maxExt: number): string {
  if (name.length <= maxLen) return name
  const dot = name.lastIndexOf('.')
  let ext = dot > 0 ? name.slice(dot) : ''
  if (ext.length - 1 > maxExt) ext = ext.slice(0, maxExt + 1)
  const base = name.slice(0, Math.max(0, maxLen - ext.length))
  return base + ext
}

/** 업로드 객체의 파일 세그먼트 — `${now}-` 접두를 붙이고도 200자 상한 안으로(확장자 보존). 이미 안전한 이름이라 바깥 sanitize 는
 *  길이만 자른다. 업로드 5곳(회의록 본문·첨부, 산출물, 이슈 첨부)이 같이 쓴다. */
export function stampedFileName(name: string, now: number): string {
  return sanitizeFileName(`${now}-${sanitizeFileName(name)}`)
}

/** Storage 경로가 그 회의록 스코프(ws/<wid>/p/<pid|_>/<entity>/<minuteId>/…)인지 — 타 객체를 가리키는 메타 기록 차단.
 *  scope 는 클라이언트 입력이 아니라 DB 에서 읽은 회의록 행(생성은 확정된 워크스페이스·프로젝트)에서 얻는다. */
export function isMinuteFilePathValid(
  scope: { workspaceId: string; projectId: string | null }, minuteId: string, path: string,
  entity: 'minutes' | 'minute-files',
): boolean {
  return isStoragePathFor(path, { workspaceId: scope.workspaceId, projectId: scope.projectId, entity, entityId: minuteId })
}

/** PostgREST or() 필터에 안전하게 삽입할 ILIKE 패턴(큰따옴표 인용 포함).
 *  1단계: LIKE 이스케이프(\, %, _ 를 \ 접두) → 2단계: PostgREST 인용 이스케이프(\ 와 " ). */
export function ilikeOrPattern(needle: string): string {
  const like = needle.replace(/[\\%_]/g, m => `\\${m}`)
  const quoted = like.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"%${quoted}%"`
}

/* ── 트리 뷰: 회의체 추출 (스펙 2026-07-17-minutes-tree-view-design.md) ── */

export const MINUTES_TREE_LIMIT = 1000 // PostgREST max_rows 하드 캡(supabase/config.toml)과 일치 — 초과 값은 성립 불가

// 노이즈 토큰(전체 일치): 날짜형 5패턴(6/8자리·연월일·2자리 연도·월일, 꼬리 요일 괄호 허용) + 회차형 + 요일 괄호 단독
const WEEKDAY_TAIL = '(?:\\((?:월|화|수|목|금|토|일)\\))?'
const NOISE_PATTERNS = [
  new RegExp(`^\\d{6}${WEEKDAY_TAIL}$`),                                    // 260716
  new RegExp(`^\\d{8}${WEEKDAY_TAIL}$`),                                    // 20260716
  new RegExp(`^\\d{4}[.\\-/]\\d{1,2}(?:[.\\-/]\\d{1,2})?${WEEKDAY_TAIL}$`), // 2026-07-16, 2026.07
  new RegExp(`^\\d{2}[.\\-/]\\d{1,2}[.\\-/]\\d{1,2}${WEEKDAY_TAIL}$`),      // 26.07.16
  new RegExp(`^\\d{1,2}[.\\-/]\\d{1,2}${WEEKDAY_TAIL}$`),                   // 7.16, 07-16
  /^\(?제?\d{1,4}차\)?$/,                                                    // 12차, 제3차, (5차)
  /^\((?:월|화|수|목|금|토|일)\)$/,                                          // (수)
]

function isNoiseToken(token: string): boolean {
  return NOISE_PATTERNS.some(re => re.test(token))
}

/** 제목에서 회의체 이름 추출 — `_`·공백 토큰화 후 노이즈(날짜·회차·요일) 제거, 공백 1칸 결합.
 *  전부 제거되어 비면 원제목(trim) 반환. 그룹 키이자 표시명. */
export function meetingBodyOf(title: string): string {
  const trimmed = title.trim()
  const kept = trimmed.split(/[_\s]+/).filter(tok => tok !== '' && !isNoiseToken(tok))
  return kept.length > 0 ? kept.join(' ') : trimmed
}

/* ── 탐색기 v2: 폴더 디렉토리 (스펙 2026-07-23-minutes-folders-design.md) ── */

export const MINUTE_FOLDER_NAME_MAX = 60
export const MINUTE_FOLDER_DEPTH_MAX = 5

/** 프로젝트 일괄 지정 1회 상한. 건별로 위키 재적재가 뒤따르는 조작이라 무제한으로 열지 않는다. */
export const MINUTES_PROJECT_BULK_MAX = 200

/** 폴더 이름 정규화 — trim + **NFC**. macOS 에서 만든 한글 폴더명은 NFD 로 들어올 수 있고,
 *  그대로 저장하면 눈에 같은 이름의 폴더가 둘 생긴다(부분 유니크 인덱스도 바이트가 달라
 *  막지 못한다). 저장·비교 경로 전부가 이 함수를 통과해야 한다. */
export function normalizeFolderName(name: string): string {
  return name.trim().normalize('NFC')
}

/** 폴더 이름 검증 — 에러 메시지 또는 null (validateMinuteFields 관례).
 *
 *  ⚠️ 반드시 `normalizeFolderName` 을 거친 값으로 재야 한다. 저장은 NFC 인데 검증만 원문
 *  길이를 재면 경계가 어긋난다 — macOS 에서 만든 한글 이름은 NFD 라 자모가 분해돼 길이가
 *  2~3배로 잡히고, 20자짜리 한글 폴더명이 "60자 초과"로 거절되면서 같은 이름을 외부 API 로
 *  보내면 통과한다(외부 API 는 NFC 후 검증한다). 계약 §4.9 의 "60자 검증도 NFC 이후 길이
 *  기준"을 UI 경로에서도 참으로 만든다. */
export function validateFolderName(name: string): string | null {
  const normalized = normalizeFolderName(name)
  if (!normalized) return '폴더 이름을 입력하세요.'
  if (normalized.length > MINUTE_FOLDER_NAME_MAX) return `폴더 이름은 ${MINUTE_FOLDER_NAME_MAX}자 이하여야 합니다.`
  return null
}

/** folderId 가 트리에서 몇 단인지(null=0, 루트=1). 순환·끊긴 체인은 상한 초과 값으로 수렴해
 *  호출부의 깊이 검증이 자연히 거부하게 한다(무한 루프 방지 가드). */
export function folderDepthOf(folders: MinuteFolder[], folderId: string | null): number {
  const byId = new Map(folders.map(f => [f.id, f]))
  let depth = 0
  let cur = folderId
  while (cur) {
    depth += 1
    if (depth > MINUTE_FOLDER_DEPTH_MAX) return depth  // 순환/과깊이 — 즉시 초과 반환
    cur = byId.get(cur)?.parentId ?? null
  }
  return depth
}

/** folderId 서브트리의 높이(자기 자신 포함 단 수). 잎이면 1.
 *  폴더 이동(M4) 판정에 필요하다 — `folderDepthOf(대상) + subtreeHeightOf(이동 폴더) ≤ 5`.
 *  folderDepthOf 만으로는 부족하다: 자손이 함께 내려가므로 3단 폴더를 3단 자리로 끌면 5단을
 *  넘는다. 순환·과깊이는 상한 초과 값으로 수렴시켜 호출부의 검증이 자연히 거부하게 한다. */
export function subtreeHeightOf(folders: MinuteFolder[], folderId: string): number {
  const childrenOf = new Map<string, string[]>()
  for (const f of folders) {
    if (f.parentId === null) continue
    const list = childrenOf.get(f.parentId)
    if (list) list.push(f.id)
    else childrenOf.set(f.parentId, [f.id])
  }
  const seen = new Set<string>()
  let height = 0
  let level = [folderId]
  while (level.length > 0) {
    height += 1
    if (height > MINUTE_FOLDER_DEPTH_MAX) return height   // 순환/과깊이 — 즉시 초과 반환
    const next: string[] = []
    for (const id of level) {
      if (seen.has(id)) continue
      seen.add(id)
      const kids = childrenOf.get(id)
      if (kids) next.push(...kids)
    }
    level = next
  }
  return height
}

/** candidateId 가 ancestorId 의 자손인가(자기 자신은 false). 조상 체인을 올라가며 순환 가드.
 *  M3(사이클 금지) — 폴더를 자기 자손 밑으로 옮기면 그 서브트리가 트리에서 통째로 끊긴다. */
export function isDescendantFolder(
  folders: MinuteFolder[], ancestorId: string, candidateId: string,
): boolean {
  const byId = new Map(folders.map(f => [f.id, f]))
  const seen = new Set<string>()
  let cur = byId.get(candidateId)?.parentId ?? null
  while (cur && !seen.has(cur)) {
    if (cur === ancestorId) return true
    seen.add(cur)
    cur = byId.get(cur)?.parentId ?? null
  }
  return false
}

/** 폴더 + 리프 → 디렉토리 트리. 정렬은 sort asc·name asc(시드 0~9 우선), directLeaves 는 입력
 *  순서 보존(재정렬 없음). 방어: 부모가 목록에 없는 고아·순환 참조 폴더는 루트로 승격(조용히
 *  버리지 않음), 미존재 폴더를 가리키는 리프는 unfiled 로. */
export function buildFolderTree(
  folders: MinuteFolder[], leaves: ExplorerLeaf[],
): { roots: FolderNode[]; unfiled: ExplorerLeaf[] } {
  const nodeById = new Map<string, FolderNode>(
    folders.map(f => [f.id, { folder: f, children: [], directLeaves: [], totalCount: 0 }]))

  // 루트 판정: 부모 없음 / 부모 미존재(고아) / 조상 체인이 순환(자신에게 되돌아옴)
  const isRoot = (f: MinuteFolder): boolean => {
    if (f.parentId === null || !nodeById.has(f.parentId)) return true
    let cur: string | null = f.parentId
    const seen = new Set<string>([f.id])
    while (cur) {
      if (seen.has(cur)) return true  // 순환 절단
      seen.add(cur)
      cur = nodeById.get(cur)?.folder.parentId ?? null
    }
    return false
  }

  const roots: FolderNode[] = []
  for (const f of folders) {
    const node = nodeById.get(f.id)!
    if (isRoot(f)) roots.push(node)
    else nodeById.get(f.parentId!)!.children.push(node)
  }

  const bySort = (a: FolderNode, b: FolderNode) =>
    a.folder.sort - b.folder.sort || a.folder.name.localeCompare(b.folder.name, 'ko')
  const sortRec = (nodes: FolderNode[]) => {
    nodes.sort(bySort)
    for (const n of nodes) sortRec(n.children)
  }
  sortRec(roots)

  const unfiled: ExplorerLeaf[] = []
  for (const l of leaves) {
    const node = l.folderId ? nodeById.get(l.folderId) : undefined
    if (node) node.directLeaves.push(l)
    else unfiled.push(l)
  }

  const sumRec = (node: FolderNode): number => {
    node.totalCount = node.directLeaves.length + node.children.reduce((n, c) => n + sumRec(c), 0)
    return node.totalCount
  }
  for (const r of roots) sumRec(r)

  return { roots, unfiled }
}

/** 탐색기 최상위 프로젝트 그룹. */
export interface ExplorerProjectGroup {
  projectId: string | null              // null = 미지정
  projectName: string | null            // 미지정이면 null — 라벨은 표시측 i18n
  folders: MinuteFolder[]
  leaves: ExplorerLeaf[]
}

/** 탐색기 최상위 프로젝트 그룹핑(0076). projects 순서 유지(호출부가 내 프로젝트 우선으로
 *  정렬해 넘긴다) → 명단 밖 projectId 그룹(이름 미상 — listProjects 실패·부분 응답 방어,
 *  남의 그룹에 섞지 않는다) → 미지정(null) 마지막. 폴더도 리프도 없는 그룹은 내지 않는다. */
export function groupExplorerByProject(
  folders: MinuteFolder[], leaves: ExplorerLeaf[],
  projects: readonly { id: string; name: string }[],
): ExplorerProjectGroup[] {
  const byProject = new Map<string | null, ExplorerProjectGroup>()
  const ensure = (projectId: string | null, projectName: string | null) => {
    let g = byProject.get(projectId)
    if (!g) { g = { projectId, projectName, folders: [], leaves: [] }; byProject.set(projectId, g) }
    return g
  }
  for (const f of folders) ensure(f.projectId, null).folders.push(f)
  for (const l of leaves) ensure(l.projectId ?? null, null).leaves.push(l)
  const known = new Map(projects.map(p => [p.id, p.name]))
  const ordered: ExplorerProjectGroup[] = []
  for (const p of projects) {
    const g = byProject.get(p.id)
    if (g) { g.projectName = p.name; ordered.push(g); byProject.delete(p.id) }
  }
  for (const [pid, g] of byProject) {
    if (pid === null) continue
    g.projectName = known.get(pid) ?? null
    ordered.push(g)
  }
  const unassigned = byProject.get(null)
  if (unassigned) ordered.push(unassigned)
  return ordered
}
