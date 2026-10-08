// SP7 §5.1.4 "env 시크릿은 킬스위치로만" — 삭제한 옛 인증 경로가 src 로 되돌아오지 않게 고정한다.
//  · 배포 전역 시크릿 두 개(에이전트·회의록)의 env 이름: 인증은 integration_credentials 행뿐이고 *_ENABLED 는 킬스위치다.
//  · 옛 PAT 저장소(러너 표) 판독: 리졸버의 폴백이 삭제됐다. 표 자체는 아직 DB 에 있다(drop 은 뒤 조각) — 그래서 src 가 이름을 다시 쓰면 곧장 살아난다.
//  · 레거시 principal 의 응답 코드: 시크릿 호출에게 신원을 묻던 400 은 없다(그 호출은 401 이다).
// 주석까지 포함한 원문을 본다 — "설명만 남긴다"도 허용하지 않는다(옛 이름은 docs/ 의 역사 기록에만 둔다). 조립한 이름(문자열 연결)은 못 잡는다.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { walk } from './_walk'

const ROOT = join(process.cwd(), 'src')
// 이 파일 자신이 금지어를 원문으로 품지 않게 조각으로 적는다(tests/ 는 검사 대상이 아니지만 grep 점검에 걸리지 않게).
const AGENT_SECRET = ['AGENT', 'API', 'SECRET'].join('_')
const MINUTES_SECRET = ['MINUTES', 'API', 'SECRET'].join('_')
const RUNNERS_TABLE = ['agent', 'runners'].join('_')
const LEGACY_CODE = ['identity', 'required'].join('_')

function hits(pattern: RegExp): string[] {
  const out: string[] = []
  for (const file of walk(ROOT)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => { if (pattern.test(line)) out.push(`${relative(process.cwd(), file)}:${i + 1}`) })
  }
  return out
}

describe('옛 인증 경로는 src 에 없다(SP7 §5.1.4)', () => {
  it('검사가 실제로 파일을 읽는다 — 살아 있는 킬스위치 이름은 잡힌다(대조)', () => {
    expect(hits(/AGENT_API_ENABLED/).length).toBeGreaterThan(0)
    expect(hits(/MINUTES_API_ENABLED/).length).toBeGreaterThan(0)
    expect(hits(/from\('integration_credentials'\)/).length).toBeGreaterThan(0)
  }, 20_000)

  it('에이전트 API 의 배포 전역 시크릿 env 이름이 0건', () => {
    expect(hits(new RegExp(AGENT_SECRET))).toEqual([])
  }, 20_000)

  it('회의록 API 의 단일 시크릿 env 이름이 0건', () => {
    expect(hits(new RegExp(MINUTES_SECRET))).toEqual([])
  }, 20_000)

  it("옛 PAT 저장소 표를 읽거나 쓰지 않는다 — from('…') 는 물론 이름 자체가 0건", () => {
    expect(hits(new RegExp(`from\\(\\s*['"\`]${RUNNERS_TABLE}['"\`]\\s*\\)`))).toEqual([])
    expect(hits(new RegExp(RUNNERS_TABLE))).toEqual([])
  }, 20_000)

  it('시크릿 호출에게 신원을 묻던 응답 코드가 0건', () => {
    expect(hits(new RegExp(LEGACY_CODE))).toEqual([])
  }, 20_000)

  it('운영 설정 카탈로그·env 예시에도 두 시크릿이 없다', () => {
    for (const file of ['docs/settings-catalog.md', '.env.local.example']) {
      const text = readFileSync(join(process.cwd(), file), 'utf8')
      expect(text.includes(AGENT_SECRET), file).toBe(false)
      expect(text.includes(MINUTES_SECRET), file).toBe(false)
    }
  })
})
