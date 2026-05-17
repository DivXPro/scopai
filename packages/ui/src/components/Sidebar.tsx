import { NavLink } from 'react-router-dom';
import * as icons from '@gravity-ui/icons';

const Tachometer = icons.Tachometer;
const ListCheck = icons.ListCheck;
const FileText = icons.FileText;
const TargetDart = icons.TargetDart;
const Thunderbolt = icons.Thunderbolt;
const Persons = icons.Persons;

const navItems = [
  { path: '/', label: '概览', icon: Tachometer },
  { path: '/tasks', label: '任务', icon: ListCheck },
  { path: '/posts', label: '帖子库', icon: FileText },
  { path: '/strategies', label: '策略', icon: TargetDart },
  { path: '/queue', label: '队列', icon: Thunderbolt },
  { path: '/creators', label: '博主管理', icon: Persons },
];

export default function Sidebar() {
  return (
    <aside className="flex w-64 flex-col bg-white border-r border-outline-variant h-screen">
      <div className="px-6 py-6 mb-2">
        <h1 className="text-lg font-bold tracking-tight text-foreground">ScopeAI</h1>
        <p className="text-xs font-medium text-secondary uppercase tracking-wider mt-0.5">
          Analyze Platform
        </p>
      </div>
      <nav className="flex-1 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-6 py-3 text-sm transition-all duration-200 ${
                  isActive
                    ? 'bg-blue-50 text-secondary border-l-[3px] border-secondary font-medium'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
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
