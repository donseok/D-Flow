'use server'

// 회의록 → 프로그램 설계서 추출(prepareMinuteDesignSpec) · 와이어프레임 화면 목업(prepareMinuteMockup).
// 가드(requireProjectMember) → 모듈 관문(minutes) → 입력 → 원문 검증(verifyMinuteIssueBlock) → AI 가능 여부 → 캐시·LLM 호출 → 명세 정규화.
// 기존 DB 표·RPC 는 건드리지 않는다. LLM 을 쓸 수 없거나 응답이 유효하지 않으면 빈 결과로 위장하지 않고 사유를 돌려준다(에러 처리 3원칙 ①).
import { requireProjectMember } from '@/lib/authz'
import { requireModule } from '@/lib/modules/gate'
import { aiAvailable } from '@/lib/modules/aiAvailable'
import { generateAnswer } from '@/lib/ai/llm'
import {
  MINUTE_DESIGN_SPEC_SYSTEM_PROMPT, MINUTE_MOCKUP_SYSTEM_PROMPT,
  buildMinuteDesignSpecPrompt, buildMinuteMockupPrompt,
  parseMinuteDesignSpecResponse, parseMinuteMockupResponse,
} from '@/lib/ai/minute-mockup-draft'
import { cachedMinuteDesignSpec, cachedMinuteMockup } from '@/lib/ai/minute-mockup-cache'
import { verifyMinuteIssueBlock, type VerifiedMinuteIssueBlock } from '@/lib/minutes/verifySource'
import { fnv1a64, minuteBlockDraftText } from '@/lib/minutes/blocks'
import { isUuidLike } from '@/lib/domain/validate'
import type { MinuteIssueSourceInput } from '@/lib/domain/issueMinuteSource'
import { normalizeDesignSpec, normalizeMockupSpec, type DesignSpec, type MockupSpec } from '@/lib/domain/mockup'
import { MINUTE_SELECTION_MAX_CHARS } from '@/lib/minutes/selection'
import { serverTranslator } from '@/lib/i18n/server'
import type { ServerTranslate } from '@/lib/i18n/serverDict'

export type MinuteDesignSpecResult = { ok: true; value: DesignSpec } | { ok: false; error: string }
export type MinuteMockupResult = { ok: true; value: MockupSpec } | { ok: false; error: string }

/** 프롬프트에 싣는 원문·문맥·피드백 상한 */
const PROMPT_TEXT_MAX = MINUTE_SELECTION_MAX_CHARS
const PROMPT_CONTEXT_MAX = 2_000
const PROMPT_FEEDBACK_MAX = 400
const BLUEPRINT_CACHE_VERSION = 'minute-blueprint-v2'
/** Gemini 3.x thinking 토큰 + 구조화 JSON 출력 여유를 함께 수용한다(issues.ts·minuteWbs.ts 와 동일 상한) */
const BLUEPRINT_MAX_OUTPUT_TOKENS = 8_192

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function clip(value: string, max: number): string {
  if (value.length <= max) return value
  const head = value.slice(0, max)
  return /[\uD800-\uDBFF]$/.test(head) ? head.slice(0, -1) : head
}

function normalizeFeedback(feedback: unknown): string | null {
  if (typeof feedback !== 'string') return null
  const trimmed = clip(feedback.trim(), PROMPT_FEEDBACK_MAX)
  return trimmed.length > 0 ? trimmed : null
}

function safeJsonLength(v: unknown): number | null {
  try {
    return v == null ? 0 : JSON.stringify(v).length
  } catch {
    return null
  }
}

async function verifyBlueprintSource(
  t: ServerTranslate,
  projectId: string,
  workspaceId: string | undefined,
  source: MinuteIssueSourceInput,
  logLabel: string,
): Promise<{ ok: true; value: VerifiedMinuteIssueBlock } | { ok: false; error: string }> {
  if (!isRecord(source) || !isUuidLike(String(source.minuteId)) || !isUuidLike(String(source.minuteVersionId))) {
    return { ok: false, error: t('srv.minuteMockup.sourceInvalid') }
  }
  const verified = await verifyMinuteIssueBlock(projectId, workspaceId, { ...source, kind: 'manual' }, logLabel, true, 'wbs')
  if (!verified.ok) return { ok: false, error: verified.error }
  const v = verified.value
  if (!source.selection && v.block.headingDepth) return { ok: false, error: t('srv.minuteWbs.headingBlock') }
  if (!(await aiAvailable({ projectId }, { module: 'minutes' }))) return { ok: false, error: t('srv.minuteMockup.aiUnavailable') }
  return { ok: true, value: v }
}

/**
 * 회의록 원문(단일 문단·드래그 선택·전체 범위)에서 구조화된 프로그램 설계서(DesignSpec)를 추출한다.
 */
export async function prepareMinuteDesignSpec(
  projectId: string,
  source: MinuteIssueSourceInput,
  feedback?: string,
  currentDraft?: DesignSpec | null,
): Promise<MinuteDesignSpecResult> {
  const t = await serverTranslator()
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const mod = await requireModule({ projectId }, 'minutes')
  if (!mod.ok) return { ok: false, error: mod.error }
  const verified = await verifyBlueprintSource(t, projectId, g.actor.projectWorkspace.get(projectId), source, 'prepareMinuteDesignSpec')
  if (!verified.ok) return verified

  const v = verified.value
  const text = v.selectionExcerpt ?? minuteBlockDraftText(v.block)
  if (text.length > PROMPT_TEXT_MAX) return { ok: false, error: t('srv.issues.selectionTooLarge') }
  // 이전 초안도 신뢰할 수 없는 클라이언트 입력이다. 크기와 스키마를 검증한 값만 데이터로 전달한다.
  const draft = currentDraft == null ? null : normalizeDesignSpec(currentDraft)
  const draftLen = safeJsonLength(currentDraft)
  if (currentDraft != null && (!draft || draftLen === null || draftLen > 40_000)) {
    return { ok: false, error: t('srv.minuteMockup.sourceInvalid') }
  }
  const prompt = buildMinuteDesignSpecPrompt({
    minuteTitle: null,
    minuteDate: null,
    text,
    context: clip(v.draftContextText, PROMPT_CONTEXT_MAX),
    feedback: normalizeFeedback(feedback),
    currentDraft: draft,
  })
  const compute = async (): Promise<DesignSpec | null> => {
    try {
      const raw = await generateAnswer(MINUTE_DESIGN_SPEC_SYSTEM_PROMPT, [{ role: 'user', content: prompt }], {
        timeoutMs: 40_000, maxOutputTokens: BLUEPRINT_MAX_OUTPUT_TOKENS, allowModelFallback: false, retries: 0, retryRateLimit: false,
      })
      const parsed = parseMinuteDesignSpecResponse(raw)
      if (!parsed) console.error('[prepareMinuteDesignSpec] AI 응답을 쓰지 못함')
      return parsed
    } catch (cause) {
      console.error('[prepareMinuteDesignSpec] AI 설계서 추출 실패:', cause instanceof Error ? cause.message : cause)
      return null
    }
  }
  const cacheKey = [
    BLUEPRINT_CACHE_VERSION, 'spec', projectId, source.minuteVersionId, source.blockIndex, v.block.hash, fnv1a64(prompt),
  ].join(':')
  // 사용자가 명시적으로 '다시 생성'을 누른 경우(typeof feedback === 'string')에는 캐시를 건너뛰고 새 버전을 생성한다
  const spec = typeof feedback === 'string'
    ? await compute()
    : await cachedMinuteDesignSpec(cacheKey, compute)
  if (!spec) return { ok: false, error: t('srv.minuteMockup.specFailed') }
  return { ok: true, value: spec }
}

/**
 * 회의록 원문(단일 문단·드래그 선택·전체 범위)에서 와이어프레임 화면 목업(MockupSpec)을 생성한다.
 */
export async function prepareMinuteMockup(
  projectId: string,
  source: MinuteIssueSourceInput,
  feedback?: string,
  currentDraft?: MockupSpec | null,
): Promise<MinuteMockupResult> {
  const t = await serverTranslator()
  const g = await requireProjectMember(projectId)
  if (!g.ok) return { ok: false, error: g.error }
  const mod = await requireModule({ projectId }, 'minutes')
  if (!mod.ok) return { ok: false, error: mod.error }
  const verified = await verifyBlueprintSource(t, projectId, g.actor.projectWorkspace.get(projectId), source, 'prepareMinuteMockup')
  if (!verified.ok) return verified

  const v = verified.value
  const text = v.selectionExcerpt ?? minuteBlockDraftText(v.block)
  if (text.length > PROMPT_TEXT_MAX) return { ok: false, error: t('srv.issues.selectionTooLarge') }
  // 이전 초안도 신뢰할 수 없는 클라이언트 입력이다. 크기와 스키마를 검증한 값만 데이터로 전달한다.
  const draft = currentDraft == null ? null : normalizeMockupSpec(currentDraft)
  const draftLen = safeJsonLength(currentDraft)
  if (currentDraft != null && (!draft || draftLen === null || draftLen > 40_000)) {
    return { ok: false, error: t('srv.minuteMockup.sourceInvalid') }
  }
  const prompt = buildMinuteMockupPrompt({
    minuteTitle: null,
    minuteDate: null,
    text,
    context: clip(v.draftContextText, PROMPT_CONTEXT_MAX),
    feedback: normalizeFeedback(feedback),
    currentDraft: draft,
  })
  const compute = async (): Promise<MockupSpec | null> => {
    try {
      const raw = await generateAnswer(MINUTE_MOCKUP_SYSTEM_PROMPT, [{ role: 'user', content: prompt }], {
        timeoutMs: 40_000, maxOutputTokens: BLUEPRINT_MAX_OUTPUT_TOKENS, allowModelFallback: false, retries: 0, retryRateLimit: false,
      })
      const parsed = parseMinuteMockupResponse(raw)
      if (!parsed) console.error('[prepareMinuteMockup] AI 응답을 쓰지 못함')
      return parsed
    } catch (cause) {
      console.error('[prepareMinuteMockup] AI 생성 실패:', cause instanceof Error ? cause.message : cause)
      return null
    }
  }
  const cacheKey = [
    BLUEPRINT_CACHE_VERSION, 'mockup', projectId, source.minuteVersionId, source.blockIndex, v.block.hash, fnv1a64(prompt),
  ].join(':')
  const spec = typeof feedback === 'string'
    ? await compute()
    : await cachedMinuteMockup(cacheKey, compute)
  if (!spec) return { ok: false, error: t('srv.minuteMockup.generateFailed') }
  return { ok: true, value: spec }
}
