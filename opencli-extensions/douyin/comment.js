/**
 * Douyin comment — fetch comments from a post with pagination.
 *
 * Usage:
 *   opencli douyin comment <aweme-id-or-url> --limit 50
 *
 * Accepts an aweme_id or full douyin.com/video/<aweme_id> URL.
 * Uses the Douyin comment API with cursor-based pagination via browserFetch
 * to handle a_bogus signing automatically.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError, CommandExecutionError } from '@jackwener/opencli/errors';

/**
 * Extract aweme_id from input — accepts bare ID or full URL.
 */
function parseAwemeId(input) {
  const trimmed = String(input).trim();
  const urlMatch = trimmed.match(/douyin\.com\/(?:video\/(\d+)|.*[?&]modal_id=(\d+))/);
  if (urlMatch) return urlMatch[1] || urlMatch[2];
  if (/^\d+$/.test(trimmed)) return trimmed;
  throw new CliError('ARGUMENT', `Invalid input: "${trimmed}"`, 'Provide an aweme_id or a full URL (e.g. https://www.douyin.com/video/7597309249148046602)');
}

/**
 * Fetch a page of comments from the Douyin API inside the browser context.
 */
const FETCH_COMMENTS_JS = (awemeId, count, cursor) => `
  (async () => {
    const params = new URLSearchParams({
      aweme_id: ${JSON.stringify(awemeId)},
      count: ${JSON.stringify(String(count))},
      cursor: ${JSON.stringify(String(cursor))},
      aid: '6383',
    });
    const res = await fetch('/aweme/v1/web/comment/list/?' + params.toString(), {
      credentials: 'include',
      headers: { referer: 'https://www.douyin.com/' }
    });
    const text = await res.text();
    if (!text) return { comments: [], has_more: 0, cursor: '0' };
    return JSON.parse(text);
  })()
`;

cli({
  site: 'douyin',
  name: 'comment',
  description: '获取抖音帖子评论',
  domain: 'www.douyin.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'aweme-id', positional: true, required: true, help: 'aweme_id 或完整 URL (e.g. https://www.douyin.com/video/7597309249148046602)' },
    { name: 'limit', type: 'int', default: 20, help: '获取数量' },
  ],
  columns: ['index', 'cid', 'text', 'diggCount', 'nickname', 'createTime'],
  func: async (page, kwargs) => {
    const rawInput = String(kwargs['aweme-id']);
    const awemeId = parseAwemeId(rawInput);
    const targetLimit = Number(kwargs.limit) || 20;

    // Navigate to the post page to establish browser context and cookies
    const isFullUrl = /^https?:\/\//.test(rawInput);
    const targetUrl = isFullUrl ? rawInput : `https://www.douyin.com/video/${awemeId}`;
    await page.goto(targetUrl);

    const allComments = [];
    let cursor = 0;
    let hasMore = true;
    const perPage = 20;

    while (hasMore && allComments.length < targetLimit) {
      const data = await page.evaluate(FETCH_COMMENTS_JS(awemeId, perPage, cursor));

      if (data && data.status_code !== undefined && data.status_code !== 0) {
        throw new CommandExecutionError(`Douyin API error ${data.status_code}: ${data.status_msg || 'unknown'}`);
      }

      const comments = data?.comments || [];
      hasMore = !!data?.has_more;
      cursor = Number(data?.cursor) || cursor + perPage;

      for (const c of comments) {
        allComments.push({
          cid: c.cid,
          text: c.text || '',
          diggCount: c.digg_count ?? 0,
          createTime: c.create_time || 0,
          ipLabel: c.ip_label || '',
          replyCommentTotal: c.reply_comment_total ?? 0,
          nickname: c.user?.nickname || '',
          uid: c.user?.uid || '',
          secUid: c.user?.sec_uid || '',
        });
      }

      if (comments.length === 0) break;

      // Small delay between API calls to avoid rate limiting
      await page.wait(0.5);
    }

    return allComments.slice(0, targetLimit).map((item, i) => {
      const createTimeStr = item.createTime
        ? new Date(item.createTime * 1000).toISOString().replace('T', ' ').substring(0, 19)
        : '';

      return {
        index: i + 1,
        ...item,
        createTime: createTimeStr,
      };
    });
  },
});
