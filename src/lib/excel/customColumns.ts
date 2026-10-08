/** WBS 가져오기의 사용자 정의 필드 열(SP5c §3.6.7 "임포트 마법사 자동 감지") — 순수 함수만.
 *  ① 헤더 → 필드 매핑 제안 ② 엑셀 셀 → 필드 유형의 값 ③ 행 단위 값 검사(validateCustomValue — DB 트리거와 골든 패리티가 있는 판정).
 *  여기서 통과해도 관문은 DB 트리거(enforce_custom_fields)다 — 이 검사는 거부 사유를 행 번호와 함께 미리 보이는 용도다. */
import { validateCustomValue, type CustomValueError, type FieldDef } from '@/lib/domain/customFields'
import type { ExcelProfile } from './profile'
import type { ImportError } from './validate'

/** 헤더·라벨 비교 키 — 전각/반각(NFKC)·공백·대소문자를 무시한다 */
const norm = (v: string): string => v.normalize('NFKC').replace(/\s+/g, '').toLowerCase()

/** 프로파일이 이미 쓰는 열(계층·논리·팀) — 필드 열로 제안하지 않는다 */
export function profileColumns(profile: Pick<ExcelProfile, 'hierarchy' | 'logical' | 'teamColumns'>): Set<number> {
  return new Set<number>([
    ...(profile.hierarchy.kind === 'columns' ? profile.hierarchy.columns : [profile.hierarchy.column]),
    ...Object.values(profile.logical).filter((c): c is number => c !== null),
    ...profile.teamColumns.map(([c]) => c),
  ])
}

/** 헤더가 활성 필드의 key 또는 라벨과 같으면(norm) 그 열을 그 필드로 제안한다. key 일치가 라벨 일치보다 먼저다. 같은 라벨의 활성 필드가
 *  둘 이상이면 어느 쪽인지 모르므로 제안하지 않는다(추측 금지). 한 필드는 가장 왼쪽 열 하나, 한 열은 한 필드. 결과는 열 순. */
export function suggestCustomColumns(headers: readonly string[], defs: readonly FieldDef[], taken: ReadonlySet<number>): [number, string][] {
  const active = defs.filter((d) => d.active)
  const byKey = new Map(active.map((d) => [norm(d.key), d.key]))
  const byLabel = new Map<string, string[]>()
  for (const d of active) byLabel.set(norm(d.label), [...(byLabel.get(norm(d.label)) ?? []), d.key])
  const out: [number, string][] = []
  const used = new Set<string>()
  const claim = (col: number, key: string | undefined) => {
    if (key === undefined || used.has(key) || out.some(([c]) => c === col)) return
    used.add(key)
    out.push([col, key])
  }
  const cols = headers.map((h, col) => ({ col, h: norm(String(h ?? '')) })).filter(({ col, h }) => h !== '' && !taken.has(col))
  for (const { col, h } of cols) claim(col, byKey.get(h))
  for (const { col, h } of cols) {
    const keys = byLabel.get(h)
    if (keys && keys.length === 1) claim(col, keys[0])
  }
  return out.sort((a, b) => a[0] - b[0])
}

/** 감지 양식에 필드 열 제안을 싣는다(inspect 와 execute 의 저장 양식 대조가 같은 양식을 보게 — 한쪽만 실으면 customColumns 가 늘 불일치다).
 *  제안이 없으면 양식을 그대로 돌려준다. */
export function withSuggestedCustomColumns(profile: ExcelProfile, headers: readonly string[], defs: readonly FieldDef[]): ExcelProfile {
  const suggested = suggestCustomColumns(headers, defs, profileColumns(profile))
  return suggested.length > 0 ? { ...profile, customColumns: suggested } : profile
}

const YES = new Set(['true', 'yes', 'y', '예', '네', 'o'])
const NO = new Set(['false', 'no', 'n', '아니오', '아니요', 'x'])

function optionCode(def: FieldDef, raw: string): string {
  const options = def.options ?? []
  if (options.some((o) => o.code === raw)) return raw
  // 내보내기는 선택지를 라벨로 쓴다(formatCustomValue) — 왕복하려면 라벨을 code 로 되돌린다. 같은 라벨이 둘이면 되돌리지 않는다
  const hits = options.filter((o) => norm(o.label) === norm(raw))
  return hits.length === 1 ? hits[0].code : raw
}

/** 엑셀 셀 값 → 그 필드 유형의 값. 바꿀 수 없으면 원래 값을 그대로 돌려준다 — 판정(거부 사유)은 validateCustomValue 몫이다.
 *  내보내기의 표시 서식(선택지 라벨·`a, b`·예/아니오·`12.5 m³`)을 되읽는 것까지만 한다. */
export function coerceCustomCell(def: FieldDef, raw: unknown): unknown {
  switch (def.type) {
    case 'text': case 'multiline':
      return typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : raw
    case 'number': {
      if (typeof raw !== 'string') return raw
      const unit = def.limits?.unit
      const body = (unit && raw.trim().endsWith(unit) ? raw.trim().slice(0, -unit.length) : raw).trim().replace(/,/g, '')
      return /^[+-]?\d+(\.\d+)?$/.test(body) ? Number(body) : raw
    }
    case 'boolean': {
      if (typeof raw !== 'string') return raw
      const v = norm(raw)
      return YES.has(v) ? true : NO.has(v) ? false : raw
    }
    case 'select':
      return typeof raw === 'number' ? optionCode(def, String(raw)) : typeof raw === 'string' ? optionCode(def, raw.trim()) : raw
    case 'multiselect':
      if (typeof raw === 'number') return [optionCode(def, String(raw))]
      return typeof raw === 'string' ? raw.split(',').map((v) => v.trim()).filter((v) => v !== '').map((v) => optionCode(def, v)) : raw
    case 'date':
      return raw
  }
}

function reasonText(def: FieldDef, reason: CustomValueError): string {
  const limits = def.limits ?? {}
  switch (reason) {
    case 'type': return { text: '텍스트', multiline: '텍스트', number: '숫자', date: '날짜', boolean: '예/아니오', select: '선택지', multiselect: '선택지 목록' }[def.type] + ' 형식이 아닙니다'
    case 'null': case 'empty': return '빈 값은 넣을 수 없습니다'
    case 'newline': return '한 줄 텍스트에 줄바꿈이 있습니다'
    case 'length': return `최대 ${limits.maxLength ?? (def.type === 'text' ? 200 : 2000)}자를 넘습니다`
    case 'number': return '숫자 범위를 벗어났습니다'
    case 'decimals': return `소수 ${limits.decimals ?? 0}자리까지만 넣을 수 있습니다`
    case 'range': return `허용 범위(${limits.min ?? '−∞'} ~ ${limits.max ?? '∞'})를 벗어났습니다`
    case 'date': return '날짜(YYYY-MM-DD)가 아닙니다'
    case 'option': return '선택지에 없는 값입니다'
    case 'inactive_option': return '비활성 선택지입니다'
    case 'duplicate': return '같은 선택지가 두 번 들어 있습니다'
    case 'items': return `최대 ${limits.maxItems ?? 10}개까지 선택할 수 있습니다`
  }
}

const shown = (raw: unknown): string => {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw) ?? String(raw)
  return text.length > 40 ? `${text.slice(0, 37)}…` : text
}

/** 파싱한 행의 custom(열 → 필드 key 로 읽은 원시 셀 값)을 필드 유형의 값으로 바꾸고 검사한다. 오류는 가져오기의 행 단위 오류 표
 *  (ImportError — 엑셀 행 번호 + 문구) 그대로다. 정의에 없는 key·비활성 필드는 열 전체의 문제라 처음 만난 행에 한 번만 싣는다.
 *  필수 필드의 빈 칸은 오류가 아니다 — INSERT 트리거가 기본값으로 채운다(§3.6.4). 입력 행은 바꾸지 않는다. */
export function checkCustomRows<R extends { custom?: Record<string, unknown>; excelRow: number }>(
  rows: readonly R[], defs: readonly FieldDef[],
): { rows: R[]; errors: ImportError[] } {
  const byKey = new Map(defs.map((d) => [d.key, d]))
  const errors: ImportError[] = []
  const columnReported = new Set<string>()
  const out = rows.map((row) => {
    if (!row.custom) return row
    const custom: Record<string, unknown> = {}
    for (const [key, raw] of Object.entries(row.custom)) {
      const def = byKey.get(key)
      if (!def || !def.active) {
        if (!columnReported.has(key)) {
          columnReported.add(key)
          errors.push({
            excelRow: row.excelRow,
            message: def
              ? `'${def.label}' 은(는) 비활성 필드라 값을 넣을 수 없습니다 — 이 열을 빼거나 필드를 활성화하세요`
              : `'${key}' 은(는) 이 프로젝트의 추가 필드가 아닙니다 — 열 매핑을 확인하세요`,
          })
        }
        continue
      }
      const value = coerceCustomCell(def, raw)
      const reason = validateCustomValue(def, value)
      if (reason) errors.push({ excelRow: row.excelRow, message: `'${def.label}' — ${reasonText(def, reason)}: ${shown(raw)}` })
      custom[key] = value
    }
    return { ...row, custom }
  })
  return { rows: out, errors }
}
