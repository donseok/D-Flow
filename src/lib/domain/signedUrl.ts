// Storage 서명 URL 의 유효 시간(초) — 단일 출처. 서명은 발급할 때마다 Storage RLS 를 다시 검사한다. 권한을 회수하면 새 URL 은
// 즉시 막히지만 이미 발급한 URL 은 TTL 까지 유효하다(회수 창). 'use server' 액션 모듈은 상수를 export 할 수 없어 여기 둔다.

/** 클릭할 때 발급하는 서명(회의록 파일·버전 원본). 받은 즉시 여는 링크라 짧게 둔다. */
export const SIGNED_URL_TTL_SEC = 60

/** 목록을 그릴 때 서명해 <a href> 로 싣는 링크(산출물 첨부 listAttachments·이슈 첨부 listIssueAttachments).
 *  패널을 열어 둔 채 나중에 누르므로 SIGNED_URL_TTL_SEC 로 줄이면 링크가 죽는다. 회수 창을 60초로 맞추려면 회의록처럼
 *  클릭 때 발급으로 옮긴 뒤 이 상수를 없앤다. */
export const LIST_SIGNED_URL_TTL_SEC = 3600
