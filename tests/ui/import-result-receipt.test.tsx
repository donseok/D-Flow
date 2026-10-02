// #23 가져오기 결과(SP4 §5.2·D52·Q14, 계획 P9) — 실행 ID 8자와 같은 화면의 ?receipt= 링크, 중복 안내, ?receipt= 패널의 네 상태.
import { describe, expect, it, vi } from 'vitest'
import { renderToString } from 'react-dom/server'
import { ImportReceiptPanel, receiptStateOf } from '@/components/import/ImportReceiptPanel'
import { ImportRunSummary } from '@/components/import/ImportRunSummary'
import { registerEn, t, type DictKey } from '@/lib/i18n/dict'
import { EN } from '@/lib/i18n/dict/en'

// 영문 단언이 한국어 폴백으로 통과하지 않게 — 서버(i18n/server)가 하는 EN 등록을 테스트에서도 한다(패널은 서버 컴포넌트).
registerEn(EN)

const PID = '00000000-0000-0000-7e57-000000001aa0'
const CMD = '00000000-0000-4000-8000-000000001aa1'
const HANGUL = /[가-힣]/
const receipt = { commandId: CMD, mode: 'replace' as const, count: 42, createdAt: '2026-10-02T01:02:03+00:00' }
const tKo = (k: DictKey) => t('ko', k)

describe('ImportRunSummary — 결과 카드의 실행 ID·영수증 링크·중복 안내', () => {
  it('실행 ID 는 앞 8자(전체는 title), 링크는 같은 화면의 ?receipt=', () => {
    const html = renderToString(<ImportRunSummary projectId={PID} result={{ kind: 'applied', commandId: CMD } as never} t={tKo} />)
    expect(html).toContain('>00000000<')
    expect(html).toContain(`title="${CMD}"`)
    expect(html).toContain(`href="/p/${PID}/import?receipt=${CMD}"`)
    expect(html).not.toContain(tKo('importWizard.duplicateTitle'))
  })
  it('중복(같은 명령 id 재전송)이면 conflict 상태 안내를 앞에 둔다', () => {
    const html = renderToString(<ImportRunSummary projectId={PID} result={{ kind: 'duplicate', commandId: CMD } as never} t={tKo} />)
    expect(html).toContain(tKo('importWizard.duplicateTitle'))
    expect(html).toContain('role="status"')
  })
})

describe('?receipt= 패널', () => {
  it('찾음 — 실행 ID 8자·모드·건수·시각(서울)', () => {
    const html = renderToString(<ImportReceiptPanel state={{ kind: 'found', receipt }} locale="ko" />)
    expect(html).toContain('data-import-receipt')
    expect(html).toContain('>00000000<')
    expect(html).toContain('42')
    expect(html).toContain('2026-10-02 10:02')
    expect(html).toContain(tKo('importWizard.modeReplace'))
  })
  it('영어 화면 — 네 상태 모두 한글 0자(SP3a CR-13 꼴)', () => {
    for (const state of [{ kind: 'found', receipt }, { kind: 'missing' }, { kind: 'invalid' }, { kind: 'error' }] as const) {
      const html = renderToString(<ImportReceiptPanel state={state} locale="en" />)
      expect(HANGUL.test(html.replace(/<[^>]*>/g, '')), state.kind).toBe(false)
    }
  })
  it('[RF4] 나쁜 값 — 없음이면 패널 없음, 배열·uuid 아님은 액션을 부르지 않는다', async () => {
    const read = vi.fn()
    expect(await receiptStateOf(undefined, read)).toBeNull()
    expect(await receiptStateOf([CMD, CMD], read)).toEqual({ kind: 'invalid' })
    expect(await receiptStateOf('not-a-uuid', read)).toEqual({ kind: 'invalid' })
    expect(read).not.toHaveBeenCalled()
  })
  it('[RF4] 다른 프로젝트의 명령 id(액션이 receipt: null — Q14)는 찾지 못함, 읽기 실패는 오류 — 없음으로 위장하지 않는다', async () => {
    expect(await receiptStateOf(CMD, async () => ({ ok: true, receipt: null }))).toEqual({ kind: 'missing' })
    expect(await receiptStateOf(CMD, async () => ({ ok: false, error: '실행 기록을 불러오지 못했습니다.' }))).toEqual({ kind: 'error' })
    expect(await receiptStateOf(CMD, async () => ({ ok: true, receipt }))).toEqual({ kind: 'found', receipt })
    const html = renderToString(<ImportReceiptPanel state={{ kind: 'error' }} locale="ko" />)
    expect(html).toContain(tKo('importWizard.receiptError'))
  })
})
