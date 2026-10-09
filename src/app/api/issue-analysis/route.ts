import { NextRequest, NextResponse } from 'next/server'
import { getDisplayName } from '@/lib/auth'
import { requireProjectMember } from '@/lib/authz'
import { denyStatus } from '@/lib/authz/errors'
import { toProjectActorView } from '@/lib/domain/authz'
import { configFailureResponse, jsonError } from '@/lib/api/http'
import { loadSavedIssueAnalysisRun } from '@/lib/data/issueAnalysis'
import { requireModule } from '@/lib/modules/gate'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { valueOf } from '@/lib/settings/registry'
import { requireCalendar } from '@/lib/calendar/load'
import { engineFor } from '@/lib/report/engine'
import { scanFormTemplate } from '@/lib/report/engine/scan'
import { FORM_FORMAT, FormRenderError, formatLocation } from '@/lib/report/engine/types'
import { buildIssueAnalysisCatalog, emptyIssueAnalysisCatalog } from '@/lib/report/catalog/issueAnalysisBuild'
import { FormTemplateLoadError, loadFormTemplate } from '@/lib/report/forms/loadTemplate'
import { catalogRoots, needsIssueAnalysisRun } from '@/lib/report/forms/roots'
import {
  ISSUE_ANALYSIS_PPTX_MIME,
  buildIssueAnalysisFilename,
} from '@/lib/report/issues/export'
import type { CatalogModel } from '@/lib/report/catalog/types'
import { serverTranslator } from '@/lib/i18n/server'
import { guardText } from '@/lib/i18n/serverText'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * 저장된 AI 실행을 이슈 분석 양식으로 내보내는 읽기 전용 경계 (정본 §4.8).
 *
 * projectId/runId만 URL에서 받고, 스캔된 루트가 저장 실행을 요구할 때만 DB에서 다시 읽는다.
 * 제품 고정 슬라이드 삽입(§4.9)은 방식(A/B)과 테마 색이 아직 스파이크라 여기서 끼우지 않는다.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const t = await serverTranslator()
  const projectId = req.nextUrl.searchParams.get('projectId')?.trim() ?? ''
  const runId = req.nextUrl.searchParams.get('runId')?.trim() ?? ''
  if (!projectId || !runId) return jsonError(t('srv.api.issueAnalysis.projectidRunidRequired'), 400)

  const guard = await requireProjectMember(projectId)
  if (!guard.ok) return jsonError(guardText(t, guard), denyStatus(guard))
  const mod = await requireModule({ projectId }, 'issue_analysis')                    // 스펙 §4.2 세션 API — 꺼지면 404(존재 은닉)
  if (!mod.ok) return jsonError(guardText(t, mod), denyStatus(mod))

  try {
    const cfg = await getProjectConfig(projectId)
    const setting = valueOf(cfg, 'forms.issue_analysis_pptx')
    const loaded = await loadFormTemplate(projectId, 'issue_analysis_pptx', setting.template_id)
    const scanned = await scanFormTemplate(loaded.bytes, FORM_FORMAT.issue_analysis_pptx)
    const roots = catalogRoots(scanned.placeholders, setting.mapping)

    let model: CatalogModel
    let filename = 'issue-analysis.pptx'
    if (needsIssueAnalysisRun(roots)) {
      const saved = await loadSavedIssueAnalysisRun(projectId, runId)
      if (!saved) return jsonError(t('srv.api.issueAnalysis.savedIssueAnalysisRunNot'), 404)
      if (roots.has('custom')) valueOf(cfg, 'fields.issue')
      const authorName = (await getDisplayName())?.trim() || '작성자'
      const tz = requireCalendar(cfg).timezone
      model = buildIssueAnalysisCatalog({
        report: saved.report,
        areas: saved.areas,
        projectName: saved.projectName,
        authorName,
        authorTeam: toProjectActorView(guard.actor, projectId)?.primaryTeamCode ?? '',
        timeZone: tz,
        severities: valueOf(cfg, 'issues.severities'),
        sources: valueOf(cfg, 'issues.sources'),
        causeCategories: valueOf(cfg, 'issues.cause_categories'),
        issueStatuses: valueOf(cfg, 'workflow.issue_statuses'),
      })
      filename = buildIssueAnalysisFilename(saved.projectName, saved.report.generatedAt, tz)
    } else {
      model = emptyIssueAnalysisCatalog()
    }

    const body = await engineFor('pptx').render(loaded.bytes, model, setting.mapping, setting.options)
    return new NextResponse(body as unknown as ArrayBuffer, {
      headers: {
        'Content-Type': ISSUE_ANALYSIS_PPTX_MIME,
        'Content-Disposition': `attachment; filename="issue-analysis.pptx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
        'X-Form-Template': loaded.source,
      },
    })
  } catch (error) {
    if (error instanceof FormRenderError) {
      const formatted = error.location ? formatLocation(error.location) : undefined
      const location = formatted && formatted !== '(unknown location)' ? formatted : undefined
      console.error('[issue-analysis] 양식 렌더 실패', error.code, location, error.token, error.message)
      return NextResponse.json(
        { error: error.message, code: error.code, ...(location ? { location } : {}), ...(error.token ? { token: error.token } : {}) },
        { status: 422, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    if (error instanceof FormTemplateLoadError) {
      console.error('[issue-analysis] 양식 파일을 읽지 못했다', error.message)
      return jsonError(error.message, 500)
    }
    const failed = configFailureResponse(error, 'issue-analysis')
    if (failed) return failed
    console.error(
      '[issue-analysis] PPT 다운로드 실패:',
      error instanceof Error ? error.message : error,
    )
    return jsonError(t('srv.api.issueAnalysis.couldNotGenerateIssueAnalysis'), 500)
  }
}
