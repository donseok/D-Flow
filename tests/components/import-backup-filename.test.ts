// 가져오기 백업 파일 이름의 날짜 = 그 프로젝트 달력 tz 의 날짜(merge 리뷰 범위 밖 관찰 — 옛 판은 toISOString 의 UTC 날짜라
// 서울 프로젝트의 오전 9시 전 백업이 전날 이름이 됐다). 날짜는 백업이 만들어진 순간(generatedAt)의 날짜이고, tz 를 못 읽었으면 날짜를 지어내지 않는다.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { backupFileName } from '@/components/import/backupFileName'

const P = '00000000-0000-0000-7e57-0000000019a5'

describe('backupFileName', () => {
  it('같은 순간(2026-10-03T02:00Z)이 서울 프로젝트는 10-03, LA 프로젝트는 10-02', () => {
    expect(backupFileName(P, '2026-10-03T02:00:00.000Z', 'Asia/Seoul')).toBe(`wbs-backup-${P}-2026-10-03.json`)
    expect(backupFileName(P, '2026-10-03T02:00:00.000Z', 'America/Los_Angeles')).toBe(`wbs-backup-${P}-2026-10-02.json`)
  })
  it('라벨은 끝에, tz 를 모르면 날짜 없이(UTC 로 지어내지 않는다)', () => {
    expect(backupFileName(P, '2026-10-03T02:00:00.000Z', 'UTC', '실행 전')).toBe(`wbs-backup-${P}-2026-10-03-실행 전.json`)
    expect(backupFileName(P, '2026-10-03T02:00:00.000Z', null, '실행 전')).toBe(`wbs-backup-${P}-실행 전.json`)
    expect(backupFileName(P, '2026-10-03T02:00:00.000Z', null)).toBe(`wbs-backup-${P}.json`)
  })
  it('마법사는 이 함수로만 이름을 짓는다 — toISOString 날짜 자르기가 없다', () => {
    const src = readFileSync('src/components/import/ImportWizard.tsx', 'utf8')
    expect(src).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/)
    expect(src).toMatch(/backupFileName\(/)
  })
})
