import 'server-only'

// 봇 도구의 사용자 정의 필드 원천(SP5c §3.6.9) — 어휘 원천(vocabSource.ts)과 같은 꼴. 조립 지점(createDefaultChatToolRegistry)의 세션
// 클라이언트로 프로젝트 설정을 읽어 도구에 넘긴다. 키 손상·조회 실패는 던진다 — 오케스트레이터가 도구 실패로 올린다("필드 없음"으로 풀지 않는다).
// 도구는 이 파일에서 형(ToolFieldSource)만 import 한다(테스트는 tests/helpers/tool-field-source.ts 의 고정 원천을 넘긴다).
import type { FieldDef, FieldEntity } from '@/lib/domain/customFields'
import { getProjectConfig, type ConfigReadClient } from '@/lib/settings/projectConfig'
import { pick } from '@/lib/settings/pick'
import { ConfigKeyError } from '@/lib/settings/errors'

export interface ToolFieldSource {
  /** 그 프로젝트·엔티티의 필드 정의 전부(비활성 포함, 설정 순서 그대로) — 무엇을 덧붙일지는 customSearchText 가 고른다 */
  projectFields(projectId: string, entity: FieldEntity): Promise<FieldDef[]>
}

export function createToolFieldSource(client: ConfigReadClient): ToolFieldSource {
  return {
    async projectFields(projectId, entity) {
      const key = `fields.${entity}` as const
      const v = pick(await getProjectConfig(projectId, { client }), key)
      if (!v.ok) throw new ConfigKeyError(v.kind === 'required' ? 'CONFIG_REQUIRED' : 'CONFIG_INVALID', key)
      return v.value
    },
  }
}
