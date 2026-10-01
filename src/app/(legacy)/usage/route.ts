import { type NextRequest } from 'next/server'
import { legacyRedirect } from '@/lib/workspace/legacyStub'

export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) { return legacyRedirect(req, 'usage') }
