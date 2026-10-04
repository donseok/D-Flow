// 표준 엑셀 레이아웃(SP4 D16·스펙 §4.3) — 저장 양식이 없을 때 내보낼 때마다 프로젝트 팀·단계 이름으로 계산한다. 설정 키로 저장하지
// 않는다('{}' 는 이제 '키 미설정'). 옛 3행 양식(Biz · 계층 L열 · 스페이서 2 · 팀 열 · 산출물·시작·종료·가중치·(빈칸)·실적%)의 일반화라
// 레거시 5팀·3단이면 옛 프로파일과 같다(W26), 결과는 옛 빌더와 셀 단위로 같다(W23 — tests/excel/standard-profile.test.ts).
import type { ComputedItem } from '@/lib/domain/types'
import type { ExcelProfile } from '@/lib/excel/profile'
import type { FieldDef } from '@/lib/domain/customFields'

/** 표준 양식의 담당 마크 — 정확히 둘(감지기의 기본 마크 다섯을 쓰면 옛 양식과 달라진다) */
export const STANDARD_OWNER_MARKS: Readonly<Record<string, 'primary' | 'support'>> = Object.freeze({ '●': 'primary', '△': 'support' })

/** 팀 열 목록 확정 — 주입된 목록(활성 프로젝트 팀 코드) ∪ 트리 담당에 실제로 등장하는 팀(비활성·sub-act·목록 밖 공용 팀).
 *  주입 목록 뒤에 등장 순으로 덧붙인다 — 비활성 팀 담당이 열 부재로 조용히 유실되지 않게(옛 빌더 — 지운 export.ts, tests/fixtures/excel 의 옛 빌더 사본(동등성 오라클) — 와 같은 규칙). */
export function resolveTeamColumns(items: readonly ComputedItem[], teamCodes: readonly string[]): string[] {
  const cols = [...teamCodes]
  const seen = new Set(cols)
  const walk = (ns: readonly ComputedItem[]) => ns.forEach((n) => {
    for (const o of n.owners) if (!seen.has(o.team)) { seen.add(o.team); cols.push(o.team) }
    walk(n.children)
  })
  walk(items)
  return cols
}

/** 표준 프로파일 — L = 단계 이름 수, 팀 열은 1 + L + 2 부터, 그 뒤 산출물·시작·종료·가중치·(빈칸)·실적%, 그 뒤 활성 사용자 정의 열(base + 6, 스펙 §3.6.7) */
export function deriveStandardExcelProfile(
  teamColumns: readonly string[],
  levelLabels: readonly string[],
  customFields?: readonly Pick<FieldDef, 'key' | 'sort' | 'active'>[],
): ExcelProfile {
  const L = levelLabels.length
  if (L < 1) throw new Error('단계 이름이 없어 표준 엑셀 양식을 만들 수 없습니다')
  const teamsStart = 1 + L + 2
  const base = teamsStart + teamColumns.length
  const activeFields = (customFields ?? [])
    .filter((f) => f.active)
    .slice()
    .sort((a, b) => a.sort - b.sort)
  const customColumns: [number, string][] = activeFields.map((f, i) => [base + 6 + i, f.key])
  return {
    version: 1,
    sheetName: 'WBS',
    holidaySheetName: 'Holiday',
    headerRow: 2,
    hierarchy: { kind: 'columns', columns: Array.from({ length: L }, (_, i) => i + 1) },
    logical: { extraAxis: 0, code: null, name: null, deliverable: base, start: base + 1, end: base + 2, weight: base + 3, actualPct: base + 5 },
    teamColumns: teamColumns.map((c, i) => [teamsStart + i, c] as [number, string]),
    ownerMarks: { ...STANDARD_OWNER_MARKS },
    customColumns,
  }
}
