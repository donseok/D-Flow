/**
 * 표 행 셀의 긴 텍스트를 표시 줄 예산에 맞춰 손실 없이 나눈다(정본 §4.4.6 — {{#rows}} 행의 셀 넘침).
 * 양식 엔진(engine/pptx.ts)이 쓴다. 글꼴 메트릭은 재지 않고 전각 1·반각 0.55·공백 0.35 로 어림한다.
 */

function characterWidth(char: string): number {
  if (/\s/u.test(char)) return 0.35
  if (/^[\u0000-\u00ff]$/u.test(char)) return 0.55
  return 1
}

export function estimateIssueAnalysisLineCount(value: string, lineWidth: number): number {
  if (!Number.isFinite(lineWidth) || lineWidth <= 0) {
    throw new Error('PPT 열 너비가 올바르지 않습니다.')
  }
  if (!value) return 1
  let lines = 1
  let width = 0
  for (const char of value) {
    if (char === '\n') {
      lines += 1
      width = 0
      continue
    }
    const next = characterWidth(char)
    if (width > 0 && width + next > lineWidth) {
      lines += 1
      width = next
    } else {
      width += next
    }
  }
  return lines
}

const PREFERRED_PAGE_BREAK_RE = /[\s.!?。;；:：,，、]/u

/**
 * 텍스트를 표시 줄 예산에 맞춰 손실 없이 나눈다. 가능한 경우 공백·문장부호에서
 * 끊고, 긴 식별자처럼 경계가 없을 때만 유니코드 코드포인트 경계에서 나눈다.
 */
export function splitIssueAnalysisTextForRows(
  value: string,
  lineWidth: number,
  maxLines = 15,
): string[] {
  if (!Number.isSafeInteger(maxLines) || maxLines < 1) {
    throw new Error('PPT 행 줄 수가 올바르지 않습니다.')
  }
  if (!value) return ['']

  const result: string[] = []
  let rest = value
  while (estimateIssueAnalysisLineCount(rest, lineWidth) > maxLines) {
    let width = 0
    let lines = 1
    let utf16Index = 0
    let lastPreferredIndex = 0
    let hardCutIndex = 0

    for (const char of rest) {
      const charLength = char.length
      if (char === '\n') {
        if (lines >= maxLines) {
          // 다음 문단의 개행은 다음 조각에 남겨 현재 조각이 줄 예산을 넘지 않게 한다.
          // 조각 맨 앞의 개행만 단독 보존해 진행이 멈추는 것을 방지한다.
          hardCutIndex = utf16Index || charLength
          break
        }
        lines += 1
        width = 0
        utf16Index += charLength
        lastPreferredIndex = utf16Index
        continue
      }

      const next = characterWidth(char)
      if (width > 0 && width + next > lineWidth) {
        if (lines >= maxLines) {
          hardCutIndex = utf16Index
          break
        }
        lines += 1
        width = next
      } else {
        width += next
      }
      utf16Index += charLength
      if (PREFERRED_PAGE_BREAK_RE.test(char)) lastPreferredIndex = utf16Index
    }

    if (!hardCutIndex) hardCutIndex = utf16Index
    const preferredIsClose = lastPreferredIndex >= Math.floor(hardCutIndex * 0.65)
    const cutIndex = preferredIsClose ? lastPreferredIndex : hardCutIndex
    if (cutIndex < 1 || cutIndex >= rest.length) {
      throw new Error('PPT 텍스트 페이지 분할에 실패했습니다.')
    }
    result.push(rest.slice(0, cutIndex))
    rest = rest.slice(cutIndex)
  }
  result.push(rest)
  return result
}
