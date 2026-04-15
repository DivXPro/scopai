# JSON Array Import Support Design

## Overview
Make `post import` and `comment import` commands support standard JSON array files (`.json`) in addition to the existing JSONL (`.jsonl`) format. JSON array becomes the default/supported first-class format, with auto-detection based on file extension.

## Requirements
- `post import` and `comment import` must accept `.json` files containing a JSON array: `[{...}, {...}]`
- Existing `.jsonl` line-delimited import continues to work unchanged
- Format is auto-detected by file extension:
  - `.json` → parse as JSON array
  - `.jsonl` → parse line-by-line as JSON
- Field mapping logic remains identical regardless of format
- Command descriptions are updated to reflect both supported formats

## Affected Components
- `src/cli/post.ts` — `post import` file reading logic
- `src/cli/comment.ts` — `comment import` file reading logic
- `test/import-offline.test.ts` — add JSON array import test case
- `test-data/mock/xhs_posts.json` — new mock test data file

## Implementation Details

### Auto-Detection Logic
In both `post import` and `comment import`:
1. Read file contents as UTF-8 string
2. If path ends with `.jsonl`:
   - Split by newline, filter empty lines, `JSON.parse` each line
3. If path ends with `.json`:
   - `JSON.parse` the entire file content
   - Validate the result is an array
   - Iterate over array elements

### Error Handling
- If `.json` file fails to parse or does not parse to an array, log a clear error (e.g., `Invalid JSON array file`) and exit with code 1
- Individual element import failures continue to be skipped and counted as `skipped`

### Field Mapping (Unchanged)
After parsing, the per-item field extraction (`RawPostItem` / `RawCommentItem`) and database `createPost` / `createComment` calls remain exactly the same as the current JSONL implementation.

## Testing Plan
- Add a new test case in `test/import-offline.test.ts` that imports `test-data/mock/xhs_posts.json` and asserts the correct number of posts are imported
- Ensure existing JSONL tests continue to pass
