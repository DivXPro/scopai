# JSON Array Import Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `post import` and `comment import` support standard JSON array files (`.json`) alongside existing JSONL (`.jsonl`), with auto-detection by file extension.

**Architecture:** Extract the file-reading logic into a small shared helper that returns `unknown[]` based on extension. Both `post.ts` and `comment.ts` call this helper, then keep their existing per-item field mapping unchanged.

**Tech Stack:** TypeScript, Node.js built-in `fs`, Commander.js CLI

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/shared/utils.ts` | Modify | Add `parseImportFile(path: string): unknown[]` helper for auto-detecting `.json` vs `.jsonl` |
| `src/cli/post.ts` | Modify | Replace inline JSONL parsing with `parseImportFile`; update command description |
| `src/cli/comment.ts` | Modify | Replace inline JSONL parsing with `parseImportFile`; update command description |
| `test-data/mock/xhs_posts.json` | Create | JSON array version of existing `xhs_posts.jsonl` test data |
| `test/import-offline.test.ts` | Modify | Add test case for importing `xhs_posts.json` |

---

## Task 1: Add Shared Import File Parser Helper

**Files:**
- Modify: `src/shared/utils.ts`

- [ ] **Step 1: Write the helper function**

Add the following function to the end of `src/shared/utils.ts`:

```typescript
export function parseImportFile(filePath: string): unknown[] {
  const fs = require('fs');
  const content = fs.readFileSync(filePath, 'utf-8');

  if (filePath.endsWith('.jsonl')) {
    return content
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0)
      .map((l: string) => JSON.parse(l));
  }

  if (filePath.endsWith('.json')) {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid JSON array file: expected an array');
    }
    return parsed;
  }

  throw new Error(`Unsupported file format: ${filePath}. Use .json or .jsonl`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/utils.ts
git commit -m "$(cat <<'EOF'
feat: add parseImportFile helper for auto-detecting .json and .jsonl

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Update `post import` to Support JSON Arrays

**Files:**
- Modify: `src/cli/post.ts`

- [ ] **Step 1: Import the helper**

Change the import on line 6 from:

```typescript
import { generateId, now } from '../shared/utils';
```

To:

```typescript
import { generateId, now, parseImportFile } from '../shared/utils';
```

- [ ] **Step 2: Update command description**

Change line 41 from:

```typescript
    .description('Import posts from a JSONL file')
```

To:

```typescript
    .description('Import posts from a JSON or JSONL file')
```

- [ ] **Step 3: Replace inline file parsing with helper**

Replace lines 53-59 (the existing file-read and JSONL parse block):

```typescript
      const fs = require('fs');
      if (!fs.existsSync(opts.file)) {
        console.log(pc.red(`File not found: ${opts.file}`));
        process.exit(1);
      }
      const content = fs.readFileSync(opts.file, 'utf-8');
      const lines = content.split('\n').filter((l: string) => l.trim());
```

With:

```typescript
      const fs = require('fs');
      if (!fs.existsSync(opts.file)) {
        console.log(pc.red(`File not found: ${opts.file}`));
        process.exit(1);
      }

      let items: unknown[];
      try {
        items = parseImportFile(opts.file);
      } catch (err: unknown) {
        console.log(pc.red(`Failed to parse import file: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
```

- [ ] **Step 4: Replace loop variable from `lines` to `items`**

Change line 62 from:

```typescript
      for (const line of lines) {
        try {
          const item: RawPostItem = JSON.parse(line);
```

To:

```typescript
      for (const itemRaw of items) {
        try {
          const item = itemRaw as RawPostItem;
```

- [ ] **Step 5: Build and verify no compile errors**

```bash
npm run build
```

Expected: `tsc` completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli/post.ts
git commit -m "$(cat <<'EOF'
feat: post import supports JSON array files via parseImportFile

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Update `comment import` to Support JSON Arrays

**Files:**
- Modify: `src/cli/comment.ts`

- [ ] **Step 1: Import the helper**

Change the import on line 6 from:

```typescript
import { generateId } from '../shared/utils';
```

To:

```typescript
import { generateId, parseImportFile } from '../shared/utils';
```

- [ ] **Step 2: Update command description**

Change line 29 from:

```typescript
    .description('Import comments from a JSONL file')
```

To:

```typescript
    .description('Import comments from a JSON or JSONL file')
```

- [ ] **Step 3: Replace inline file parsing with helper**

Replace lines 41-47 (the existing file-read and JSONL parse block):

```typescript
      const fs = require('fs');
      if (!fs.existsSync(opts.file)) {
        console.log(pc.red(`File not found: ${opts.file}`));
        process.exit(1);
      }
      const content = fs.readFileSync(opts.file, 'utf-8');
      const lines = content.split('\n').filter((l: string) => l.trim());
```

With:

```typescript
      const fs = require('fs');
      if (!fs.existsSync(opts.file)) {
        console.log(pc.red(`File not found: ${opts.file}`));
        process.exit(1);
      }

      let items: unknown[];
      try {
        items = parseImportFile(opts.file);
      } catch (err: unknown) {
        console.log(pc.red(`Failed to parse import file: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
```

- [ ] **Step 4: Replace loop variable from `lines` to `items`**

Change line 50 from:

```typescript
      for (const line of lines) {
        try {
          const item: RawCommentItem = JSON.parse(line);
```

To:

```typescript
      for (const itemRaw of items) {
        try {
          const item = itemRaw as RawCommentItem;
```

- [ ] **Step 5: Build and verify no compile errors**

```bash
npm run build
```

Expected: `tsc` completes with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/cli/comment.ts
git commit -m "$(cat <<'EOF'
feat: comment import supports JSON array files via parseImportFile

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Create JSON Array Test Data

**Files:**
- Create: `test-data/mock/xhs_posts.json`

- [ ] **Step 1: Create the JSON array file**

Create `test-data/mock/xhs_posts.json` with the same 5 posts as `xhs_posts.jsonl`, but wrapped in a JSON array:

```json
[
  {"noteId": "69a1b2c3d4e5f6a7b8c9d0e1", "displayTitle": "ChatGPT最强AI工具推荐", "desc": "最近用了好多AI工具，觉得ChatGPT真的是最强的，无论是写代码还是写文章都很厉害。大家还有什么好用的AI工具推荐吗？", "user": {"userId": "user001", "nickname": "AI爱好者小王"}, "interactInfo": {"likedCount": 234, "collectedCount": 56, "commentCount": 45}, "type": "text", "lastUpdateTime": "2025-04-10T10:30:00.000Z"},
  {"noteId": "69a1b2c3d4e5f6a7b8c9d0e2", "displayTitle": "AI编程工具横评", "desc": "试用了Cursor、Claude Code、GitHub Copilot三个AI编程工具，来说说我的感受。Cursor的补全真的很强，Claude Code的代码理解能力更好。", "user": {"userId": "user002", "nickname": "程序员老李"}, "interactInfo": {"likedCount": 567, "collectedCount": 123, "commentCount": 89}, "type": "text", "lastUpdateTime": "2025-04-11T14:20:00.000Z"},
  {"noteId": "69a1b2c3d4e5f6a7b8c9d0e3", "displayTitle": "AI画图工具Midjourney教程", "desc": "教大家怎么用Midjourney生成高质量图片。这个AI工具真的很强大，只需要输入文字描述就能生成精美的图片。但是有时候也会翻车，生成的图片不太理想。", "user": {"userId": "user003", "nickname": "设计师大美"}, "interactInfo": {"likedCount": 890, "collectedCount": 234, "commentCount": 67}, "type": "image", "lastUpdateTime": "2025-04-12T09:15:00.000Z"},
  {"noteId": "69a1b2c3d4e5f6a7b8c9d0e4", "displayTitle": "这个AI工具太坑了", "desc": "花了好几百买了一个AI写作工具，结果生成的文章质量很差，完全不能用。大家买AI工具一定要先试用，别被广告骗了。感觉现在AI工具泡沫太大了。", "user": {"userId": "user004", "nickname": "踩坑达人"}, "interactInfo": {"likedCount": 45, "collectedCount": 12, "commentCount": 78}, "type": "text", "lastUpdateTime": "2025-04-12T16:45:00.000Z"},
  {"noteId": "69a1b2c3d4e5f6a7b8c9d0e5", "displayTitle": "2025年AI工具年度报告", "desc": "今年AI工具发展真的很快，从GPT-4到Claude Opus，从Stable Diffusion到Midjourney v6。我觉得明年AI会真正普及到各行各业。大家觉得呢？", "user": {"userId": "user005", "nickname": "科技观察家"}, "interactInfo": {"likedCount": 1200, "collectedCount": 456, "commentCount": 123}, "type": "article", "lastUpdateTime": "2025-04-13T08:00:00.000Z"}
]
```

- [ ] **Step 2: Commit**

```bash
git add test-data/mock/xhs_posts.json
git commit -m "$(cat <<'EOF'
test: add JSON array mock data for import tests

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Add JSON Import Test

**Files:**
- Modify: `test/import-offline.test.ts`

- [ ] **Step 1: Add JSON file path constant**

After line 28, add:

```typescript
const postsJsonFile = path.join(testDir, 'xhs_posts.json');
```

- [ ] **Step 2: Add JSON import test case**

After the existing `"should import posts from mock JSONL file"` test block (after line 91), add a new test:

```typescript
  it('should import posts from mock JSON file', async () => {
    const content = fs.readFileSync(postsJsonFile, 'utf-8');
    const items = JSON.parse(content);
    assert.ok(Array.isArray(items), 'JSON file should contain an array');

    let imported = 0;
    let skipped = 0;
    const jsonPostIds: string[] = [];

    for (const item of items) {
      try {
        const post = await createPost({
          platform_id: TEST_PLATFORM,
          platform_post_id: item.noteId ?? item.id ?? `json_post_${imported}`,
          title: item.displayTitle ?? item.title ?? null,
          content: item.desc ?? item.content ?? '',
          author_id: item.user?.userId ?? null,
          author_name: item.user?.nickname ?? null,
          author_url: null,
          url: null,
          cover_url: null,
          post_type: (item.type ?? null) as any,
          like_count: Number(item.interactInfo?.likedCount ?? 0),
          collect_count: Number(item.interactInfo?.collectedCount ?? 0),
          comment_count: Number(item.interactInfo?.commentCount ?? 0),
          share_count: 0,
          play_count: 0,
          score: null,
          tags: null,
          media_files: null,
          published_at: item.lastUpdateTime ? new Date(item.lastUpdateTime) : null,
          metadata: item,
        });
        jsonPostIds.push(post.id);
        imported++;
      } catch {
        skipped++;
      }
    }

    assert.equal(imported, items.length, `expected ${items.length} posts imported from JSON`);
    assert.equal(skipped, 0, 'expected no skipped posts from JSON');
    assert.equal(jsonPostIds.length, 5);
  });
```

- [ ] **Step 3: Run offline tests**

```bash
npm run test:offline
```

Expected: All tests pass, including the new JSON import test.

- [ ] **Step 4: Commit**

```bash
git add test/import-offline.test.ts
git commit -m "$(cat <<'EOF'
test: add offline test for JSON array post import

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- `post import` supports `.json` arrays → Task 2
- `comment import` supports `.json` arrays → Task 3
- `.jsonl` continues to work → unchanged logic lives in `parseImportFile`
- Auto-detection by extension → `parseImportFile` checks `.endsWith('.json')` / `.endsWith('.jsonl')`
- Field mapping unchanged → both commands reuse existing per-item mapping
- Command descriptions updated → Step 2 in Tasks 2 and 3
- Tests added → Tasks 4 and 5

**Placeholder scan:** No TBD/TODO/fill-in-details found. Every step includes exact code or exact commands.

**Type consistency:** `parseImportFile` returns `unknown[]`; both `post.ts` and `comment.ts` cast via `as RawPostItem` / `as RawCommentItem`, matching existing patterns. Import paths (`../shared/utils`) are consistent.
