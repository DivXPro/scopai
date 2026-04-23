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
    <aside className="w-64 bg-house-green flex flex-col">
      <div className="p-4 border-b border-white/10">
        <h1 className="text-lg font-bold text-white">Analyze CLI</h1>
        <p className="text-xs text-white/70">Dashboard</p>
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
                  'flex items-center gap-3 px-3 py-2 rounded-pill text-sm transition-all duration-200',
                  isActive
                    ? 'bg-green-accent text-white font-medium'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
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
