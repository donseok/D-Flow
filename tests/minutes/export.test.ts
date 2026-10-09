import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  createMinutesExportArchive,
  minuteExportEntryPath,
  minutesExportFileNames,
  minutesManifestCsv,
  sanitizeArchiveSegment,
  type MinuteExportRow,
} from '@/lib/minutes/export'
import { BRAND } from '@/lib/branding'

function row(patch: Partial<MinuteExportRow> = {}): MinuteExportRow {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    minuteDate: '2026-07-23',
    teamCode: 'PMO',
    title: '주간정례 2026-07-23',
    bodyMd: '# 결정사항\n\n본문 그대로',
    meetingId: null,
    createdByName: '홍길동',
    createdAt: '2026-07-23T01:00:00.000Z',
    updatedAt: '2026-07-23T02:00:00.000Z',
    ...patch,
  }
}

describe('minutes bulk export archive', () => {
  it('preserves Unicode while removing path traversal and platform-forbidden characters', () => {
    expect(sanitizeArchiveSegment('../한글/회의:*?')).toBe('__한글_회의___')
    const path = minuteExportEntryPath(row({ title: '../../비밀/회의 2026-07-23' }))
    expect(path).toContain('minutes/PMO/')
    expect(path).not.toContain('..')
    expect(path.split('/')).toHaveLength(4)
  })

  it('팀 없는 회의록(team_code 빈 값 — 0052)은 "팀 없음" 묶음에 넣고 목록 파일의 team 칸은 비운다', () => {
    const path = minuteExportEntryPath(row({ teamCode: '' }))
    expect(path.split('/').slice(0, 2)).toEqual(['minutes', '팀 없음'])
    expect(path.split('/')).toHaveLength(4)
    // 값은 있는데 경로에 쓸 글자가 남지 않는 코드는 지금처럼 '미분류' — 팀 없음과 섞지 않는다
    expect(minuteExportEntryPath(row({ teamCode: '   ' })).split('/')[1]).toBe('미분류')
    const csv = minutesManifestCsv([{
      id: 'x', date: '2026-07-23', team: '', meetingGroup: '주간정례', title: '주간정례', createdByName: null, meetingId: null,
      createdAt: 't', updatedAt: 't', bodyBytes: 1, path,
    }])
    expect(csv.split('\r\n')[1].split(',').slice(0, 3)).toEqual(['"x"', '"2026-07-23"', '""'])
  })

  it('stores every canonical body verbatim and includes a matching UTF-8 manifest', async () => {
    const rows = [
      row(),
      row({
        id: '22222222-2222-2222-2222-222222222222',
        minuteDate: '2026-07-22',
        title: 'ERP 인터페이스_260722',
        teamCode: 'ERP',
        bodyMd: '한글 본문\n- 액션',
        createdByName: '=HYPERLINK("bad")',
      }),
    ]
    const { zip, manifest } = createMinutesExportArchive(rows, new Date('2026-07-23T03:00:00.000Z'))
    const bytes = await zip.generateAsync({ type: 'uint8array' })
    const opened = await JSZip.loadAsync(bytes)

    expect(manifest).toHaveLength(2)
    for (const entry of manifest) {
      const original = rows.find(item => item.id === entry.id)!
      expect(await opened.file(entry.path)!.async('string')).toBe(original.bodyMd)
    }
    const csv = await opened.file('_manifest.csv')!.async('string')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('ERP 인터페이스_260722')
    expect(csv).toContain("'=HYPERLINK")
    expect(await opened.file('_README.txt')!.async('string')).toContain('일반 첨부파일은')
  })

  it('uses full ids and a suffix fallback so duplicate titles cannot overwrite an entry', () => {
    const duplicate = row()
    const { manifest } = createMinutesExportArchive([duplicate, duplicate])
    expect(new Set(manifest.map(item => item.path)).size).toBe(2)
    expect(manifest[0].path).toContain(duplicate.id)
    expect(manifest[1].path).toMatch(/__2\.md$/)
  })

  it('neutralizes spreadsheet formulas in manifest metadata', () => {
    const csv = minutesManifestCsv([{
      id: 'id', date: '2026-07-23', team: 'PMO', meetingGroup: '@cmd', title: '-2+3',
      createdByName: '+SUM(1,1)', meetingId: null, createdAt: 'now', updatedAt: 'now',
      bodyBytes: 0, path: 'minutes/a.md',
    }])
    expect(csv).toContain("'@cmd")
    expect(csv).toContain("'-2+3")
    expect(csv).toContain("'+SUM")
  })
})

describe('minutesExportFileNames — 내려받기 파일명은 제품명을 따른다', () => {
  it('기본은 BRAND.productName 이다', () => {
    const { utf8Name, fallbackName } = minutesExportFileNames('2026-09-24')
    expect(utf8Name).toBe(`${BRAND.productName.replace(/\s+/g, '_')}_회의록_전체_2026-09-24.zip`)
    expect(fallbackName).toMatch(/^[A-Za-z0-9_-]+_minutes_all_2026-09-24\.zip$/)
  })

  it('ASCII 폴백과 UTF-8 이름을 함께 만든다', () => {
    expect(minutesExportFileNames('2026-09-24', 'D-Flow')).toEqual({
      utf8Name: 'D-Flow_회의록_전체_2026-09-24.zip',
      fallbackName: 'D-Flow_minutes_all_2026-09-24.zip',
    })
  })

  it("공백은 _ 로 바꾸고 헤더·경로에 위험한 문자(' \" / 등)는 버린다", () => {
    expect(minutesExportFileNames('2026-09-24', `Acme PM's "Hub"/v2`)).toEqual({
      utf8Name: 'Acme_PMs_Hubv2_회의록_전체_2026-09-24.zip',
      fallbackName: 'Acme_PMs_Hubv2_minutes_all_2026-09-24.zip',
    })
  })

  it('ASCII 로 남는 글자가 없으면 폴백 이름은 export 로 시작한다', () => {
    expect(minutesExportFileNames('2026-09-24', '한빛 플로우')).toEqual({
      utf8Name: '한빛_플로우_회의록_전체_2026-09-24.zip',
      fallbackName: 'export_minutes_all_2026-09-24.zip',
    })
  })
})
