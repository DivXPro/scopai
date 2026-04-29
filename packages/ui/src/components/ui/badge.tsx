import { Badge as HeroBadge } from "@heroui/react";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: string;
  size?: "sm" | "md" | "lg";
}

const colorMap: Record<string, string> = {
  default: "primary",
  secondary: "secondary",
  destructive: "danger",
  outline: "default",
  success: "success",
  warning: "warning",
};

export function Badge({ variant = "default", size = "md", className = "", ...props }: BadgeProps) {
  const color = colorMap[variant] || "primary";

  return (
    <HeroBadge
      color={color as any}
      size={size}
      className={className}
      {...props}
    />
  );
}
