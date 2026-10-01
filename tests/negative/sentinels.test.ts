// 옛 기본값 센티널(스펙 D8·§4.8·§6.4, 판정 Q39, 계획 P6) — 목록·SP 부분 집합·등록 이름 제외·일치 규칙(대소문자·영문 코드 경계·마스크·
// zip 텍스트 파트)과 .mjs 러너용 사본의 드리프트를 고정한다. 출력 검사 자체는 부정 테스트(tests/negative/weekly-outputs.test.ts)·E2E 가 한다.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { SP4_SENTINELS_B64, sp4Sentinels } from '../../scripts/lib/sentinels.mjs'
import {
  LEGACY_SENTINELS, SENTINEL_MASKS, SENTINELS_BY_SP, findSentinels, isZipTextPart, sentinelsFor, zipTextParts,
} from '../fixtures/legacy-sentinels'
import { walk } from '../invariants/_walk'

const SP4 = SENTINELS_BY_SP.SP4

describe('센티널 목록', () => {
  it('11구분명·5팀 코드·8영역·이슈 ID 접두·시간대 — SP4 부분 집합은 11구분명 ∪ 5팀 코드(중복 없이 14)', () => {
    expect(LEGACY_SENTINELS.weeklySections).toHaveLength(11)
    expect(LEGACY_SENTINELS.teamCodes).toHaveLength(5)
    expect(LEGACY_SENTINELS.issueAreas).toHaveLength(8)
    expect(LEGACY_SENTINELS.issueIdPrefix).toBe('PI-I-')
    expect([...LEGACY_SENTINELS.timezone]).toEqual(['Asia/Seoul', '+09:00'])
    expect(SP4).toHaveLength(14)
    expect(new Set(SP4).size).toBe(SP4.length)
    for (const w of [...LEGACY_SENTINELS.weeklySections, ...LEGACY_SENTINELS.teamCodes]) expect(SP4, w).toContain(w)
  })

  it('.mjs 러너의 base64 사본은 픽스처의 SP4 목록과 같다(P6 — 드리프트 0)', () => {
    expect(sp4Sentinels()).toEqual([...SP4])
    expect(SP4_SENTINELS_B64).toBe(Buffer.from(SP4.join('\n'), 'utf8').toString('base64'))
  })

  it('런타임 코드(src)는 센티널 목록·규칙 파일을 import 하지 않는다 — 목록은 시험 도구다', () => {
    const hits = walk(join(process.cwd(), 'src'))
      .filter((f) => /legacy-sentinels|lib\/sentinels\.mjs/.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
})

describe('sentinelsFor — 그 프로젝트가 등록한 이름과 같은 센티널만 뺀다(포함 관계 아님, 스펙 D8)', () => {
  it('C 가 영역 품질을 등록하면 그 하나만 빠진다', () => {
    const [, , , , quality] = LEGACY_SENTINELS.weeklySections   // 다섯째 = C 의 합성 영역 이름과 같은 낱말
    const got = sentinelsFor('SP4', ['공정', '안전', quality, '자재', 'CIV', 'MEP', 'SAF'])
    expect(got).not.toContain(quality)
    expect(got).toHaveLength(13)
  })

  it('등록 이름이 센티널을 품기만 하면 빼지 않는다 — 등록 이름 하나가 센티널 여럿을 지우지 않게', () => {
    expect(sentinelsFor('SP4', ['영업관리', 'PMO팀', 'erp', ' MES '])).toEqual([...SP4])
  })
})

describe('findSentinels — 일치 규칙', () => {
  it('대소문자를 구분한다', () => {
    expect(findSentinels('erp mes pmo mdm', SP4)).toEqual([])
    expect(findSentinels('ERP 연동', SP4)).toEqual(['ERP'])
  })

  it('영문 코드는 앞뒤가 영숫자가 아닐 때만 — 글꼴 이름·영어 낱말 속 글자는 거짓 적중이 아니다', () => {
    for (const s of ['Times New Roman', 'GAMES', 'ERPs', 'MDMX', 'xPMO', 'TERPS', '<a:latin typeface="Times New Roman"/>', 'PMO2']) {
      expect(findSentinels(s, SP4), s).toEqual([])
    }
    expect(findSentinels('PMO-1', SP4)).toEqual(['PMO'])
    expect(findSentinels('(ERP)', SP4)).toEqual(['ERP'])
    expect(findSentinels('<a:t>MES</a:t>', SP4)).toEqual(['MES'])
    expect(findSentinels('담당: MDM', SP4)).toEqual(['MDM'])
  })

  it('원문 소스·JSON 출력의 이스케이프 시퀀스 바로 뒤 영문 코드도 적중이다(A1-4 리뷰 P5 — 앞 글자가 n·t·r·숫자라 경계가 막혔다)', () => {
    // 소스·JSON 본문에 글자 그대로 남은 두 글자 이스케이프(\\n 등)·\\uXXXX·\\xXX
    for (const s of ['a\\nERP', 'a\\tMES', 'a\\rPMO', '\\u00a0MDM', '\\x20ERP', 'ERP\\n', '1.\\nMES 이슈']) {
      expect(findSentinels(s, SP4).length, s).toBe(1)
    }
    // JSON.stringify 가 줄바꿈·탭을 \\n·\\t 로 내보낸 응답 본문
    expect(findSentinels(JSON.stringify({ cell: '첫 줄\nERP 이슈\tMES' }), SP4)).toEqual(['ERP', 'MES'])
    // 영숫자 경계 규칙은 그대로 — 이스케이프가 아닌 글자에 붙은 코드는 여전히 비적중
    for (const s of ['ERPx', 'Times New Roman', 'a\\\\nERPs', 'nERP']) expect(findSentinels(s, SP4), s).toEqual([])
  })

  it('한글 센티널은 부분 문자열 — 닫힌 마스크 복합어(영업일·영업관리팀)만 먼저 지운다', () => {
    expect(findSentinels('계획 기간에 영업일이 없는 작업', SP4)).toEqual([])
    expect(findSentinels('예: 영업관리팀', SP4)).toEqual([])
    expect(findSentinels('영업 실적과 영업일', SP4)).toEqual(['영업'])
    expect(findSentinels('물류 정리', SP4)).toEqual(['물류'])
  })

  it('적중은 센티널 목록 순·중복 없음', () => {
    const [pmo, sales] = LEGACY_SENTINELS.weeklySections
    expect(findSentinels(`MES ${sales} ERP MES ${pmo}`, SP4)).toEqual([pmo, sales, 'ERP', 'MES'])
  })

  it('마스크는 닫힌 목록이고 각 문자열이 src 의 정당한 문자열로 실제로 있다(낡은 마스크 금지 — 스펙 K12)', () => {
    expect([...SENTINEL_MASKS]).toEqual(['영업일', '영업관리팀'])
    expect(readFileSync(join(process.cwd(), 'src/lib/i18n/dict/wbs.ts'), 'utf8')).toContain('영업일')
    expect(readFileSync(join(process.cwd(), 'src/lib/i18n/dict/issues.ts'), 'utf8')).toContain('영업관리팀')
  })
})

describe('zipTextParts — 텍스트 파트만(미디어·이진 제외)', () => {
  it('*.xml·*.rels·[Content_Types].xml·docProps/* 만 이름 순으로 읽는다', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types/>')
    zip.file('_rels/.rels', '<Relationships/>')
    zip.file('docProps/app.xml', '<Properties/>')
    zip.file('ppt/slides/slide1.xml', '<a:t>ERP</a:t>')
    zip.file('ppt/media/image1.png', Buffer.from('MES PMO'))
    zip.file('ppt/embeddings/oleObject1.bin', Buffer.from('ERP'))
    const parts = await zipTextParts(await zip.generateAsync({ type: 'uint8array' }))
    expect(parts.map((p) => p.name)).toEqual(['[Content_Types].xml', '_rels/.rels', 'docProps/app.xml', 'ppt/slides/slide1.xml'])
    expect(parts.flatMap((p) => findSentinels(p.text, SP4))).toEqual(['ERP'])
    expect(isZipTextPart('ppt/media/image1.png')).toBe(false)
    expect(isZipTextPart('xl/sharedStrings.xml')).toBe(true)
  })
})
