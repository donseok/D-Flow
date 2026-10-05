// 토글되는 모듈이 "소유" 한 데이터 표 → 어느 모듈 관문이 닫아야 하는 데이터인가(deny.test.ts 의 null 항목 축·deny.routes.test.ts 의 무관문 갈래 축이 공유한다).
// 관리 목록이다 — 표가 늘면 여기 한 줄을 더한다(새 표가 모듈 소유가 아니라면 더하지 않는다).
import type { ModuleId } from '@/lib/modules/defaults'

export const MODULE_TABLE_OWNER: Readonly<Record<string, ModuleId>> = {
  meetings: 'meetings', meeting_attendees: 'meetings', meeting_exceptions: 'meetings',
  weekly_reports: 'weekly', weekly_report_rows: 'weekly',
  issues: 'issues', issue_assignees: 'issues', issue_attachments: 'issues', issue_links: 'issues',
  issue_major_processes: 'issues', issue_number_counters: 'issues', issue_updates: 'issues',
  issue_analysis_runs: 'issue_analysis',
  wiki_items: 'wiki', wiki_topics: 'wiki', wiki_questions: 'wiki', wiki_item_relations: 'wiki', wiki_item_sources: 'wiki',
  wiki_change_events: 'wiki', wiki_feedback: 'wiki', wiki_processing_jobs: 'wiki', wiki_project_rebuild_jobs: 'wiki',
  wiki_topic_revisions: 'wiki', ai_documents: 'wiki', ai_index_jobs: 'wiki',
  announcements: 'announcements', announcement_seen: 'announcements',
  attendance_records: 'attendance',
  agent_projects: 'agents', agent_runners: 'agents', agent_work_orders: 'agents', agent_work_reports: 'agents',
  agent_lead_leases: 'agents', agent_watchers: 'agents',
  minutes: 'minutes', minute_folders: 'minutes', minute_files: 'minutes', minute_highlights: 'minutes',
  minute_insights: 'minutes', minute_versions: 'minutes', minute_favorites: 'minutes', minute_embeddings: 'minutes',
  usage_events: 'usage',
}
