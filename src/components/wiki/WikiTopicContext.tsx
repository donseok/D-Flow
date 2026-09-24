'use client'

import { useBotPageContext } from '@/components/chat/BotPageContextProvider'

/** 열린 문서를 AI 어시스턴트의 명시적 Wiki 주제로 등록한다. 렌더 출력은 없다. */
export function WikiTopicContext({ topicId }: { topicId: string }) {
  useBotPageContext({ selectedEntity: { type: 'wiki_topic', id: topicId } })
  return null
}
