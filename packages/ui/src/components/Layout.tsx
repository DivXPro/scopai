import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import * as icons from '@gravity-ui/icons';

const Magnifier = icons.Magnifier;
const Bell = icons.Bell;
const Gear = icons.Gear;

export default function Layout() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-16 shrink-0 bg-slate-50/80 backdrop-blur-md border-b border-slate-200 flex items-center justify-between px-8 shadow-sm">
          <div className="flex items-center gap-4">
            <div className="relative">
              <Magnifier className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="搜索帖子、任务、策略..."
                className="bg-white border border-outline-variant rounded-full pl-10 pr-4 py-1.5 text-sm w-80 focus:ring-2 focus:ring-secondary focus:border-secondary outline-none transition-all"
              />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <button className="text-slate-500 hover:text-slate-900 transition-colors relative">
              <Bell className="h-5 w-5" />
            </button>
            <button className="text-slate-500 hover:text-slate-900 transition-colors">
              <Gear className="h-5 w-5" />
            </button>
            <div className="h-8 w-px bg-slate-200 mx-1" />
            <div className="w-8 h-8 rounded-full bg-secondary text-white flex items-center justify-center text-xs font-bold">
              U
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-10 bg-background">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
