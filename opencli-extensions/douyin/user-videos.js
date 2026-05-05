/**
 * Douyin user-videos — list posts from a user profile page via DOM + React fiber.
 *
 * Usage:
 *   opencli douyin user-videos <secUid-or-url> --limit 30
 *
 * Accepts a secUid or full https://www.douyin.com/user/<secUid> URL.
 * Navigates to the user profile page, scrolls to load more posts,
 * and extracts post data from React fiber on each card element.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';

/**
 * Extract secUid from input — accepts bare secUid or full URL.
 */
function parseSecUid(input) {
  const trimmed = String(input).trim();
  const urlMatch = trimmed.match(/douyin\.com\/user\/([A-Za-z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  if (/^[A-Za-z0-9_-]+$/.test(trimmed)) return trimmed;
  throw new CliError('ARGUMENT', `Invalid input: "${trimmed}"`, 'Provide a secUid or a full URL (e.g. https://www.douyin.com/user/MS4wLjABAAAA4yR0jTwzHKd6VM1iEPq6XR869vsd_Aq2GtSjT8k_M9A)');
}

/**
 * Wait for user profile content or login wall using MutationObserver (max 8s).
 */
const WAIT_FOR_CONTENT_JS = `
  new Promise((resolve) => {
    const detect = () => {
      if (!document.body) return null;
      const text = document.body.innerText || '';
      if (/登录后查看|请登录/.test(text)) return 'login_wall';
      if (document.querySelector('a[href*="/video/"], [class*="user-info"], [class*="account"], [class*="nickname"]')) return 'content';
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
 * Extract post data from React fiber on user profile page.
 * Each a[href*="/video/"] element has awemeInfo at depth ~3.
 */
const EXTRACT_JS = `
  (() => {
    const cleanText = (v) => (v || '').replace(/\\s+/g, ' ').trim();

    const results = [];
    const seen = new Set();

    const links = document.querySelectorAll('a[href*="/video/"]');
    for (const el of links) {
      const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
      if (!fiberKey) continue;

      let current = el[fiberKey];
      let awemeInfo = null;
      for (let i = 0; i < 15 && current; i++) {
        const props = current.memoizedProps || {};
        if (props.awemeInfo && props.awemeInfo.awemeId) {
          awemeInfo = props.awemeInfo;
          break;
        }
        current = current.return;
      }

      if (!awemeInfo) continue;

      const awemeId = awemeInfo.awemeId;
      if (!awemeId || seen.has(awemeId)) continue;
      seen.add(awemeId);

      const stats = awemeInfo.stats || {};
      const authorInfo = awemeInfo.authorInfo || {};
      const video = awemeInfo.video || {};
      const images = awemeInfo.images || [];
      const isImage = awemeInfo.awemeType === 68 || awemeInfo.mediaType === 2;
      const coverImage = video.cover || (images[0]?.urlList?.[0]) || '';

      results.push({
        awemeId: awemeId,
        desc: cleanText(awemeInfo.desc || awemeInfo.itemTitle || ''),
        diggCount: stats.diggCount ?? 0,
        commentCount: stats.commentCount ?? 0,
        shareCount: stats.shareCount ?? 0,
        collectCount: stats.collectCount ?? 0,
        nickname: authorInfo.nickname || '',
        secUid: authorInfo.secUid || '',
        uid: authorInfo.uid || '',
        cover: coverImage,
        isImage: isImage,
        duration: isImage ? 0 : Math.round((video.duration || 0) / 1000),
        createTime: awemeInfo.createTime || 0,
        url: 'https://www.douyin.com/video/' + awemeId,
      });
    }

    return results;
  })()
`;

cli({
  site: 'douyin',
  name: 'user-videos',
  description: '获取抖音用户的作品列表',
  domain: 'www.douyin.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'sec-uid', positional: true, required: true, help: 'secUid 或完整 URL (e.g. https://www.douyin.com/user/MS4wLjABAAAA4yR0jTwzHKd6VM1iEPq6XR869vsd_Aq2GtSjT8k_M9A)' },
    { name: 'limit', type: 'int', default: 20, help: '获取数量' },
  ],
  columns: ['index', 'awemeId', 'desc', 'diggCount', 'commentCount', 'nickname', 'isImage', 'createTime'],
  func: async (page, kwargs) => {
    const rawInput = String(kwargs['sec-uid']);
    const secUid = parseSecUid(rawInput);
    const targetLimit = Number(kwargs.limit) || 20;

    const targetUrl = `https://www.douyin.com/user/${secUid}`;
    await page.goto(targetUrl);

    const waitResult = await page.evaluate(WAIT_FOR_CONTENT_JS);
    if (waitResult === 'login_wall') {
      throw new AuthRequiredError('www.douyin.com', 'Douyin requires login to view this profile');
    }

    // Scroll to load more posts
    const scrollTimes = Math.max(3, Math.ceil(targetLimit / 6));
    await page.autoScroll({ times: scrollTimes });

    const payload = await page.evaluate(EXTRACT_JS);
    const data = Array.isArray(payload) ? payload : [];

    return data.slice(0, targetLimit).map((item, i) => {
      const createTimeStr = item.createTime
        ? new Date(item.createTime * 1000).toISOString().replace('T', ' ').substring(0, 19)
        : '';

      return {
        index: i + 1,
        ...item,
        duration: item.isImage ? '-' : `${item.duration}s`,
        createTime: createTimeStr,
      };
    });
  },
});
