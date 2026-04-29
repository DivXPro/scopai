import { Button as HeroButton } from "@heroui/react";

export interface ButtonProps {
  variant?: string;
  size?: string;
  asChild?: boolean;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
}

const variantMap: Record<string, string> = {
  default: "primary",
  destructive: "danger",
  outline: "outline",
  secondary: "secondary",
  ghost: "ghost",
  link: "ghost",
};

const sizeMap: Record<string, string> = {
  default: "md",
  sm: "sm",
  lg: "lg",
  icon: "md",
  "icon-only": "md",
};

export function Button({ variant = "default", size = "default", className = "", disabled, onClick, children }: ButtonProps) {
  const effectiveVariant = variantMap[variant] || "primary";
  const effectiveSize = sizeMap[size] || "md";

  return (
    <HeroButton
      variant={effectiveVariant as any}
      size={effectiveSize as any}
      className={className}
      isDisabled={disabled}
      onPress={onClick as any}
    >
      {children}
    </HeroButton>
  );
}
