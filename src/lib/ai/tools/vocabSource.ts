import 'server-only'

// 봇 도구의 어휘 원천(SP5 B4) — 팀 원천(teamSource.ts)과 같은 꼴. 조립 지점(createDefaultChatToolRegistry)의 세션 클라이언트로 프로젝트 설정을
// 읽어 도구에 넘긴다. 키 손상·조회 실패는 던진다 — 오케스트레이터가 도구 실패로 올린다(기본값으로 풀지 않는다).
// 도구는 이 파일에서 형(ToolVocabSource)만 import 한다(테스트는 tests/helpers/tool-vocab-source.ts 의 고정 원천을 넘긴다).
import { getProjectConfig, type ConfigReadClient } from '@/lib/settings/projectConfig'
import { pick } from '@/lib/settings/pick'
import { ConfigKeyError } from '@/lib/settings/errors'
import type { VocabKey, VocabValues } from '@/lib/settings/vocab'

export interface ToolVocabSource {
  /** 그 프로젝트의 어휘 하나(설정 해석값 — 비활성 포함, 설정 순서 그대로) */
  projectVocab<K extends VocabKey>(projectId: string, key: K): Promise<VocabValues[K]>
}

export function createToolVocabSource(client: ConfigReadClient): ToolVocabSource {
  return {
    async projectVocab(projectId, key) {
      const v = pick(await getProjectConfig(projectId, { client }), key)
      if (!v.ok) throw new ConfigKeyError(v.kind === 'required' ? 'CONFIG_REQUIRED' : 'CONFIG_INVALID', key)
      return v.value as never
    },
  }
}
