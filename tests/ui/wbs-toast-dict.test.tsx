// WBS·칸반 토스트의 사전 매핑(SP4 D21·D52, 계획 P12 — H2 removeErrorKey 꼴): 액션이 돌려준 한국어 고정 문구를 사전 키로 바꿔 그린다.
// 한국어 화면은 같은 문구, 영어 화면은 한글 0자(SP3a CR-13). 표 밖 문구(동적 문구·원문·프로토타입 이름)는 화면의 일반 키 — 받은 문구를 그리지 않는다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { registerEn, t, type DictKey } from '@/lib/i18n/dict'
import { EN } from '@/lib/i18n/dict/en'
import { WBS_ACTION_ERRORS, wbsErrorKey, wbsToastText } from '@/lib/wbs/actionErrors'
import { ERR_ANON, ERR_DENIED, ERR_LOOKUP, ERR_MISSING, ERR_MODULE_DISABLED } from '@/lib/authz/errors'

// 영문 단언이 한국어 폴백으로 통과하지 않게 — 서버(i18n/server)·클라이언트(LocaleProvider 의 ensureEnLoaded)가 하는 EN 등록을 테스트에서도 한다.
registerEn(EN)

const HANGUL = /[가-힣]/
const tEn = (k: DictKey) => t('en', k)
const tKo = (k: DictKey) => t('ko', k)
const MESSAGES = [...Object.values(WBS_ACTION_ERRORS), ERR_ANON, ERR_DENIED, ERR_LOOKUP, ERR_MISSING, ERR_MODULE_DISABLED]

describe('WBS·칸반 토스트 사전', () => {
  it.each(MESSAGES)('%s — 사전 키가 있고 ko 는 같은 문구, en 은 한글 0자', (msg) => {
    const k = wbsErrorKey(msg)
    expect(k).not.toBeNull()
    expect(tKo(k!)).toBe(msg)
    expect(HANGUL.test(tEn(k!)), tEn(k!)).toBe(false)
  })
  it('표 밖 문구는 화면의 일반 키 — 영어 화면에 받은 한국어를 싣지 않는다', () => {
    expect(wbsToastText(tEn, "'QA' 팀과 같은 낱말입니다 — 그 팀을 고르세요.", 'wbs.toastSaveFail')).toBe(tEn('wbs.toastSaveFail'))
    expect(wbsToastText(tEn, undefined, 'kanban.errChange')).toBe(tEn('kanban.errChange'))
    expect(wbsToastText(tEn, 'constructor', 'wbs.toastAddFail')).toBe(tEn('wbs.toastAddFail'))
    expect(HANGUL.test(wbsToastText(tEn, WBS_ACTION_ERRORS.noWritePermission, 'wbs.toastSaveFail'))).toBe(false)
    expect(wbsToastText(tKo, WBS_ACTION_ERRORS.hasChildren, 'wbs.toastSaveFail')).toBe(WBS_ACTION_ERRORS.hasChildren)
  })
  it('세 액션(updateActual·updateWeight·addWbsItem)은 리터럴 문구를 돌려주지 않는다 — 문구는 표의 상수(새 문구가 사전 없이 늘지 않게)', () => {
    const src = readFileSync('src/app/actions/wbs.ts', 'utf8')
    for (const fn of ['updateActual', 'updateWeight', 'addWbsItem']) {
      const start = src.indexOf(`export async function ${fn}(`)
      const next = src.indexOf('\nexport ', start + 1)
      const body = src.slice(start, next === -1 ? undefined : next)
      expect(start, fn).toBeGreaterThan(-1)
      expect([...body.matchAll(/error:\s*'([^']+)'/g)].map((m) => m[1]), fn).toEqual([])
    }
  })
  it('화면 셋(WBS 시트·칸반)은 받은 문구를 그대로 그리지 않는다', () => {
    for (const f of ['src/components/wbs/WbsGanttSheet.tsx', 'src/components/kanban/KanbanBoard.tsx']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/res\.error\s*\?\?/)
    }
  })
})
