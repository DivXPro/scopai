import { Link } from 'react-router-dom';
import { Card } from '@heroui/react';
import * as icons from '@gravity-ui/icons';

const ArrowsRotateRight = icons.ArrowsRotateRight;
const Ellipsis = icons.Ellipsis;

interface Creator {
  id: string;
  platform_id: string;
  platform_author_id: string;
  author_name: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  homepage_url: string | null;
  follower_count: number;
  following_count: number;
  post_count: number;
  status: 'active' | 'paused' | 'unsubscribed';
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
  metadata: Record<string, unknown> | null;
}

interface CreatorCardProps {
  creator: Creator;
}

const statusConfig: Record<Creator['status'], { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-green-100/50 text-emerald-700' },
  paused: { label: 'Paused', className: 'bg-amber-100/50 text-amber-700' },
  unsubscribed: { label: 'Unsubscribed', className: 'bg-blue-100/50 text-blue-700' },
};

function formatCount(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function formatRelativeTime(date: string | null): string {
  if (!date) return 'Never';
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

export function CreatorCard({ creator }: CreatorCardProps) {
  const displayName = creator.display_name || creator.author_name || 'Unknown';
  const username = creator.author_name || 'No username';
  const status = statusConfig[creator.status];
  const initials = displayName.charAt(0).toUpperCase();

  return (
    <Link to={`/creators/${creator.id}`} className="block">
      <Card className="bg-white border border-outline-variant shadow-sm hover:shadow-lg transition-all group">
        <Card.Content className="p-6">
          {/* Header: Avatar + Name + Status */}
          <div className="flex justify-between items-start mb-6">
            <div className="flex gap-4">
              <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center text-secondary font-bold text-xl border-2 border-white ring-1 ring-slate-100 shrink-0 overflow-hidden">
                {creator.avatar_url
                  ? <img src={creator.avatar_url} alt={displayName} className="w-full h-full object-cover" />
                  : initials
                }
              </div>
              <div>
                <h3 className="font-semibold text-lg text-slate-900 group-hover:text-secondary transition-colors">
                  {displayName}
                </h3>
                <p className="text-sm text-slate-400">@{username}</p>
              </div>
            </div>
            <div className={`px-3 py-1 rounded-full text-[11px] font-bold tracking-tight uppercase shrink-0 ${status.className}`}>
              {status.label}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-4 py-4 border-y border-slate-50 mb-4">
            <div>
              <div className="font-bold text-lg text-primary">{formatCount(creator.follower_count)}</div>
              <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">粉丝</div>
            </div>
            <div>
              <div className="font-bold text-lg text-primary">{formatCount(creator.post_count)}</div>
              <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">帖子</div>
            </div>
          </div>

          {/* Footer: Sync time + More */}
          <div className="flex justify-between items-center text-sm text-slate-400">
            <div className="flex items-center gap-1">
              <ArrowsRotateRight className="h-4 w-4" />
              <span>上次同步: {formatRelativeTime(creator.last_synced_at)}</span>
            </div>
            <button className="text-slate-400 hover:text-primary transition-colors">
              <Ellipsis className="h-5 w-5" />
            </button>
          </div>
        </Card.Content>
      </Card>
    </Link>
  );
}