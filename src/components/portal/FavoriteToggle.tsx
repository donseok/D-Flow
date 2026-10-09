'use client'
import { Star } from 'lucide-react'
import { IconButton } from '@/components/ui/IconButton'
import { useFavorites } from './FavoritesProvider'
import { useLocale } from '@/components/providers/LocaleProvider'
export function FavoriteToggle({ projectId, projectName }: { projectId: string; projectName: string }) {
  const { t } = useLocale()
  const f = useFavorites(), on = f.ids.has(projectId)
  const reason = f.disabled ? t('portalUi.fav.loadFailed') : !on && f.full ? t('portalUi.fav.full') : undefined
  return <IconButton variant="ghost" aria-label={t('portalUi.fav.toggleAria').replace('{name}', () => projectName)} aria-pressed={on}
    disabled={!!reason} disabledReason={reason}
    icon={<Star className={`h-4 w-4 ${on ? 'fill-current text-action' : 'text-fg-muted'}`} aria-hidden />}
    onClick={() => void f.toggle(projectId)} />
}
