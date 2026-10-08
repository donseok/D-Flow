/** 배포·플랫폼 운영 설정의 이름과 소유 파일만 기록한다. 값이나 비밀은 이 목록에 넣지 않는다. */
export interface OperationalDef {
  name: string
  kind: 'env' | 'env_public' | 'table'
  editor: '운영자' | '플랫폼 관리자'
  apply: 'restart' | 'rebuild' | 'immediate'
  secret: boolean
  owner: readonly string[]
}

const env = (names: readonly string[], owner: readonly string[], opts: { secret?: readonly string[]; public?: boolean; apply?: 'restart' | 'rebuild' } = {}): OperationalDef[] =>
  names.map(name => ({ name, kind: opts.public ? 'env_public' : 'env', editor: '운영자',
    apply: opts.apply ?? (opts.public ? 'rebuild' : 'restart'), secret: opts.secret?.includes(name) ?? false, owner }))

export const OPERATIONAL_SETTINGS: readonly OperationalDef[] = [
  ...env(['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_AUTH', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM_ADDRESS'],
    ['src/lib/mail/transport.ts'], { secret: ['SMTP_USER', 'SMTP_PASS'] }),
  ...env(['MAIL_FROM_NAME'], ['src/lib/mail/fromName.ts', 'src/lib/settings/workspaceConfig.ts']),
  ...env(['INVITE_ALLOWED_DOMAINS'], ['src/lib/settings/workspaceConfig.ts']),
  ...env(['NEXT_PUBLIC_BRAND_NAME', 'NEXT_PUBLIC_BRAND_TAGLINE', 'NEXT_PUBLIC_BRAND_COPYRIGHT'],
    ['src/lib/branding.ts'], { public: true }),
  ...env(['NEXT_PUBLIC_APP_URL'], ['src/app/actions/meetingNotify.ts', 'src/app/actions/projectInvites.ts', 'src/app/api/v1/minutes/route.ts'], { public: true }),
  ...env(['VERCEL_PROJECT_PRODUCTION_URL'], ['src/app/actions/meetingNotify.ts']),
  ...env(['VERCEL_ENV'], ['next.config.ts']),
  ...env(['NEXT_OUTPUT'], ['next.config.ts'], { apply: 'rebuild' }),
  ...env(['STAGING'], ['src/app/(app)/layout.tsx', 'next.config.ts']),
  ...env(['USAGE_TRACKING'], ['src/lib/domain/usageTracking.ts', 'src/app/api/track/route.ts']),
  ...env(['CRON_SECRET'], ['src/app/api/cron/ai-index/route.ts', 'src/app/api/cron/inbox-retention/route.ts', 'src/app/api/wiki/worker/route.ts'], { secret: ['CRON_SECRET'] }),
  ...env(['WIKI_WORKER_SECRET'], ['src/app/api/wiki/worker/route.ts'], { secret: ['WIKI_WORKER_SECRET'] }),
  ...env(['CHAT_V2_INDEX_CRON_SECRET'], ['src/app/api/chat/index/worker/route.ts'], { secret: ['CHAT_V2_INDEX_CRON_SECRET'] }),
  ...env(['AGENT_API_ENABLED'], ['src/lib/modules/flags.ts', 'src/lib/agent/externalApi.ts']),
  ...env(['MINUTES_API_ENABLED', 'MINUTES_FOLDER_PATH_ENABLED'], ['src/lib/modules/flags.ts', 'src/lib/minutes/externalApi.ts']),
  ...env(['WIKI_SERVICE_ENABLED', 'WIKI_WORKER_ENABLED'], ['src/lib/modules/flags.ts', 'src/lib/wiki/serviceState.ts']),
  ...env(['CHAT_V2_ENABLED', 'CHAT_V2_PLANNER_ENABLED', 'CHAT_V2_LLM_SYNTHESIS_ENABLED', 'CHAT_V2_INDEX_WORKER_ENABLED'], ['src/lib/modules/flags.ts']),
  ...env(['AI_PROVIDER', 'LLM_API_KEY', 'OPENAI_API_KEY', 'LLM_BASE_URL', 'LLM_MODEL', 'EMBED_MODEL', 'GEMINI_API_KEY',
    'GOOGLE_API_KEY', 'GEMINI_BASE_URL', 'GEMINI_MODEL', 'GEMINI_EMBED_MODEL', 'GEMINI_FALLBACK_MODELS', 'ASSISTANT_MIN_SIMILARITY'],
  ['src/lib/ai/provider.ts', 'src/lib/ai/llm.ts', 'src/lib/ai/similarity.ts'],
  { secret: ['LLM_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'] }),
  ...env(['NEXT_PUBLIC_SUPABASE_URL'],
    ['src/lib/supabase/client.ts', 'src/lib/supabase/server.ts', 'src/lib/supabase/env.ts', 'src/middleware.ts'], { public: true }),
  ...env(['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    ['src/lib/supabase/client.ts', 'src/lib/supabase/server.ts', 'src/middleware.ts'], { public: true }),
  ...env(['SUPABASE_SERVICE_ROLE_KEY'], ['src/lib/supabase/env.ts'], { secret: ['SUPABASE_SERVICE_ROLE_KEY'] }),
  { name: 'table:llm_config', kind: 'table', editor: '플랫폼 관리자', apply: 'immediate', secret: true, owner: ['src/lib/ai/llm-override.ts'] },
  { name: 'table:llm_profiles', kind: 'table', editor: '플랫폼 관리자', apply: 'immediate', secret: true, owner: ['src/lib/ai/llm-override.ts'] },
]
