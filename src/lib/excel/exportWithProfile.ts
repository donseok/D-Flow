/** 프로파일 기반 익스포트(Plan B §6.5, Task 7 + 리뷰 픽스). */

import * as XLSX from 'xlsx'
import type { ComputedItem } from '@/lib/domain/types'
import type { ExcelProfile } from '@/lib/excel/profile'
import { HEADER, TEAM_DIRECT_MARK } from '@/lib/excel/headerWords'

const STATUS_LABEL: Record<ComputedItem['status'], string> = {
  not_started: '시작전', in_progress: '진행중', delayed: '지연', done: '완료',
}

// 날짜 문자열 → Date(옛 빌더 export.ts 의 isoToDate 와 같다 — 그 파일은 SP4 A2 에서 지웠고 원문은 tests/fixtures/excel 의 옛 빌더 사본(동등성 오라클)에 있다).
function isoToDate(iso: string | null): Date | '' {
  if (!iso) return ''
  return new Date(iso + 'T00:00:00Z')
}

/** 계층 열 라벨 — 주입된 프로젝트 라벨(늘 있다 — 라우트가 core.level_labels 를 넘긴다). 라벨이 계층 열보다 짧으면 남는 열만 Level{N}. */
function hierarchyLabel(depth: number, levelLabels: readonly string[]): string {
  return levelLabels[depth] || `Level${depth + 1}`
}

/** 트리를 (항목, 깊이) 페어로 평탄화. sub-act(isOwnerSplit) 자식 여부로만 판단한다 — level 문자열은
 *  N단 프로파일에서 전부 'activity'로 뭉개져 있어(parseWithProfile.linkByDepth) 판별 근거가 될 수 없다
 *  (스펙 §5.2 와 동일 원칙을 익스포트에도 적용).
 *  - expandSubActs=false: sub-act 자식은 숨긴다(부모 행이 대표 — 옛 빌더의 flatten 과 동일 결과, tests/fixtures/excel 의 옛 빌더 사본).
 *  - expandSubActs=true : sub-act 자식도 깊이+1 로 펼쳐 낸다.
 *  한 항목의 자식은 전부 isOwnerSplit 이거나 전부 아니다(splitLeafOwners 가 리프만 분리하므로 섞이지
 *  않는다) — 그래서 children[0] 하나만 봐도 충분하다. */
function flattenWithDepth(items: ComputedItem[], expandSubActs: boolean): { item: ComputedItem; depth: number }[] {
  const out: { item: ComputedItem; depth: number }[] = []
  const walk = (ns: ComputedItem[], depth: number) => {
    for (const n of ns) {
      out.push({ item: n, depth })
      const childrenAreSubActs = n.children.length > 0 && n.children[0].isOwnerSplit
      if (childrenAreSubActs && !expandSubActs) continue // 접기 — 숨김
      walk(n.children, depth + 1)
    }
  }
  walk(items, 0)
  return out
}

/** 트리 전체에서 등장하는 팀 코드를 최초 등장 순으로 수집(옛 빌더의 resolveTeamColumns 와 동일 의미 —
 *  collapse/expand 무관하게 항상 전체 트리를 본다. 접힌 sub-act 의 담당도 열 후보에 포함되던 기존
 *  동작을 그대로 계승한다). */
function collectTeams(items: ComputedItem[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const walk = (ns: ComputedItem[]) => ns.forEach(n => {
    for (const o of n.owners) if (!seen.has(o.team)) { seen.add(o.team); out.push(o.team) }
    walk(n.children)
  })
  walk(items)
  return out
}

/** WBS 시트의 AOA(행 배열) 생성 — 프로파일이 열 배치를 결정한다(§6.5).
 *  expandSubActs=false 면 옛 buildWbsAoa(tests/fixtures/excel 의 옛 빌더 사본)의 flatten 접기와 셀 단위로 동일(라운드트립 계약 (a),
 *  시프트가 전혀 없다). expandSubActs=true 면 sub-act 를 계층 열 하나를 "삽입"해 실제 행으로 펼친다.
 *
 *  ── 삽입-시프트 설계(리뷰 픽스, Important #1) ──
 *  최초 구현은 sub-act 를 "마지막 계층 열 + 1" 의 *기존* 위치에 얹었는데, 이건 옛 3행 양식
 *  이 우연히 그 자리를 빈 여백 열로 남겨뒀을 때만 안전했다. 계층 열 바로 다음에 다른 논리 열이 선언된
 *  프로파일(예: hierarchy=[0,1,2], deliverable=3)에서는 sub-act 이름과 산출물 값이 같은 물리 열을
 *  다퉈 — 재감지(detectWorkbook) 시 그 열이 "산출물"인지 "4단 계층 이름"인지 모호해지고, 실제로는
 *  산출물 텍스트가 계층 이름으로 오파싱되는 무증상 손상이 난다.
 *  고쳐 넣은 설계는 배열 삽입(splice)과 동일한 의미다: `insertAt = 마지막 계층 열 + 1` 에 새 열을
 *  "끼워 넣고", `insertAt` 이상인 **모든** 선언 열(logical + teamColumns, 예외 없음)을 +1 만큼 뒤로
 *  민다. 어떤 프로파일이든 충돌이 구조적으로 불가능해지고(밀린 자리는 전부 비어 있던 자리이거나 같이
 *  밀린 다른 선언 열이라 겹칠 수 없다), 계층 열 자체(0..마지막 계층 열)는 항상 insertAt 미만이라
 *  시프트 대상이 아니므로 계층 열의 "연속 구간"이 안 끊긴다 — detectColumnHierarchy(Task3, 규칙3)가
 *  그 연속 구간을 그대로 4열 계층으로 재감지할 수 있다(테스트 (c)).
 *  접기(expandSubActs=false)는 insertAt 자체가 없다(null) → shift 가 항등 함수라 라운드트립 계약
 *  (a)에 전혀 영향이 없다. 옛 3행 양식도 예외가 아니다 — 펼침 모드에선 팀 열(원래 6~10)도
 *  전부 +1 밀린다(insertAt=4 이상이라서). "우연히 안 겹치는 레거시"를 특별 취급하지 않고 모든
 *  프로파일에 같은 규칙을 균일하게 적용한 결과다.
 *
 *  ── 프로파일 밖 팀 동적 확장(리뷰 픽스, Important #2) ──
 *  트리에 등장하지만 profile.teamColumns 에 없는 팀은 조용히 유실시키지 않는다(옛 빌더의
 *  resolveTeamColumns 와 동일 원칙, "조용한 유실 금지"). 시프트가 끝난 좌표계의 맨 끝(선언된 모든 열
 *  다음, 계산 전용 trailing 열보다는 앞)에 열을 추가한다 — collapse/expand 모두 적용.
 *
 *  ── outline 계층 + 펼침(리뷰 픽스, 항목 3) ──
 *  outline 코드 열은 "깊이 = 구분자 수"로 표현되는데, sub-act 는 코드 자릿수를 늘릴 데이터 근거가
 *  없다(splitLeafOwners 가 sub-act 에 부모와 동일한 code 를 승계 — 자릿수 합성은 별도 설계가
 *  필요한 일이라 이 태스크 범위 밖). 예전엔 이 조합에서도 조용히 (틀린 모양의) 결과를 냈는데, 그건
 *  무증상 왕복 오파싱을 낳는다 — 대신 명시적으로 실패를 반환한다.
 *
 *  ── 깊은 트리(SP4 D16) ──
 *  deep='reject'(저장 양식 — 기본)는 계층 열보다 깊은 일반 항목을 거부한다(문구는 '저장된 양식 비우기' 처방 — 저장 양식에만 맞다).
 *  deep='fold'(표준 레이아웃)는 그 항목의 이름을 마지막 계층 열에 쓴다(옛 빌더의 접기와 같다 — tests/fixtures/excel 의 옛 빌더 사본). 펼침의 sub-act 는 계층 열이
 *  모자랄 때(깊이 ≥ 계층 열 수 — 접힌 항목 아래 포함)만 insertAt 에 쓰고 얕으면 제 깊이의 계층 열에 쓴다 — 접는 것은 일반 항목뿐이다
 *  (Q40, A2-2 리뷰 정정 — 늘 insertAt 이면 얕은 잎의 펼침 파일이 깊이를 건너뛰어 왕복이 깨졌다). */
export function buildAoaWithProfile(
  items: ComputedItem[],
  profile: ExcelProfile,
  opts: { expandSubActs: boolean; levelLabels: readonly string[]; deep?: 'fold' | 'reject' },
  projectName = 'WBS',
): { ok: true; aoa: unknown[][] } | { ok: false; error: string } {
  const { expandSubActs, levelLabels, deep = 'reject' } = opts

  if (profile.hierarchy.kind === 'outline' && expandSubActs) {
    return { ok: false, error: '아웃라인 양식의 펼침 익스포트는 아직 지원되지 않습니다' }
  }

  const hierCols = profile.hierarchy.kind === 'columns' ? profile.hierarchy.columns : null
  // 계층 열보다 깊은 항목(sub-act 제외)은 저장 양식의 계층 열에 자리가 없다 — 단계 추가(LevelSettingsManager)나 더 깊은 파일의
  // append 임포트 뒤에 생긴다. 저장 양식(deep='reject')은 조용한 손상 대신 거부하고, 표준(deep='fold')은 마지막 계층 열로 접는다.
  if (hierCols && deep === 'reject') {
    const tooDeep = flattenWithDepth(items, false).some(({ item, depth }) => !item.isOwnerSplit && depth >= hierCols.length)
    if (tooDeep) {
      return { ok: false, error: `저장된 엑셀 양식의 계층 열(${hierCols.length}개)보다 WBS가 깊습니다 — 설정 화면의 "저장된 양식 비우기"로 양식을 비우세요` }
    }
  }
  const outlineCol = profile.hierarchy.kind === 'outline' ? profile.hierarchy.column : null
  // 삽입 지점 — columns 계층 + 펼침일 때만 존재. 계층 열은 전부 insertAt 미만이라 시프트되지 않는다.
  const insertAt = expandSubActs && hierCols ? hierCols[hierCols.length - 1] + 1 : null
  const shift = (c: number): number => (insertAt != null && c >= insertAt) ? c + 1 : c

  const markByKind = new Map<'primary' | 'support', string>()
  for (const [mark, kind] of Object.entries(profile.ownerMarks)) {
    if (!markByKind.has(kind)) markByKind.set(kind, mark)
  }

  // ── 프로파일 선언 열을 전부 시프트 좌표로 변환(접기 모드는 shift 가 항등이라 원본과 동일 값). ──
  const hierColsOut = hierCols ? hierCols.map(shift) : null // 실질적으로 항등(전부 insertAt 미만)
  const outlineColOut = outlineCol != null ? shift(outlineCol) : null
  const extraAxisCol = profile.logical.extraAxis != null ? shift(profile.logical.extraAxis) : null
  const codeCol = profile.logical.code != null ? shift(profile.logical.code) : null
  const nameCol = profile.logical.name != null ? shift(profile.logical.name) : null
  const deliverableCol = profile.logical.deliverable != null ? shift(profile.logical.deliverable) : null
  const startCol = profile.logical.start != null ? shift(profile.logical.start) : null
  const endCol = profile.logical.end != null ? shift(profile.logical.end) : null
  const weightCol = profile.logical.weight != null ? shift(profile.logical.weight) : null
  const actualPctCol = profile.logical.actualPct != null ? shift(profile.logical.actualPct) : null
  const declaredTeamCols: [number, string][] = profile.teamColumns.map(([c, label]) => [shift(c), label])

  const knownCols: number[] = [
    ...(hierColsOut ?? (outlineColOut != null ? [outlineColOut] : [])),
    ...(insertAt != null ? [insertAt] : []),
    ...[extraAxisCol, codeCol, nameCol, deliverableCol, startCol, endCol, weightCol, actualPctCol]
      .filter((c): c is number => c != null),
    ...declaredTeamCols.map(([c]) => c),
  ]
  const maxKnown = knownCols.length ? Math.max(...knownCols) : -1

  // 프로파일 밖 팀 — 시프트된 선언 열 다음(맨 끝)에 등장 순으로 추가. teamColumns=[[c,'*']] 방식은
  // 팀명을 셀 값으로 직접 적는 방식이라 "특정 팀 전용 열"이 아니므로 확장 후보에서 제외한다.
  const declaredTeamCodes = new Set(declaredTeamCols.map(([, label]) => label).filter(l => l !== TEAM_DIRECT_MARK))
  const extraTeams = collectTeams(items).filter(t => !declaredTeamCodes.has(t))
  const extraTeamCols: [number, string][] = extraTeams.map((team, i) => [maxKnown + 1 + i, team])
  const teamCols = [...declaredTeamCols, ...extraTeamCols]

  const maxCol = maxKnown + extraTeams.length

  // ── 헤더 1행: 프로젝트명 ──
  const header1: unknown[] = [projectName]

  // ── 헤더 2행: 병합 타이틀(담당/산출물/계획) — 옛 buildWbsAoa 의 시각 관례를 그대로 재현.
  // 폭은 계층 열·팀 열·산출물/시작 위치 중 가장 오른쪽까지만(원본이 'end' 위치에서 멈추는 것과 동일). ──
  const header2Bound = Math.max(
    ...(hierColsOut ?? []),
    ...teamCols.map(([c]) => c),
    deliverableCol ?? -1,
    startCol ?? -1,
    endCol ?? -1,
    -1,
  )
  const header2 = new Array(header2Bound + 1).fill('')
  if (hierColsOut) hierColsOut.forEach((c, i) => { header2[c] = hierarchyLabel(i, levelLabels) })
  if (teamCols.length > 0) header2[teamCols[0][0]] = HEADER.owner
  if (deliverableCol != null) header2[deliverableCol] = HEADER.deliverable
  if (startCol != null) header2[startCol] = HEADER.plan

  // ── 헤더 3행(라벨 행) ──
  // trailing 은 데이터 행과 같은 4칸이다 — 계획%·계획대비%·진척·상태(SP4 §4.3 ①에서 상태 머리를 더했다).
  // 앞 세 칸의 머리가 값과 한 칸씩 어긋난 것(계획대비% 가 롤업 실적% 위, 진척 이 성과율 위)은 감지 낱말 호환 때문에 그대로 둔다(D16).
  const header3 = new Array(maxCol + 5).fill('')
  if (hierColsOut) hierColsOut.forEach((c, i) => { header3[c] = hierarchyLabel(i, levelLabels) })
  else if (outlineColOut != null) header3[outlineColOut] = HEADER.code
  if (extraAxisCol != null) header3[extraAxisCol] = HEADER.extraAxis
  if (codeCol != null) header3[codeCol] = HEADER.code
  if (nameCol != null) header3[nameCol] = HEADER.name
  teamCols.forEach(([c, label]) => { header3[c] = label })
  if (deliverableCol != null) header3[deliverableCol] = HEADER.deliverable
  if (startCol != null) header3[startCol] = HEADER.start
  if (endCol != null) header3[endCol] = HEADER.end
  if (weightCol != null) header3[weightCol] = HEADER.weight
  if (actualPctCol != null) header3[actualPctCol] = HEADER.actualPct
  if (insertAt != null) header3[insertAt] = HEADER.subAct // 펼침 전용 — 접기 모드는 insertAt 자체가 null
  header3[maxCol + 1] = HEADER.plannedPct
  header3[maxCol + 2] = HEADER.vsPlan
  header3[maxCol + 3] = HEADER.progress
  header3[maxCol + 4] = HEADER.status

  // 라벨 행(header3)은 profile.headerRow 위치에 둔다 — parseWithProfile 이 headerRow+1 부터 데이터를 읽는다.
  const rows: unknown[][] = [...headerRowsBeforeLabel(profile.headerRow, header1, header2, projectName), header3]

  for (const { item, depth } of flattenWithDepth(items, expandSubActs)) {
    const row = new Array(maxCol + 5).fill('')

    if (extraAxisCol != null) row[extraAxisCol] = item.biz ?? ''
    if (codeCol != null) row[codeCol] = item.code ?? ''

    if (hierColsOut) {
      // 펼침의 sub-act — 계층 열이 모자랄 때(부모가 마지막 계층 열 깊이 이상 — 접힌 일반 항목 아래 포함)만 세부업무 열(insertAt). 얕으면
      // 부모 다음 계층 열이다: 늘 insertAt 에 쓰면 얕은 잎의 sub-act 가 깊이를 건너뛰어 다시 가져올 때 거부된다(A2-2 리뷰 — Q40 정정)
      if (item.isOwnerSplit && insertAt != null && depth >= hierColsOut.length) row[insertAt] = item.name
      else if (depth < hierColsOut.length) row[hierColsOut[depth]] = item.name
      else row[hierColsOut[hierColsOut.length - 1]] = item.name                          // deep='fold' — reject 는 위에서 거부했다
    } else if (outlineColOut != null) {
      row[outlineColOut] = item.code ?? ''
      if (nameCol != null) row[nameCol] = item.name
    }

    for (const [col, label] of teamCols) {
      if (label === TEAM_DIRECT_MARK) {
        // 팀명 직접 방식(콤마 분리) — detect.ts 규칙 6 대안 방식의 역변환.
        const teams = item.owners.map(o => o.team)
        if (teams.length > 0) row[col] = teams.join(',')
      } else {
        const owner = item.owners.find(o => o.team === label)
        if (owner) row[col] = markByKind.get(owner.kind) ?? (owner.kind === 'primary' ? '●' : '△')
      }
    }

    if (deliverableCol != null) row[deliverableCol] = item.deliverable ?? ''
    if (startCol != null) row[startCol] = isoToDate(item.plannedStart)
    if (endCol != null) row[endCol] = isoToDate(item.plannedEnd)
    if (weightCol != null) row[weightCol] = item.weight ?? ''
    if (actualPctCol != null) {
      const childrenAreSubActs = item.children.length > 0 && item.children[0].isOwnerSplit
      row[actualPctCol] =
        item.children.length === 0
          ? (item.actualPct ?? '')
          : (!expandSubActs && childrenAreSubActs)
            ? Math.round(item.rolledActualPct) // 접기 모드에서 sub-act 를 대표하는 롤업값(옛 빌더와 동일 규약)
            : ''
    }

    // 읽기용 계산 컬럼 — 모든 행에 무조건(리프/상위/sub-act 구분 없이) 싣는다. 옛 빌더와 동일 규약.
    row[maxCol + 1] = Math.round(item.plannedPct)
    row[maxCol + 2] = Math.round(item.rolledActualPct)
    row[maxCol + 3] = item.achievement == null ? '' : item.achievement
    row[maxCol + 4] = STATUS_LABEL[item.status]

    rows.push(row)
  }

  return { ok: true, aoa: rows }
}

/** 라벨 행 앞에 올 행 headerRow 개. detect·parse 는 blankrows:false 로 읽어 빈 행을 세지 않으므로 전부 비어 있지 않아야 한다.
 *  0 → 없음, 1 → [제목], 2 → [제목, 병합 타이틀](레거시 3행 헤더 — 바이트 불변), 3 이상 → 제목과 병합 타이틀 사이에 제목 반복 행.
 *  병합 타이틀이 비면(아웃라인 + 팀·산출물·일정 열 없음) 제목으로 채운다 — 비어 있으면 행이 사라져 라벨 위치가 한 칸 당겨진다. */
function headerRowsBeforeLabel(headerRow: number, header1: unknown[], header2: unknown[], projectName: string): unknown[][] {
  if (headerRow === 0) return []
  if (headerRow === 1) return [header1]
  const title2 = header2.some(c => c !== '') ? header2 : [projectName]
  const fillers = Array.from({ length: headerRow - 2 }, () => [projectName])
  return [header1, ...fillers, title2]
}

/** WBS + Holiday 시트를 가진 xlsx ArrayBuffer 생성 — 옛 buildWbsWorkbook(지운 export.ts)의 프로파일 버전. 지금은 표준 양식도 이 함수로 낸다(스펙 §4.3 경로 하나).
 *  시트명은 profile.sheetName/profile.holidaySheetName 을 그대로 쓴다(재임포트 시 프로파일이 찾는
 *  이름과 일치해야 하므로). holidaySheetName 이 null 이면 Holiday 시트를 만들지 않는다.
 *  buildAoaWithProfile 이 실패(outline+펼침, 계층 열보다 깊은 WBS)하면 그대로 전파한다.
 *
 *  headerRow 는 라벨 행 위치로 존중한다(headerRowsBeforeLabel). 계층 열보다 깊은 WBS 는 거부한다. */
export function buildWorkbookWithProfile(
  items: ComputedItem[],
  profile: ExcelProfile,
  holidays: { date: string; name: string }[],
  opts: { expandSubActs: boolean; levelLabels: readonly string[]; deep?: 'fold' | 'reject' },
  projectName = 'WBS',
): { ok: true; buffer: ArrayBuffer } | { ok: false; error: string } {
  const built = buildAoaWithProfile(items, profile, opts, projectName)
  if (!built.ok) return built

  const wb = XLSX.utils.book_new()
  const wbsSheet = XLSX.utils.aoa_to_sheet(built.aoa, { cellDates: true })
  XLSX.utils.book_append_sheet(wb, wbsSheet, profile.sheetName)

  if (profile.holidaySheetName) {
    const holAoa: unknown[][] = [['날짜', '명칭'], ...holidays.map(h => [isoToDate(h.date), h.name])]
    const holSheet = XLSX.utils.aoa_to_sheet(holAoa, { cellDates: true })
    XLSX.utils.book_append_sheet(wb, holSheet, profile.holidaySheetName)
  }

  return { ok: true, buffer: XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer }
}
