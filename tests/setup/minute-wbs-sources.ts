// tests/setup/minute-wbs-sources.ts — 단위 테스트 전역 기본 mock(module-gate.ts 와 같은 꼴). vitest.config.ts 의 setupFiles 가 모든 테스트 파일 앞에 싣는다.
// WBS 상세 패널(RowDetailPanel)은 「회의록 원문」 구역(WbsMinuteSourceSection)을 품는다 — 패널을 그리는 jsdom 테스트가 진짜 읽기 액션을 부르면
// 요청 밖이라 cookies 가 던져 '[WbsMinuteSourceSection] 회의록 원문 호출 실패' 스택이 쌓이고, uuid 꼴이 아닌 항목 id 면 구역이 오류를 그린다.
// 기본값은 연결 없음({ ok: true, rows: [] }) — 구역은 아무것도 그리지 않는다. 준비·등록 두 액션은 진짜 그대로다(importActual).
// vi.fn(impl) 이라 mockReset 뒤에도 같은 기본값으로 돌아온다(undefined 를 돌려 구역이 깨지지 않게).
// 진짜 읽기 액션을 보는 파일은 vi.unmock('@/app/actions/minuteWbs') 로 진짜 모듈을 받는다(tests/actions/minute-wbs.test.ts·tests/gates/deny.test.ts).
// 구역 자체는 tests/ui/wbs-minute-source-section.test.tsx 가 파일 mock 으로 본다(파일의 vi.mock 이 셋업의 mock 을 이긴다 — module-gate-override.test.ts).
// 이 기본값은 tests/setup/minute-wbs-sources-default.test.ts 가 고정한다. tests/rls(vitest.config.rls.ts)·settings:verify(vitest.config.verify.ts)에는 걸지 않는다.
import { vi } from 'vitest'

vi.mock('@/app/actions/minuteWbs', async () => ({
  ...(await vi.importActual<typeof import('@/app/actions/minuteWbs')>('@/app/actions/minuteWbs')),
  getWbsItemMinuteSources: vi.fn(async () => ({ ok: true, rows: [] })),
}))
