# analyze-cli Test Report

> Generated: 2026-04-14T05:38:39.000Z

## Summary

| Metric | Value |
|--------|-------|
| Total Test Files | 6 |
| Total Tests | 68 |
| Passed | 68 ✅ |
| Failed | 0  |
| Cancelled | 0 |
| Offline Tests | 32 |
| Online Tests | 36 |
| Success Rate | 100.0% |
| Total Duration | 48.0s |

## Test Suites

| Suite | Type | Tests | Passed | Failed | Duration |
|-------|------|-------|--------|--------|----------|
| opencli.test.ts | opencli (unit + integration) | 16 | 16 | 0 | 11.2s |
| import-offline.test.ts | import (offline mock) | 11 | 11 | 0 | 0.5s |
| prepare-data-offline.test.ts | prepare-data (offline mock E2E) | 9 | 9 | 0 | 0.4s |
| task-post-status.test.ts | task-post-status (DB integration) | 9 | 9 | 0 | 0.4s |
| prepare-data.test.ts | prepare-data (online E2E) | 10 | 10 | 0 | 7.8s |
| xhs-shanghai-food.test.ts | XHS Shanghai food (real data E2E) | 13 | 13 | 0 | 27.8s |

## Detailed Results

### opencli.test.ts (opencli (unit + integration))

- ✅ should report missing variables (0.796125ms)
- ✅ should substitute variables in command args (6.100542ms)
- ✅ should reject empty template (0.144875ms)
- ✅ should reject whitespace-only template (0.070834ms)
- ✅ should handle empty stdout (2.94875ms)
- ✅ should handle command producing no stdout (3.109958ms)
- ✅ should handle command failure (3.489208ms)
- ✅ should handle timeout errors (203.408083ms)
- ✅ should parse JSON array from command output (4.974042ms)
- ✅ should unwrap {data: [...]} JSON output (2.721875ms)
- ✅ should unwrap {items: [...]} JSON output (3.162541ms)
- ✅ should handle non-JSON text output (3.695708ms)
- ✅ opencli — template substitution (unit) (235.87425ms)
- ✅ should fetch HackerNews top stories (3511.033875ms)
- ✅ should handle variable substitution with exact limit (3094.323459ms)
- ✅ should handle template with all variables substituted (2845.670166ms)
- ✅ should fetch dev.to top stories (public API, no browser) (1318.070708ms)
- ✅ opencli — real data (integration) (10769.518ms)

### import-offline.test.ts (import (offline mock))

- ✅ should import posts from mock JSONL file (11.540458ms)
- ✅ should verify imported posts are queryable (7.359584ms)
- ✅ should verify post content integrity (0.556583ms)
- ✅ should import comments from mock JSONL file for post 1 (7.874417ms)
- ✅ should import comments from mock JSONL file for post 2 (9.066917ms)
- ✅ should verify comment counts match mock data (0.750042ms)
- ✅ should verify comment content integrity (0.933375ms)
- ✅ should import media files from post metadata (7.509333ms)
- ✅ should verify media files are queryable by post (1.256167ms)
- ✅ should handle empty JSONL file gracefully (0.488875ms)
- ✅ should handle malformed JSONL lines (0.56325ms)
- ✅ import — offline mock data (155.25925ms)

### prepare-data-offline.test.ts (prepare-data (offline mock E2E))

- ✅ should create task with mock cli_templates (1.896792ms)
- ✅ should simulate comments fetch from mock data (7.169209ms)
- ✅ should simulate media fetch from mock data (3.814708ms)
- ✅ should track progress for mock data preparation (9.986834ms)
- ✅ should verify breakpoint recovery with mock data (3.286792ms)
- ✅ should create queue jobs from task targets (7.164125ms)
- ✅ should verify full offline data flow (3.457666ms)
- ✅ should handle empty mock comments (0.181875ms)
- ✅ should handle mock media with missing fields (1.3885ms)
- ✅ prepare-data — offline mock E2E (101.334625ms)

### task-post-status.test.ts (task-post-status (DB integration))

- ✅ should create task with cli_templates and retrieve it (3.628708ms)
- ✅ should update cli_templates (2.380833ms)
- ✅ should upsert new post status (5.565916ms)
- ✅ should preserve existing values when upserting with partial updates (4.972334ms)
- ✅ should clear error field on successful upsert (4.606084ms)
- ✅ should get all post statuses for a task (3.000083ms)
- ✅ should return only pending (incomplete) posts (4.773667ms)
- ✅ should handle partial fetch correctly in getPendingPostIds (5.26325ms)
- ✅ should return null for non-existent post status (0.569958ms)
- ✅ task-post-status — real DB (integration) (104.303042ms)

### prepare-data.test.ts (prepare-data (online E2E))

- ✅ should create task with opencli templates and retrieve it (1.851834ms)
- ✅ should verify post and task target binding (2.6435ms)
- ✅ should fetch real data from opencli using the template (3290.094875ms)
- ✅ should import fetched data into DuckDB as comments (2746.514125ms)
- ✅ should import media files into DuckDB from opencli data (1349.045125ms)
- ✅ should track progress in task_post_status (11.372791ms)
- ✅ should skip already-fetched posts on retry (breakpoint recovery) (4.129458ms)
- ✅ should create queue jobs from task targets (6.817583ms)
- ✅ should be able to dequeue and process a job (3.143375ms)
- ✅ should verify full data flow: opencli → import → queue → process (3.910959ms)
- ✅ prepare-data E2E — real opencli data (7479.440542ms)

### xhs-shanghai-food.test.ts (XHS Shanghai food (real data E2E))

- ✅ should fetch real Shanghai food search results (1.444167ms)
- ✅ should fetch real comments from XHS post (1.831417ms)
- ✅ should fetch real media info from XHS post (0.288542ms)
- ✅ should import post into DuckDB (4.846042ms)
- ✅ should import comments into DuckDB (23.697167ms)
- ✅ should import media into DuckDB (8.189792ms)
- ✅ should verify task with real XHS CLI templates (1.435416ms)
- ✅ should simulate prepare-data with real XHS templates (12.06525ms)
- ✅ should verify breakpoint recovery after prepare-data (3.032583ms)
- ✅ should create queue jobs from task targets (5.566917ms)
- ✅ should verify complete E2E data flow (6.160917ms)
- ✅ should verify comment data quality (0.89975ms)
- ✅ should verify media data quality (0.764583ms)
- ✅ xhs shanghai food — real data E2E (27489.325209ms)
