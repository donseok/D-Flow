/**
 * 포털·프로젝트 목록의 개인 설정 값(SP3b UI-3 과제 8, 스펙 §5.6·§6.1·§6.2) — 순수 모듈. 저장 경로의 정리(prefs/split)·서버 페이지·
 * 클라이언트 조작(숨기기·보기 전환)이 같은 파서·상수를 쓴다(판정 R10 ③ — 클라이언트는 settings/defs 런타임을 import 하지 않는다).
 * 이 모듈은 prefs 를 import 하지 않는다(prefs → portal 한 방향).
 */
import { isPortalWidgetId, parsePortalLayout, type PortalLayout, type PortalWidgetId } from './widgets'

/** 프로젝트 목록 보기(계정 키 projectsView) — 기본은 행 목록 */
export const PROJECTS_VIEWS = ['rows', 'cards'] as const
export type ProjectsView = (typeof PROJECTS_VIEWS)[number]
export const DEFAULT_PROJECTS_VIEW: ProjectsView = 'rows'
export const isProjectsView = (v: unknown): v is ProjectsView => v === 'rows' || v === 'cards'

/**
 * 홈에서 숨긴 위젯(워크스페이스 키 portalHiddenWidgets) — 2026-10-10 위젯 강화로 개인 구성(portalLayout)에 흡수됐다. 이 키는 옛 값을 읽어
 * 기본 배치에서 빼는 이행에만 쓰고, 홈 구성을 저장할 때 비운다([]). 배열이 아니면 null(저장 경로는 그 키를 버린다),
 * 배열이면 레지스트리에 있는 id 만·처음 나온 순서로 중복 제거(레지스트리에서 빠진 위젯 id 는 조용히 버린다)
 */
export function parseHiddenWidgets(v: unknown): PortalWidgetId[] | null {
  if (!Array.isArray(v)) return null
  return [...new Set(v.filter(isPortalWidgetId))]
}

/**
 * 홈 구성(워크스페이스 키 portalLayout) — 저장 경로의 정리. null 은 '개인 구성 지우기'(기본값으로 되돌리기)라 그대로 저장한다.
 * 형태가 아니면 { ok: false }(그 키를 버린다). 값의 정리는 parsePortalLayout(모르는 id·중복 버림 — 항목 수 상한 = 레지스트리 크기)
 */
export function cleanPortalLayout(v: unknown): { ok: true; value: PortalLayout | null } | { ok: false } {
  if (v === null) return { ok: true, value: null }
  const layout = parsePortalLayout(v)
  return layout ? { ok: true, value: layout } : { ok: false }
}

/** 홈 메모 위젯의 본문(워크스페이스 키 portalMemo) — 글자 수 상한. 넘치면 잘라 받지 않고 거부한다(쓴 글이 조용히 잘리지 않게 — 입력 칸이 같은 상한을 건다) */
export const PORTAL_MEMO_MAX = 2000
export const isPortalMemo = (v: unknown): v is string => typeof v === 'string' && v.length <= PORTAL_MEMO_MAX
