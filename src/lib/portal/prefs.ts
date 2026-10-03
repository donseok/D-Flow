/**
 * 포털·프로젝트 목록의 개인 설정 값(SP3b UI-3 과제 8, 스펙 §5.6·§6.1·§6.2) — 순수 모듈. 저장 경로의 정리(prefs/split)·서버 페이지·
 * 클라이언트 조작(숨기기·보기 전환)이 같은 파서·상수를 쓴다(판정 R10 ③ — 클라이언트는 settings/defs 런타임을 import 하지 않는다).
 * 이 모듈은 prefs 를 import 하지 않는다(prefs → portal 한 방향).
 */
import { isPortalWidgetId, type PortalWidgetId } from './widgets'

/** 프로젝트 목록 보기(계정 키 projectsView) — 기본은 행 목록 */
export const PROJECTS_VIEWS = ['rows', 'cards'] as const
export type ProjectsView = (typeof PROJECTS_VIEWS)[number]
export const DEFAULT_PROJECTS_VIEW: ProjectsView = 'rows'
export const isProjectsView = (v: unknown): v is ProjectsView => v === 'rows' || v === 'cards'

/**
 * 홈에서 숨긴 위젯(워크스페이스 키 portalHiddenWidgets) — 배열이 아니면 null(저장 경로는 그 키를 버린다),
 * 배열이면 레지스트리에 있는 id 만·처음 나온 순서로 중복 제거(레지스트리에서 빠진 위젯 id 는 조용히 버린다)
 */
export function parseHiddenWidgets(v: unknown): PortalWidgetId[] | null {
  if (!Array.isArray(v)) return null
  return [...new Set(v.filter(isPortalWidgetId))]
}
