import 'server-only'
import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { serverTranslator } from '@/lib/i18n/server'
import type { MinuteLinkedWbsItem, MinuteWbsSourceKind } from '@/lib/domain/minuteWbs'

/** 연결 행 + 작업의 코드·이름 — 작업은 복합 FK(wbs_item_id, project_id)로 임베드한다(0061) */
const LINK_SELECT = 'id, wbs_item_id, project_id, minute_version_id, body_hash, block_index, block_hash, source_kind, wbs_items!wbs_item_links_item_project_fk(code, name)'

/**
 * 회의록 문단에 연결된 WBS 작업(설계 2026-10-21-minutes-to-wbs §3.3·§5.6) — 그 회의록의 모든 버전의 연결을 읽는다.
 * "등록됨"은 버전이 아니라 문단 내용(block_hash)으로 판정하므로(activeLinkedWbsItems) 여기서 버전으로 거르지 않는다.
 * 세션 클라이언트라 RLS(accessible_project_ids)가 볼 수 있는 연결만 온다. 작업을 읽을 수 없는 연결(임베드 없음)은 뺀다 —
 * 연결과 작업의 읽기 정책이 같고 복합 FK 라 같은 프로젝트여서 실제로는 생기지 않는다. 볼 수 없는 작업은 그리지 않는다(이슈 연결과 같은 규칙).
 * 실패는 결과로 돌려준다 — 빈 목록으로 바꾸면 등록된 문단이 미등록으로 보여 같은 작업을 또 만든다(§5.6, 에러 처리 3원칙 ①).
 * cache — 같은 요청 안의 중복 호출 dedupe.
 */
export const getMinuteLinkedWbsItems = cache(async (
  minuteId: string,
): Promise<{ ok: true; rows: MinuteLinkedWbsItem[] } | { ok: false; error: string }> => {
  const sb = await createServerClient()
  const { data, error } = await sb.from('wbs_item_links')
    .select(LINK_SELECT)
    .eq('minute_id', minuteId)
    .eq('link_type', 'minute_block')
    .order('created_at')
  if (error || !data) {
    console.error('[getMinuteLinkedWbsItems] 조회 실패:', error?.message ?? 'unknown')
    const t = await serverTranslator()
    return { ok: false, error: t('srv.minuteWbs.linksUnavailable') }
  }
  const rows: MinuteLinkedWbsItem[] = []
  for (const r of data as Record<string, unknown>[]) {
    const raw = r.wbs_items as Record<string, unknown> | Record<string, unknown>[] | null
    const item = Array.isArray(raw) ? raw[0] : raw
    if (!item) continue
    rows.push({
      linkId: r.id as string,
      itemId: r.wbs_item_id as string,
      code: String(item.code ?? ''),
      name: String(item.name ?? ''),
      projectId: r.project_id as string,
      minuteVersionId: r.minute_version_id as string,
      bodyHash: r.body_hash as string,
      blockIndex: Number(r.block_index),
      blockHash: r.block_hash as string,
      sourceKind: r.source_kind as MinuteWbsSourceKind,   // 표 검사 제약이 'manual'|'action' 만 받는다
    })
  }
  return { ok: true, rows }
})
