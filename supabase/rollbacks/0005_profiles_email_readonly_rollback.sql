-- 0005_profiles_email_readonly 롤백 — authenticated 의 profiles 권한을 0003 적용 직후 상태로 되돌린다.
--
-- 0003 직후: 표 단위 arwdDxtm(grant all), 컬럼 단위 ACL 없음(2026-09-26 로컬 카탈로그 확인 — pg_attribute.attacl 전부 null).
-- 컬럼 권한을 먼저 회수해 컬럼 ACL 을 비운 뒤 표 단위 update 를 다시 준다.
-- 되돌린 상태는 결함 그대로다: 세션이 자기 행의 email·user_id 를 바꿀 수 있다.

revoke update (display_name, updated_at) on table public.profiles from authenticated;
grant update on table public.profiles to authenticated;
