/**
 * SP6 양식 병합 엔진 진입점 (정본 §4.3)
 */
export * from './types'
export * from './scanner'
export * from '../catalog'
export { capItems, lineCost, paginateGroups, paginateLines } from './paginate'
export { scanFormTemplate } from './scan'
export { pptxEngine, renderPptx } from './pptx'
import { engineFor as scanEngineFor } from './scan'
import { renderPptx as renderPptxEngine } from './pptx'
import type { FormFormat } from './types'

/** pptx 는 render 까지. xlsx 는 scan 만 (XlsxFormEngine 은 다음 조각). */
export function engineFor(format: FormFormat) {
  const base = scanEngineFor(format)
  if (format !== 'pptx') return base
  return { ...base, render: renderPptxEngine }
}
