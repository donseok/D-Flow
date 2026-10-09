import 'server-only'

// 봇 도구의 단계 이름 원천 — 어휘 원천(vocabSource.ts)과 같은 꼴. 조립 지점(createDefaultChatToolRegistry)의 세션 클라이언트로 프로젝트 설정
// `core.level_labels` 를 읽어 WBS 도구에 넘긴다. 키 손상·미설정·조회 실패는 던진다 — 받는 쪽(wbs.ts 의 levelLabelsOf)이 로그를 남기고 이름 없이 싣는다
// (단계 이름은 깊이 키 곁의 표시 이름이라, 못 읽어도 도구의 답은 그대로 맞다 — 회의 범주 라벨과 같은 처리).
// 도구는 이 파일에서 형(ToolLevelSource)만 import 한다(테스트는 tests/helpers/tool-level-source.ts 의 고정 원천을 넘긴다).
import { getProjectConfig, type ConfigReadClient } from '@/lib/settings/projectConfig'
import { pick } from '@/lib/settings/pick'
import { ConfigKeyError } from '@/lib/settings/errors'

export interface ToolLevelSource {
  /** 그 프로젝트의 단계 이름(깊이 0 부터, 설정 순서 그대로) */
  projectLevelLabels(projectId: string): Promise<readonly string[]>
}

export function createToolLevelSource(client: ConfigReadClient): ToolLevelSource {
  return {
    async projectLevelLabels(projectId) {
      const v = pick(await getProjectConfig(projectId, { client }), 'core.level_labels')
      if (!v.ok) throw new ConfigKeyError(v.kind === 'required' ? 'CONFIG_REQUIRED' : 'CONFIG_INVALID', 'core.level_labels')
      return v.value
    },
  }
}
