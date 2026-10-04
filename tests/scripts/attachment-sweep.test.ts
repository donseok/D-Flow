import { describe, expect, it } from 'vitest'
import { GRACE_MS, isMinuteFilesPath, planSweep, safePathLabel, stillOrphan } from '../../scripts/lib/attachmentSweep.mjs'

// SP5 B3 과제10 — 회의록 첨부 청소의 순수 판정. 본문·과거 버전 객체는 대상 0, 유예 경계, 중복, 톰스톤 재시도.
const W = 'aaaaaaaa-1111-4111-8111-111111111111'
const P = 'bbbbbbbb-2222-4222-8222-222222222222'
const M = 'cccccccc-3333-4333-8333-333333333333'
const att = (name: string, proj = P) => `ws/${W}/p/${proj}/minute-files/${M}/${name}`
const body = (name: string) => `ws/${W}/p/${P}/minutes/${M}/${name}`
const NOW = Date.parse('2026-10-04T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const OLD = ago(GRACE_MS + 1)

describe('isMinuteFilesPath', () => {
  it('규약 경로만', () => {
    expect(isMinuteFilesPath(att('1-a.pdf'))).toBe(true)
    expect(isMinuteFilesPath(att('1-a.pdf', '_'))).toBe(true)
    expect(isMinuteFilesPath(body('1-a.md'))).toBe(false)
    expect(isMinuteFilesPath(`${M}/a.pdf`)).toBe(false)
    expect(isMinuteFilesPath(`ws/${W}/p/zz/minute-files/${M}/a.pdf`)).toBe(false)
    expect(isMinuteFilesPath(`ws/${W}/p/${P}/minute-files/${M}/`)).toBe(false)
  })
  it('로그 라벨은 파일 이름을 싣지 않는다', () => {
    expect(safePathLabel(att('1-기밀.pdf'))).toBe(`ws/${W}/p/${P}/minute-files/${M}/…`)
    expect(safePathLabel('x')).toBe('(규약 밖 경로)')
  })
})

describe('planSweep — 고아 객체', () => {
  it('참조 없는 오래된 minute-files 객체만, 본문·버전·참조(톰스톤 포함) 객체는 0', () => {
    const plan = planSweep({
      now: NOW,
      objects: [
        { name: att('1-orphan.pdf'), createdAt: OLD },
        { name: att('2-active.pdf'), createdAt: OLD },
        { name: att('3-tomb.pdf'), createdAt: OLD },
        { name: body('1-body.md'), createdAt: OLD },
        { name: att('4-version-ref.md'), createdAt: OLD },
      ],
      files: [
        { id: 'f2', filePath: att('2-active.pdf'), role: 'attachment', deletedAt: null, purgedAt: null },
        { id: 'f3', filePath: att('3-tomb.pdf'), role: 'attachment', deletedAt: OLD, purgedAt: OLD },
      ],
      versionPaths: [att('4-version-ref.md'), null, body('1-body.md')],
    })
    expect(plan.orphans).toEqual([att('1-orphan.pdf')])
  })
  it('유예 경계 — 정확히 24시간은 대상, 1ms 모자라면 아니다, 시각을 모르면 지우지 않는다', () => {
    const plan = planSweep({
      now: NOW, files: [], versionPaths: [],
      objects: [
        { name: att('edge.pdf'), createdAt: ago(GRACE_MS) },
        { name: att('young.pdf'), createdAt: ago(GRACE_MS - 1) },
        { name: att('future.pdf'), createdAt: ago(-60_000) },
        { name: att('notime.pdf'), createdAt: null },
        { name: att('garbage.pdf'), createdAt: 'not-a-date' },
      ],
    })
    expect(plan.orphans).toEqual([att('edge.pdf')])
    expect(plan.skippedYoung).toBe(2)
    expect(plan.skippedNoTime).toBe(2)
  })
  it('같은 객체가 두 번 나와도(페이지 겹침) 한 번', () => {
    const o = { name: att('dup.pdf'), createdAt: OLD }
    expect(planSweep({ now: NOW, files: [], versionPaths: [], objects: [o, o] }).orphans).toEqual([att('dup.pdf')])
  })
  it('기준 시각이 없으면 판정하지 않는다', () => {
    expect(() => planSweep({ now: Number.NaN, files: [], versionPaths: [], objects: [] })).toThrow()
  })
})

describe('planSweep — 미정리 톰스톤 재시도', () => {
  it('객체가 남은 톰스톤은 삭제 대상, 없는 것은 purged_at 만, 정리 끝난·활성·본문·규약 밖은 0', () => {
    const plan = planSweep({
      now: NOW, versionPaths: [],
      objects: [{ name: att('t1.pdf'), createdAt: OLD }],
      files: [
        { id: 't1', filePath: att('t1.pdf'), role: 'attachment', deletedAt: OLD, purgedAt: null },
        { id: 't2', filePath: att('t2-gone.pdf'), role: 'attachment', deletedAt: OLD, purgedAt: null },
        { id: 't3', filePath: att('t3.pdf'), role: 'attachment', deletedAt: OLD, purgedAt: OLD },
        { id: 'a1', filePath: att('a1.pdf'), role: 'attachment', deletedAt: null, purgedAt: null },
        { id: 'b1', filePath: body('b1.md'), role: 'body', deletedAt: OLD, purgedAt: null },
        { id: 'x1', filePath: `${M}/old.pdf`, role: 'attachment', deletedAt: OLD, purgedAt: null },
      ],
    })
    expect(plan.purgeObjects).toEqual([{ id: 't1', path: att('t1.pdf') }])
    expect(plan.markPurged).toEqual([{ id: 't2' }])
    // 톰스톤 객체는 행이 참조하므로 고아로도 잡히지 않는다(두 번 지우지 않는다)
    expect(plan.orphans).toEqual([])
  })
})

describe('stillOrphan — --apply 직전 재검증', () => {
  it('그 사이 행·버전 참조가 생겼으면 지우지 않는다', () => {
    expect(stillOrphan(att('a.pdf'), { fileRefs: 0, versionRefs: 0 })).toBe(true)
    expect(stillOrphan(att('a.pdf'), { fileRefs: 1, versionRefs: 0 })).toBe(false)
    expect(stillOrphan(att('a.pdf'), { fileRefs: 0, versionRefs: 1 })).toBe(false)
    expect(stillOrphan(body('a.md'), { fileRefs: 0, versionRefs: 0 })).toBe(false)
  })
})
