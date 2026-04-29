import { Skeleton as HeroSkeleton } from "@heroui/react";

export function Skeleton({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <HeroSkeleton className={className} {...props} />;
}
