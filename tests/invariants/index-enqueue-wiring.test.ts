// 증분 색인 배선의 닫힌 목록(SP8 — 정본 §5.4.5). 색인 대상(WBS 항목·주간 문서·회의·공지·이슈·회의록)을 쓰는 경로가 쓰기 성공 뒤에
// 등록 도우미(@/lib/ai/index/enqueueChange)를 부르는지 파일·함수 단위로 고정한다. 새 쓰기 경로를 더하면 여기에 적는다 —
// 빠진 경로는 ai-index 의 consistency 모드가 메우지만, 그것은 안전망이지 정상 경로가 아니다.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const HELPERS = ['enqueueIndexChange', 'enqueueMinuteIndexChange', 'enqueueWeeklyRowIndexChange', 'enqueueWeeklyAreaIndexChange', 'enqueueTeamRenameIndexChange', 'enqueueProjectIndexChange'] as const
const HELPER_FILE = 'src/lib/ai/index/enqueueChange.ts'

/** 파일 → 등록을 부르는 함수(최상위 선언 이름)와 그 횟수 */
const WIRED: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  'src/app/actions/announcements.ts': { createAnnouncement: 1, updateAnnouncement: 1, deleteAnnouncement: 1, createAnnouncementFromMeeting: 1 },
  'src/app/actions/meetings.ts': { createMeeting: 1, updateMeeting: 1, deleteMeeting: 1 },
  'src/lib/minutes/meetings.ts': { resolveOrCreateExternalMeeting: 1 },
  'src/app/actions/issues.ts': { createIssue: 1, createIssueFromMinuteBlock: 1, updateIssue: 1, updateIssueProgress: 1, deleteIssue: 1 },
  'src/app/actions/issueUpdates.ts': { syncResolutionNoteMirror: 1 },
  'src/app/actions/customFieldValues.ts': { saveCustomFieldValues: 2 },
  'src/app/actions/weekly.ts': { createWeeklyReport: 1, saveWeeklyTitle: 1, touchWeeklyReports: 1 },
  // 주간 영역 개명 — 그 영역의 행이 든 주간 문서의 본문(영역 이름)이 낡는다
  'src/app/actions/projectAreas.ts': { upsertArea: 1 },
  // 팀 개명 — 그 팀이 담당인 WBS 항목·그 팀의 회의록의 본문(팀 이름)이 낡는다
  'src/app/actions/teams.ts': { updateTeam: 1 },
  'src/app/actions/projectTeams.ts': { updateProjectTeam: 1 },
  'src/app/actions/wbs.ts': { updateActual: 1, addWbsItem: 1, addSubAct: 1, updateWbsFields: 1, updateDeliverable: 1, deleteWbsItem: 1 },
  'src/app/actions/wbsBulk.ts': { updateWbsItems: 1 },
  'src/lib/agent/workflowEvent.ts': { applyWorkflowEvent: 1 },
  'src/lib/agent/wbsImport.ts': { runWbsImport: 1 },
  'src/app/api/import/execute/route.ts': { POST: 1 },
  'src/app/actions/minutes.ts': { createMinute: 1, replaceMinuteBody: 1, recordMinuteFile: 1 },
  'src/app/api/v1/minutes/route.ts': { handleExisting: 1, insertNew: 1 },
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : [])
}

/** 최상위 함수 선언마다 등록 도우미 호출 수 */
function callsByFunction(file: string): Record<string, number> {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const out: Record<string, number> = {}
  for (const statement of sf.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name) continue
    let count = 0
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (HELPERS as readonly string[]).includes(node.expression.text)) count += 1
      ts.forEachChild(node, visit)
    }
    visit(statement)
    if (count > 0) out[statement.name.text] = count
  }
  return out
}

describe('증분 색인 배선', () => {
  it.each(Object.entries(WIRED))('%s — 적힌 함수가 쓰기 뒤에 등록을 부른다', (file, expected) => {
    expect(callsByFunction(file)).toEqual(expected)
  })

  it('등록 도우미를 부르는 src 파일은 위 목록뿐이다(목록 밖 호출 0 — 더하면 여기에 적는다)', () => {
    const callers = files('src').filter((f) => f !== HELPER_FILE && HELPERS.some((h) => readFileSync(f, 'utf8').includes(`${h}(`))).sort()
    expect(callers).toEqual(Object.keys(WIRED).sort())
  })

  it('호출부는 도우미를 한 곳에서 import 한다 — 큐 어댑터·등록 RPC 를 액션이 직접 들지 않는다', () => {
    for (const file of Object.keys(WIRED)) {
      const text = readFileSync(file, 'utf8')
      expect(text, file).toContain("from '@/lib/ai/index/enqueueChange'")
      expect(text, file).not.toMatch(/upsert_ai_index_jobs|createSupabaseIndexJobQueue/)
    }
  })

  it('도우미는 배포 가용 판정을 클라이언트 생성보다 먼저 한다 — 챗봇이 없는 배포에서 쓰기 경로에 비용을 더하지 않는다', () => {
    const text = readFileSync(HELPER_FILE, 'utf8')
    for (const name of HELPERS) {
      const body = text.slice(text.indexOf(`export async function ${name}(`) >= 0 ? text.indexOf(`export async function ${name}(`) : text.indexOf(`export function ${name}(`))
      const head = body.slice(0, body.indexOf('\n}\n'))
      // 회의록 입구는 enqueueIndexChange 로 넘긴다 — 판정은 거기서 한다
      if (name === 'enqueueMinuteIndexChange') { expect(head).toContain('enqueueIndexChange('); continue }
      const gate = head.indexOf('indexEnqueueAvailable()')
      expect(gate, name).toBeGreaterThan(-1)
      const client = head.indexOf('createAdminClient(')
      if (client !== -1) expect(gate, name).toBeLessThan(client)
    }
  })
})
