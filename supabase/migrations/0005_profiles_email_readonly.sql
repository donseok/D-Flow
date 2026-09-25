-- 0005_profiles_email_readonly — 세션(authenticated)이 자기 profiles 행의 email·user_id 를 바꾸지 못하게 한다.
--
-- 0003 은 profiles_update_own(using/with check user_id = auth.uid()) 과 함께 표 전체 권한(grant all)을 authenticated 에 줬다.
-- 그래서 로그인한 사용자가 PostgREST 로 자기 행의 email 을 아무 값으로 바꿀 수 있었다. SP1 이 profiles.email 을 신원 키로
-- 올렸으므로(초대 미리보기·가입·계정 생성·consume_project_invite 의 unique(email), 외부 회의록 API 의 user_email 해석)
-- 남의 이메일을 선점하면 그 사람의 합류가 23505 로 막히고, 외부 API 의 user_email 이 선점자로 해석된다(SP1 최종 리뷰 I1).
--
-- 바꾼 것: authenticated 의 표 단위 update 를 회수하고, 본인이 고칠 수 있는 컬럼(display_name, updated_at)만 컬럼 단위로 준다.
-- email·user_id·created_at 은 세션으로 못 바꾼다(42501). RLS 정책(profiles_update_own)은 그대로 둔다 — 행 범위는 정책이,
-- 컬럼 범위는 권한이 맡는다. 앱은 profiles 를 세션으로 쓰지 않는다(쓰기는 전부 service_role·security definer — 2026-09-26 grep).
-- anon 의 표 권한은 건드리지 않는다(anon 용 정책이 없어 RLS 가 막는다).
-- 롤백: supabase/rollbacks/0005_profiles_email_readonly_rollback.sql.

revoke update on table public.profiles from authenticated;
grant update (display_name, updated_at) on table public.profiles to authenticated;
