// 모듈 표시 이름(한국어) — 설정 편집기(허용 모듈)와 전환기 토스트("이 프로젝트에서는 {모듈}을 사용하지 않아…")가 같이 쓴다.
// core 넷은 내비 라벨(D30)과 같은 말로 둔다. 순수 잎 파일.
import type { ModuleId } from './defaults'

export const MODULE_LABEL: Readonly<Record<ModuleId, string>> = {
  dashboard: '개요', wbs: '작업 계획', members: '팀 구성', settings: '설정',
  kanban: '칸반', meetings: '회의', weekly: '주간보고', issues: '이슈', wiki: '위키',
  announcements: '공지', attendance: '근태', agents: '에이전트', minutes: '회의록',
  minutes_integration: '회의록 외부 연동', chatbot: '챗봇', portfolio: '포트폴리오', usage: '사용 현황',
}
