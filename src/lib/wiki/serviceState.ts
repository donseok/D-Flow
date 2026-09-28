/**
 * Wiki 자동화 상태의 읽기 전용 정본.
 *
 * 회의록 저장 경로와 크론 워커 중 하나라도 멈춰 있으면 새 지식이 지속적으로 반영되지
 * 않으므로 UI에는 `paused`로 표시한다. 두 값 모두 대소문자까지 정확히 `true`일 때만
 * 활성으로 본다. 이 모듈은 ingest 코드를 import하지 않아 읽기 화면이 LLM/관리자 클라이언트
 * 의존성을 끌어오지 않게 한다.
 */
import { wikiServiceEnabled, wikiWorkerEnabled } from '@/lib/modules/flags'

export type WikiAutomationState = 'active' | 'paused'
// type + 인덱스 시그니처 — flags.ts 술어의 Record<string, string | undefined> 인자에 그대로 넘기고, 기본값 process.env 를 받는다
// (선택 속성뿐인 '약한 타입'이면 ProcessEnv 가 TS2559 로 거부된다. 기본값을 옛 객체 리터럴로 되돌리면 process.env.WIKI_* 판독이 남아 flag-readers 가 실패한다)
export type WikiAutomationEnv = { WIKI_SERVICE_ENABLED?: string; WIKI_WORKER_ENABLED?: string; [name: string]: string | undefined }

export function wikiAutomationState(env: WikiAutomationEnv = process.env): WikiAutomationState {
  return wikiServiceEnabled(env) && wikiWorkerEnabled(env) ? 'active' : 'paused'
}
