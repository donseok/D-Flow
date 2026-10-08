// SP7 §5.1.4 "env 시크릿은 킬스위치로만" — 삭제한 옛 인증 경로가 src 로 되돌아오지 않게 고정한다.
//  · 배포 전역 시크릿 두 개(에이전트·회의록)의 env 이름: 인증은 integration_credentials 행뿐이고 *_ENABLED 는 킬스위치다.
//  · 옛 PAT 저장소(러너 표) 판독: 리졸버의 폴백이 삭제됐고 표도 0041 이 지웠다 — src 가 이름을 다시 쓰면 런타임 오류(없는 표)다.
//  · 옛 에이전트 등록 표: 에이전트 사용 여부의 원천은 프로젝트 설정 modules.enabled 하나다(두 원천 AND 종료). 표는 0041 이 지웠다.
//  · 유일 워크스페이스 판정 함수: 워크스페이스는 자격증명 행(외부 API)·화면이 실어 온 값(세션)이 정한다. 소속에서 짐작하지 않는다.
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
const PROJECTS_TABLE = ['agent', 'projects'].join('_')
const SOLE_WORKSPACE_FN = ['resolve', 'Sole', 'WorkspaceId'].join('')
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

  it("옛 에이전트 등록 표를 읽거나 쓰지 않는다 — from('…') 는 물론 이름 자체가 0건(주석 포함)", () => {
    expect(hits(new RegExp(`from\\(\\s*['"\`]${PROJECTS_TABLE}['"\`]\\s*\\)`))).toEqual([])
    expect(hits(new RegExp(PROJECTS_TABLE))).toEqual([])
  }, 20_000)

  it('유일 워크스페이스 판정 함수가 0건 — 정의도 호출도 없다', () => {
    expect(hits(new RegExp(SOLE_WORKSPACE_FN))).toEqual([])
  }, 20_000)

  it('검사 패턴이 실제로 문다 — 같은 정규식이 옛 원문을 잡는다(대조)', () => {
    expect(new RegExp(PROJECTS_TABLE).test(`admin.from('${PROJECTS_TABLE}').select('enabled')`)).toBe(true)
    expect(new RegExp(RUNNERS_TABLE).test(`// ${RUNNERS_TABLE} 폴백`)).toBe(true)
    expect(new RegExp(SOLE_WORKSPACE_FN).test(`const w = ${SOLE_WORKSPACE_FN}(actor)`)).toBe(true)
  })

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
