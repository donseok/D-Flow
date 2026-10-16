// 매뉴얼 본문 묶음(chapters.generated.json — `npm run manual:build` 가 src/content/manual/*.md 에서 만든다)을 읽는 한 줄 어댑터.
// 본문은 JSON 에 둔다: 시간대 예시(Asia/Seoul 등)가 .ts 에 있으면 코드의 고정 시간대를 막는 검사(D45)에 걸린다.
import sources from './chapters.generated.json'

export const MANUAL_SOURCES: readonly { file: string; raw: string }[] = sources
