// 레지스트리의 lucide 이름 → 컴포넌트(§5.4.2, D31). 크기(메뉴 18·툴바 16)·획 1.75 도 여기 한 곳(개정 §5.4.1). 표에 없는 이름은 tests/shell/nav-icons 가 잡는다
import {
  BarChart3, BookOpenText, Bot, Briefcase, CalendarCheck, CalendarClock, CircleAlert, Cpu, FileText, FolderOpen, LayoutDashboard, LayoutGrid,
  ListChecks, ListTree, Megaphone, NotebookPen, Settings, SwatchBook, UserCog, Users, type LucideIcon,
} from 'lucide-react'

export const NAV_ICONS: Readonly<Record<string, LucideIcon>> = {
  BarChart3, BookOpenText, Bot, Briefcase, CalendarCheck, CalendarClock, CircleAlert, Cpu, FileText, FolderOpen, LayoutDashboard, LayoutGrid,
  ListChecks, ListTree, Megaphone, NotebookPen, Settings, SwatchBook, UserCog, Users,
}
export const NAV_ICON_SIZE = { menu: 18, toolbar: 16 } as const
export const NAV_ICON_STROKE = 1.75
export function navIcon(name: string): LucideIcon {
  const icon = Object.hasOwn(NAV_ICONS, name) ? NAV_ICONS[name] : undefined
  if (!icon) throw new Error(`[navIcons] 레지스트리 아이콘 ${name} 이 표에 없다`)
  return icon
}
