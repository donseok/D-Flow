'use client'
import { Star } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { useFavorites } from './FavoritesProvider'
export function FavoriteToggle({ projectId, projectName }: { projectId: string; projectName: string }) {
  const f = useFavorites(), on = f.ids.has(projectId)
  const reason = f.disabled ? '즐겨찾기를 불러오지 못했습니다' : !on && f.full ? '즐겨찾기는 20개까지입니다' : undefined
  return <IconButton variant="ghost" aria-label={`${projectName} 즐겨찾기`} aria-pressed={on}
    disabled={!!reason} disabledReason={reason}
    icon={<Star className={`h-4 w-4 ${on ? 'fill-current text-action' : 'text-fg-muted'}`} aria-hidden />}
    onClick={() => void f.toggle(projectId)} />
}
