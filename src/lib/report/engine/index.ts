/**
 * SP6 양식 병합 엔진 진입점 (정본 §4.3)
 */
export * from './types'
export * from './scanner'
export * from '../catalog'
export { capItems, lineCost, paginateGroups, paginateLines } from './paginate'
export { scanFormTemplate } from './scan'
export { pptxEngine, renderPptx } from './pptx'
export { renderXlsx, xlsxEngine } from './xlsx'
import { engineFor as scanEngineFor } from './scan'
import { renderPptx as renderPptxEngine } from './pptx'
import { renderXlsx } from './xlsx'
import type { FormFormat } from './types'

/** 형식에 맞는 엔진. pptx·xlsx 모두 scan 과 render. */
export function engineFor(format: FormFormat) {
  const base = scanEngineFor(format)
  return { ...base, render: format === 'pptx' ? renderPptxEngine : renderXlsx }
}
