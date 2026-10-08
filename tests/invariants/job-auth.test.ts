// 잡 인증·배포 환경 판독의 닫힌 목록(SP8 — 정본 §5.1.4·§5.5.2 ①·⑦).
//  ① 옛 잡 시크릿 env 둘과 옛 헤더는 src·scripts 어디에도 없다 — 잡은 CRON_SECRET Bearer 하나다.
//  ② CRON_SECRET 을 읽는 src 파일은 인증 도우미 하나다(라우트가 시크릿 비교를 따로 들고 있지 않다).
//  ③ VERCEL_ENV 는 next.config.ts 한 곳만 읽는다(APP_ENV 로 옮기는 자리). 이름이 나오는 다른 두 파일은 판독이 아니다.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.name === 'node_modules' ? [] : e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])
}
const TREE = [...files('src'), ...files('scripts'), 'next.config.ts'].sort()
const mentioning = (needle: string | RegExp) => TREE.filter((f) => {
  const text = readFileSync(f, 'utf8')
  return typeof needle === 'string' ? text.includes(needle) : needle.test(text)
})

describe('잡 인증 — 옛 시크릿·헤더 0건', () => {
  it.each(['CHAT_V2_INDEX_CRON_SECRET', 'WIKI_WORKER_SECRET', 'x-cron-secret'])('%s 는 src·scripts 에 없다', (name) => {
    expect(mentioning(name)).toEqual([])
  })

  it('옛 워커 경로(/api/chat/index/worker)는 src·scripts 에 없다', () => {
    expect(mentioning('chat/index/worker')).toEqual([])
  })

  it('CRON_SECRET 을 읽는 src 파일은 @/lib/jobs/auth 하나다', () => {
    expect(mentioning(/process\.env\.CRON_SECRET|env\[['"]CRON_SECRET['"]\]/).filter((f) => f.startsWith('src/'))).toEqual(['src/lib/jobs/auth.ts'])
  })

  it('시크릿 상수시간 비교(timingSafeEqual)를 잡 라우트가 따로 들고 있지 않다', () => {
    const routes = TREE.filter((f) => /^src\/app\/api\/(?:cron\/.*|wiki\/worker)\/route\.ts$/.test(f))
    expect(routes.length).toBeGreaterThanOrEqual(4)
    expect(routes.filter((f) => /timingSafeEqual|secretMatches/.test(readFileSync(f, 'utf8')))).toEqual([])
  })
})

describe('배포 환경 — APP_ENV 가 정본', () => {
  /** 이름이 나와도 되는 파일(닫힌 목록 — 판독은 첫 줄 하나뿐) */
  const ALLOW: Record<string, string> = {
    'next.config.ts': 'APP_ENV 가 없을 때 VERCEL_ENV 를 빌드 env APP_ENV 로 옮기는 유일한 판독',
    'src/lib/settings/operational.ts': '운영 설정 목록의 이름(판독 아님 — next.config.ts 가 읽는 env 는 목록에 있어야 한다)',
    'scripts/vercel-ignore-build.sh': 'Vercel ignoreCommand 셸 — Vercel 빌드 전 단계에서만 돌고 앱 코드가 아니다',
  }
  it('VERCEL_ENV 가 나오는 파일은 허용 셋뿐이다', () => {
    expect(mentioning('VERCEL_ENV')).toEqual(Object.keys(ALLOW).sort())
  })
  it('코드가 VERCEL_ENV 를 읽는 곳은 next.config.ts 의 한 식이다', () => {
    const reads = (f: string) => readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(?:\/\/|\*)/.test(l) && /\.VERCEL_ENV\b|env\s*(?:\?\.)?\s*\[['"]VERCEL_ENV['"]\]/.test(l))
    expect(reads('next.config.ts')).toHaveLength(1)
    expect(reads('src/lib/settings/operational.ts')).toEqual([])
  })
  it('사용 기록 수집·툴바 헤더는 APP_ENV 를 본다', () => {
    expect(readFileSync('src/lib/domain/usageTracking.ts', 'utf8')).toMatch(/env\.APP_ENV === 'production'/)
    expect(readFileSync('src/app/api/track/route.ts', 'utf8')).toContain('APP_ENV: process.env.APP_ENV')
    expect(readFileSync('next.config.ts', 'utf8')).toMatch(/appEnv === "production"/)
  })
})
