// 워크스페이스 보관 사유의 입력 규칙 — 화면과 서버 액션이 같은 함수를 쓴다(RPC archive_workspace 가 같은 규칙을 다시 본다 — 0056).
// 사유는 선택이다: 비우면 null. 앞뒤 공백은 다듬고, 다듬은 길이가 상한을 넘으면 거부한다(잘라 저장하지 않는다 — 적은 사람이 줄인다).
export const WORKSPACE_ARCHIVE_REASON_MAX = 500

export type ArchiveReasonCheck = { ok: true; reason: string | null } | { ok: false; code: 'reason_too_long' }

export function checkArchiveReason(raw: unknown): ArchiveReasonCheck {
  if (raw === undefined || raw === null) return { ok: true, reason: null }
  if (typeof raw !== 'string') return { ok: false, code: 'reason_too_long' }   // 문자열이 아닌 입력 — 같은 거부로 닫는다(모양을 추측하지 않는다)
  const reason = raw.trim()
  if (reason === '') return { ok: true, reason: null }
  // 글자 수는 코드 포인트로 센다 — DB 의 char_length 와 같은 단위(이모지 한 글자를 둘로 세지 않는다)
  if ([...reason].length > WORKSPACE_ARCHIVE_REASON_MAX) return { ok: false, code: 'reason_too_long' }
  return { ok: true, reason }
}

/** 목록 정렬 — 활성 먼저, 보관된 것은 뒤. 같은 묶음 안의 순서(만든 순)는 그대로 둔다(안정 정렬) */
export function activeFirst<T extends { archivedAt: string | null }>(rows: readonly T[]): T[] {
  return [...rows.filter((r) => r.archivedAt === null), ...rows.filter((r) => r.archivedAt !== null)]
}
