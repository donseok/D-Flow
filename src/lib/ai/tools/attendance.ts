import { attendanceHref } from '@/lib/ai/chat/deep-links'
import { compareKoreanName } from '@/lib/domain/nameSort'
import type { AttendanceRecord, AttendanceType, TeamCode } from '@/lib/domain/types'
import type { AttendanceRepository } from '@/lib/repositories/types'
import {
  checkProjectAccess,
  invalidArgument,
  isIsoDate,
  isRecord,
  readLimit,
  readOptionalString,
  readRequiredString,
  repositoryFailure,
  repositoryScopeViolation,
  validDateRange,
} from './common'
import type { BotSource, ReadOnlyBotTool } from './types'
import type { ToolTeamSource } from './teamSource'
import type { ToolVocabSource } from './vocabSource'
import { summarizeAttendance, vocabLabel, VOCAB_CODE_RE } from '@/lib/settings/vocab'

const ATTENDANCE_CAPABILITY = 'attendance:read' as const
/** 한 번에 거를 수 있는 유형 수 상한 — 어휘 목록 상한(parseVocab 50)과 같다 */
const TYPES_MAX = 50

export interface AttendanceToolRecord {
  id: string
  projectId: string
  memberId: string
  memberName: string
  teamCodes: TeamCode[]
  date: string
  type: AttendanceType
}

function parseTypes(value: unknown): AttendanceType[] | null | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.length > TYPES_MAX) return null
  // 형식만 — 그 프로젝트의 유형인지는 접근 판정 뒤 설정(attendance.types)으로 본다
  const types = value.filter((item): item is AttendanceType =>
    typeof item === 'string' && VOCAB_CODE_RE.test(item),
  )
  return types.length === value.length ? [...new Set(types)] : null
}

export function createGetAttendanceTool(
  repository: AttendanceRepository,
  teams: ToolTeamSource,
  vocab: ToolVocabSource,
): ReadOnlyBotTool<AttendanceToolRecord> {
  return {
    name: 'get_attendance',
    requiredCapability: ATTENDANCE_CAPABILITY,
    async execute(args, context) {
      if (!isRecord(args)) return invalidArgument()
      const projectId = readRequiredString(args.projectId)
      const from = isIsoDate(args.from) ? args.from : null
      const to = isIsoDate(args.to) ? args.to : null
      const team = readOptionalString(args.team, 30)
      const memberId = readOptionalString(args.memberId)
      const types = parseTypes(args.types)
      const limit = readLimit(args.limit)
      if (!projectId || !from || !to || team === null || memberId === null || types === null || limit === null) {
        return invalidArgument()
      }
      if (!validDateRange(from, to)) return invalidArgument('근태 조회 기간이 올바르지 않습니다.')
      const denied = checkProjectAccess(context, projectId, ATTENDANCE_CAPABILITY)
      if (denied) return denied
      // 담당팀은 접근 판정 뒤에 본다 — 먼저 보면 볼 수 없는 프로젝트의 팀 구성이 검증 결과로 샌다(팀 목록).
      if (team && !(await teams.projectTeamCodes(projectId)).includes(team)) {
        return invalidArgument('알 수 없는 담당팀입니다.')
      }
      // 근태 유형 = 이 프로젝트의 설정 어휘(B4) — 집계 분류(counts_as)·라벨도 여기서. 팀처럼 접근 판정 뒤에 읽는다
      const typeDefs = await vocab.projectVocab(projectId, 'attendance.types')
      if (types && types.some(type => !typeDefs.some(def => def.code === type))) {
        return invalidArgument('알 수 없는 근태 유형입니다.')
      }

      const repoResult = await repository.listRecords(projectId, from, to)
      if (!repoResult.ok) return repositoryFailure(repoResult)
      if (repoResult.data.some(record => record.projectId !== projectId)) {
        return repositoryScopeViolation()
      }
      const matched = repoResult.data.filter(record => {
        if (team && !record.teamCodes.includes(team)) return false
        if (memberId && record.memberId !== memberId) return false
        if (types && !types.includes(record.type)) return false
        return true
      })
      // 리포지토리는 날짜순만 보장한다 — 같은 날짜 안의 이름 순서는 미정.
      // limit 로 자르기 전에 이름 가나다순으로 고정해야 '앞쪽 N건'이 매번 같은 답이 된다.
      const ordered = [...matched].sort((a, b) =>
        a.date.localeCompare(b.date) || compareKoreanName(a.memberName, b.memberName))
      const records: AttendanceToolRecord[] = ordered.slice(0, limit)
      const summaryInput: AttendanceRecord[] = matched.map(record => ({
        id: record.id,
        projectId: record.projectId,
        memberId: record.memberId,
        date: record.date,
        type: record.type,
        note: null,
      }))
      const counts = summarizeAttendance(typeDefs, summaryInput)
      // 출처는 조회 조건을 그대로 복원한다. 복수 type 조회는 화면 필터로 재현할 수 없어 생략.
      const href = attendanceHref(projectId, {
        from,
        to,
        team: team || undefined,
        type: types && types.length === 1 ? types[0] : undefined,
      })
      const sources: BotSource[] = records.map(record => ({
        id: `attendance:${record.id}`,
        domain: 'attendance',
        entityType: 'attendance_record',
        entityId: record.id,
        projectId,
        title: `${record.date} ${record.memberName} · ${vocabLabel('attendance.types', typeDefs, record.type)}`,
        href,
        updatedAt: null,
      }))
      const truncated = matched.length > records.length
      return {
        ok: true,
        result: {
          status: truncated ? 'partial' : 'ok',
          facts: {
            totalMatched: matched.length,
            returned: records.length,
            memberCount: new Set(matched.map(record => record.memberId)).size,
            leave: counts.leave,
            trip: counts.trip,
            remote: counts.remote,
            rangeFrom: from,
            rangeTo: to,
          },
          records,
          sources,
          asOf: context.now,
          truncated,
          warnings: truncated ? [`근태 기록 ${matched.length}건 중 ${records.length}건만 반환했습니다.`] : [],
        },
      }
    },
  }
}
