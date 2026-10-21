// 회의록 원문 검증(verifyMinuteIssueBlock)의 문구 갈래 — WBS 등록(wording 'wbs')은 대상(이슈)을 말하는 문구만 srv.minuteWbs.* 로 바꾸고,
// 대상이 없는 문구(형식·조회 실패·선택 대조)는 그대로 둔다. 기본(이슈 흐름)은 옛 문구 그대로다(호출부 무변경).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fnv1a64, splitMinuteBlocks } from '@/lib/minutes/blocks'

const state = vi.hoisted(() => ({
  version: undefined as Record<string, unknown> | null | undefined,
  minute: undefined as Record<string, unknown> | null | undefined,
}))
vi.mock('@/lib/supabase/server', () => ({
  createServerClient: vi.fn(async () => ({
    from: (table: string) => {
      const row = table === 'minute_versions' ? state.version : table === 'minutes' ? state.minute : null
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.maybeSingle = async () => ({ data: row ?? null, error: null })
      return chain
    },
  })),
}))

import { verifyMinuteIssueBlock } from '@/lib/minutes/verifySource'
import { serverKoTranslate as t } from '@/lib/i18n/serverDict'
import type { MinuteIssueSourceInput } from '@/lib/domain/issueMinuteSource'

const WS = 'ws-1'
const BODY = ['# 개발 회의', '', '로그인 API 개발을 맡는다.', '', '## 다음 안건'].join('\n')
const BODY_HASH = fnv1a64(BODY)
const BLOCKS = splitMinuteBlocks(BODY)
const SOURCE: MinuteIssueSourceInput = {
  minuteId: 'minute-1', minuteVersionId: 'version-1', bodyHash: BODY_HASH, blockIndex: 1, blockHash: BLOCKS[1].hash, kind: 'manual',
}

function version(over: Record<string, unknown> = {}) {
  return { id: 'version-1', minute_id: 'minute-1', body_md: BODY, body_hash: BODY_HASH, title: '개발 회의', minute_date: '2026-10-21', ...over }
}
function minute(over: Record<string, unknown> = {}) {
  return { project_id: 'project-1', archived_at: null, workspace_id: WS, ...over }
}
const both = async (source: MinuteIssueSourceInput = SOURCE) => ({
  issue: await verifyMinuteIssueBlock('project-1', WS, source, 'test'),
  wbs: await verifyMinuteIssueBlock('project-1', WS, source, 'test', false, 'wbs'),
})

beforeEach(() => {
  state.version = version()
  state.minute = minute()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('verifyMinuteIssueBlock — 문구 갈래(wording)', () => {
  it('보관된 회의록 — WBS 는 srv.minuteWbs.minuteArchived, 이슈는 옛 문구', async () => {
    state.minute = minute({ archived_at: '2026-10-20T00:00:00Z' })
    const r = await both()
    expect(r.issue).toEqual({ ok: false, error: t('srv.issues.issuesCannotCreatedArchivedMinutes') })
    expect(r.wbs).toEqual({ ok: false, error: t('srv.minuteWbs.minuteArchived') })
  })

  it('다른 프로젝트의 회의록 — srv.minuteWbs.minuteProjectMismatch', async () => {
    state.minute = minute({ project_id: 'project-2' })
    const r = await both()
    expect(r.issue).toEqual({ ok: false, error: t('srv.issues.minutesIssueBelongDifferentProjects') })
    expect(r.wbs).toEqual({ ok: false, error: t('srv.minuteWbs.minuteProjectMismatch') })
  })

  it('다른 워크스페이스의 프로젝트 없는 회의록 — WBS 는 회의록 없음(RPC 의 MINUTE_NOT_FOUND 와 같은 판정)', async () => {
    state.minute = minute({ project_id: null, workspace_id: 'ws-2' })
    const r = await both()
    expect(r.issue).toEqual({ ok: false, error: t('srv.issues.minutesAnotherWorkspaceCannotCreate') })
    expect(r.wbs).toEqual({ ok: false, error: t('srv.minuteWbs.minuteNotFound') })
  })

  it('회의록 없음·버전 없음 — srv.minuteWbs.minuteNotFound·versionNotFound', async () => {
    state.minute = null
    const gone = await both()
    expect(gone.issue).toEqual({ ok: false, error: t('err.minutesNotFound') })
    expect(gone.wbs).toEqual({ ok: false, error: t('srv.minuteWbs.minuteNotFound') })
    state.minute = minute()
    state.version = null
    const noVersion = await both()
    expect(noVersion.issue).toEqual({ ok: false, error: t('srv.issues.minutesSourceVersionNotFound') })
    expect(noVersion.wbs).toEqual({ ok: false, error: t('srv.minuteWbs.versionNotFound') })
  })

  it('낡은 화면(본문 hash 불일치) — srv.minuteWbs.bodyStale', async () => {
    const r = await both({ ...SOURCE, bodyHash: '0000000000000000' })
    expect(r.issue).toEqual({ ok: false, error: t('srv.issues.minutesSourceVersionChanged') })
    expect(r.wbs).toEqual({ ok: false, error: t('srv.minuteWbs.bodyStale') })
  })

  it('제목만 걸친 선택 — srv.minuteWbs.headingRange', async () => {
    const heading = { ...SOURCE, blockIndex: 0, blockHash: BLOCKS[0].hash, selection: { text: '개발 회의', endBlockIndex: 0, endBlockHash: BLOCKS[0].hash } }
    const r = await both(heading)
    expect(r.issue).toEqual({ ok: false, error: t('srv.issues.selectRangeActualIssueContent') })
    expect(r.wbs).toEqual({ ok: false, error: t('srv.minuteWbs.headingRange') })
  })

  it('WBS 문구에는 이슈라는 말이 없다(대상을 말하는 갈래 전부)', async () => {
    const cases: Array<[() => void, MinuteIssueSourceInput]> = [
      [() => { state.minute = minute({ archived_at: '2026-10-20T00:00:00Z' }) }, SOURCE],
      [() => { state.minute = minute({ project_id: 'project-2' }) }, SOURCE],
      [() => { state.minute = minute({ project_id: null, workspace_id: 'ws-2' }) }, SOURCE],
      [() => {}, { ...SOURCE, blockIndex: 0, blockHash: BLOCKS[0].hash, selection: { text: '개발 회의', endBlockIndex: 0, endBlockHash: BLOCKS[0].hash } }],
    ]
    for (const [arrange, source] of cases) {
      state.minute = minute()
      arrange()
      const r = await verifyMinuteIssueBlock('project-1', WS, source, 'test', false, 'wbs')
      expect(r.ok).toBe(false)
      expect(r.ok ? '' : r.error).not.toContain('이슈')
    }
  })

  it('대상이 없는 문구(형식 오류)는 두 갈래가 같다', async () => {
    const r = await both({ ...SOURCE, blockHash: 'not-a-hash' })
    expect(r.issue).toEqual({ ok: false, error: t('srv.issues.minutesSourceInformationNotValid') })
    expect(r.wbs).toEqual(r.issue)
  })

  it('통과는 갈래와 무관하게 같은 검증 결과다', async () => {
    const r = await both()
    expect(r.issue.ok).toBe(true)
    expect(r.wbs).toEqual(r.issue)
  })
})
