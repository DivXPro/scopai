---
name: ScopeAI
description: AI 驱动的社交媒体内容分析平台，简洁、直观、轻量的工具型设计系统
colors:
  surface: "#f8f9fb"
  surface-raised: "#ffffff"
  surface-sunken: "#f1f3f5"
  text-primary: "#1a1d21"
  text-secondary: "#5f6670"
  text-tertiary: "#8c939e"
  accent: "#4a6cf7"
  accent-hover: "#3b5ce6"
  accent-subtle: "#eef2ff"
  success: "#22c55e"
  success-subtle: "#f0fdf4"
  danger: "#ef4444"
  danger-subtle: "#fef2f2"
  warning: "#f59e0b"
  warning-subtle: "#fffbeb"
  border: "#e2e5ea"
  border-subtle: "#eef0f3"
  divider: "#eef0f3"
typography:
  display:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  heading:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  subheading:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "-0.01em"
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0"
  caption:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.01em"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  xxl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "8px 20px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  card:
    backgroundColor: "{colors.surface-raised}"
    rounded: "{rounded.lg}"
    padding: "24px"
  badge:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "8px 14px"
  sidebar:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-secondary}"
    width: "256px"
---

# Design System: ScopeAI

## 1. Overview

**Creative North Star: "Modern SaaS Tool"**

ScopeAI 的设计系统以现代 SaaS 工具（Linear、Notion、Figma）为标杆：工具应该消失在任务中，而不是强调自己的存在。界面追求的是"拿起来就会用"的熟悉感，不是"看起来很酷"的新鲜感。

这是一个为内容创作者和运营人员设计的分析工具。用户打开页面是为了获取洞察，不是为了欣赏设计。所以每个视觉决策都应该服务于"让用户更快找到答案"这个目标。

配色走中性灰调路线，减少品牌感，让数据本身成为焦点。蓝色仅用于交互元素（按钮、链接、选中状态），不用于装饰。整体视觉层次靠轻量阴影和间距变化建立，不用颜色堆叠。

**Key Characteristics:**
- 工具感优先，装饰为零
- 中性灰调配色，蓝色仅限交互
- 轻量阴影建立层次，不用重色块
- 间距变化创造节奏，不用卡片嵌套
- 状态用语义色（绿/红/黄）清晰表达，不用图标装饰

## 2. Colors

中性灰调配色系统，以蓝灰色为基调，蓝色仅用于交互元素。

### Primary (Accent)
- **柔和蓝** (#4a6cf7): 主交互色，用于按钮、链接、选中状态、进度指示。仅在用户需要行动的地方出现，占屏幕面积 ≤10%。
- **柔和蓝-悬停** (#3b5ce6): 悬停状态，比主色深一级。

### Neutral
- **主表面** (#f8f9fb): 页面背景，极淡的蓝灰色调，不是纯白。
- **抬高表面** (#ffffff): 卡片、面板、弹窗背景。与主表面形成微妙的层次差。
- **下沉表面** (#f1f3f5): 输入框背景、禁用状态、次要信息区域。
- **主文本** (#1a1d21): 标题、正文、重要数据。不是纯黑，带一丝蓝灰。
- **次要文本** (#5f6670): 说明文字、标签、辅助信息。
- **三级文本** (#8c939e): 占位符、时间戳、非关键信息。
- **边框** (#e2e5ea): 卡片边框、分割线。
- **细分隔线** (#eef0f3): 表格内部分割、列表项分隔。

### Semantic
- **成功** (#22c55e): 完成状态、成功提示。
- **成功-底** (#f0fdf4): 成功状态背景。
- **危险** (#ef4444): 错误状态、删除操作、失败标记。
- **危险-底** (#fef2f2): 错误状态背景。
- **警告** (#f59e0b): 暂停状态、需要注意的信息。
- **警告-底** (#fffbeb): 警告状态背景。

### Named Rules

**The ≤10% Rule.** 蓝色（accent）仅用于需要用户行动的元素：主按钮、链接、选中状态、进度条。装饰性使用蓝色是被禁止的。

**The No Pure Black/White Rule.** 禁止使用 #000000 和 #ffffff 作为文本或大面积背景。所有中性色都带蓝灰色调，保持视觉温度一致。

**The Semantic Clarity Rule.** 语义色（success/danger/warning）仅用于状态表达，不用于装饰。一个界面中语义色的使用应该能让用户一眼看出"什么完成了、什么出错了、什么需要注意"。

## 3. Typography

**Font Family:** Inter（系统字体回退栈：-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif）

**Character:** Inter 是现代 SaaS 工具的标准选择，可读性好，中英文混排表现稳定。字间距 -0.01em 让文本看起来更紧凑、更专业。

### Hierarchy (1.25 ratio, rem-based)

- **Display** (700, 2rem/32px, line-height 1.2, letter-spacing -0.02em): 页面主标题，仅用于页面级标题。Tailwind: `text-3xl font-bold tracking-tight`。
- **Title** (600, 1.5rem/24px, line-height 1.25, letter-spacing -0.015em): 区块标题、卡片标题。Tailwind: `text-2xl font-semibold`。
- **Heading** (600, 1.25rem/20px, line-height 1.3, letter-spacing -0.01em): 子区块标题、表单分组。Tailwind: `text-xl font-semibold`。
- **Subheading** (600, 1.125rem/18px, line-height 1.35, letter-spacing -0.01em): 卡片内标题、列表项标题。Tailwind: `text-lg font-semibold`。
- **Body** (400, 1rem/16px, line-height 1.5, letter-spacing -0.01em): 正文、数据、描述。最大行宽 65-75ch。Tailwind: `text-base`。
- **Label** (500, 0.875rem/14px, line-height 1.4, letter-spacing 0): 按钮文字、表单标签、表格单元格。Tailwind: `text-sm font-medium`。
- **Caption** (500, 0.75rem/12px, line-height 1.4, letter-spacing 0.01em): 时间戳、辅助说明、徽章文字。Tailwind: `text-xs font-medium`。

### Named Rules

**The Single Family Rule.** 只用 Inter 一个字体族。产品 UI 不需要 display/body 配对，一个调校好的 sans 就能承载所有层级。

**The Fixed Scale Rule.** 使用固定 rem 缩放（12px → 14px → 16px → 18px → 20px → 24px → 32px），1.25 比率。不用 clamp() 流体缩放。

**The 16px Floor Rule.** 正文和可读内容必须使用 1rem (16px)。14px 仅用于按钮、标签等紧凑 UI 元素，不用于正文段落。

## 4. Elevation

轻量阴影系统，用于建立层次感而非装饰。阴影仅在状态变化时出现（悬停、弹窗、浮层），静态元素默认扁平。

### Shadow Vocabulary
- **微阴影** (`0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)`): 卡片默认状态，几乎不可见，仅提供微妙的层次暗示。
- **悬停阴影** (`0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)`): 卡片悬停、可交互元素的反馈。
- **浮层阴影** (`0 8px 24px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.06)`): 下拉菜单、弹窗、浮层。

### Named Rules

**The Flat-By-Default Rule.** 静态元素不用阴影。阴影是状态响应（hover、focus、elevation），不是默认装饰。如果一个卡片在静止状态就有明显阴影，那阴影太重了。

**The Subtle Gradient Rule.** 阴影用两层（ambient + direct），不用单层硬阴影。两层阴影模拟真实光照，比单层更自然。

## 5. Components

### Buttons
- **Shape:** 圆角 6px（rounded-sm），不用全圆角。
- **Primary:** 蓝色背景 (#4a6cf7)，白色文字，padding 8px 20px。悬停时背景变深 (#3b5ce6)。
- **Ghost:** 透明背景，次要文本色 (#5f6670)。悬停时背景变为下沉表面色 (#f1f3f5)。
- **Destructive:** 危险色背景 (#ef4444)，白色文字。仅用于删除等不可逆操作。
- **Disabled:** 下沉表面背景 (#f1f3f5)，三级文本色 (#8c939e)。

### Cards
- **Shape:** 圆角 14px（rounded-lg）。
- **Background:** 抬高表面 (#ffffff)。
- **Border:** 1px solid 边框色 (#e2e5ea)。
- **Shadow:** 微阴影，悬停时加深。
- **Padding:** 24px。

### Inputs
- **Shape:** 圆角 6px（rounded-sm）。
- **Background:** 抬高表面 (#ffffff)。
- **Border:** 1px solid 边框色 (#e2e5ea)。
- **Focus:** 边框变为主色 (#4a6cf7)，带 2px 蓝色光晕。
- **Placeholder:** 三级文本色 (#8c939e)。

### Badges
- **Shape:** 全圆角 (9999px)。
- **Default:** 下沉表面背景 (#f1f3f5)，次要文本色 (#5f6670)。
- **Success:** 成功-底背景 (#f0fdf4)，成功色文字 (#22c55e)。
- **Destructive:** 危险-底背景 (#fef2f2)，危险色文字 (#ef4444)。
- **Warning:** 警告-底背景 (#fffbeb)，警告色文字 (#f59e0b)。

### Navigation (Sidebar)
- **Width:** 256px。
- **Background:** 抬高表面 (#ffffff)。
- **Border:** 右边框 1px solid 边框色 (#e2e5ea)。
- **Active Item:** 左侧 3px 蓝色边框，蓝色文本，淡蓝背景 (#eef2ff)。
- **Default Item:** 次要文本色 (#5f6670)，悬停时变为主文本色。

### Tables
- **Header:** 次要文本色 (#5f6670)，Label 字号 (12px)，大写字母。
- **Row:** 主文本色 (#1a1d21)，Body 字号 (14px)。
- **Divider:** 细分隔线色 (#eef0f3)。
- **Hover:** 下沉表面背景 (#f1f3f5)。

### Timeline
- **Line:** 边框色 (#e2e5ea)，宽度 2px。
- **Dot:** 根据状态着色（primary/success/danger/warning），带 2px 白色边框。
- **Card:** 复用 Card 样式。

## 6. Do's and Don'ts

### Do:
- **Do** 用蓝色 (#4a6cf7) 仅限交互元素：主按钮、链接、选中状态、进度指示。
- **Do** 用语义色（success/danger/warning）清晰表达状态，让用户一眼看出什么完成了、什么出错了。
- **Do** 用间距变化创造节奏：标题区块用 24px，列表项用 12px，紧密元素用 8px。
- **Do** 用轻量阴影建立层次，静态元素扁平，状态变化时阴影加深。
- **Do** 用中性灰调让数据成为焦点，界面消失在任务中。

### Don't:
- **Don't** 用蓝色做装饰。PRODUCT.md 说"不要过度使用渐变、毛玻璃、霓虹色等 AI 感视觉元素"，蓝色仅限交互。
- **Don't** 用 #000000 和 #ffffff。所有中性色都带蓝灰色调。
- **Don't** 嵌套卡片。卡片是内容容器，不是布局手段。
- **Don't** 用渐变文字（background-clip: text + gradient）。这是装饰，不是信息。
- **Don't** 用侧边彩色条（border-left > 1px 作为强调）。用完整边框、背景色或前导图标。
- **Don't** 堆砌信息到一个仪表盘。PRODUCT.md 说"不要把所有信息堆在一个仪表盘上，造成信息过载"。
- **Don't** 用对话气泡呈现分析结果。PRODUCT.md 说"分析结果用结构化视图呈现，不用对话气泡"。
