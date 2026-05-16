import { ProgressBar as HeroProgressBar } from "@heroui/react";

export interface ProgressProps {
  value?: number;
  max?: number;
  color?: "default" | "accent" | "success" | "warning" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
  showValueLabel?: boolean;
}

export function Progress({
  value = 0,
  max = 100,
  color = "accent",
  size = "md",
  className = "",
  label,
  showValueLabel = false,
}: ProgressProps) {
  return (
    <HeroProgressBar
      value={value}
      maxValue={max}
      color={color}
      size={size}
      className={className}
    >
      {({ percentage, valueText }) => (
        <>
          {(label || showValueLabel) && (
            <div className="flex justify-between mb-1">
              {label && (
                <span className="text-sm font-medium text-default-700">
                  {label}
                </span>
              )}
              {showValueLabel && (
                <span className="text-sm text-default-500">
                  {valueText}
                </span>
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
