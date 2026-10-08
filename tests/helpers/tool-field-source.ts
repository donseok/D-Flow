import type { ToolFieldSource } from '@/lib/ai/tools/fieldSource'
import type { FieldDef, FieldEntity } from '@/lib/domain/customFields'

/**
 * 봇 도구의 사용자 정의 필드 원천(SP5c §3.6.9) — 엔티티별 고정 정의(기본 = 정의 없음). calls 는 읽은 순서(`<projectId>:<entity>`) —
 * "필드 정의는 접근 판정 뒤에만 읽는다"를 단언할 때 쓴다. throwOn 을 주면 그 엔티티 조회가 실패한다.
 */
export function fixedToolFields(
  defs: { [E in FieldEntity]?: readonly FieldDef[] } = {},
  opts: { throwOn?: FieldEntity } = {},
): ToolFieldSource & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async projectFields(projectId, entity) {
      calls.push(`${projectId}:${entity}`)
      if (opts.throwOn === entity) throw new Error('fields down')
      return [...(defs[entity] ?? [])]
    },
  }
}
