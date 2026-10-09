import type { ToolLevelSource } from '@/lib/ai/tools/levelSource'

/**
 * 봇 도구의 단계 이름 원천 — 고정 라벨. calls 는 읽은 프로젝트 순서 — "단계 이름은 접근 판정 뒤에만 읽는다"를 단언할 때 쓴다.
 * 기본은 빈 목록(어느 깊이에도 이름이 없다) — 단계 이름을 보지 않는 시험의 레코드가 이름 없는 옛 꼴 그대로 남는다. null 을 주면 조회가 실패한다.
 */
export function fixedToolLevels(labels: readonly string[] | null = []): ToolLevelSource & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async projectLevelLabels(projectId) {
      calls.push(projectId)
      if (!labels) throw new Error('levels down')
      return labels
    },
  }
}
