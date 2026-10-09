// members 영어 사전 — ko 파일과 물리 분리(웹팩이 En 을 클라이언트 공통 청크에 싣지 않도록).
// 키 패리티는 import type 으로만 강제한다 — 값 import 를 넣으면 분리가 무효가 된다.
import type { membersKo } from './members'

export const membersEn: Record<keyof typeof membersKo, string> = {
  'members.projectFallback': 'Project',
  'members.heroTitleSuffix': 'team',
  'members.heroDesc': 'The participant roster behind attendance and meeting attendees.',
  'members.kpiTeamSizeSub': 'Active participants',
  'members.kpiAdminsSub': 'Admin access',
  'members.kpiUnlinkedSub': 'No linked account (external)',
  'members.sectionManage': 'Roster & access',
  'members.sectionRoster': 'Participants',
  'members.manageHint': 'One row per person. A person can belong to several teams; the primary team comes first. Access (none/member/admin) is set on the same row, and each row is saved on its own. People with records cannot be removed — mark them inactive instead.',
  'members.invite.noDomainsAdmin': 'Invites cannot be sent right now because no invite domains are allowed. Set the email domains to invite in workspace settings first.',
  'members.invite.noDomainsAsk': 'Invites cannot be sent right now because no invite domains are allowed. Ask a workspace admin to set the allowed invite domains.',
  'members.invite.openWorkspaceSettings': 'Open workspace settings',
}
