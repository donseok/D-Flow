// 개인 설정은 서버 판정에 들어가지 않는다(개정 §2.8.5) — 판정 모듈이 prefs 모듈을 import 하지 않는다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { walk } from '../invariants/_walk'

const JUDGES = [...walk('src/lib/authz'), ...walk('src/lib/modules'), ...walk('src/lib/settings'), 'src/lib/domain/authz.ts']
const PREFS = /from\s+['"](@\/lib\/prefs\/|@\/app\/actions\/preferences|@\/app\/api\/prefs)/

describe('개인 설정 ↛ 서버 판정', () => {
  it('src/lib/{authz,modules,settings}/**·domain/authz.ts 가 prefs 를 import 하지 않는다', () => {
    const bad = JUDGES.filter((f) => /\.(ts|tsx)$/.test(f) && PREFS.test(readFileSync(f, 'utf8')))
    expect(bad).toEqual([])
  })
  it('민감도 — 판정 모듈 원문에 prefs import 가 있으면 잡는다', () => {
    expect(PREFS.test(`import { splitPrefs } from '@/lib/prefs/split'`)).toBe(true)
    expect(PREFS.test(`import { getAccountPrefs } from "@/app/actions/preferences"`)).toBe(true)
  })
  it('검사 대상이 비어 있지 않다', () => { expect(JUDGES.length).toBeGreaterThan(20) })
})
