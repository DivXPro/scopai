export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: 'sm' | 'md' | 'lg';
}

const variantClasses: Record<string, string> = {
  default: 'bg-accent text-accent-foreground border-transparent',
  secondary: 'bg-default text-default-foreground border-transparent',
  destructive: 'bg-danger text-danger-foreground border-transparent',
  outline: 'bg-background text-foreground border-border',
  success: 'bg-success/10 text-success border-success/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
};

const sizeClasses: Record<string, string> = {
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-2.5 py-0.5 text-xs',
  lg: 'px-3 py-1 text-sm',
};

export function Badge({
  variant = 'default',
  size = 'md',
  className = '',
  ...props
}: BadgeProps) {
  const baseClasses =
    'inline-flex items-center rounded-full border font-medium transition-colors';

  return (
    <span
      className={`${baseClasses} ${variantClasses[variant] || variantClasses.default} ${sizeClasses[size]} ${className}`}
      {...props}
    />
  );
}
