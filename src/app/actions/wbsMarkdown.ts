'use server'

import { revalidatePath } from 'next/cache'
import { requireProjectAdmin } from '@/lib/authz'
import { requireAgentProject } from '@/lib/agent/externalApi'
import { createAdminClient } from '@/lib/supabase/admin'
import { runWbsImport, validateLevels } from '@/lib/agent/wbsImport'
import { parseWbsMarkdown, toImportNodes, validateWbsDoc, type WbsDoc } from '@/lib/wbsmd/parse'
import { chunked } from '@/lib/ai/util'
import { getProjectConfig } from '@/lib/settings/projectConfig'
import { productNameFor } from '@/lib/settings/displayBranding'
import type { Actor } from '@/lib/domain/authz'
import { configText, CONFIG_MESSAGES, ConfigKeyError, ConfigUnavailableError, ERR_CONFIG_UNAVAILABLE } from '@/lib/settings/errors'
import { ERR_LEVEL_LABELS_INVALID } from '@/lib/agent/wbsImport'
import { requireCalendar } from '@/lib/calendar/load'
import { CalendarError } from '@/lib/domain/calendar'
import { serverTranslator } from '@/lib/i18n/server'
import type { ServerTranslate } from '@/lib/i18n/serverDict'
import { fill } from '@/lib/i18n/translate'
import { libText } from '@/lib/i18n/serverText'

/** 달력 실패의 사용자 문구 — 손상 키(키 이름이 든 고정 문구)·근무일 없음(3,660일 상한 — 고정 문구). 그 밖은 null(호출부의 고정 문구) */
function calendarFailureText(t: ServerTranslate, e: unknown): string | null {
  if (e instanceof ConfigKeyError) return `${configText(t, CONFIG_MESSAGES[e.code])} (${e.key})`
  if (e instanceof CalendarError) return t('srv.wbsMarkdown.noWorkingDayFoundStart')
  return null
}

/**
 * wbs.md 웹 업로드 — 스펙 §업로드 경로 2개의 "웹 경로(자동 부착 + 확인)".
 * 미리보기(previewWbsUpload)가 부착점·levels 정합·신규/갱신을 보여주고, 사람은 노드를 고르지
 * 않고 확인만 한다. 적용(applyWbsUpload)은 클라이언트 미리보기를 신뢰하지 않고 전 과정을
 * 다시 검증한 뒤 API 라우트와 같은 코어(runWbsImport)를 태운다 — 두 경로의 규칙 분기 금지.
 * 권한: 프로젝트 관리자 전용(import API 와 동일).
 */

export type WbsUploadPreview = {
  ok: boolean
  error?: string
  mode?: 'skeleton' | 'pl'
  module?: string
  attach?: string                    // frontmatter 표기 (PH-03/SYS-QA)
  attachRef?: string | null          // 해석된 full external_ref (acme-skel/SYS-QA)
  attachFound?: boolean
  levelsStatus?: 'match' | 'mismatch' | 'seed'
  serverLevels?: string[] | null
  fileLevels?: string[]
  counts?: Record<string, number>
  newCount?: number
  updateCount?: number
  foldCount?: number
  errors?: string[]
  warnings?: string[]
  canApply?: boolean
}

type Admin = ReturnType<typeof createAdminClient>

/** 검증 오류문이 가리키는 제품 이름 — 그 프로젝트의 워크스페이스가 정한 값(branding.product_name). 워크스페이스는 폼 값이 아니라 가드 결과
 *  (actor.projectWorkspace)에서 얻는다 — 다른 워크스페이스의 이름을 고를 길이 없다. 대응이 없으면(미존재 프로젝트를 통과한 플랫폼 관리자) 배포 기본 이름. */
function uploadProductName(actor: Actor, projectId: string): Promise<string> {
  return productNameFor(actor.projectWorkspace?.get(projectId) ?? null)
}

/** 파싱 + 구조·본문 검증 — 미리보기·적용이 공유하는 앞단. */
function parseAndValidate(t: ServerTranslate, md: string, productName: string): { doc: WbsDoc; role: 'pl' | 'skeleton'; errors: string[]; warnings: string[]; counts: Record<string, number> } {
  const doc = parseWbsMarkdown(md)
  const role: 'pl' | 'skeleton' = doc.front.attach ? 'pl' : 'skeleton'
  const errors: string[] = []
  const lv = validateLevels(doc.levels)
  if ('error' in lv) errors.push(fill(t('err.levelsValidationFailed'), { error: libText(t, lv.error) }))
  const v = validateWbsDoc(doc, role, productName)
  // 파서(순수 lib)의 검증 문구는 한국어로 만들어진다 — 화면에 싣는 이 자리에서 요청의 언어로 푼다(틀 역조회, 한국어 로캘은 글자 그대로)
  errors.push(...v.errors.map(e => libText(t, e)))
  return { doc, role, errors, warnings: v.warnings.map(w => libText(t, w)), counts: v.counts }
}

/** attach 경로 표기(PH-03/SYS-OP)의 마지막 세그먼트를 full external_ref 로 해석.
 *  0건 = 골격 미업로드(fail-closed 표시), 2건+ = 모호(에러 — 자동 부착 불가). */
async function resolveAttachRef(admin: Admin, projectId: string, attach: string):
  Promise<{ ref: string | null; ambiguous: boolean }> {
  const last = attach.split('/').pop() ?? ''
  const { data, error } = await admin
    .from('wbs_items').select('external_ref')
    .eq('project_id', projectId).like('external_ref', `%/${last}`).limit(2)
  if (error) throw new Error(`attach 해석 실패: ${error.message}`)
  const rows = (data ?? []) as Array<{ external_ref: string }>
  if (rows.length === 1) return { ref: rows[0].external_ref, ambiguous: false }
  return { ref: null, ambiguous: rows.length > 1 }
}

export async function previewWbsUpload(projectId: string, md: string): Promise<WbsUploadPreview> {
  const t = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: libText(t, g.error) }

  try {
    const { doc, role, errors, warnings, counts } = parseAndValidate(t, md, await uploadProductName(g.actor, projectId))
    const admin = createAdminClient()

    // attach 자동 판정 (PL 만)
    let attachRef: string | null = null
    let attachFound = false
    if (role === 'pl' && doc.front.attach) {
      const r = await resolveAttachRef(admin, projectId, doc.front.attach)
      attachRef = r.ref
      attachFound = r.ref !== null
      if (r.ambiguous) errors.push(fill(t('srv.wbsMarkdown.attachPointAmbiguous'), { attach: doc.front.attach }))
      else if (!attachFound) errors.push(fill(t('srv.wbsMarkdown.attachNodeDoesNotExist'), { attach: doc.front.attach }))
    }

    // levels 정합 (PL: 정본 대조 / 골격: 시드 예정)
    let levelsStatus: WbsUploadPreview['levelsStatus'] = 'seed'
    let serverLevels: string[] | null = null
    // 설정은 한 번 — 단계 정본(PL)과 시작일 파생의 근무일 달력(SP5 — 손상 키는 ConfigKeyError, 아래 catch). 실패는 throw — 아래 catch 가 고정 문구로
    const cfg = await getProjectConfig(projectId, { client: admin })
    const cal = requireCalendar(cfg)
    if (role === 'pl') {
      const state = cfg.keys['core.level_labels']
      serverLevels = state.status === 'set' ? state.value : null
      const fileLabels = doc.levels.map(l => l.name)
      levelsStatus = serverLevels && JSON.stringify(serverLevels) === JSON.stringify(fileLabels) ? 'match' : 'mismatch'
      // 손상(invalid)은 '정본 없음'과 다르다 — 파일이 아니라 설정을 고쳐야 한다(3원칙 ①)
      if (state.status === 'invalid') errors.push(ERR_LEVEL_LABELS_INVALID)
      else if (levelsStatus === 'mismatch') {
        errors.push(t('srv.wbsMarkdown.levelsMismatch').replace('{levels}', () => serverLevels?.join('>') ?? t('common.none')))
      }
    }

    // 신규/갱신 분류 — 업로드될 노드의 external_ref 존재 조회
    const module_ = doc.front.module ?? ''
    const nodes = toImportNodes(doc, cal)
    const refs = nodes.map(n => `${module_}/${n.id}`)
    const existing = new Set<string>()
    for (const refChunk of chunked(refs, 200)) {
      const { data, error } = await admin
        .from('wbs_items').select('external_ref')
        .eq('project_id', projectId).in('external_ref', refChunk)
      if (error) throw new Error(`기존 노드 조회 실패: ${error.message}`)
      for (const r of (data ?? []) as Array<{ external_ref: string }>) existing.add(r.external_ref)
    }
    const updateCount = refs.filter(r => existing.has(r)).length
    const foldCount = doc.nodes.filter(n => doc.levels[n.level]?.upload === 'fold').length

    return {
      ok: true,
      mode: role,
      module: module_ || undefined,
      attach: doc.front.attach,
      attachRef,
      attachFound,
      levelsStatus,
      serverLevels,
      fileLevels: doc.levels.map(l => l.name),
      counts,
      newCount: refs.length - updateCount,
      updateCount,
      foldCount,
      errors,
      warnings,
      canApply: errors.length === 0 && (role === 'skeleton' || (attachFound && levelsStatus === 'match')),
    }
  } catch (e) {
    // 원인(DB 원문 포함)은 로그에만 — 화면에는 고정 문구
    console.error('[wbs-md] 미리보기 실패:', e)
    return { ok: false, error: calendarFailureText(t, e) ?? (e instanceof ConfigUnavailableError ? configText(t, ERR_CONFIG_UNAVAILABLE) : t('srv.wbsMarkdown.couldNotBuildPreview')) }
  }
}

export async function applyWbsUpload(projectId: string, md: string): Promise<{
  ok: boolean; error?: string
  upserted?: number; ordersCreated?: number
  unmatched?: Array<{ id: string; assignee: string }>
  /** payload 의 task(input 층) 노드 수 — ordersCreated 와 대조해 "침묵 0건"을 화면이 잡는다. */
  taskCount?: number
  /** 프로젝트의 agents 모듈이 꺼져 있어 주문이 안 나간 경우 — 사람이 프로젝트 설정에서 켜야 한다. */
  agentStopped?: boolean
}> {
  const t = await serverTranslator()
  const g = await requireProjectAdmin(projectId)
  if (!g.ok) return { ok: false, error: libText(t, g.error) }

  try {
    // 클라이언트 미리보기를 신뢰하지 않는다 — 전 과정 재검증(fail-closed).
    const { doc, role, errors } = parseAndValidate(t, md, await uploadProductName(g.actor, projectId))
    if (errors.length > 0) return { ok: false, error: fill(t('srv.wbsMarkdown.validationErrors'), { length: errors.length, v: errors.slice(0, 3).join(' / ') }) }
    const module_ = doc.front.module ?? ''
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(module_)) return { ok: false, error: t('err.moduleFormatNotValid') }

    const admin = createAdminClient()
    let attachRef: string | null = null
    if (role === 'pl' && doc.front.attach) {
      const r = await resolveAttachRef(admin, projectId, doc.front.attach)
      if (!r.ref) {
        return { ok: false, error: r.ambiguous
          ? fill(t('srv.wbsMarkdown.attachPointAmbiguous2'), { attach: doc.front.attach })
          : fill(t('srv.wbsMarkdown.attachNodeDoesNotExist'), { attach: doc.front.attach }) }
      }
      attachRef = r.ref
    }

    // 선행 종료 다음 근무일은 대상 프로젝트의 달력으로(SP5 — 손상 키·근무일 없음은 아래 catch 가 그 문구로)
    const cal = requireCalendar(await getProjectConfig(projectId, { client: admin }))
    const nodes = toImportNodes(doc, cal)
    const taskCount = nodes.filter(n => n.kind === 'task').length
    // task 가 있는 업로드는 dev_workflow 를 심는다 — 주문은 agents 모듈이 켜진 프로젝트에서만 나간다(유일한 원천, SP7 — 자동 등록은 없다).
    // 모듈이 꺼져 있으면 조용히 0건이 되지 않게 안내한다. 판정 실패는 꺼짐(fail-closed).
    const agentStopped = taskCount > 0 && !(await requireAgentProject(admin, projectId))
    const result = await runWbsImport(admin, {
      projectId, module: module_, actorUserId: g.actor.userId,
      levels: doc.levels, attachRef, nodes,
    })
    if (!result.ok) return { ok: false, error: result.message }

    revalidatePath(`/p/${projectId}/wbs`)
    return {
      ok: true, upserted: result.upserted, ordersCreated: result.ordersCreated, unmatched: result.unmatched,
      taskCount, ...(agentStopped ? { agentStopped: true } : {}),
    }
  } catch (e) {
    // 원인(DB 원문 포함)은 로그에만 — 화면에는 고정 문구
    console.error('[wbs-md] 적용 실패:', e)
    return { ok: false, error: calendarFailureText(t, e) ?? (e instanceof ConfigUnavailableError ? configText(t, ERR_CONFIG_UNAVAILABLE) : t('srv.wbsMarkdown.uploadFailed')) }
  }
}
