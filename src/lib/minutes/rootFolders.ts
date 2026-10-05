/**
 * 회의록 최상위 폴더 모드(SP5 B2 — 개정 §4.7, 스펙 D21) — 순수 계약. I/O 없음.
 * teams: 팀마다 루트 하나(`minute_folders.kind = 'team_root'`, `team_id`) — 팀 생성이 루트를 만들고, 개명이 루트 이름을 따라가고,
 *        비활성 팀의 루트는 읽기 전용이다. 회의록 `team_id` 가 편철 위치를 정한다.
 * custom: 관리자가 정한 이름의 루트(`custom_root`) — 팀은 폴더를 만들지 않고 회의록 `team_id` 는 속성·필터일 뿐이다.
 * custom 은 SP7 전까지 화면에 내놓지 않는다(D21 — 키 editor = platform_admin, 설정 화면은 teams 만).
 */
import type { Parsed } from '@/lib/settings/def'

export type RootFoldersSetting = { mode: 'teams' } | { mode: 'custom'; names: string[] }
export const DEFAULT_ROOT_FOLDERS: RootFoldersSetting = { mode: 'teams' }

/** custom 루트 이름 수 상한 — 최상위 폴더 목록이라 작게 둔다 */
export const ROOT_NAMES_MAX = 20
const NAME_MAX = 30

const fail = <T>(error: string): Parsed<T> => ({ ok: false, error })
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** 엄격 parse — 모르는 필드·모드 거부. custom 이름은 1~30자(앞뒤 공백 정리)·대소문자 무시 유일·꺾쇠·경로 구분자 금지 */
export function parseRootFolders(raw: unknown): Parsed<RootFoldersSetting> {
  if (!isObj(raw)) return fail('최상위 폴더 설정은 { mode } 객체여야 합니다.')
  if (raw.mode === 'teams') {
    return Object.keys(raw).length === 1 ? { ok: true, value: { mode: 'teams' } } : fail('teams 모드에는 다른 필드가 없습니다.')
  }
  if (raw.mode !== 'custom') return fail("mode 는 'teams' 또는 'custom' 이어야 합니다.")
  if (Object.keys(raw).sort().join(',') !== 'mode,names') return fail('custom 모드는 { mode, names } 여야 합니다.')
  if (!Array.isArray(raw.names) || raw.names.length < 1 || raw.names.length > ROOT_NAMES_MAX) {
    return fail(`최상위 폴더 이름은 1~${ROOT_NAMES_MAX}개여야 합니다.`)
  }
  const names: string[] = []
  const seen = new Set<string>()
  for (const n of raw.names) {
    if (typeof n !== 'string') return fail('최상위 폴더 이름은 문자열이어야 합니다.')
    const name = n.trim()
    if (name.length < 1 || name.length > NAME_MAX) return fail(`최상위 폴더 이름은 1~${NAME_MAX}자여야 합니다.`)
    if (/[<>/\\]/.test(name)) return fail('최상위 폴더 이름에 꺾쇠·경로 구분자를 쓸 수 없습니다.')
    const key = name.toLowerCase()
    if (seen.has(key)) return fail(`최상위 폴더 이름이 중복됩니다: ${name}`)
    seen.add(key)
    names.push(name)
  }
  return { ok: true, value: { mode: 'custom', names } }
}

/** 팀 생성이 루트를 만드는가(개정 §4.7 표 '팀 생성') */
export const teamCreatesRoot = (s: RootFoldersSetting): boolean => s.mode === 'teams'
/** 회의록 team_id 가 필수인가(표 '회의록 team_id' — teams 는 편철 위치를 정한다) */
export const minuteTeamRequired = (s: RootFoldersSetting): boolean => s.mode === 'teams'
