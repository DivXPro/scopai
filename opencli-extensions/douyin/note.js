/**
 * Douyin note — read post content and engagement metrics from a video/image post.
 *
 * Extracts title, author, stats, media info, and hashtags via React fiber.
 * Accepts an aweme_id or full douyin.com/video/<aweme_id> URL.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError, EmptyResultError } from '@jackwener/opencli/errors';

/**
 * Extract aweme_id from input — accepts bare ID or full URL.
 */
function parseAwemeId(input) {
  const trimmed = String(input).trim();
  const urlMatch = trimmed.match(/douyin\.com\/(?:video\/(\d+)|.*[?&]modal_id=(\d+))/);
  if (urlMatch) return urlMatch[1] || urlMatch[2];
  if (/^\d+$/.test(trimmed)) return trimmed;
  throw new CliError('ARGUMENT', `Invalid input: "${trimmed}"`, 'Provide an aweme_id or a full URL (e.g. https://www.douyin.com/video/7597309249148046602 or https://www.douyin.com/jingxuan?modal_id=7597309249148046602)');
}

/**
 * Wait for detail page content or login wall using MutationObserver (max 8s).
 */
const WAIT_FOR_CONTENT_JS = `
  new Promise((resolve) => {
    const detect = () => {
      if (!document.body) return null;
      const text = document.body.innerText || '';
      if (/登录后查看|请登录/.test(text)) return 'login_wall';
      if (document.querySelector('video, img[src*="douyinpic"], .search-result-card')) return 'content';
      return null;
    };
    const found = detect();
    if (found) return resolve(found);
    const observer = new MutationObserver(() => {
      const result = detect();
      if (result) { observer.disconnect(); resolve(result); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve('timeout'); }, 8000);
  })
`;

/**
 * Extract full post data from React fiber tree on the detail page.
 */
const EXTRACT_JS = `
  (() => {
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const keys = Object.keys(el).filter(k => k.startsWith('__reactFiber$'));
      if (keys.length === 0) continue;

      const fiber = el[keys[0]];
      let current = fiber;
      for (let i = 0; i < 30 && current; i++) {
        const props = current.memoizedProps || {};
        const info = props.awemeInfo || props.awemeDetail || props.videoDetail || props.detail;
        if (info && info.awemeId) {
          const stats = info.stats || {};
          const authorInfo = info.authorInfo || {};
          const video = info.video || {};
          const images = info.images || [];
          const isImage = info.awemeType === 68 || info.mediaType === 2;
          const hashtags = (info.textExtra || []).filter(t => t.hashtagName).map(t => t.hashtagName);

          return {
            awemeId: info.awemeId,
            awemeType: info.awemeType,
            mediaType: info.mediaType,
            desc: (info.desc || info.itemTitle || '').replace(/\\s+/g, ' ').trim(),
            nickname: authorInfo.nickname || '',
            secUid: authorInfo.secUid || '',
            uid: authorInfo.uid || '',
            followerCount: authorInfo.followerCount || 0,
            createTime: info.createTime || 0,
            isImage: isImage,
            duration: isImage ? 0 : Math.round((video.duration || 0) / 1000),
            cover: video.cover || (images[0]?.urlList?.[0]) || '',
            imagesCount: isImage ? images.length : 0,
            diggCount: stats.diggCount ?? 0,
            commentCount: stats.commentCount ?? 0,
            shareCount: stats.shareCount ?? 0,
            collectCount: stats.collectCount ?? 0,
            hashtags: hashtags,
            url: 'https://www.douyin.com/video/' + info.awemeId,
          };
        }
        current = current.return;
      }
    }
    return null;
  })()
`;

cli({
  site: 'douyin',
  name: 'note',
  description: '获取抖音帖子正文和互动数据',
  domain: 'www.douyin.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'aweme-id', positional: true, required: true, help: 'aweme_id 或完整 URL (e.g. https://www.douyin.com/video/7597309249148046602)' },
  ],
  columns: ['field', 'value'],
  func: async (page, kwargs) => {
    const rawInput = String(kwargs['aweme-id']);
    const awemeId = parseAwemeId(rawInput);

    // If input is a full URL, navigate directly; otherwise construct /video/ path
    const isFullUrl = /^https?:\/\//.test(rawInput);
    const targetUrl = isFullUrl ? rawInput : `https://www.douyin.com/video/${awemeId}`;

    await page.goto(targetUrl);

    const waitResult = await page.evaluate(WAIT_FOR_CONTENT_JS);
    if (waitResult === 'login_wall') {
      throw new AuthRequiredError('www.douyin.com', 'Douyin requires login to view this post');
    }

    const data = await page.evaluate(EXTRACT_JS);

    if (!data) {
      throw new EmptyResultError('douyin/note', `Post ${awemeId} not found or unavailable — it may have been deleted or restricted`);
    }

    const createTimeStr = data.createTime
      ? new Date(data.createTime * 1000).toISOString().replace('T', ' ').substring(0, 19)
      : '';

    const rows = [
      { field: 'awemeId', value: data.awemeId },
      { field: 'desc', value: data.desc || '' },
      { field: 'nickname', value: data.nickname },
      { field: 'secUid', value: data.secUid },
      { field: 'uid', value: data.uid },
      { field: 'followerCount', value: data.followerCount },
      { field: 'isImage', value: data.isImage ? 'true' : 'false' },
      { field: 'duration', value: data.isImage ? '-' : `${data.duration}s` },
      { field: 'imagesCount', value: data.isImage ? String(data.imagesCount) : '-' },
      { field: 'cover', value: data.cover },
      { field: 'diggCount', value: String(data.diggCount) },
      { field: 'commentCount', value: String(data.commentCount) },
      { field: 'shareCount', value: String(data.shareCount) },
      { field: 'collectCount', value: String(data.collectCount) },
      { field: 'createTime', value: createTimeStr },
      { field: 'url', value: data.url },
    ];

    if (data.hashtags?.length) {
      rows.push({ field: 'hashtags', value: data.hashtags.join(', ') });
    }

    return rows;
  },
});