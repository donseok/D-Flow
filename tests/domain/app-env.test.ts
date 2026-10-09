import { describe, expect, it } from 'vitest'
import { isLocalDevEnv } from '@/lib/domain/appEnv'

describe('isLocalDevEnv — 개발자용 안내를 보일지', () => {
  it.each([
    [{ APP_ENV: 'development', NODE_ENV: 'production' }, true],
    [{ APP_ENV: 'production', NODE_ENV: 'development' }, false],   // APP_ENV 가 정본이다
    [{ APP_ENV: 'staging' }, false],
    [{ APP_ENV: 'preview', NODE_ENV: 'development' }, false],
    [{ NODE_ENV: 'development' }, true],                            // APP_ENV 없는 next dev
    [{ NODE_ENV: 'production' }, false],                            // APP_ENV 를 빠뜨린 자체호스트 — 배포로 본다
    [{ NODE_ENV: 'test' }, false],
    [{ APP_ENV: '  ', NODE_ENV: 'development' }, true],             // 빈 값은 없는 것
    [{}, false],
  ])('%j → %s', (env, want) => {
    expect(isLocalDevEnv(env)).toBe(want)
  })
})
