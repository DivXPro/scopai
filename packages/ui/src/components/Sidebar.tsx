import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, ClipboardList, FileText, Target, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/', label: '概览', icon: LayoutDashboard },
  { path: '/tasks', label: '任务', icon: ClipboardList },
  { path: '/posts', label: '帖子库', icon: FileText },
  { path: '/strategies', label: '策略', icon: Target },
  { path: '/queue', label: '队列', icon: Zap },
];

export default function Sidebar() {
  return (
    <aside className="w-64 border-r bg-background flex flex-col">
      <div className="p-4 border-b">
        <h1 className="text-lg font-bold">Analyze CLI</h1>
        <p className="text-xs text-muted-foreground">Dashboard</p>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
