'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { RotateCcw, X, Send, Sparkles, CalendarDays, ChevronDown, ChevronUp } from 'lucide-react'
import { RightRail, useRailHost, useRightRailOptional } from '@/components/app/RightRail'
import { useShellScope } from '@/components/app/ShellScope'
import { RobotMascot } from './RobotMascot'
import { ASSISTANT_NAME } from '@/lib/branding'
import { useCurrentBotPageContext } from './BotPageContextProvider'
import { consumeChatNdjson, isSafeInternalBotHref } from './chatStream'
import { QUICK_SUGGESTIONS } from '@/lib/ai/intent'
import { parseScopePath } from '@/lib/nav/active'
import { useLocale } from '@/components/providers/LocaleProvider'
import { KO_LOCALE } from '@/lib/i18n/format'
import type { DictKey} from '@/lib/i18n/dict'
import { isCommandUtterance } from '@/lib/ai/commands/cue'
import type { CommandProposal, CommandCandidate } from '@/lib/ai/commands/types'
import type {
  BotSource,
  ChatRequestV2,
  ChatStreamEvent,
  ConversationStateV1,
} from '@/lib/ai/chat/protocol'
import { updateActual, updateWbsFields } from '@/app/actions/wbs'
import { applyCommandProposal } from '@/lib/ai/commands/apply'

type Role = 'user' | 'assistant'
interface Msg {
  id: number
  role: Role
  content: string
  proposal?: CommandProposal // 있으면 Bubble 대신 ProposalCard 렌더
  proposalState?: 'pending' | 'applied' | 'cancelled'
  sources?: BotSource[]
  asOf?: string
  /** asOf 를 찍을 시간대 — 봇 응답(done)이 실어 온 요청 범위 tz. 없으면(옛 대화 복원 등) '기준' 줄을 그리지 않는다 */
  asOfTimezone?: string
  tools?: string[]
  truncated?: boolean
}
interface BotContext {
  currentProject: { id: string; name: string; taskCount: number; donePct: number } | null
  totalProjects: number
  weekStartCount: number
}

const EMPTY_CONVERSATION_STATE: ConversationStateV1 = {
  version: 1,
  lastEntities: [],
  lastDomains: [],
}

type T = (k: DictKey) => string

// 빠른 질문 칩의 표시 라벨 매핑 — 전송 문구(한국어, 서버 인텐트 매칭용)는 그대로 두고 표시만 번역한다.
const SUGGESTION_LABEL_KEY: Record<string, DictKey> = {
  '전체 프로젝트 현황 알려줘': 'chat.suggestion.allStatus',
  '지연된 작업이 뭐야?': 'chat.suggestion.delayed',
  '이번 주 작업 알려줘': 'chat.suggestion.thisWeek',
  '멤버별 업무 정리해줘': 'chat.suggestion.byMember',
  '완료된 작업 목록 보여줘': 'chat.suggestion.doneList',
}

function welcomeText(ctx: BotContext | null, t: T): string {
  if (!ctx) return `${t('chat.welcome.greeting')}\n${t('chat.welcome.ask')}`
  const lines = [t('chat.welcome.greeting')]
  if (ctx.currentProject) {
    lines.push(`${t('chat.welcome.currentProject')}: "${ctx.currentProject.name}"`)
    lines.push(
      `${t('chat.welcome.tasksPrefix')}${ctx.currentProject.taskCount}${t('chat.welcome.tasksSuffix')} | ${t('chat.welcome.progressPrefix')}${ctx.currentProject.donePct}${t('chat.welcome.progressSuffix')}`,
    )
  }
  if (ctx.totalProjects === 1) {
    // N=1일 때 "전체 1개 프로젝트에 대해서도 질문할 수 있습니다"는 어색하다 — 단일 프로젝트 전용 문구로 대체.
    lines.push(t('chat.welcome.singleProject'))
  } else if (ctx.totalProjects > 1) {
    lines.push(`${t('chat.welcome.totalPrefix')}${ctx.totalProjects}${t('chat.welcome.totalSuffix')}`)
  }
  lines.push(t('chat.welcome.ask'))
  lines.push(t('chat.welcome.commandHint'))
  return lines.join('\n')
}

/** 미디어 쿼리(min-width) — SSR·첫 렌더는 false(레일·아이콘은 열린 채로 SSR 하지 않는다 — D55) */
function useMinWidth(px: number): boolean {
  const [hit, setHit] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return   // 미디어 쿼리가 없는 환경 = 좁은 화면으로(옛 모양)
    const mq = window.matchMedia(`(min-width: ${px}px)`)
    const on = () => setHit(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [px])
  return hit
}

/** 좁은 화면의 FAB 를 가릴 때 — 저장 바([data-save-bar])가 문서에 있거나 가상 키보드가 떠 있다(D33) */
function useFabSuppressed(active: boolean): boolean {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    if (!active) { setHidden(false); return }
    const vv = window.visualViewport
    const calc = () => setHidden(!!document.querySelector('[data-save-bar]') || (!!vv && vv.height < window.innerHeight * 0.75))
    calc()
    const mo = new MutationObserver(calc)
    mo.observe(document.body, { subtree: true, childList: true })
    vv?.addEventListener('resize', calc)
    return () => { mo.disconnect(); vv?.removeEventListener('resize', calc) }
  }, [active])
  return hidden
}

/**
 * 전역 바의 AI 아이콘(1024 이상 — D33). 탐침이 통과했을 때만 버튼을 내고, 누르면 레일 점유자를 'ai' 로 바꾼다.
 * 탐침 결과는 AssistantChat 이 레일 공급자에 싣는다(모듈 수준 상태 없음). 공급자 밖(옛 셸)·탐침 실패·404 면 null.
 */
export function useAiRailButton(): ReactNode | null {
  const rail = useRightRailOptional()
  const { t } = useLocale()
  if (!rail?.aiAvailable) return null
  return (
    <button type="button" data-ai-open aria-label={t('chat.open')} aria-expanded={rail.occupant === 'ai'} onClick={() => (rail.occupant === 'ai' ? rail.close('ai') : rail.open('ai'))}
      className="flex h-9 w-9 items-center justify-center rounded-(--radius-control) text-fg-secondary hover:bg-surface-hover hover:text-fg">
      <RobotMascot className="h-6 w-6" label={t('chat.open')} />
    </button>
  )
}

/**
 * AI 도우미(D33·D56). 1024 이상이고 레일 공급자·레일 자리(#app-rail 또는 WBS 전체 화면 안 자리)가 있으면 우측 레일 점유자 'ai' 로 그리고
 * FAB 를 그리지 않는다(진입은 전역 바 아이콘). 1024 미만이거나 레일 자리가 없으면(옛 셸) 지금의 FAB·떠 있는 패널 — FAB 는 저장 바·가상 키보드가
 * 보이는 동안 그리지 않는다. 대화 상태는 레일 밖(이 컴포넌트)에 있어 레일을 닫았다 열어도, 범위를 바꿔도 남는다.
 * 프로젝트 목록은 게시 저장소(현재 범위 워크스페이스의 가시 프로젝트 — 범위 레이아웃의 <ShellScope>)에서 읽는다.
 */
export function AssistantChat() {
  const { t } = useLocale()
  const assistantName = ASSISTANT_NAME.ko
  const router = useRouter()
  const pageContext = useCurrentBotPageContext()
  const currentProjectId = pageContext.projectId
  // 프로젝트 없는 질문의 범위(D26, 과제 34) — 화면 문맥이 셸 범위에서 고른 워크스페이스(프로젝트 화면이면 null). 모든 챗 요청에 싣는다
  const currentWorkspaceId = pageContext.workspaceId ?? null
  const scopeQuery = `projectId=${currentProjectId ?? ''}${currentWorkspaceId ? `&workspaceId=${encodeURIComponent(currentWorkspaceId)}` : ''}`
  // 보낼 수 있는 요청이 없는 화면 — 범위 경로(/w/·/p/)가 아니고 게시 범위도 없다(소속 0 등. (global) 은 레이아웃이 검증된 쿠키 워크스페이스를
  // 게시한다 — CC4). 범위 경로의 빈 순간(게시가 한 커밋 늦음)은 여기에 넣지 않는다 — /w/A → /w/B 전환마다 진입점이 깜박이지 않게
  const noScope = !currentProjectId && !currentWorkspaceId && parseScopePath(pageContext.pathname) === null
  const shellScope = useShellScope()
  const projectList = shellScope?.projects ?? []
  const currentProjectName = projectList.find(p => p.id === currentProjectId)?.name ?? null

  const rail = useRightRailOptional()
  const railHost = useRailHost()
  const wide = useMinWidth(1024)
  const railActive = !!rail && !!railHost && wide
  // 좁은 화면(레일 아님)에서 WBS 전체 화면이 열려 있으면 그 안의 레일 자리 — 떠 있는 패널을 거기로 포털해 전체 화면(120) 아래로 숨지 않게(AA3, D56)
  const fsHost = !railActive && railHost?.getAttribute('data-rail-host') === 'fullscreen' ? railHost : null
  const [openLocal, setOpenLocal] = useState(false)
  // 레일 모드의 열림 = 레일 점유자가 'ai'. 옛 모양의 열림 = 이 컴포넌트 상태. 둘은 setOpen 이 같이 맞춘다
  const open = railActive ? rail.occupant === 'ai' : openLocal
  const setOpen = useCallback((v: boolean) => {
    setOpenLocal(v)
    if (!rail) return
    if (v) rail.open('ai')
    else rail.close('ai')
  }, [rail])
  const setOpenRef = useRef(setOpen)
  setOpenRef.current = setOpen
  // 레일을 다른 점유자(인스펙터)가 가져가면 옛 모양 상태도 닫아 둔다 — 좁아졌을 때 패널이 혼자 다시 뜨지 않게
  useEffect(() => {
    if (railActive && rail.occupant !== 'ai') setOpenLocal(false)
    if (railActive && rail.occupant === 'ai') setOpenLocal(true)
  }, [railActive, rail?.occupant])
  // 전체 화면 안(좁은 화면)에서는 툴바 토글이 레일 API 로 연다·닫는다 — 점유자를 따라간다(AA3)
  useEffect(() => {
    if (fsHost && rail) setOpenLocal(rail.occupant === 'ai')
  }, [fsHost, rail, rail?.occupant])
  const fabHidden = useFabSuppressed(!railActive && !fsHost)
  const [collapsed, setCollapsed] = useState(false) // 접힘 = 알약 바만 표시. 대화·스트리밍은 그대로 유지
  const [ctx, setCtx] = useState<BotContext | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streamStatus, setStreamStatus] = useState<string | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)

  const idRef = useRef(0)
  const nextId = () => (idRef.current += 1)
  const loadedKeyRef = useRef<string | null>(null)
  const genRef = useRef(0) // 대화 세대 — 프로젝트 전환 시 증가, 진행 중 요청의 stale 결과를 폐기
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastCommandRef = useRef<string>('') // disambiguate 후속용 원문 보관
  const applyingRef = useRef<Set<number>>(new Set()) // 적용 왕복 중 재클릭 무시 — 낙관적 잠금 충돌 버블 오표시 방지
  const conversationStateRef = useRef<ConversationStateV1>(EMPTY_CONVERSATION_STATE)
  const streamAbortRef = useRef<AbortController | null>(null)
  const fabRef = useRef<HTMLButtonElement | null>(null)
  const wasOpenRef = useRef(false)

  // 패널 열림 + 프로젝트 컨텍스트 부트스트랩 (프로젝트가 바뀌면 새 대화로 갱신)
  useEffect(() => {
    if (!open) return
    const key = currentProjectId ?? 'none'
    if (loadedKeyRef.current === key) return // 이미 로드된 대화 → 닫았다 열어도 보존
    loadedKeyRef.current = key
    const gen = (genRef.current += 1) // 새 대화 세대 시작
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    conversationStateRef.current = EMPTY_CONVERSATION_STATE
    // 프로젝트 전환 = 새 대화. 이전 진행 중 send() 의 결과는 세대 불일치로 무시된다.
    setMessages([])
    setLoading(false)
    setStreamStatus(null)
    setInput('')
    setCtx(null)
    // 범위가 없으면 문맥을 묻지 않는다(서버 400) — 일반 환영문
    if (!currentProjectId && !currentWorkspaceId) {
      setMessages([{ id: nextId(), role: 'assistant', content: welcomeText(null, t) }])
      return
    }
    fetch(`/api/chat/context?${scopeQuery}`, { cache: 'no-store' })
      .then(r => (r.ok ? (r.json() as Promise<BotContext>) : null))
      .then(c => {
        if (genRef.current !== gen) return // 그 사이 프로젝트 전환 → 폐기
        setCtx(c)
        // 사용자가 그새 질문을 보냈으면(messages 비어있지 않음) 환영문구로 덮어쓰지 않는다.
        setMessages(prev => (prev.length ? prev : [{ id: nextId(), role: 'assistant', content: welcomeText(c, t) }]))
      })
      .catch(() => {
        if (genRef.current !== gen) return
        setMessages(prev => (prev.length ? prev : [{ id: nextId(), role: 'assistant', content: welcomeText(null, t) }]))
      })
    // t는 의도적으로 deps에서 제외 — 값이 바뀌지 않는다(고정 사전).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentProjectId])

  useEffect(() => () => streamAbortRef.current?.abort(), [])

  // 처음과 프로젝트·워크스페이스 전환 때 모듈 관문만 확인한다. 전환 중에는 이전 판정을 유지한다(404 만 닫는다).
  // 범위가 없으면 묻지 않는다 — 서버는 400 이고 추측하지 않는다(과제 34). 범위 없는 화면(noScope)이면 진입점을 닫는다(대화 상태는 이 컴포넌트에
  // 남는다 — 범위가 돌아오면 탐침이 다시 열고 이어진다, CC4). 범위 경로의 빈 순간은 판정을 바꾸지 않는다. 게시가 오면 다시 돈다
  useEffect(() => {
    if (noScope) { setOpenRef.current(false); setAvailable(false); return }
    if (!currentProjectId && !currentWorkspaceId) return
    let alive = true
    fetch(`/api/chat/context?${scopeQuery}&probe=1`, { cache: 'no-store' })
      .then((response) => {
        if (!alive) return
        if (response.status === 404) {
          streamAbortRef.current?.abort()
          setOpenRef.current(false)
          setAvailable(false)
        } else {
          setAvailable(true)
        }
      })
      .catch(() => { if (alive) setAvailable(true) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scopeQuery 는 두 값에서 만든다
  }, [currentProjectId, currentWorkspaceId, noScope])

  // 탐침 결과를 레일 공급자에 싣는다 — 전역 바 아이콘(useAiRailButton)·WBS 전체 화면 툴바 토글이 읽는다. 레일 API 로 열 수 있을 때만
  // (레일로 그리거나, 좁아도 전체 화면 안 자리가 있을 때 — AA3). 그 밖의 좁은 화면은 FAB 가 진입점
  const setAiAvailable = rail?.setAiAvailable
  const viaRailApi = railActive || !!fsHost
  useEffect(() => { setAiAvailable?.(available === true && viaRailApi) }, [setAiAvailable, available, viaRailApi])

  // 완전 닫기 — 접힘 상태도 리셋해 다음에 열 때는 펼친 상태로 시작
  const close = useCallback(() => {
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    setOpen(false)
    setCollapsed(false)
    setLoading(false)
    setStreamStatus(null)
  }, [setOpen])

  // 닫힘 시 포커스를 FAB 로 복귀 — 키보드/스크린리더 사용자가 포커스를 잃지 않게(a11y).
  // FAB 는 닫힌 뒤에야 다시 마운트되므로 렌더 커밋 후 시점(effect)에서 잡아야 한다.
  useEffect(() => {
    if (!open && wasOpenRef.current) fabRef.current?.focus()
    wasOpenRef.current = open
  }, [open])

  // Esc 닫기 (접힘 상태에서도 완전 닫기)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  // 메시지 추가 시 하단 스크롤 + 입력 포커스
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])
  useEffect(() => {
    if (open && !collapsed) inputRef.current?.focus()
  }, [open, collapsed])
  // 펼칠 때 — 재마운트된 스크롤 컨테이너는 scrollTop 0에서 시작하므로 즉시 맨 아래로
  useEffect(() => {
    if (open && !collapsed) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [open, collapsed])

  /**
   * 입력창 비우기 — setInput('') 만으로는 한글 IME 조합 중이던 마지막 글자가 입력창에
   * 되살아난다: React 상태를 비워도 브라우저의 조합(composition) 버퍼는 살아 있어서,
   * 다음 커밋 시점에 조합 중이던 글자를 빈 입력창에 다시 써 넣는다(전송 버튼 클릭은
   * 포커스를 뺏지 않아 조합이 안 끝난 채 남고, Enter 는 조합 확정과 전송이 겹친다).
   * blur 로 조합을 강제 종료(확정)시킨 뒤 DOM 값까지 직접 비우고 포커스를 되돌린다.
   * setInput('') 는 마지막에 — blur 가 확정분으로 onChange 를 한 번 더 발화시켜도 덮어쓴다.
   */
  const clearInput = useCallback(() => {
    const el = inputRef.current
    if (el) {
      el.blur()
      el.value = ''
      el.style.height = 'auto'
      el.focus()
    }
    setInput('')
  }, [])

  // 명령 제안 요청 — send()의 명령 분기와 후보 칩 선택(pickCandidate)이 공유
  const requestProposal = useCallback(
    async (message: string, targetId?: string) => {
      const gen = genRef.current
      setLoading(true)
      try {
        const res = await fetch('/api/chat/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: currentProjectId, workspaceId: currentWorkspaceId, message, targetId }),
        })
        if (!res.ok) return 'not_command' as const // 401/400 등은 스트리밍 경로의 기존 에러 처리로 폴백
        const proposal = (await res.json()) as CommandProposal
        if (genRef.current !== gen) return 'stale' as const
        if (proposal.kind === 'not_command') return 'not_command' as const
        const content =
          proposal.kind === 'proposal' ? t('chat.cmd.confirm')
          : proposal.kind === 'disambiguate' ? t('chat.cmd.disambiguate')
          : proposal.kind === 'not_found' ? t('chat.cmd.notFound').replace('{q}', () => proposal.targetQuery)
          : proposal.message
        setMessages(prev => [...prev, {
          id: nextId(), role: 'assistant', content,
          ...(proposal.kind === 'proposal' || proposal.kind === 'disambiguate'
            ? { proposal, proposalState: 'pending' as const } : {}),
        }])
        return 'handled' as const
      } catch {
        if (genRef.current !== gen) return 'stale' as const
        return 'not_command' as const // 명령 경로 실패 → 호출부가 스트리밍으로 폴백
      } finally {
        if (genRef.current === gen) setLoading(false) // ← 로딩 고착 방지 (stale이면 다른 세대 소유)
      }
    },
    [currentProjectId, currentWorkspaceId, t],
  )

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || loading) return
      const gen = genRef.current // 이 요청이 속한 대화 세대
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      setMessages(prev => [...prev, { id: nextId(), role: 'user', content: text }])
      clearInput()
      // 범위가 비어 있으면(게시가 한 커밋 늦은 순간 등) 보내지 않는다 — 서버 400 문구('워크스페이스를 지정해야 합니다')는 사용자가 어쩔 수 없는 말이다(CC4)
      if (!currentProjectId && !currentWorkspaceId) {
        setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: t('chat.error.noScope') }])
        return
      }
      if (isCommandUtterance(text)) {
        lastCommandRef.current = text
        const outcome = await requestProposal(text)
        if (outcome !== 'not_command') return // handled/stale — 스트리밍 경로 미진입
        // not_command → 아래 기존 스트리밍 경로 그대로 계속
      }
      setLoading(true)
      let asstId: number | null = null
      const abortController = new AbortController()
      streamAbortRef.current = abortController
      try {
        const request: ChatRequestV2 = {
          projectId: currentProjectId,
          workspaceId: currentWorkspaceId,
          message: text,
          history,
          pageContext,
          conversationState: conversationStateRef.current,
        }
        let res = await fetch('/api/chat/v2/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/x-ndjson',
          },
          body: JSON.stringify(request),
          signal: abortController.signal,
        })
        // 점진 배포 중 v2 라우트가 없는 서버에서는 기존 읽기 챗봇으로 즉시 강등한다.
        if ([404, 405, 501].includes(res.status)) {
          res = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId: currentProjectId, workspaceId: currentWorkspaceId, message: text, history }),
            signal: abortController.signal,
          })
        }
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          if (genRef.current !== gen) return
          setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: data.error ?? t('chat.error.generic') }])
          return
        }
        let acc = ''
        let sources: BotSource[] = []
        let asOf: string | undefined
        let asOfTimezone: string | undefined
        let tools: string[] | undefined
        let truncated: boolean | undefined

        const ensureAssistant = () => {
          if (asstId !== null) return asstId
          const id = nextId()
          asstId = id
          setMessages(prev => [...prev, {
            id,
            role: 'assistant',
            content: acc,
            ...(sources.length ? { sources } : {}),
            ...(asOf ? { asOf, asOfTimezone } : {}),
            ...(tools ? { tools } : {}),
            ...(truncated !== undefined ? { truncated } : {}),
          }])
          return id
        }
        const patchAssistant = () => {
          if (asstId === null) return
          const id = asstId
          setMessages(prev => prev.map(m => (m.id === id ? {
            ...m,
            content: acc,
            ...(sources.length ? { sources } : {}),
            ...(asOf ? { asOf, asOfTimezone } : {}),
            ...(tools ? { tools } : {}),
            ...(truncated !== undefined ? { truncated } : {}),
          } : m)))
        }
        const mergeSources = (items: BotSource[]) => {
          const byId = new Map(sources.map(source => [source.id, source]))
          for (const source of items) byId.set(source.id, source)
          sources = [...byId.values()]
          patchAssistant()
        }
        const onEvent = (event: ChatStreamEvent) => {
          if (genRef.current !== gen) throw new DOMException('Stale chat request', 'AbortError')
          switch (event.type) {
            case 'status':
              setStreamStatus(event.message)
              break
            case 'delta':
              acc += event.text
              ensureAssistant()
              patchAssistant()
              break
            case 'sources':
              mergeSources(event.items)
              break
            case 'state':
              conversationStateRef.current = event.conversationState
              break
            case 'done':
              asOf = event.asOf
              asOfTimezone = event.timezone
              tools = event.tools
              truncated = event.truncated
              patchAssistant()
              break
            case 'error':
              break
          }
        }

        const contentType = res.headers?.get('content-type') ?? ''
        if (contentType.includes('application/x-ndjson')) {
          const terminal = await consumeChatNdjson(res.body, onEvent)
          if (terminal.type === 'error') {
            setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: terminal.message }])
          } else if (asstId === null && genRef.current === gen) {
            setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: t('chat.error.empty') }])
          }
        } else {
          // text/plain 은 구형 스트림 또는 v2 서버의 명시적 하위 호환 응답이다.
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (genRef.current !== gen) {
              await reader.cancel()
              return
            }
            acc += decoder.decode(value, { stream: true })
            ensureAssistant()
            patchAssistant()
          }
          acc += decoder.decode()
          patchAssistant()
          if (asstId === null && genRef.current === gen) {
            setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content: t('chat.error.empty') }])
          }
        }
      } catch (error) {
        if (genRef.current !== gen) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        setMessages(prev => [
          ...prev,
          { id: nextId(), role: 'assistant', content: t('chat.error.retry') },
        ])
      } finally {
        if (streamAbortRef.current === abortController) streamAbortRef.current = null
        if (genRef.current === gen) {
          setLoading(false)
          setStreamStatus(null)
        }
      }
    },
    [messages, loading, currentProjectId, currentWorkspaceId, pageContext, clearInput, t, requestProposal],
  )

  const applyProposal = useCallback(
    async (msgId: number, p: Extract<CommandProposal, { kind: 'proposal' }>) => {
      if (applyingRef.current.has(msgId)) return // 왕복 중 재클릭 — 무시
      applyingRef.current.add(msgId)
      try {
        const mark = (state: 'applied' | 'cancelled') =>
          setMessages(prev => prev.map(m => (m.id === msgId ? { ...m, proposalState: state } : m)))
        const say = (content: string) =>
          setMessages(prev => [...prev, { id: nextId(), role: 'assistant', content }])
        // 원시 params·기대값(제안을 만들 때 본 값)은 applyCommandProposal 이 싣는다 — 확인을 누르는 사이 바뀐 값을 덮지 않는다(SPU1, 개정 §5.8)
        const result = await applyCommandProposal(p, { updateActual, updateWbsFields })
        if (result.ok) {
          mark('applied')
          say(t('chat.cmd.applied').replace('{name}', () => p.target.name).replace('{changes}', () => p.changes.map(c => `${c.label} ${c.after}`).join(', ')))
          router.refresh()
        } else if (result.conflict) {
          // 제안이 낡았다 — 쓰지 않았다. 서버의 현재 값을 말해 주고 화면을 다시 읽는다(낡은 제안은 닫아 다시 누를 수 없게 한다)
          mark('cancelled')
          const latest = result.latestText ?? ''
          say(t('chat.cmd.conflict').replace('{name}', () => p.target.name)
            .replace('{latest}', () => (latest ? t('chat.cmd.conflictLatest').replace('{v}', () => latest) : '')))
          router.refresh()
        } else {
          mark('cancelled')
          say(t('chat.cmd.failed').replace('{error}', () => result.error ?? t('chat.cmd.unknownError'))) // 서버 액션의 한국어 에러 그대로 — AI도 권한을 우회하지 못한다
        }
      } finally {
        applyingRef.current.delete(msgId)
      }
    },
    [router, t],
  )

  const pickCandidate = useCallback((c: CommandCandidate) => {
    // 되묻기 후속: 같은 명령 원문 + targetId 재요청 (requestProposal 재사용)
    void requestProposal(lastCommandRef.current, c.id)
  }, [requestProposal])

  const cancelProposal = useCallback((msgId: number) => {
    setMessages(prev => prev.map(m => (m.id === msgId ? { ...m, proposalState: 'cancelled' } : m)))
  }, [])

  const reset = () => {
    // 진행 중 스트림이 있으면 폐기한다 — 세대를 올리면 send() 루프가 reader.cancel() 후 중단하고,
    // 늦게 도착한 토큰이 새 대화에 끼어들지 않는다. 로딩도 직접 해제(스트림 finally 는 옛 세대라 건너뜀).
    genRef.current += 1
    streamAbortRef.current?.abort()
    streamAbortRef.current = null
    conversationStateRef.current = EMPTY_CONVERSATION_STATE
    setLoading(false)
    setStreamStatus(null)
    clearInput()
    setMessages([{ id: nextId(), role: 'assistant', content: welcomeText(ctx, t) }])
  }

  const onInputKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 IME 조합 중의 Enter 는 '조합 확정' 키다 — 이때 전송하면 마지막 글자가 잘리거나
    // 조합 버퍼가 입력창에 남는다. 조합이 끝난 Enter 만 전송으로 처리한다.
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }
  const onInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  if (available !== true) return null

  // 머리 — 레일 모드에서는 접기(알약 바)가 없다(레일 닫기가 같은 일을 하고 대화는 남는다)
  const panelHeader = (withCollapse: boolean) => (
          <header className="flex items-center gap-3 border-b border-border bg-surface-raised px-4 py-3.5 text-fg">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-subtle ring-1 ring-border">
              <RobotMascot className="h-8 w-8" label={assistantName} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold leading-tight">{assistantName}</div>
              <div className="truncate text-xs text-fg-muted">{currentProjectName ?? t('nav.allProjects')}</div>
            </div>
            {withCollapse && (
              <button
                onClick={() => setCollapsed(true)}
                aria-label={t('chat.collapse')}
                className="flex h-9 w-9 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={reset}
              aria-label={t('chat.reset')}
              className="flex h-9 w-9 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              onClick={close}
              aria-label={t('common.close')}
              className="flex h-9 w-9 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover hover:text-fg"
            >
              <X className="h-4 w-4" />
            </button>
          </header>
  )

  const panelBody = (
        <>
          {/* 본문 — aria-live: 새 봇 응답을 스크린리더가 낭독(polite = 사용자 발화 중 끼어들지 않음) */}
          <div ref={scrollRef} aria-live="polite" className="flex-1 space-y-3 overflow-y-auto bg-canvas px-4 py-4">
            {/* 프로액티브 인사이트 */}
            {ctx?.currentProject && (
              <div className="rounded-2xl border border-border-focus/40 bg-action-soft/50 p-3.5">
                <div className="flex items-center gap-1.5 text-[13px] font-semibold text-action">
                  <Sparkles className="h-4 w-4" /> {t('chat.insight.title')}
                </div>
                <p className="mt-1.5 text-[13px] leading-5 text-fg-secondary">
                  {ctx.weekStartCount > 0
                    ? `${t('chat.insight.weekPrefix')}${ctx.weekStartCount}${t('chat.insight.weekSuffix')}`
                    : t('chat.insight.none')}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <button
                    onClick={() => send('이번 주 시작 작업 알려줘')}
                    disabled={loading}
                    className="inline-flex items-center gap-1 rounded-full bg-action px-3 py-1.5 text-xs font-medium text-action-fg transition hover:bg-action-hover disabled:opacity-50"
                  >
                    <CalendarDays className="h-3.5 w-3.5" /> {t('chat.chip.weekStartPrefix')}
                    {ctx.weekStartCount}
                    {t('chat.chip.weekStartSuffix')}
                  </button>
                  <button
                    onClick={() => send('주간 요약')}
                    disabled={loading}
                    className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-fg-secondary transition hover:border-border-focus hover:text-action disabled:opacity-50"
                  >
                    {t('chat.chip.weeklySummary')}
                  </button>
                </div>
              </div>
            )}

            {/* 빠른 질문 칩 */}
            <div className="flex flex-wrap gap-1.5">
              {QUICK_SUGGESTIONS.map(q => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  disabled={loading}
                  className="rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] text-fg-secondary transition hover:border-border-focus hover:text-action disabled:opacity-50"
                >
                  {SUGGESTION_LABEL_KEY[q] ? t(SUGGESTION_LABEL_KEY[q]) : q}
                </button>
              ))}
            </div>

            {/* 메시지 */}
            {messages.map(m =>
              m.proposal ? (
                <div key={m.id} className="space-y-1.5">
                  <Bubble role="assistant" content={m.content} />
                  <ProposalCard msg={m} onApply={applyProposal} onPick={pickCandidate} onCancel={cancelProposal} />
                </div>
              ) : (
                <Bubble
                  key={m.id}
                  role={m.role}
                  content={m.content}
                  sources={m.sources}
                  asOf={m.asOf}
                  asOfTimezone={m.asOfTimezone}
                  truncated={m.truncated}
                />
              ),
            )}
            {/* 첫 토큰 도착 전(마지막 메시지가 사용자)에만 타이핑 표시 — 이후엔 버블이 스트리밍됨 */}
            {loading && messages[messages.length - 1]?.role !== 'assistant' && <TypingBubble message={streamStatus} />}
          </div>

          {/* 입력 */}
          <footer className="border-t border-border bg-surface px-3 py-3">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                data-autofocus
                value={input}
                onChange={onInputChange}
                onKeyDown={onInputKey}
                rows={1}
                placeholder={t('chat.inputPlaceholder')}
                aria-label={t('chat.inputAria')}
                className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-border bg-canvas px-3.5 py-3 text-sm text-fg outline-none transition placeholder:text-fg-muted focus:border-action focus:ring-2 focus:ring-border-focus"
              />
              <button
                onClick={() => send(input)}
                disabled={!input.trim() || loading}
                aria-label={t('chat.send')}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-action text-action-fg transition hover:bg-action-hover disabled:opacity-40"
              >
                <Send className="h-5 w-5" />
              </button>
            </div>
          </footer>
        </>
  )

  if (railActive) {
    return open ? (
      <RightRail occupant="ai" title={t('chat.dialog')} onClose={close} header={panelHeader(false)}>
        {panelBody}
      </RightRail>
    ) : null
  }

  const floating = (
    <>
      {/* ── FAB ── 층은 레일(--z-rail): 오버레이·전체 화면·모달 아래(z 대응표 §1). 저장 바·가상 키보드가 보이면 그리지 않는다.
          전체 화면 안에서는 그리지 않는다 — 진입점은 전체 화면 툴바의 AI 토글(AA3) */}
      {!open && !fabHidden && !fsHost && (
        <button
          ref={fabRef}
          onClick={() => setOpen(true)}
          aria-label={t('chat.open')}
          aria-haspopup="dialog"
          className="fixed bottom-16 right-5 z-(--z-rail) flex h-[52px] w-[52px] items-center justify-center rounded-full border border-border bg-surface-raised text-fg transition hover:scale-105 active:scale-95"
          style={{ boxShadow: 'var(--shadow-popover)' }}
        >
          <RobotMascot className="h-9 w-9" label={assistantName} />
          {ctx && ctx.weekStartCount > 0 && (
            <span className="absolute right-1 top-1 h-3 w-3 rounded-full border-2 border-surface-raised bg-action" />
          )}
        </button>
      )}

      {/* ── 접힌 바 ── 바 전체가 펼치기 버튼. 대화는 뒤에서 그대로 유지된다 */}
      {open && collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          aria-label={t('chat.expand')}
          className="fixed bottom-16 right-5 z-(--z-rail) flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 border border-border bg-surface-raised text-fg transition hover:bg-surface-hover active:scale-95"
          style={{ boxShadow: 'var(--shadow-popover)' }}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-subtle ring-1 ring-border">
            <RobotMascot className="h-6 w-6" label={assistantName} />
          </span>
          <span className="text-sm font-bold">{assistantName}</span>
          {/* 응답 스트리밍 중 표시점 — 접혀 있어도 진행 상황을 알 수 있게 */}
          {loading && <span className="h-2 w-2 animate-pulse rounded-full bg-action" />}
          <ChevronUp className="h-4 w-4 text-fg-secondary" />
        </button>
      )}

      {/* ── 패널 ── */}
      {open && !collapsed && (
        <div
          role="dialog"
          aria-label={t('chat.dialog')}
          className="fixed bottom-16 right-5 z-(--z-rail) flex h-[min(720px,calc(100dvh-5.25rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-border bg-surface"
          style={{ boxShadow: 'var(--shadow-xl)' }}
        >
          {panelHeader(true)}
          {panelBody}
        </div>
      )}
    </>
  )
  // 전체 화면이 열려 있으면 그 안의 레일 자리(스태킹 맥락 안 --z-rail)에 그린다 — 밖에 두면 전체 화면 층 아래로 숨는다(AA3)
  return fsHost ? createPortal(floating, fsHost) : floating
}

function Bubble({
  role, content, sources, asOf, asOfTimezone, truncated,
}: {
  role: Role
  content: string
  sources?: BotSource[]
  asOf?: string
  asOfTimezone?: string
  truncated?: boolean
}) {
  const { t } = useLocale()
  const isUser = role === 'user'
  const safeSources = isUser ? [] : (sources ?? []).filter(source => isSafeInternalBotHref(source.href))
  const citedIds = [...content.matchAll(/\[(S\d+)]/g)].map(match => match[1])
  const sourceById = new Map(safeSources.map(source => [source.id, source]))
  const visibleSources = [
    ...citedIds.flatMap(id => sourceById.get(id) ? [sourceById.get(id)!] : []),
    ...safeSources,
  ].filter((source, index, all) => all.findIndex(item => item.id === source.id) === index).slice(0, 12)
  const hiddenSourceCount = safeSources.length - visibleSources.length
  return (
    <div data-chat-role={role} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
          isUser
            ? 'rounded-br-md bg-action text-action-fg'
            : 'rounded-bl-md border border-border-focus/30 bg-action-soft/50 text-fg'
        }`}
      >
        {content}
        {!isUser && (safeSources.length > 0 || (asOf && asOfTimezone) || truncated) && (
          <div className="mt-2 border-t border-border-focus/30 pt-2 text-meta text-fg-muted">
            {visibleSources.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label={t('chat.sources.aria')}>
                {visibleSources.map(source => (
                  <a
                    key={source.id}
                    href={source.href}
                    className="max-w-full truncate rounded-full border border-border-focus/40 bg-surface px-2 py-1 text-action transition hover:border-action hover:underline"
                    title={source.excerpt ?? source.title}
                  >
                    {source.id} · {source.title}
                  </a>
                ))}
                {hiddenSourceCount > 0 && (
                  <span className="rounded-full border border-border-focus/30 px-2 py-1">
                    {t('chat.sources.more').replace('{n}', String(hiddenSourceCount))}
                  </span>
                )}
              </div>
            )}
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
              {asOf && asOfTimezone && <span>{t('chat.asOf').replace('{time}', formatAsOf(asOf, asOfTimezone)).replace('{tz}', () => asOfTimezone)}</span>}
              {truncated && <span>{t('chat.truncated')}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 봇 답의 기준 시각 — 그 응답의 요청 범위 tz 로 찍는다(서울로 대체하지 않는다, 계획 D-21b) */
function formatAsOf(value: string, timeZone: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(KO_LOCALE, { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(date)
}

function ProposalCard({
  msg, onApply, onPick, onCancel,
}: {
  msg: Msg
  onApply: (msgId: number, p: Extract<CommandProposal, { kind: 'proposal' }>) => void
  onPick: (c: CommandCandidate) => void
  onCancel: (msgId: number) => void
}) {
  const { t } = useLocale()
  const p = msg.proposal
  if (!p || (p.kind !== 'proposal' && p.kind !== 'disambiguate')) return null
  const disabled = msg.proposalState !== 'pending'
  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-border-focus/30 bg-action-soft/50 px-3.5 py-2.5 text-[13px] leading-relaxed text-fg">
        {p.kind === 'proposal' ? (
          <>
            <div className="font-medium">{p.target.name}</div>
            <div className="mt-0.5 text-[12px] text-fg-secondary">
              {t('chat.proposal.target').replace('{group}', () => p.target.phaseName).replace('{owners}', () => p.target.ownersText)}
            </div>
            <ul className="mt-1.5 space-y-0.5">
              {p.changes.map(c => (
                <li key={c.field}>
                  {c.label}: <span className="line-through opacity-60">{c.before}</span>
                  {' → '}<span className="font-semibold text-action">{c.after}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-1.5">
              <button
                onClick={() => onApply(msg.id, p)}
                disabled={disabled}
                className="inline-flex items-center gap-1 rounded-full bg-action px-3 py-1.5 text-xs font-medium text-action-fg transition hover:bg-action-hover disabled:opacity-50"
              >
                {t('chat.proposal.apply')}
              </button>
              <button
                onClick={() => onCancel(msg.id)}
                disabled={disabled}
                className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-fg-secondary transition hover:border-border-focus disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
            </div>
            {msg.proposalState === 'applied' && <div className="mt-1.5 text-[12px] text-fg-muted">{t('chat.proposal.applied')}</div>}
            {msg.proposalState === 'cancelled' && <div className="mt-1.5 text-[12px] text-fg-muted">{t('chat.proposal.cancelled')}</div>}
          </>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {p.candidates.map(c => (
              <button
                key={c.id}
                onClick={() => onPick(c)}
                disabled={disabled}
                className="rounded-full border border-border bg-surface px-3 py-1.5 text-[12.5px] text-fg-secondary transition hover:border-border-focus hover:text-action disabled:opacity-50"
              >
                {c.name} <span className="opacity-60">({c.phaseName})</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TypingBubble({ message }: { message?: string | null }) {
  return (
    <div className="flex justify-start">
      <div className="rounded-2xl rounded-bl-md border border-border-focus/30 bg-action-soft/50 px-4 py-3">
        <div className="flex items-center gap-1">
          {[0, 1, 2].map(i => (
            <span
              key={i}
              className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg-muted"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
        {message && <div className="mt-1.5 max-w-64 text-meta text-fg-muted">{message}</div>}
      </div>
    </div>
  )
}
