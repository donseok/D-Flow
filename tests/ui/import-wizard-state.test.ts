import { describe, expect, it, vi } from 'vitest'
import { LEGACY_EXCEL_PROFILE_V1 } from '../fixtures/excel/legacy-3row-profile'
import { type ExcelProfile } from '@/lib/excel/profile'
import type { DetectionResult } from '@/lib/excel/detect'
import {
  initialWizardState, reducer, switchHierarchyKind, setOutlineColumn, setLogicalColumn,
  recordToRows, rowsToRecord, deriveMappedPreview, compareProfiles, executionIntentKey, commandIdFor,
  preBackupReady, isDefinitiveFailure, type ExecuteResult, type MarkRow, type WizardState,
} from '@/lib/domain/importWizard'

const DETECTION: DetectionResult = {
  sheetNames: ['WBS'],
  profile: LEGACY_EXCEL_PROFILE_V1,
  confidence: { header: 1, hierarchy: 1, logical: 1 },
  preview: { headers: ['Biz', '대', '중', '소'], rows: [] },
  warnings: [],
}

describe('importWizard reducer — 상태 전이(§6.2)', () => {
  it('fileSelected — 파일을 바꾸면 이전 감지·편집 상태를 전부 무효화한다', () => {
    const dirty = reducer(initialWizardState, { type: 'inspectStart' })
    const next = reducer(dirty, { type: 'fileSelected', fileName: 'a.xlsx' })
    expect(next).toEqual({ ...initialWizardState, fileName: 'a.xlsx' })
  })

  it('inspectSuccess — 저장 양식이 파일 구조와 같으면 저장 양식, 없으면 감지 결과(§6.2 계약)', () => {
    // 좌표·팀 열이 같고 마크 사전만 다른 저장 양식 — 구조가 같으므로 저장 양식을 그대로 쓴다.
    const SAVED_SAME = { ...LEGACY_EXCEL_PROFILE_V1, ownerMarks: { '●': 'primary' as const } }
    const withSaved = reducer(initialWizardState, { type: 'inspectSuccess', detection: DETECTION, savedProfile: SAVED_SAME })
    expect(withSaved.step).toBe('review')
    expect(withSaved.profile).toBe(SAVED_SAME)
    expect(withSaved).toMatchObject({ profileSource: 'saved', profileMismatch: null, savedProfile: SAVED_SAME })

    const withoutSaved = reducer(initialWizardState, { type: 'inspectSuccess', detection: DETECTION, savedProfile: null })
    expect(withoutSaved.profile).toBe(DETECTION.profile)
    expect(withoutSaved).toMatchObject({ profileSource: 'detected', profileMismatch: null, savedProfile: null })
  })

  it('inspectFailure — 1단계에 머물며 에러만 싣는다', () => {
    const next = reducer(initialWizardState, { type: 'inspectFailure', error: '시트가 없습니다' })
    expect(next.step).toBe('select')
    expect(next.error).toBe('시트가 없습니다')
    expect(next.busy).toBe(false)
  })

  it('executeStart — 이전 실패 상태(error/errors/needsTeams/inheritsCommon/commonTeams)를 전부 지운다', () => {
    const dirty: WizardState = {
      ...initialWizardState, error: 'x', errors: [{ excelRow: 1, message: 'y' }], needsTeams: ['CIV'],
      inheritsCommon: true, commonTeams: [{ code: 'RES', name: '연구팀' }],
    }
    const next = reducer(dirty, { type: 'executeStart' })
    expect(next).toMatchObject({ busy: true, error: null, errors: null, needsTeams: null, inheritsCommon: false, commonTeams: [] })
  })

  it('executeNeedsTeams — busy 를 풀고 팀 목록·상속 여부·상속 공용 팀을 싣는다(409 확인 창 — D54)', () => {
    const inherit = reducer({ ...initialWizardState, busy: true }, {
      type: 'executeNeedsTeams', teams: ['CIV'], inheritsCommon: true, commonTeams: [{ code: 'RES', name: '연구팀' }],
    })
    expect(inherit).toMatchObject({ busy: false, needsTeams: ['CIV'], inheritsCommon: true, commonTeams: [{ code: 'RES', name: '연구팀' }] })
    const own = reducer({ ...initialWizardState, busy: true }, { type: 'executeNeedsTeams', teams: ['CIV'], inheritsCommon: false, commonTeams: [] })
    expect(own).toMatchObject({ busy: false, needsTeams: ['CIV'], inheritsCommon: false, commonTeams: [], convertToken: null })
  })

  it('executeNeedsTeams — 서버가 준 전환 동의 토큰을 싣고, 실행 시작·창 닫기·실패가 지운다(A1-5 R3 — 토큰은 그 확인 창의 것이다)', () => {
    const asked = reducer({ ...initialWizardState, busy: true }, {
      type: 'executeNeedsTeams', teams: ['CIV'], inheritsCommon: true, commonTeams: [{ code: 'RES', name: '연구팀' }], convertToken: 'tok-1',
    })
    expect(asked.convertToken).toBe('tok-1')
    expect(reducer(asked, { type: 'executeStart' }).convertToken).toBeNull()
    expect(reducer(asked, { type: 'dismissNeedsTeams' }).convertToken).toBeNull()
    expect(reducer(asked, { type: 'executeFailure', error: 'x', definitive: false }).convertToken).toBeNull()
  })

  it('dismissNeedsTeams — needsTeams 와 함께 상속 표시도 지운다', () => {
    const dirty: WizardState = { ...initialWizardState, needsTeams: ['CIV'], inheritsCommon: true, commonTeams: [{ code: 'RES', name: '연구팀' }] }
    expect(reducer(dirty, { type: 'dismissNeedsTeams' })).toMatchObject({ needsTeams: null, inheritsCommon: false, commonTeams: [] })
  })

  it('executeSuccess — done 단계로 전이하고 에러류·상속 표시를 비운다', () => {
    const dirty: WizardState = { ...initialWizardState, errors: [{ excelRow: 1, message: 'z' }], needsTeams: ['CIV'], inheritsCommon: true }
    const result: ExecuteResult = { commandId: 'cmd-1', kind: 'applied', count: 3, mode: 'append', reindexed: 3, profileSaved: true }
    const next = reducer(dirty, { type: 'executeSuccess', result })
    expect(next).toMatchObject({ step: 'done', result, error: null, errors: null, needsTeams: null, inheritsCommon: false, commonTeams: [] })
  })

  it('reset — 실행 의도가 없으면 완전 초기 상태로 되돌린다', () => {
    const dirty = { ...initialWizardState, step: 'done' as const, fileName: 'a.xlsx' }
    expect(reducer(dirty, { type: 'reset' })).toEqual(initialWizardState)
  })

  it('resetToDetected — savedProfile 로 시작했어도 detection.profile 로 되돌린다(리뷰 Important #2, 레거시 프로젝트+새 양식 파일 차단 해소)', () => {
    // 저장 양식이 파일과 다르면 감지 결과로 시작하므로(Task 1b), 저장 양식을 직접 고른 뒤 되돌린다.
    const inspected = reducer(initialWizardState, {
      type: 'inspectSuccess', detection: DETECTION, savedProfile: { ...LEGACY_EXCEL_PROFILE_V1, sheetName: 'SAVED' },
    })
    const withSaved = reducer(inspected, { type: 'useSavedProfile' })
    expect(withSaved.profile?.sheetName).toBe('SAVED')
    // 편집도 반영한 뒤 되돌려도 detection.profile 로 정확히 복원돼야 한다(savedProfile 이 아니라).
    const edited = reducer(withSaved, { type: 'profileChanged', profile: { ...withSaved.profile!, sheetName: 'EDITED' } })
    const reverted = reducer(edited, { type: 'resetToDetected' })
    expect(reverted.profile).toBe(DETECTION.profile)
    expect(reverted.profile?.sheetName).not.toBe('SAVED')
    expect(reverted.profileSource).toBe('detected')
  })

  it('resetToDetected — detection 이 없으면(1단계) 무변화', () => {
    expect(reducer(initialWizardState, { type: 'resetToDetected' })).toBe(initialWizardState)
  })
})

/* ── Task 1b — 저장 양식과 파일 구조가 다르면 조용히 저장 양식으로 읽지 않는다 ── */
const COLS: ExcelProfile = {
  version: 1, sheetName: 'WBS', holidaySheetName: null, headerRow: 2,
  hierarchy: { kind: 'columns', columns: [0, 1] },
  logical: { extraAxis: null, code: null, name: null, deliverable: 2, start: 3, end: 4, weight: null, actualPct: 5 },
  teamColumns: [[6, '팀A']], ownerMarks: { '●': 'primary', '△': 'support' },
}
/** 펼침 내보내기가 만드는 모양 — 계층 다음에 '세부업무' 열이 끼어 논리·팀 열이 +1 밀리고, 양식 밖 팀(팀B)이 끝에 붙는다. */
const SHIFTED: ExcelProfile = {
  ...COLS,
  logical: { ...COLS.logical, deliverable: 3, start: 4, end: 5, actualPct: 6 },
  teamColumns: [[7, '팀A'], [8, '팀B']],
  ownerMarks: { '●': 'primary', '△': 'support', '◎': 'primary' },
}

describe('compareProfiles — 저장 양식 대 감지 양식', () => {
  it('좌표·팀 열이 같으면 null — 마크 사전 차이는 열을 옮기지 않으므로 세지 않는다', () => {
    expect(compareProfiles(COLS, { ...COLS, ownerMarks: { O: 'primary' } })).toBeNull()
  })

  it('열 밀림 — 밀린 논리 열·같은 팀의 열 이동·양식 밖 팀을 모두 알린다', () => {
    expect(compareProfiles(COLS, SHIFTED)).toEqual({
      fields: ['deliverable', 'start', 'end', 'actualPct', 'teamColumns'],
      extraTeams: ['팀B'],
      missingTeams: [],
    })
  })

  it('팀 초과(접기 내보내기의 양식 밖 팀)·팀 누락만 달라도 불일치다', () => {
    expect(compareProfiles(COLS, { ...COLS, teamColumns: [[6, '팀A'], [7, '팀B']] }))
      .toEqual({ fields: [], extraTeams: ['팀B'], missingTeams: [] })
    expect(compareProfiles(COLS, { ...COLS, teamColumns: [] }))
      .toEqual({ fields: [], extraTeams: [], missingTeams: ['팀A'] })
  })

  it('시트·헤더 행·휴일 시트·계층 열도 좌표다', () => {
    const other: ExcelProfile = {
      ...COLS, sheetName: 'Sheet1', headerRow: 0, holidaySheetName: 'Holiday', hierarchy: { kind: 'outline', column: 0 },
    }
    expect(compareProfiles(COLS, other)?.fields).toEqual(['sheetName', 'headerRow', 'holidaySheetName', 'hierarchy'])
    expect(compareProfiles(COLS, { ...COLS, hierarchy: { kind: 'columns', columns: [0, 1, 2] } })?.fields).toEqual(['hierarchy'])
  })

  it("팀명 직접 방식('*') 열은 팀 이름이 아니라 열 위치로 비교한다", () => {
    const star: ExcelProfile = { ...COLS, teamColumns: [[6, '*']] }
    expect(compareProfiles(star, star)).toBeNull()
    expect(compareProfiles(star, { ...COLS, teamColumns: [[7, '*']] }))
      .toEqual({ fields: ['teamColumns'], extraTeams: [], missingTeams: [] })
    expect(compareProfiles(COLS, star)).toEqual({ fields: ['teamColumns'], extraTeams: [], missingTeams: ['팀A'] })
  })
})

describe('importWizard reducer — 불일치면 감지 결과가 기본, 저장 양식은 명시 선택으로만(Task 1b)', () => {
  const DET_SHIFTED: DetectionResult = { ...DETECTION, profile: SHIFTED }

  it('inspectSuccess — 불일치를 싣고 감지 결과로 시작한다', () => {
    const next = reducer(initialWizardState, { type: 'inspectSuccess', detection: DET_SHIFTED, savedProfile: COLS })
    expect(next.profile).toBe(SHIFTED)
    expect(next.profileSource).toBe('detected')
    expect(next.profileMismatch).toEqual(compareProfiles(COLS, SHIFTED))
    expect(next.savedProfile).toBe(COLS)
  })

  it('useSavedProfile — 사용자가 고르면 저장 양식으로 바꾸고 출처를 saved 로 둔다(불일치 표시는 남긴다)', () => {
    const inspected = reducer(initialWizardState, { type: 'inspectSuccess', detection: DET_SHIFTED, savedProfile: COLS })
    const chosen = reducer(inspected, { type: 'useSavedProfile' })
    expect(chosen.profile).toBe(COLS)
    expect(chosen.profileSource).toBe('saved')
    expect(chosen.profileMismatch).toEqual(inspected.profileMismatch)
    expect(reducer(chosen, { type: 'resetToDetected' })).toMatchObject({ profile: SHIFTED, profileSource: 'detected' })
  })

  // 불일치 파일의 감지 양식을 기본으로 저장하면 프로젝트의 저장 양식이 조용히 덮어써진다 — 저장은 사용자가 켤 때만(T1b 리뷰 carry f).
  it('inspectSuccess — 불일치면 양식 저장 기본값이 꺼진다. 저장 양식이 없거나 같으면 켜진 채다', () => {
    expect(reducer(initialWizardState, { type: 'inspectSuccess', detection: DET_SHIFTED, savedProfile: COLS }).saveProfile).toBe(false)
    expect(reducer(initialWizardState, { type: 'inspectSuccess', detection: DET_SHIFTED, savedProfile: null }).saveProfile).toBe(true)
    expect(reducer(initialWizardState, { type: 'inspectSuccess', detection: DET_SHIFTED, savedProfile: SHIFTED }).saveProfile).toBe(true)
  })

  it('saveProfileChanged — 불일치여도 사용자가 켜면 저장한다', () => {
    const inspected = reducer(initialWizardState, { type: 'inspectSuccess', detection: DET_SHIFTED, savedProfile: COLS })
    expect(reducer(inspected, { type: 'saveProfileChanged', saveProfile: true }).saveProfile).toBe(true)
  })

  it('useSavedProfile — 저장 양식이 없으면 무변화', () => {
    const inspected = reducer(initialWizardState, { type: 'inspectSuccess', detection: DETECTION, savedProfile: null })
    expect(reducer(inspected, { type: 'useSavedProfile' })).toBe(inspected)
  })

  it('executeProfileMismatch — 서버 409 사유와 불일치를 싣고 busy 를 푼다', () => {
    const mm = { fields: ['start' as const], extraTeams: [], missingTeams: [] }
    const next = reducer({ ...initialWizardState, busy: true }, { type: 'executeProfileMismatch', error: 'E', profileMismatch: mm })
    expect(next).toMatchObject({ busy: false, error: 'E', profileMismatch: mm })
  })
})

describe('switchHierarchyKind — columns↔outline 전환(§6.2 계층 방식 라디오)', () => {
  it('columns → outline: 첫 계층 열을 아웃라인 코드 열 기본값으로 승계한다', () => {
    const next = switchHierarchyKind(LEGACY_EXCEL_PROFILE_V1, 'outline')
    expect(next.hierarchy).toEqual({ kind: 'outline', column: 1 })
  })

  it('outline → columns: name 을 다시 null 로 되돌린다(계층 열 자체가 이름의 출처 — profile.ts 규약)', () => {
    const outlineProfile = { ...LEGACY_EXCEL_PROFILE_V1, hierarchy: { kind: 'outline' as const, column: 0 }, logical: { ...LEGACY_EXCEL_PROFILE_V1.logical, name: 1 } }
    const next = switchHierarchyKind(outlineProfile, 'columns')
    expect(next.hierarchy).toEqual({ kind: 'columns', columns: [0] })
    expect(next.logical.name).toBeNull()
  })

  it('같은 kind 로 전환하면 원본을 그대로 반환한다(무변화)', () => {
    expect(switchHierarchyKind(LEGACY_EXCEL_PROFILE_V1, 'columns')).toBe(LEGACY_EXCEL_PROFILE_V1)
  })
})

describe('setOutlineColumn / setLogicalColumn — 논리 열 셀렉트 편집', () => {
  it('setOutlineColumn — outline 모드에서만 반영, columns 모드에서는 무시', () => {
    const outline = { ...LEGACY_EXCEL_PROFILE_V1, hierarchy: { kind: 'outline' as const, column: 0 } }
    expect(setOutlineColumn(outline, 3).hierarchy).toEqual({ kind: 'outline', column: 3 })
    expect(setOutlineColumn(LEGACY_EXCEL_PROFILE_V1, 3)).toBe(LEGACY_EXCEL_PROFILE_V1)
  })

  it('setLogicalColumn — 지정 필드만 갱신, 나머지는 불변', () => {
    const next = setLogicalColumn(LEGACY_EXCEL_PROFILE_V1, 'weight', 9)
    expect(next.logical.weight).toBe(9)
    expect(next.logical.actualPct).toBe(LEGACY_EXCEL_PROFILE_V1.logical.actualPct)
    expect(setLogicalColumn(LEGACY_EXCEL_PROFILE_V1, 'code', null).logical.code).toBeNull()
  })
})

describe('마크 사전 행 변환 — recordToRows/rowsToRecord(키 편집 중 identity 보존)', () => {
  it('recordToRows — Record 를 안정적인 id 부여 행 배열로 바꾼다', () => {
    const rows = recordToRows({ '●': 'primary', '△': 'support' })
    expect(rows).toEqual([{ id: 0, key: '●', kind: 'primary' }, { id: 1, key: '△', kind: 'support' }])
  })

  it('rowsToRecord — 빈 키는 버리고, 앞뒤 공백은 trim 한다', () => {
    const rows: MarkRow[] = [{ id: 0, key: ' ● ', kind: 'primary' }, { id: 1, key: '', kind: 'support' }]
    expect(rowsToRecord(rows)).toEqual({ '●': 'primary' })
  })

  it('rowsToRecord — 같은 키가 중복되면 나중 행이 이긴다', () => {
    const rows: MarkRow[] = [{ id: 0, key: 'X', kind: 'primary' }, { id: 1, key: 'X', kind: 'support' }]
    expect(rowsToRecord(rows)).toEqual({ X: 'support' })
  })

  it('recordToRows → rowsToRecord 왕복이 원본과 동등하다(빈 키 없을 때)', () => {
    const original = LEGACY_EXCEL_PROFILE_V1.ownerMarks
    expect(rowsToRecord(recordToRows(original))).toEqual(original)
  })
})

describe('deriveMappedPreview — 리뷰 Important #2: 미리보기가 편집된 profile 을 즉시 반영한다', () => {
  const headers = ['Biz', '대', '중', '소', 'x', 'x', 'PMO', 'ERP', 'x', 'x', 'x', '산출물', '시작', '종료', '가중치', 'x', '실적%']

  it('columns 계층 — 계층/논리/팀 열이 각각 올바른 role 로 표시된다', () => {
    const rows: unknown[][] = [['B1', '', '', '', ...Array(12).fill('')]]
    const preview = deriveMappedPreview(headers, rows, LEGACY_EXCEL_PROFILE_V1)
    expect(preview.columns[1].role).toEqual({ kind: 'hierarchy' })
    expect(preview.columns[2].role).toEqual({ kind: 'hierarchy' })
    expect(preview.columns[3].role).toEqual({ kind: 'hierarchy' })
    expect(preview.columns[0].role).toEqual({ kind: 'logical', field: 'extraAxis' })
    expect(preview.columns[11].role).toEqual({ kind: 'logical', field: 'deliverable' })
    expect(preview.columns[6].role).toEqual({ kind: 'team', team: 'PMO' })
    expect(preview.columns[4].role).toBeNull() // 매핑 안 된 여백 열
  })

  it('columns 계층 — 정확히 1열만 채워진 행만 깊이를 판정하고, 나머지는 null(?)로 표시한다', () => {
    const filledAtPhase: unknown[] = ['', 'A', '', '', ...Array(12).fill('')]
    const filledAtActivity: unknown[] = ['', '', '', 'C', ...Array(12).fill('')]
    const noneFilled: unknown[] = ['', '', '', '', ...Array(12).fill('')]
    const twoFilled: unknown[] = ['', 'A', 'B', '', ...Array(12).fill('')]
    const preview = deriveMappedPreview(headers, [filledAtPhase, filledAtActivity, noneFilled, twoFilled], LEGACY_EXCEL_PROFILE_V1)
    expect(preview.rows.map(r => r.depth)).toEqual([0, 2, null, null])
  })

  it('outline 계층 — 코드 열 깊이는 구분자 수, 이름 열은 logical.name 으로 매핑된다', () => {
    const outlineProfile: ExcelProfile = {
      ...LEGACY_EXCEL_PROFILE_V1,
      hierarchy: { kind: 'outline', column: 0 },
      logical: { ...LEGACY_EXCEL_PROFILE_V1.logical, name: 1 },
    }
    const rows: unknown[][] = [['1', 'Name A'], ['1.1', 'Name B'], ['bad-code', 'Name C'], ['1.1.2.3', 'Name D']]
    const preview = deriveMappedPreview(['코드', '이름'], rows, outlineProfile)
    expect(preview.columns[0].role).toEqual({ kind: 'hierarchy' })
    expect(preview.columns[1].role).toEqual({ kind: 'logical', field: 'name' })
    expect(preview.rows.map(r => r.depth)).toEqual([0, 1, null, 3])
  })

  it('원본 셀 값을 그대로 보존한다(재파싱·재포맷 없음)', () => {
    const rows: unknown[][] = [['B1', '', '', '', ...Array(12).fill('')]]
    const preview = deriveMappedPreview(headers, rows, LEGACY_EXCEL_PROFILE_V1)
    expect(preview.rows[0].cells).toBe(rows[0])
  })
})

/* ── SP4 §4.4·RF3 — 명령 id 는 실행 의도 단위다. 같은 의도의 재시도·needsTeams 재실행은 같은 id(서버가 이미 적용했으면 duplicate),
 *  의도가 바뀌거나 성공·확정 실패 뒤에는 새 id. 파일을 다시 골라도(같은 파일) 의도는 남는다 ── */
const FILE = { fileName: 'wbs.xlsx', fileSize: 2048, lastModified: 1_790_000_000_000 }
const intent = (over: Partial<Parameters<typeof executionIntentKey>[0]> = {}) =>
  executionIntentKey({ ...FILE, profile: COLS, mode: 'append', saveProfile: true, ...over })
/** 서로 다른 id 를 차례로 내는 가짜 newUuid — 불린 횟수로 "새로 뽑았는가"를 본다 */
function minter() {
  let n = 0
  return vi.fn(() => `cmd-${++n}`)
}
/** 컴포넌트의 실행 시작과 같은 순서 — 의도 키로 id 를 고르고(commandIdFor) intentChanged → executeStart */
function startExecute(s: WizardState, key: string, mint: () => string): { state: WizardState; id: string } {
  const id = commandIdFor(s, key, mint)
  return { id, state: reducer(reducer(s, { type: 'intentChanged', intentKey: key, commandId: id }), { type: 'executeStart' }) }
}
const lost = (s: WizardState) => reducer(s, { type: 'executeFailure', error: '네트워크 오류', definitive: false })

describe('명령 id — 실행 의도 단위(스펙 §4.4) [RF3]', () => {
  it('executionIntentKey — 같은 입력이면 같은 키, 마크 사전의 키 순서는 무관하다', () => {
    expect(intent()).toBe(intent())
    const reordered: ExcelProfile = { ...COLS, ownerMarks: { '△': 'support', '●': 'primary' } }
    expect(intent({ profile: reordered })).toBe(intent())
  })

  it('executionIntentKey — 파일 이름·크기·수정 시각·프로파일·모드·양식 저장 중 하나만 바뀌어도 다른 키', () => {
    const variants = [
      intent({ fileName: 'wbs (1).xlsx' }), intent({ fileSize: 2049 }), intent({ lastModified: FILE.lastModified + 1 }),
      intent({ profile: { ...COLS, logical: { ...COLS.logical, start: 9 } } }),
      intent({ profile: { ...COLS, ownerMarks: { '●': 'primary' } } }), intent({ profile: null }),
      intent({ mode: 'replace' }), intent({ saveProfile: false }),
    ]
    for (const v of variants) expect(v).not.toBe(intent())
    expect(new Set(variants).size).toBe(variants.length)
  })

  it('첫 실행은 새 id, 같은 의도의 재실행은 같은 id(새로 뽑지 않는다), 의도가 바뀌면 새 id', () => {
    const mint = minter()
    const a = startExecute(initialWizardState, intent(), mint)
    expect(a.id).toBe('cmd-1')
    expect(a.state).toMatchObject({ commandId: 'cmd-1', intentKey: intent(), busy: true })
    const b = startExecute(lost(a.state), intent(), mint)
    expect(b.id).toBe('cmd-1')
    expect(mint).toHaveBeenCalledTimes(1)
    const c = startExecute(lost(b.state), intent({ saveProfile: false }), mint)
    expect(c.id).toBe('cmd-2')
    expect(c.state.commandId).toBe('cmd-2')
  })

  it('intentChanged — 같은 키에 id 가 있으면 상태를 바꾸지 않고, 다른 키면 id 를 바꾸고 사전 백업을 버린다', () => {
    const s1 = reducer(initialWizardState, { type: 'intentChanged', intentKey: 'K1', commandId: 'cmd-1' })
    expect(reducer(s1, { type: 'intentChanged', intentKey: 'K1', commandId: 'cmd-1' })).toBe(s1)
    const taken = reducer(s1, { type: 'preBackupTaken', generatedAt: '2026-10-01T00:00:00.000Z' })
    expect(reducer(taken, { type: 'intentChanged', intentKey: 'K2', commandId: 'cmd-2' }))
      .toMatchObject({ intentKey: 'K2', commandId: 'cmd-2', preBackup: null })
  })

  it('네트워크 실패·응답 유실·5xx 뒤 재시도는 같은 id — 서버가 이미 적용했으면 duplicate 로 받는다', () => {
    const mint = minter()
    const a = startExecute(initialWizardState, intent(), mint)
    for (const status of [0, 200, 500, 502, 503]) {
      const failed = reducer(a.state, { type: 'executeFailure', error: 'x', definitive: isDefinitiveFailure(status) })
      expect(failed.commandId, String(status)).toBe(a.id)
      expect(startExecute(failed, intent(), mint).id, String(status)).toBe(a.id)
    }
    expect(mint).toHaveBeenCalledTimes(1)
  })

  it('409 needsTeams 뒤 등록 재실행은 같은 id — 409 는 영수증을 남기지 않는다(창을 닫았다 다시 실행해도 같다)', () => {
    const mint = minter()
    const a = startExecute(initialWizardState, intent(), mint)
    const asked = reducer(a.state, { type: 'executeNeedsTeams', teams: ['CIV'], inheritsCommon: true, commonTeams: [{ code: 'RES', name: '연구팀' }] })
    expect(asked.commandId).toBe(a.id)
    expect(startExecute(asked, intent(), mint).id).toBe(a.id)
    expect(startExecute(reducer(asked, { type: 'dismissNeedsTeams' }), intent(), mint).id).toBe(a.id)
  })

  it('성공 뒤 같은 입력으로 다시 실행하면 새 id — 옛 id 로 duplicate 만 받지 않는다', () => {
    const mint = minter()
    const a = startExecute(initialWizardState, intent(), mint)
    const done = reducer(a.state, {
      type: 'executeSuccess', result: { commandId: a.id, kind: 'applied', count: 2, mode: 'append', reindexed: 0, profileSaved: true },
    })
    expect(done).toMatchObject({ commandId: null, intentKey: null, preBackup: null })
    expect(startExecute(reducer(done, { type: 'reset' }), intent(), mint).id).toBe('cmd-2')
  })

  it('확정 실패(409 를 뺀 4xx) 뒤 다음 실행은 새 id — 같은 id 는 COMMAND_REUSED 일 수 있다', () => {
    const mint = minter()
    const a = startExecute(initialWizardState, intent(), mint)
    const refused = reducer(a.state, { type: 'executeFailure', error: '이미 다른 내용으로 쓴 실행 ID 입니다.', definitive: isDefinitiveFailure(422) })
    expect(refused).toMatchObject({ commandId: null, intentKey: intent(), busy: false })
    expect(startExecute(refused, intent(), mint).id).toBe('cmd-2')
  })

  it('링크 오류(400 errors) 뒤 다음 실행은 새 id', () => {
    const mint = minter()
    const a = startExecute(initialWizardState, intent(), mint)
    const invalid = reducer(a.state, { type: 'executeValidationFailure', errors: [{ excelRow: 3, message: '부모 행이 없습니다' }] })
    expect(invalid.commandId).toBeNull()
    expect(startExecute(invalid, intent(), mint).id).toBe('cmd-2')
  })

  it('isDefinitiveFailure — 409 를 뺀 4xx 만 확정 실패다', () => {
    for (const s of [400, 401, 403, 404, 422]) expect(isDefinitiveFailure(s), String(s)).toBe(true)
    for (const s of [0, 200, 409, 500, 502, 503, 504]) expect(isDefinitiveFailure(s), String(s)).toBe(false)
  })

  it('응답을 잃은 뒤 같은 파일을 다시 고르거나 처음부터 다시 해도 같은 id — 두 벌이 되지 않는다', () => {
    const mint = minter()
    const a = startExecute(initialWizardState, intent(), mint)
    const failed = lost(a.state)
    const reselected = reducer(failed, { type: 'fileSelected', fileName: FILE.fileName })
    expect(reselected).toMatchObject({ step: 'select', detection: null, profile: null, fileName: FILE.fileName, commandId: a.id, intentKey: intent() })
    expect(startExecute(reselected, intent(), mint).id).toBe(a.id)
    const restarted = reducer(failed, { type: 'reset' })
    expect(restarted).toMatchObject({ step: 'select', fileName: null, commandId: a.id, intentKey: intent() })
    expect(startExecute(restarted, intent(), mint).id).toBe(a.id)
    expect(mint).toHaveBeenCalledTimes(1)
    expect(startExecute(reselected, intent({ fileName: 'other.xlsx' }), mint).id).toBe('cmd-2')   // 다른 파일이면 다른 의도
  })
})

describe('replace 사전 백업 — 실행 의도에 묶인다(D50)', () => {
  const K = intent({ mode: 'replace' })
  const T = '2026-10-01T00:00:00.000Z'
  const withBackup = () => reducer(
    reducer(initialWizardState, { type: 'intentChanged', intentKey: K, commandId: 'cmd-1' }),
    { type: 'preBackupTaken', generatedAt: T },
  )

  it('받기 전에는 잠겨 있다 — 백업 읽기에 실패하면(preBackupTaken 이 없다) 실행할 수 없다', () => {
    const s = reducer(initialWizardState, { type: 'intentChanged', intentKey: K, commandId: 'cmd-1' })
    expect(preBackupReady(s, K)).toBe(false)
    expect(preBackupReady(initialWizardState, null)).toBe(false)
  })

  it('받으면 그 의도에서만 열린다 — 입력이 바뀌면 잠기고, 되돌리면 다시 열린다', () => {
    const s = withBackup()
    expect(s.preBackup).toEqual({ generatedAt: T })
    expect(preBackupReady(s, K)).toBe(true)
    expect(preBackupReady(s, intent({ mode: 'replace', saveProfile: false }))).toBe(false)
    expect(preBackupReady(s, intent({ mode: 'replace', fileName: 'other.xlsx' }))).toBe(false)
    expect(preBackupReady(s, null)).toBe(false)
    expect(preBackupReady(s, K)).toBe(true)
  })

  it('다른 의도로 실행이나 백업을 시작하면(intentChanged) 받아 둔 백업을 버린다', () => {
    const next = reducer(withBackup(), { type: 'intentChanged', intentKey: intent({ mode: 'replace', saveProfile: false }), commandId: 'cmd-2' })
    expect(next.preBackup).toBeNull()
    expect(preBackupReady(next, K)).toBe(false)
  })

  it('의도 없이 온 preBackupTaken 은 무시한다 — 묶을 의도가 없다', () => {
    expect(reducer(initialWizardState, { type: 'preBackupTaken', generatedAt: T })).toBe(initialWizardState)
  })

  it('성공 뒤에는 백업이 사라진다 — 다음 replace 는 바뀐 트리를 다시 받아야 한다', () => {
    const done = reducer(reducer(withBackup(), { type: 'executeStart' }), {
      type: 'executeSuccess', result: { commandId: 'cmd-1', kind: 'applied', count: 4, mode: 'replace', reindexed: 4, profileSaved: true },
    })
    expect(preBackupReady(done, K)).toBe(false)
  })

  it('확정 실패·응답 유실 뒤에도 같은 의도의 백업은 남는다 — 적용되지 않았거나, 그 백업이 교체 전 원본이다', () => {
    const refused = reducer(reducer(withBackup(), { type: 'executeStart' }), { type: 'executeFailure', error: 'x', definitive: true })
    expect(preBackupReady(refused, K)).toBe(true)
    const failed = lost(reducer(withBackup(), { type: 'executeStart' }))
    expect(preBackupReady(failed, K)).toBe(true)
    expect(preBackupReady(reducer(failed, { type: 'fileSelected', fileName: FILE.fileName }), K)).toBe(true)
  })
})
