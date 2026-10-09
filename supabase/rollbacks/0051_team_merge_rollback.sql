-- 0051 롤백 — 팀 병합 RPC 와 영향 건수 함수를 지운다. 앱이 이 함수들을 부르는 동안 지우면 "다른 팀으로 합치기"가 실패하므로 앱을 먼저 되돌린다.
-- 되돌리지 않는 데이터: 이미 한 병합(옮긴 담당·명단·영역·회의록·폴더·초대·자격증명과 비활성이 된 원본 팀) — 어느 참조가 원본 것이었는지 남지 않는다.
begin;
drop function if exists public.merge_teams(uuid, uuid, uuid);
drop function if exists public.team_reference_counts(uuid);
commit;
