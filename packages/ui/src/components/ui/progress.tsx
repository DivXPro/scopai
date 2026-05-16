import { ProgressBar as HeroProgressBar } from "@heroui/react";

export interface ProgressProps {
  value?: number;
  max?: number;
  color?: "default" | "accent" | "success" | "warning" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
  showValueLabel?: boolean;
  ariaLabel?: string;
}

export function Progress({
  value = 0,
  max = 100,
  color = "accent",
  size = "md",
  className = "",
  label,
  showValueLabel = false,
  ariaLabel,
}: ProgressProps) {
  const safeMax = Math.max(0, max);
  const safeValue = safeMax === 0 ? 0 : Math.min(Math.max(0, value), safeMax);

  return (
    <HeroProgressBar
      value={safeValue}
      maxValue={safeMax}
      color={color}
      size={size}
      className={className}
      aria-label={label || ariaLabel || "Progress"}
    >
      {({ percentage }) => (
        <>
          {(label || showValueLabel) && (
            <div className="flex justify-between mb-1">
              {label && (
                <span className="text-sm font-medium text-default-700">
                  {label}
                </span>
              )}
              {showValueLabel && (
                <HeroProgressBar.Output className="text-sm text-default-500" />
              )}
            </div>
          )}
          <HeroProgressBar.Track>
            <HeroProgressBar.Fill style={{ width: `${percentage}%` }} />
          </HeroProgressBar.Track>
        </>
      )}
    </HeroProgressBar>
  );
}
