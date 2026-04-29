import { NavLink } from 'react-router-dom';
import * as icons from '@gravity-ui/icons';

const Tachometer = icons.Tachometer;
const ListCheck = icons.ListCheck;
const FileText = icons.FileText;
const TargetDart = icons.TargetDart;
const Thunderbolt = icons.Thunderbolt;
const Users = icons.Users;

const navItems = [
  { path: '/', label: '概览', icon: Tachometer },
  { path: '/tasks', label: '任务', icon: ListCheck },
  { path: '/posts', label: '帖子库', icon: FileText },
  { path: '/strategies', label: '策略', icon: TargetDart },
  { path: '/queue', label: '队列', icon: Thunderbolt },
  { path: '/creators', label: '博主管理', icon: Users },
];

export default function Sidebar() {
  return (
    <aside className="flex w-64 flex-col border-r border-divider bg-background">
      <div className="p-4 border-b border-divider">
        <h1 className="text-lg font-bold text-foreground">ScopeAI</h1>
        <p className="text-xs text-muted-foreground">Analyze Platform</p>
      </div>
      <nav className="flex-1 p-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-colors mb-1 ${
                  isActive
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-default hover:text-foreground'
                }`
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
