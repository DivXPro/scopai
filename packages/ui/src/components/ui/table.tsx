import {
  Table as HeroTable,
  TableHeader as HeroTableHeader,
  TableColumn as HeroTableColumn,
  TableBody as HeroTableBody,
  TableRow as HeroTableRow,
  TableCell as HeroTableCell,
} from "@heroui/react";

export interface TableProps extends React.HTMLAttributes<HTMLDivElement> {
  children?: React.ReactNode;
}

export function Table({ className = "", children, "aria-label": ariaLabel, "aria-labelledby": ariaLabelledBy, ...props }: TableProps) {
  return (
    <HeroTable className={className} {...(props as any)}>
      <HeroTable.Content aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}>
        {children}
      </HeroTable.Content>
    </HeroTable>
  );
}

export function TableHeader({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <HeroTableHeader className={className} {...(props as any)}>
      {children}
    </HeroTableHeader>
  );
}

export function TableBody({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <HeroTableBody className={className} {...(props as any)}>
      {children}
    </HeroTableBody>
  );
}

export function TableRow({ className = "", children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <HeroTableRow className={className} {...(props as any)}>
      {children}
    </HeroTableRow>
  );
}

export function TableHead({ className = "", isRowHeader, children, ...props }: React.ThHTMLAttributes<HTMLTableCellElement> & { isRowHeader?: boolean }) {
  return (
    <HeroTableColumn isRowHeader={isRowHeader} className={className} {...(props as any)}>
      {children}
    </HeroTableColumn>
  );
}

export function TableCell({ className = "", children, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <HeroTableCell className={className} {...(props as any)}>
      {children}
    </HeroTableCell>
  );
}
