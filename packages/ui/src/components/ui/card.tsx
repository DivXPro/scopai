import { Card as HeroCard } from "@heroui/react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export function Card({ className = "", children, ...props }: CardProps) {
  return (
    <HeroCard className={className} {...props}>
      {children}
    </HeroCard>
  );
}

export function CardHeader({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <HeroCard.Header className={className} {...props}>
      {children}
    </HeroCard.Header>
  );
}

export function CardTitle({ className = "", children, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <HeroCard.Title className={className} {...props}>
      {children}
    </HeroCard.Title>
  );
}

export function CardDescription({ className = "", children, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <HeroCard.Description className={className} {...props}>
      {children}
    </HeroCard.Description>
  );
}

export function CardContent({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <HeroCard.Content className={className} {...props}>
      {children}
    </HeroCard.Content>
  );
}

export function CardFooter({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <HeroCard.Footer className={className} {...props}>
      {children}
    </HeroCard.Footer>
  );
}
