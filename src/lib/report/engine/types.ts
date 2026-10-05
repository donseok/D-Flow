/**
 * SP6 양식 병합 엔진 핵심 인터페이스 및 타입 (정본 §4.3.1)
 */
import type { CatalogModel } from '../catalog/types'

export type FormKind =
  | 'weekly_report_pptx'
  | 'weekly_report_xlsx'
  | 'issue_analysis_pptx'
  | 'wbs_export_xlsx'

export type FormFormat = 'pptx' | 'xlsx'

/** 양식 종류별 확장자/형식 매핑 (제품 고정) */
export const FORM_FORMAT: Record<FormKind, FormFormat> = {
  weekly_report_pptx: 'pptx',
  weekly_report_xlsx: 'xlsx',
  issue_analysis_pptx: 'pptx',
  wbs_export_xlsx: 'xlsx',
}

/** 양식 파일 상한(정본 §4.7.2). 버킷 file_size_limit 과 같다. */
export const FORM_TEMPLATE_MAX_BYTES = 10_485_760

export type PlaceholderKind = 'value' | 'rows' | 'slide' | 'items'

/** 토큰이 있는 자리. pptx는 slide·shapeId(·table 셀·paragraph), xlsx는 sheet·cell */
export interface PlaceholderLocation {
  slide?: number                       // 1-based, ppt/slides/slideN.xml의 N
  shapeId?: string                     // <p:cNvPr id>
  table?: { row: number; col: number } // 0-based, <a:tbl> 안일 때
  paragraph?: number                   // 0-based, 그 txBody 안 문단 순번
  sheet?: string                       // xlsx 시트명
  cell?: string                        // 'B7'
}

export interface Placeholder {
  token: string          // 원문(공백 정규화) 예: '{{report.week_range}}'
  kind: PlaceholderKind
  path: string           // 'report.week_range' | 'sections' | '.this_content' | '.'
  scope: string[]        // 둘러싼 블록 토큰 원문, 바깥부터. 최상위는 [] 예: ['{{#slide areas}}', '{{#rows .issues}}']
  location: PlaceholderLocation
  mergedRuns: boolean    // 여러 런에 걸친 토큰을 병합해 인식했는가 (스파이크 ① 지표)
}

export type ScanIssueCode =
  | 'UNKNOWN_TOKEN'          // 문법은 맞지만 카탈로그에도 매핑에도 없음 → 활성화 거부
  | 'MALFORMED_TOKEN'        // '{{'로 열리고 문법 불일치 → 활성화 거부
  | 'UNCLOSED_BLOCK'         // {{#items}}에 {{/items}} 없음, 또는 여는 토큰 없는 {{/rows}}·{{/items}} → 활성화 거부
  | 'ROWS_OUTSIDE_TABLE'     // {{#rows}}가 표 셀 밖 → 활성화 거부
  | 'ROWS_SPAN_ROWS'         // {{#rows}}…{{/rows}}가 다른 행에 → 활성화 거부
  | 'VERTICAL_MERGE_IN_ROWS' // 반복 행이 세로 병합에 걸림 → 활성화 거부
  | 'MULTIPLE_SLIDE_BLOCKS'  // 한 슬라이드에 {{#slide}} 2개 → 활성화 거부
  | 'SLIDE_IN_XLSX'          // xlsx에 {{#slide}} → 활성화 거부
  | 'TYPE_MISMATCH'          // 블록 토큰에 스칼라 경로, 값 토큰에 목록 경로 → 활성화 거부
  | 'SPLIT_RUN'              // 병합으로 인식했으나 런이 쪼개져 있었음 → 경고
  | 'ROUNDTRIP_LOSS'         // 차트·피벗·조건부 서식·데이터 유효성 등 손실 가능성 → 경고
  | 'SHARED_PART_ON_CLONE'   // {{#slide}} 슬라이드가 OLE·차트 파트를 참조 → 경고
  | 'RECOMMENDED_MISSING'    // 그 form_kind의 권장 토큰(예: 주간 sections) 부재 → 경고

export interface ScanIssue {
  code: ScanIssueCode
  severity: 'error' | 'warning'
  message: string
  location?: PlaceholderLocation
  token?: string
}

export class FormRenderError extends Error {
  readonly code: ScanIssueCode | 'MISSING_PATH' | 'TEMPLATE_DRIFT' | 'OPC_REWIRE'
  readonly location: PlaceholderLocation | undefined
  readonly token: string | undefined

  constructor(
    code: ScanIssueCode | 'MISSING_PATH' | 'TEMPLATE_DRIFT' | 'OPC_REWIRE',
    location: PlaceholderLocation | undefined,
    token: string | undefined,
    message: string,
  ) {
    super(message)
    this.name = 'FormRenderError'
    this.code = code
    this.location = location
    this.token = token
  }
}

export interface ScanReport {
  engineVersion: 'forms-engine.v1'
  format: FormFormat
  placeholders: Placeholder[]
  issues: ScanIssue[]
}

/** 매핑 키(최상위는 토큰 원문, 블록 안은 scope를 '/'로 이은 복합 키) → 카탈로그 경로 */
export type RenderMapping = Record<string, string>

export interface RenderOptions {
  max_lines_per_cell: number   // pptx 셀·문단 넘침 기준(시각 줄수, lineCost). 1 이상
  max_rows_per_slide: number   // pptx {{#rows}} 한 슬라이드당 복제 행 상한. 1 이상, xlsx는 무시
  item_cap: number             // {{#items}} 항목 상한, 초과는 '외 N건' 한 줄(0 = 무제한)
  empty_text: string           // 빈 목록·빈 값에 쓰는 문구('' 허용)
  continuation_label: string   // 연속 슬라이드·연속 행 표기(예: '(계속)')
}

/** 양식 종류별 기본 렌더 옵션 (정본 §4.4.6 표) */
export const DEFAULT_RENDER_OPTIONS: Record<FormKind, RenderOptions> = {
  weekly_report_pptx: {
    max_lines_per_cell: 15,
    max_rows_per_slide: 5,
    item_cap: 0,
    empty_text: '',
    continuation_label: '(계속)',
  },
  issue_analysis_pptx: {
    max_lines_per_cell: 15,
    max_rows_per_slide: 5,
    item_cap: 0,
    empty_text: '',
    continuation_label: '(계속)',
  },
  weekly_report_xlsx: {
    max_lines_per_cell: 15,
    max_rows_per_slide: 5,
    item_cap: 0,
    empty_text: '',
    continuation_label: '(계속)',
  },
  wbs_export_xlsx: {
    max_lines_per_cell: 15,
    max_rows_per_slide: 5,
    item_cap: 0,
    empty_text: '',
    continuation_label: '(계속)',
  },
}

export interface FormEngine {
  readonly format: FormFormat
  scan(template: Uint8Array): Promise<ScanReport>
  render(
    template: Uint8Array,
    model: CatalogModel,
    mapping: RenderMapping,
    options: RenderOptions,
  ): Promise<Uint8Array>
}

/**
 * PlaceholderLocation을 인간 친화적 문자열로 서식화 (정본 §4.7.4)
 * 예: "slide 7 · shape 23 · table[2,0]" 또는 "sheet '공정보고' · C12"
 */
export function formatLocation(loc?: PlaceholderLocation): string {
  if (!loc) return '(unknown location)'
  const parts: string[] = []
  if (loc.slide !== undefined) parts.push(`slide ${loc.slide}`)
  if (loc.shapeId !== undefined) parts.push(`shape ${loc.shapeId}`)
  if (loc.table !== undefined) parts.push(`table[${loc.table.row},${loc.table.col}]`)
  if (loc.paragraph !== undefined) parts.push(`p[${loc.paragraph}]`)
  if (loc.sheet !== undefined) parts.push(`sheet '${loc.sheet}'`)
  if (loc.cell !== undefined) parts.push(loc.cell)
  return parts.length > 0 ? parts.join(' · ') : '(unknown location)'
}
