import { cache } from 'react'
import { createServerClient } from '@/lib/supabase/server'
import { getComputedWbs } from '@/lib/data/wbs'
import { getProjectRoster } from '@/lib/data/members'
import { listProjects } from '@/app/actions/project'
import {
  analyzeProject,
  summarizeProject,
  answerProjectStatus,
  answerDelayed,
  answerCompleted,
  answerThisWeek,
  answerThisWeekStart,
  answerByTeam,
  answerWeeklySummary,
  answerOverview,
  buildFactSheet,
  keywordMatchLines,
  type ProjectAnalysis,
  type ProjectSummary,
} from './analytics'
import { extractSearchKeywords, type ChatIntent } from './intent'
import type { ProjectMember, TeamCode } from '@/lib/domain/types'
import { projectTeams } from '@/lib/teams/source'
import { activeCodes } from '@/lib/domain/teams'

/**
 * 프로젝트 이름 — 동시에 RLS 관문이다. 세션으로 프로젝트 행을 읽어 없으면(다른 워크스페이스·없는 프로젝트) throw 한다.
 * 호출부는 service_role 로 읽는 것(팀 캐시·admin upsert)보다 먼저 부른다 — 라우트 관문을 우회해 들어와도 여기서 멈춘다
 * (projectFacts 의 loadProjectFacts 와 같은 순서). 조회 실패도 throw — '프로젝트' 기본 이름으로 위장하지 않는다.
 */
export const getProjectName = cache(async (projectId: string): Promise<string> => {
  const sb = await createServerClient()
  const { data, error } = await sb.from('projects').select('name').eq('id', projectId).maybeSingle()
  if (error) throw new Error(`프로젝트 조회 실패: ${error.message}`)
  if (!data) throw new Error('프로젝트를 찾을 수 없습니다.')
  return (data as { name?: string | null }).name ?? '프로젝트'
})

export interface LoadedProject {
  analysis: ProjectAnalysis
  members: ProjectMember[]
  /** 명단 조회 실패 사유 — null 이면 정상. 실패면 members 는 비어 있지만 '0명' 이 아니다(gatherKnowledge 가 근거에 밝힌다). */
  rosterError: string | null
  name: string
  /** 그 프로젝트의 활성 팀 코드(activeCodes 순) — 팀 축 질문(by_team)이 같은 요청의 팀을 다시 읽지 않게 싣는다 */
  teamCodes: TeamCode[]
}

export const loadProjectAnalysis = cache(async (projectId: string): Promise<LoadedProject> => {
  const name = await getProjectName(projectId)   // RLS 관문 — 볼 수 없는 프로젝트면 여기서 throw(아래 팀을 읽지 않는다)
  const [{ items, today, calendar }, roster, teams] = await Promise.all([
    getComputedWbs(projectId),
    getProjectRoster(projectId),
    projectTeams(projectId),
  ])
  if (!roster.ok) console.error(`[assistant] 명단 조회 실패(project=${projectId}) — 담당자 정보 없이 답하고 근거에 그 사실을 밝힌다`)
  const members = roster.ok ? roster.rows : []
  const teamCodes = activeCodes(teams)
  // 팀 축은 그 프로젝트의 팀(전용 팀, 없으면 그 워크스페이스의 공용 팀) — 전 워크스페이스 공용 목록이면 남의 팀이 근거에 섞인다.
  return {
    analysis: analyzeProject(items, name, today, calendar, teamCodes, members),
    members, rosterError: roster.ok ? null : roster.error, name, teamCodes,
  }
})

async function allProjectSummaries(): Promise<{ summaries: ProjectSummary[]; excludedCount: number }> {
  const projects = (await listProjects()) as { id: string; name: string }[]
  const results = await Promise.all(
    projects.map(async p => {
      try {
        const [{ items, today, calendar }, teams] = await Promise.all([getComputedWbs(p.id), projectTeams(p.id)])
        return summarizeProject(analyzeProject(items, p.name, today, calendar, activeCodes(teams)))
      } catch (e) {
        console.error(`[assistant] 전사 요약 — 프로젝트 "${p.name}" 분석 실패(제외):`, e instanceof Error ? e.message : e)
        return null
      }
    }),
  )
  const summaries = results.filter((s): s is ProjectSummary => s !== null)
  return { summaries, excludedCount: results.length - summaries.length }
}

export interface Knowledge {
  /** 사용자에게 그대로 보여줄 결정형 답변(LLM 미설정/실패 시 폴백). 간결하게 유지. */
  text: string
  /** LLM 근거용 사실 블록. 탐색형 질문(freeform/project_status)엔 전체 작업 팩트시트를 더해 준다. */
  facts: string
  scopeProjectId: string | null
  /**
   * "X 가 들어간 항목" 류 검색 질문에서 추출한 키워드와 정확 일치 작업 목록(팩트시트 형식).
   * total=0 도 의미 있는 정보(해당 키워드 없음 → LLM/결정형 답변이 환각 없이 '없음'을 답함).
   * freeform + 키워드 감지 + 프로젝트 스코프일 때만 채워진다.
   */
  keywordHits?: { keywords: string[]; total: number; lines: string[] }
}

/** 명단을 못 읽은 채 만든 근거·답변에 붙이는 고지 — LLM 이 담당자가 없다고 단정하지 않게 근거 블록에도 싣는다. */
const ROSTER_FAILED_NOTE = '※ 명단 조회 실패 — 이 답변에는 담당자·팀 구성원 정보가 빠져 있습니다. 명단이 비어 있다는 뜻이 아닙니다.'
function withRosterFailure(k: Knowledge): Knowledge {
  return { ...k, text: `${k.text}\n\n${ROSTER_FAILED_NOTE}`, facts: `${ROSTER_FAILED_NOTE}\n\n${k.facts}` }
}

/** 의도 + 프로젝트 컨텍스트 → 구조화 사실/답변 문장(LLM 근거 또는 결정형 답변).
 *  message 는 freeform 키워드 검색 감지에만 쓰인다(생략 시 감지 안 함). */
export async function gatherKnowledge(intent: ChatIntent, projectId: string | null, message = ''): Promise<Knowledge> {
  // 전사 의도이거나 현재 선택된 프로젝트가 없으면 전체 프로젝트 요약을 컨텍스트로.
  if (intent === 'overview' || !projectId) {
    const { summaries, excludedCount } = await allProjectSummaries()
    const text = answerOverview(summaries, excludedCount)
    return { text, facts: text, scopeProjectId: null }
  }

  const { analysis, members, rosterError, teamCodes } = await loadProjectAnalysis(projectId)
  const k = projectKnowledge(intent, projectId, analysis, members, message, teamCodes)
  return rosterError ? withRosterFailure(k) : k
}

function projectKnowledge(
  intent: ChatIntent, projectId: string, analysis: ProjectAnalysis, members: ProjectMember[], message: string,
  teamCodes: readonly TeamCode[],
): Knowledge {
  const only = (text: string): Knowledge => ({ text, facts: text, scopeProjectId: projectId })
  switch (intent) {
    case 'delayed':
      return only(answerDelayed(analysis))
    case 'completed':
      return only(answerCompleted(analysis))
    case 'this_week':
      return only(answerThisWeek(analysis))
    case 'this_week_start':
      return only(answerThisWeekStart(analysis))
    case 'by_team':
      return only(answerByTeam(analysis, members, teamCodes))
    case 'weekly_summary':
      return only(answerWeeklySummary(analysis))
    case 'project_status':
    case 'freeform':
    default: {
      // 탐색형: 사용자 폴백은 간결한 스냅샷, LLM 근거엔 전체 작업 팩트시트를 더해
      // 구체 질문(담당/일정/진행률 등)에 정확히 답하게 한다. 의미검색이 산출물/업무 상세를 추가 보강.
      const text = answerProjectStatus(analysis)
      const keywords = intent === 'freeform' ? extractSearchKeywords(message) : []
      const hits = keywords.length ? keywordMatchLines(analysis, keywords) : null
      return {
        text,
        facts: `${text}\n\n${buildFactSheet(analysis)}`,
        scopeProjectId: projectId,
        keywordHits: hits ? { keywords, total: hits.total, lines: hits.lines } : undefined,
      }
    }
  }
}

export interface BotContext {
  currentProject: { id: string; name: string; taskCount: number; donePct: number } | null
  totalProjects: number
  weekStartCount: number
}

/** 패널 부트스트랩 — 환영 메시지/프로액티브 인사이트 렌더용 컨텍스트. */
export async function buildBotContext(projectId: string | null): Promise<BotContext> {
  const projects = await listProjects()
  const totalProjects = projects.length
  if (!projectId) return { currentProject: null, totalProjects, weekStartCount: 0 }
  try {
    const { analysis, name } = await loadProjectAnalysis(projectId)
    return {
      currentProject: { id: projectId, name, taskCount: analysis.taskCount, donePct: analysis.donePct },
      totalProjects,
      weekStartCount: analysis.startingThisWeek.length,
    }
  } catch {
    return { currentProject: null, totalProjects, weekStartCount: 0 }
  }
}
