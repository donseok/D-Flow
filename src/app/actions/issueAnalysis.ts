'use server'

import { requireProjectMember } from '@/lib/authz'
import { loadIssueAnalysisIssues } from '@/lib/data/issueAnalysis'
import { requireModule } from '@/lib/modules/gate'
import type { IssueAreaFilter } from '@/lib/domain/issueAnalysis'
import { loadIssueEntryContext } from '@/lib/issues/context'
import { issueAnalysisVocabOf } from '@/lib/report/issues/model'
import { orderedVocab } from '@/lib/settings/vocab'
import {
  ensureIssueAnalysis,
  type EnsureIssueAnalysisResult,
} from '@/lib/ai/issue-analysis'
import {
  buildIssueAnalysisPreflight,
  type IssueAnalysisPreflight,
  type IssueAnalysisReport,
} from '@/lib/report/issues/model'
import { issueAnalysisPptExport, type IssueAnalysisPptExport } from '@/lib/report/forms/issueAnalysisExport'
import { serverTranslator } from '@/lib/i18n/server'
import { fill } from '@/lib/i18n/translate'
import { libText } from '@/lib/i18n/serverText'

export interface EnsureIssueAnalysisActionResult {
  ok: boolean
  state: 'ready' | 'generated' | 'unavailable' | 'blocked'
  error?: string
  runId?: string
  analysis?: IssueAnalysisReport
  preflight: IssueAnalysisPreflight | null
  /** 저장된 실행(runId)이 있을 때만 싣는다 — 그 실행을 PPT 로 받을 수 있는지(양식 설정 forms.issue_analysis_pptx) */
  pptExport?: IssueAnalysisPptExport
}

async function fromEnsureResult(
  projectId: string,
  result: EnsureIssueAnalysisResult,
  preflight: IssueAnalysisPreflight,
): Promise<EnsureIssueAnalysisActionResult> {
  const t = await serverTranslator()
  if (!('reason' in result)) {
    return {
      ok: true,
      state: result.state,
      runId: result.runId,
      analysis: result.analysis,
      preflight,
      pptExport: await issueAnalysisPptExport(projectId),
    }
  }
  return {
    ok: false,
    state: result.reason === 'preflight_failed' ? 'blocked' : 'unavailable',
    error: libText(t, result.error),
    preflight,
  }
}

/**
 * 이슈 분석서 데이터 생성(버튼 온디맨드 전용).
 *
 * 프로젝트 멤버 확인 뒤 서버에서 원본을 엄격 재로드한다. 클라이언트가 보낸 이슈나 사전
 * 점검 결과는 신뢰하지 않는다. 양식 설정이 손상돼도 분석 JSON은 생성할 수 있으며, 그 실행을
 * PPT 로 받을 수 있는지는 pptExport 로 UI에 따로 전달한다(다운로드 경로는 /api/issue-analysis).
 */
export async function ensureIssueAnalysisAction(
  projectId: string,
  areaFilter: IssueAreaFilter = 'all',
): Promise<EnsureIssueAnalysisActionResult> {
  const t = await serverTranslator()
  const guard = await requireProjectMember(projectId)
  if (!guard.ok) {
    return {
      ok: false,
      state: 'unavailable',
      error: libText(t, guard.error),
      preflight: null,
    }
  }
  const mod = await requireModule({ projectId }, 'issue_analysis')                    // 스펙 §4.2 — 가드 뒤·입력 검증 앞(P17). 꺼지면 로더·LLM 에 닿지 않는다
  if (!mod.ok) return { ok: false, state: 'unavailable', error: libText(t, mod.error), preflight: null }
  const context = await loadIssueEntryContext(projectId)
  if (!context.ok) return { ok: false, state: 'unavailable', error: libText(t, context.error), preflight: null }
  if (areaFilter !== 'all' && !context.value.areas.some(area => area.id === areaFilter)) {
    return {
      ok: false,
      state: 'unavailable',
      error: t('srv.issueAnalysis.invalidAreaAnalysisScope'),
      preflight: null,
    }
  }

  let issues
  let majors
  try {
    const loaded = await loadIssueAnalysisIssues(
      projectId,
      areaFilter === 'all' ? undefined : areaFilter,
    )
    issues = loaded.issues
    majors = loaded.majors
    if (
      areaFilter !== 'all'
      && issues.some(issue => issue.areaId !== areaFilter)
    ) {
      throw new Error('[issue-analysis] 영역 분석 범위 정합성이 올바르지 않습니다.')
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : t('srv.issueAnalysis.couldNotLoadIssueAnalysis')
    console.error('[issue-analysis] 엄격 로더 실패:', message)
    return {
      ok: false,
      state: 'unavailable',
      error: t('srv.issueAnalysis.couldNotProcessIssueAnalysis'),
      preflight: null,
    }
  }

  const preflight = buildIssueAnalysisPreflight(issues, context.value.areas)
  if (preflight.totalCount === 0) {
    return {
      ok: false,
      state: 'blocked',
      error: t('err.noIssuesAnalyze'),
      preflight,
    }
  }
  if (preflight.blockedCount > 0) {
    return {
      ok: false,
      state: 'blocked',
      error: fill(t('err.issuesMissingRequiredAnalysisInformation'), { blockedCount: preflight.blockedCount }),
      preflight,
    }
  }

  try {
    const { severities, sources, causeCategories } = context.value.vocab
    if (!causeCategories) {
      return { ok: false, state: 'unavailable', error: t('srv.issueAnalysis.causeCategorySetting'), preflight }
    }
    const result = await ensureIssueAnalysis(projectId, issues, majors, guard.actor.userId, context.value.areas, {
      severityCodes: orderedVocab(severities).map(e => e.code),
      analysis: issueAnalysisVocabOf(causeCategories, sources),
    })
    return await fromEnsureResult(projectId, result, preflight)
  } catch (error) {
    // ensure 계층은 정상적으로는 never-throw 결과를 주지만, 예기치 않은 프로그래밍/IO
    // 예외도 액션 경계를 넘어 Next 오류 페이지로 번지지 않게 명시적 unavailable로 만든다.
    const message = error instanceof Error ? error.message : t('srv.issueAnalysis.couldNotGenerateIssueAnalysis')
    console.error('[issue-analysis] ensure 실패:', message)
    return {
      ok: false,
      state: 'unavailable',
      error: t('srv.issueAnalysis.couldNotProcessIssueAnalysis'),
      preflight,
    }
  }
}
