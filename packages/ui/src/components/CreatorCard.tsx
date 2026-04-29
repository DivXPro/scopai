import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@heroui/react';

// Inline Creator type to avoid cross-package import dependency
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
  created_at: Date;
  updated_at: Date;
  last_synced_at: Date | null;
  metadata: Record<string, unknown> | null;
}

interface CreatorCardProps {
  creator: Creator;
}

const statusColorMap: Record<Creator['status'], string> = {
  active: 'success',
  paused: 'warning',
  unsubscribed: 'default',
};

function formatRelativeTime(date: Date | null): string {
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

  return (
    <Link to={`/creators/${creator.id}`} className="block">
      <Card className="hover:opacity-80 transition-opacity cursor-pointer">
        <CardContent className="p-4 flex flex-col gap-3">
          {/* Header: Avatar + Name + Status Badge */}
          <div className="flex items-center gap-3">
            <Avatar className="shrink-0" size="md">
              <Avatar.Image src={creator.avatar_url ?? undefined} />
              <Avatar.Fallback>{displayName.charAt(0).toUpperCase()}</Avatar.Fallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-foreground truncate">{displayName}</p>
              <p className="text-xs text-muted-foreground truncate">
                {creator.author_name || 'No username'}
              </p>
            </div>
            <Badge
              variant={statusColorMap[creator.status] as any}
              size="sm"
            >
              {creator.status}
            </Badge>
          </div>

          {/* Stats: Followers + Posts */}
          <div className="flex gap-4 text-sm text-muted-foreground">
            <span>{creator.follower_count.toLocaleString()} 粉丝</span>
            <span>{creator.post_count.toLocaleString()} 帖子</span>
          </div>

          {/* Last synced */}
          <div className="text-xs text-muted-foreground">
            上次同步: {formatRelativeTime(creator.last_synced_at)}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}