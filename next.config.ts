import type { NextConfig } from "next";
import { buildSecurityHeaders } from "./src/lib/http/securityHeaders";

// 배포 환경의 정본은 APP_ENV(production|staging|preview|development)다(정본 §5.5.2 ⑦). Vercel 은 APP_ENV 를 모르므로
// APP_ENV 가 없을 때만 **여기 한 곳에서** VERCEL_ENV 를 읽어 빌드 env 로 옮긴다(아래 env — 빌드 때 process.env.APP_ENV 에 박힌다).
// 다른 파일은 VERCEL_ENV 를 읽지 않는다(tests/invariants/app-env.test.ts). 자체호스트는 런타임 env 로 APP_ENV 를 준다.
const APP_ENVS = ["production", "staging", "preview", "development"] as const;
const mappedAppEnv = process.env.APP_ENV ? undefined : APP_ENVS.find((v) => v === process.env.VERCEL_ENV);
const appEnv = process.env.APP_ENV ?? mappedAppEnv;

const nextConfig: NextConfig = {
  ...(mappedAppEnv ? { env: { APP_ENV: mappedAppEnv } } : {}),
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  // 라우터 캐시(2026-08-18 성능 감사): 동적 페이지도 30초간 클라이언트 라우터 캐시를 재사용해
  // 방금 본 화면 재방문·뒤로가기가 왕복 0회가 된다. 서버 액션의 revalidatePath / router.refresh
  // 가 캐시를 무효화하므로 쓰기 후 신선도는 유지된다.
  experimental: { staleTimes: { dynamic: 30 } },
  // 상위 홈 디렉터리의 lockfile을 workspace root로 오인하지 않게 서버 추적 기준을 고정한다.
  outputFileTracingRoot: process.cwd(),
  // PPTX 템플릿을 각 Node.js 다운로드 라우트 서버 번들에 포함(런타임 fs 읽기).
  outputFileTracingIncludes: {
    "/api/report": ["./src/lib/report/assets/default/weekly_report_*.pptx", "./src/lib/report/assets/default/weekly_report_*.xlsx"],
    "/api/export": ["./src/lib/report/assets/default/wbs_export_xlsx.xlsx"],
    "/api/issue-analysis": ["./src/lib/report/assets/default/issue_analysis_pptx.pptx"],
  },
  async headers() {
    // 보안 헤더·보고 전용 CSP·기존 두 규칙(스테이징 noindex, 프로덕션 툴바 숨김)의 구성은 순수 함수 한 곳이다(단위 테스트가 정책을 고정한다).
    return buildSecurityHeaders({
      appEnv,
      staging: process.env.STAGING,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      dev: process.env.NODE_ENV === "development",
    });
  },
};

export default nextConfig;
