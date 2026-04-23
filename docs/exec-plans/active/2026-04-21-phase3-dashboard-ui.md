# Phase 3: Dashboard UI — React + Vite + shadcn/ui 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 `packages/ui/` 包，使用 React + Vite + shadcn/ui 构建 Dashboard，实现设计文档中定义的所有页面。

**Architecture:** React SPA 通过 Vite 构建，shadcn/ui 提供组件系统（基于 Tailwind CSS + Radix UI）。API 调用通过自定义 hook 封装，认证 token 存储在 localStorage。构建产物（dist/）由 API 包的 Fastify static 插件托管，实现单进程部署。

**Tech Stack:** React 19, Vite 6, Tailwind CSS 3, shadcn/ui, React Router 7, lucide-react

**依赖 Phase 2:** 必须完成 Phase 2 (API 服务) 后才能执行此计划。

---

## File Structure

```
packages/ui/
├── components.json           ← shadcn/ui 配置
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── index.html
└── src/
    ├── globals.css           ← Tailwind + shadcn/ui 主题变量
    ├── main.tsx              ← React 入口
    ├── App.tsx               ← 路由配置
    ├── lib/
    │   └── utils.ts          ← cn() 工具函数（shadcn 必需）
    ├── api/                  ← API 客户端
    │   └── client.ts
    ├── hooks/                ← 自定义 React hooks
    │   ├── useApi.ts
    │   └── usePolling.ts
    ├── components/           ← 共享组件 + shadcn/ui 组件
    │   ├── ui/               ← shadcn/ui 组件目录
    │   │   ├── button.tsx
    │   │   ├── card.tsx
    │   │   ├── table.tsx
    │   │   ├── badge.tsx
    │   │   ├── skeleton.tsx
    │   │   ├── input.tsx
    │   │   └── separator.tsx
    │   ├── Layout.tsx
    │   ├── Sidebar.tsx
    │   ├── AppSidebar.tsx    ← 基于 shadcn Sidebar 的导航
    │   └── StatCard.tsx
    └── pages/
        ├── Overview.tsx
        ├── TaskList.tsx
        ├── TaskDetail.tsx
        ├── PostLibrary.tsx
        ├── Strategies.tsx
        └── QueueMonitor.tsx
```

---

## Task 1: 创建 packages/ui 包结构

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/vite.config.ts`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/tsconfig.node.json`
- Create: `packages/ui/index.html`

- [ ] **Step 1.1: 创建 packages/ui/package.json**

```json
{
  "name": "@analyze-cli/ui",
  "version": "0.1.11",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-router-dom": "^7.6.0",
    "lucide-react": "^0.503.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.2.0"
  },
  "devDependencies": {
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.4.0",
    "autoprefixer": "^10.4.21",
    "postcss": "^8.5.3",
    "tailwindcss": "^3.4.17",
    "tailwindcss-animate": "^1.0.7",
    "typescript": "^5.8.3",
    "vite": "^6.3.0"
  }
}
```

- [ ] **Step 1.2: 创建 vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

- [ ] **Step 1.3: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 1.4: 创建 tsconfig.node.json**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 1.5: 创建 index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Analyze CLI Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 1.6: Commit**

```bash
git add packages/ui/
git commit -m "chore(ui): create ui package structure with Vite + React"
```

---

## Task 2: 配置 shadcn/ui 基础

**Files:**
- Create: `packages/ui/components.json`
- Create: `packages/ui/tailwind.config.js`
- Create: `packages/ui/postcss.config.js`
- Create: `packages/ui/src/globals.css`
- Create: `packages/ui/src/lib/utils.ts`

- [ ] **Step 2.1: 创建 components.json**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.js",
    "css": "src/globals.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

- [ ] **Step 2.2: 创建 tailwind.config.js**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
```

- [ ] **Step 2.3: 创建 postcss.config.js**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 2.4: 创建 src/globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --card: 0 0% 100%;
    --card-foreground: 222.2 84% 4.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    --ring: 212.7 26.8% 83.9%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
    font-feature-settings: "rlig" 1, "calt" 1;
  }
}
```

- [ ] **Step 2.5: 创建 src/lib/utils.ts**

```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2.6: Commit**

```bash
git add packages/ui/components.json packages/ui/tailwind.config.js packages/ui/postcss.config.js packages/ui/src/globals.css packages/ui/src/lib/utils.ts
git commit -m "feat(ui): setup shadcn/ui with Tailwind CSS theme system"
```

---

## Task 3: 安装 shadcn/ui 基础组件

**Files:**
- Create: `packages/ui/src/components/ui/button.tsx`
- Create: `packages/ui/src/components/ui/card.tsx`
- Create: `packages/ui/src/components/ui/table.tsx`
- Create: `packages/ui/src/components/ui/badge.tsx`
- Create: `packages/ui/src/components/ui/skeleton.tsx`
- Create: `packages/ui/src/components/ui/input.tsx`
- Create: `packages/ui/src/components/ui/separator.tsx`

- [ ] **Step 3.1: 创建 button.tsx**

```tsx
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
```

- [ ] **Step 3.2: 创建 card.tsx**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("rounded-xl border bg-card text-card-foreground shadow", className)}
    {...props}
  />
));
Card.displayName = "Card";

const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />
));
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn("font-semibold leading-none tracking-tight", className)} {...props} />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center p-6 pt-0", className)} {...props} />
));
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
```

- [ ] **Step 3.3: 创建 table.tsx**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

const Table = React.forwardRef<
  HTMLTableElement,
  React.HTMLAttributes<HTMLTableElement>
>(({ className, ...props }, ref) => (
  <div className="relative w-full overflow-auto">
    <table ref={ref} className={cn("w-full caption-bottom text-sm", className)} {...props} />
  </div>
));
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn("border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted", className)}
    {...props}
  />
));
TableRow.displayName = "TableRow";

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
));
TableHead.displayName = "TableHead";

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td ref={ref} className={cn("p-2 align-middle [&:has([role=checkbox])]:pr-0", className)} {...props} />
));
TableCell.displayName = "TableCell";

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell };
```

- [ ] **Step 3.4: 创建 badge.tsx**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive: "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
```

- [ ] **Step 3.5: 创建 skeleton.tsx**

```tsx
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-primary/10", className)} {...props} />;
}

export { Skeleton };
```

- [ ] **Step 3.6: 创建 input.tsx**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
```

- [ ] **Step 3.7: 创建 separator.tsx**

```tsx
import * as React from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { cn } from "@/lib/utils";

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(
  ({ className, orientation = "horizontal", decorative = true, ...props }, ref) => (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className
      )}
      {...props}
    />
  )
);
Separator.displayName = SeparatorPrimitive.Root.displayName;

export { Separator };
```

- [ ] **Step 3.8: 安装额外依赖**

```bash
cd packages/ui && pnpm add @radix-ui/react-slot @radix-ui/react-separator
```

- [ ] **Step 3.9: Commit**

```bash
git add packages/ui/src/components/ui/ packages/ui/package.json pnpm-lock.yaml
git commit -m "feat(ui): add shadcn/ui base components (button, card, table, badge, skeleton, input, separator)"
```

---

## Task 4: 实现 API 客户端

**Files:**
- Create: `packages/ui/src/api/client.ts`

- [ ] **Step 4.1: 创建 API 客户端**

```typescript
const API_BASE = '';

function getToken(): string | null {
  return localStorage.getItem('api_token');
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${getToken() ?? ''}`,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token ?? ''}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 4.2: Commit**

```bash
git add packages/ui/src/api/client.ts
git commit -m "feat(ui): add API client with auth token support"
```

---

## Task 5: 实现 Layout + Sidebar（使用 shadcn/ui + lucide-react）

**Files:**
- Create: `packages/ui/src/components/Sidebar.tsx`
- Create: `packages/ui/src/components/Layout.tsx`

- [ ] **Step 5.1: 创建 Sidebar.tsx**

使用 lucide-react 图标替代 emoji，使用 shadcn/ui 的样式系统。

```tsx
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ClipboardList,
  FileText,
  Target,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/', label: '概览', icon: LayoutDashboard },
  { path: '/tasks', label: '任务', icon: ClipboardList },
  { path: '/posts', label: '帖子库', icon: FileText },
  { path: '/strategies', label: '策略', icon: Target },
  { path: '/queue', label: '队列', icon: Zap },
];

export default function Sidebar() {
  return (
    <aside className="w-64 border-r bg-background flex flex-col">
      <div className="p-4 border-b">
        <h1 className="text-lg font-bold">Analyze CLI</h1>
        <p className="text-xs text-muted-foreground">Dashboard</p>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 5.2: 创建 Layout.tsx**

```tsx
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';

export default function Layout() {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 5.3: Commit**

```bash
git add packages/ui/src/components/Sidebar.tsx packages/ui/src/components/Layout.tsx
git commit -m "feat(ui): add sidebar navigation with lucide-react icons"
```

---

## Task 6: 实现路由和入口

**Files:**
- Create: `packages/ui/src/App.tsx`
- Create: `packages/ui/src/main.tsx`

- [ ] **Step 6.1: 创建 App.tsx**

```tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from '@/components/Layout';
import Overview from '@/pages/Overview';
import TaskList from '@/pages/TaskList';
import TaskDetail from '@/pages/TaskDetail';
import PostLibrary from '@/pages/PostLibrary';
import Strategies from '@/pages/Strategies';
import QueueMonitor from '@/pages/QueueMonitor';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="tasks" element={<TaskList />} />
          <Route path="tasks/:id" element={<TaskDetail />} />
          <Route path="posts" element={<PostLibrary />} />
          <Route path="strategies" element={<Strategies />} />
          <Route path="queue" element={<QueueMonitor />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 6.2: 创建 main.tsx**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 6.3: Commit**

```bash
git add packages/ui/src/App.tsx packages/ui/src/main.tsx
git commit -m "feat(ui): setup React Router with page routes"
```

---

## Task 7: 实现 Overview 页面（使用 shadcn/ui Card）

**Files:**
- Create: `packages/ui/src/pages/Overview.tsx`
- Create: `packages/ui/src/components/StatCard.tsx`

- [ ] **Step 7.1: 创建 StatCard.tsx**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
}

export default function StatCard({ title, value, icon }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7.2: 创建 Overview.tsx**

```tsx
import { useEffect, useState } from 'react';
import { Clock, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { apiGet } from '@/api/client';
import { Skeleton } from '@/components/ui/skeleton';
import StatCard from '@/components/StatCard';

interface StatusData {
  queue_stats: { pending: number; processing: number; completed: number; failed: number };
}

export default function Overview() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    apiGet<StatusData>('/api/daemon/status')
      .then(setStatus)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-destructive">
        Error: {error}
      </div>
    );
  }

  const stats = status?.queue_stats ?? { pending: 0, processing: 0, completed: 0, failed: 0 };

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">概览</h2>
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="待处理" value={stats.pending} icon={<Clock className="h-4 w-4 text-muted-foreground" />} />
        <StatCard title="处理中" value={stats.processing} icon={<Loader2 className="h-4 w-4 text-muted-foreground" />} />
        <StatCard title="已完成" value={stats.completed} icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />} />
        <StatCard title="失败" value={stats.failed} icon={<XCircle className="h-4 w-4 text-muted-foreground" />} />
      </div>
    </div>
  );
}
```

- [ ] **Step 7.3: Commit**

```bash
git add packages/ui/src/pages/Overview.tsx packages/ui/src/components/StatCard.tsx
git commit -m "feat(ui): add overview dashboard with shadcn Card and Skeleton"
```

---

## Task 8: 实现 TaskList 和 TaskDetail 页面（使用 shadcn/ui Table + Badge）

**Files:**
- Create: `packages/ui/src/pages/TaskList.tsx`
- Create: `packages/ui/src/pages/TaskDetail.tsx`

- [ ] **Step 8.1: 创建 TaskList.tsx**

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiGet } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import type { Task, TaskStatus } from '@analyze-cli/core';

const statusVariantMap: Record<TaskStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  running: 'default',
  paused: 'secondary',
  completed: 'default',
  failed: 'destructive',
};

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<Task[]>('/api/tasks')
      .then(setTasks)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">任务列表</h2>
        <Button size="sm">新建任务</Button>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  暂无任务
                </TableCell>
              </TableRow>
            ) : (
              tasks.map((task) => (
                <TableRow key={task.id}>
                  <TableCell className="font-medium">{task.name}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariantMap[task.status]}>{task.status}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(task.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/tasks/${task.id}`}>查看</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 8.2: 创建 TaskDetail.tsx**

```tsx
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { apiGet } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    apiGet(`/api/tasks/${id}`)
      .then(setTask)
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" asChild>
          <Link to="/tasks">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h2 className="text-3xl font-bold tracking-tight">任务详情</h2>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>原始数据</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="rounded-lg bg-muted p-4 overflow-auto text-sm">
            {JSON.stringify(task, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 8.3: Commit**

```bash
git add packages/ui/src/pages/TaskList.tsx packages/ui/src/pages/TaskDetail.tsx
git commit -m "feat(ui): add task list and detail pages with shadcn Table and Badge"
```

---

## Task 9: 实现其余页面

**Files:**
- Create: `packages/ui/src/pages/PostLibrary.tsx`
- Create: `packages/ui/src/pages/Strategies.tsx`
- Create: `packages/ui/src/pages/QueueMonitor.tsx`

- [ ] **Step 9.1: 创建 PostLibrary.tsx**

```tsx
import { useEffect, useState } from 'react';
import { apiGet } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function PostLibrary() {
  const [posts, setPosts] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet('/api/posts')
      .then(setPosts)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">帖子库</h2>
      <Card>
        <CardHeader>
          <CardTitle>共 {posts.length} 条帖子</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="rounded-lg bg-muted p-4 overflow-auto text-sm">
            {JSON.stringify(posts.slice(0, 5), null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 9.2: 创建 Strategies.tsx**

```tsx
import { useEffect, useState } from 'react';
import { apiGet } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

export default function Strategies() {
  const [strategies, setStrategies] = useState<unknown[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet('/api/strategies')
      .then(setStrategies)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">策略管理</h2>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>目标</TableHead>
              <TableHead>版本</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {strategies.map((s: any) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>{s.target}</TableCell>
                <TableCell>{s.version}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
```

- [ ] **Step 9.3: 创建 QueueMonitor.tsx**

```tsx
import { useEffect, useState } from 'react';
import { apiGet } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function QueueMonitor() {
  const [status, setStatus] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet('/api/daemon/status')
      .then(setStatus)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">队列监控</h2>
      <Card>
        <CardHeader>
          <CardTitle>服务状态</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="rounded-lg bg-muted p-4 overflow-auto text-sm">
            {JSON.stringify(status, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 9.4: Commit**

```bash
git add packages/ui/src/pages/PostLibrary.tsx packages/ui/src/pages/Strategies.tsx packages/ui/src/pages/QueueMonitor.tsx
git commit -m "feat(ui): add post library, strategies, and queue monitor pages"
```

---

## Task 10: 安装依赖并构建

**Files:**
- Run: `pnpm install`
- Run: `pnpm build`

- [ ] **Step 10.1: 安装依赖**

```bash
pnpm install
```

- [ ] **Step 10.2: 构建 UI**

```bash
cd packages/ui && pnpm build
```

预期：Vite 构建成功，生成 `packages/ui/dist/` 目录。

- [ ] **Step 10.3: Commit**

```bash
git add pnpm-lock.yaml
git commit -m "chore(deps): install ui package dependencies"
```

---

## Task 11: 配置 API 托管 UI 静态文件

**Files:**
- Modify: `packages/api/src/index.ts`
- Modify: `packages/api/package.json`

- [ ] **Step 11.1: 添加 @fastify/static 依赖**

```bash
cd packages/api && pnpm add @fastify/static
```

- [ ] **Step 11.2: 更新 API 入口托管静态文件**

```typescript
import fastify from 'fastify';
import staticPlugin from '@fastify/static';
import * as path from 'path';
import { config, migrate, seedPlatforms } from '@analyze-cli/core';
import { setupAuth } from './auth';
import { registerRoutes } from './routes';
import { startWorkers, stopWorkers } from './worker/manager';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';

async function main() {
  await migrate();
  await seedPlatforms();

  const app = fastify({
    logger: { level: config.logging.level },
  });

  // Register static file serving for UI
  await app.register(staticPlugin, {
    root: path.resolve(__dirname, '../../ui/dist'),
    prefix: '/',
  });

  // SPA fallback: serve index.html for non-API, non-static routes
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/') || request.url === '/health') {
      reply.code(404).send({ error: 'Not Found' });
      return;
    }
    // Serve index.html for client-side routing
    return reply.sendFile('index.html');
  });

  app.get('/health', async () => ({ status: 'ok' }));

  await setupAuth(app);
  await registerRoutes(app);

  startWorkers();

  process.on('SIGTERM', async () => {
    stopWorkers();
    await app.close();
  });

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`API server + UI on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 11.3: Commit**

```bash
git add packages/api/src/index.ts packages/api/package.json
git commit -m "feat(api): serve UI static files from API server"
```

---

## Task 12: 验证完整功能

**Files:**
- Run: build + start

- [ ] **Step 12.1: 完整构建**

```bash
pnpm build
```

- [ ] **Step 12.2: 启动服务并验证**

```bash
cd packages/api && pnpm start
```

在浏览器中打开 `http://localhost:3000`，验证：
- UI 加载正常，shadcn/ui 主题生效
- 侧边栏导航工作，lucide-react 图标显示正常
- 需要输入 token（从控制台获取）
- API 数据能正常显示
- Card、Table、Badge 等 shadcn 组件样式正确

- [ ] **Step 12.3: 最终 Commit**

```bash
git commit -m "feat(ui): complete Phase 3 Dashboard UI with shadcn/ui"
```

---

## Self-Review

### Spec Coverage

| 设计文档 Phase 3 要求 | 对应任务 |
|----------------------|---------|
| 创建 `packages/ui/` | Task 1 |
| React + Vite | Task 1 |
| shadcn/ui 组件系统 | Task 2-3 |
| Tailwind CSS 主题 | Task 2 |
| lucide-react 图标 | Task 5 |
| 认证 token localStorage | Task 4 |
| Dashboard 页面 | Task 7-9 |
| API 静态托管 UI | Task 11 |

### Placeholder Scan

- [x] 所有页面包含实际实现（非空占位包含 API 调用和数据展示）
- [x] 无 "TODO" 或 "TBD"
- [x] 所有 shadcn 组件包含完整代码（非占位）

### 使用的 shadcn/ui 组件

| 组件 | 用途 |
|------|------|
| `Button` | 操作按钮、导航 |
| `Card` | 统计卡片、内容容器 |
| `Table` | 数据列表展示 |
| `Badge` | 状态标签 |
| `Skeleton` | 加载占位 |
| `Input` | 搜索/表单输入（预留） |
| `Separator` | 分隔线（预留） |
