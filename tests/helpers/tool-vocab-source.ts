import type { ToolVocabSource } from '@/lib/ai/tools/vocabSource'
import { defaultVocab, type VocabKey, type VocabValues } from '@/lib/settings/vocab'

/**
 * 봇 도구의 어휘 원천(SP5 B4) — 기본 어휘. overrides 로 키별 목록을 바꾼다. calls 는 읽은 순서(`<projectId>:<key>`) —
 * "어휘는 접근 판정 뒤에만 읽는다"를 단언할 때 쓴다. throwOn 을 주면 그 키 조회가 실패한다.
 */
export function fixedToolVocab(
  overrides: { [K in VocabKey]?: VocabValues[K] } = {},
  opts: { throwOn?: VocabKey } = {},
): ToolVocabSource & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    async projectVocab(projectId, key) {
      calls.push(`${projectId}:${key}`)
      if (opts.throwOn === key) throw new Error('vocab down')
      return (overrides[key] ?? defaultVocab(key)) as never
    },
  }
}
