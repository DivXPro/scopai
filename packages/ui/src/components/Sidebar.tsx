import { NavLink } from 'react-router-dom';
import * as icons from '@gravity-ui/icons';

const Tachometer = icons.Tachometer;
const ListCheck = icons.ListCheck;
const FileText = icons.FileText;
const TargetDart = icons.TargetDart;
const Thunderbolt = icons.Thunderbolt;
const Persons = icons.Persons;
const CircleQuestion = icons.CircleQuestion;
const ArrowRightFromLine = icons.ArrowRightFromLine;

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
        <h1 className="text-lg font-extrabold tracking-tighter text-secondary">ScopeAI</h1>
        <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-widest mt-1">
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
      <div className="px-6 pb-6 pt-4 border-t border-outline-variant space-y-0.5">
        <a
          href="#"
          className="flex items-center gap-3 text-slate-500 px-2 py-2 hover:text-slate-900 transition-all text-sm"
        >
          <CircleQuestion className="h-4 w-4" />
          <span>帮助中心</span>
        </a>
        <a
          href="#"
          className="flex items-center gap-3 text-slate-500 px-2 py-2 hover:text-slate-900 transition-all text-sm"
        >
          <ArrowRightFromLine className="h-4 w-4" />
          <span>退出登录</span>
        </a>
      </div>
    </aside>
  );
}
