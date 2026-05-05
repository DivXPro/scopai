/**
 * Douyin user-info — extract author info from a user profile page.
 *
 * Usage:
 *   opencli douyin user-info <secUid-or-url>
 *
 * Accepts a secUid or full https://www.douyin.com/user/<secUid> URL.
 * Navigates to the user profile page, extracts userInfo from React fiber.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

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
 * Extract user info from React fiber tree on the profile page.
 */
const EXTRACT_USER_JS = `
  (() => {
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      const keys = Object.keys(el).filter(k => k.startsWith('__reactFiber$'));
      if (keys.length === 0) continue;

      const fiber = el[keys[0]];
      let current = fiber;
      for (let i = 0; i < 30 && current; i++) {
        const props = current.memoizedProps || {};
        const info = props.userInfo || props.user || props.authorInfo;
        if (info && info.secUid) {
          return {
            uid: info.uid || '',
            secUid: info.secUid || '',
            nickname: info.nickname || '',
            desc: info.desc || '',
            gender: info.gender === 1 ? 'male' : info.gender === 2 ? 'female' : 'unknown',
            avatarUrl: info.avatarUrl || info.avatarThumb?.urlList?.[0] || '',
            awemeCount: info.awemeCount ?? 0,
            followingCount: info.followingCount ?? 0,
            followerCount: info.followerCount ?? 0,
            followerCountStr: info.followerCountStr || '',
            totalFavorited: info.totalFavorited ?? 0,
            favoritingCount: info.favoritingCount ?? 0,
            uniqueId: info.uniqueId || '',
            customVerify: info.customVerify || '',
            enterpriseVerifyReason: info.enterpriseVerifyReason || '',
            province: info.province || '',
            city: info.city || '',
            roomId: info.roomId || '',
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
  name: 'user-info',
  description: '获取抖音用户信息',
  domain: 'www.douyin.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'sec-uid', positional: true, required: true, help: 'secUid 或完整 URL (e.g. https://www.douyin.com/user/MS4wLjABAAAA4yR0jTwzHKd6VM1iEPq6XR869vsd_Aq2GtSjT8k_M9A)' },
  ],
  columns: ['field', 'value'],
  func: async (page, kwargs) => {
    const rawInput = String(kwargs['sec-uid']);
    const secUid = parseSecUid(rawInput);

    const targetUrl = `https://www.douyin.com/user/${secUid}`;
    await page.goto(targetUrl);

    const waitResult = await page.evaluate(WAIT_FOR_CONTENT_JS);
    if (waitResult === 'login_wall') {
      throw new CliError('AUTH_REQUIRED', 'Douyin requires login to view this profile', 'Make sure you are logged in to douyin.com in the browser.');
    }

    const data = await page.evaluate(EXTRACT_USER_JS);

    if (!data) {
      throw new CliError('NO_DATA', `User ${secUid} not found or unavailable`, 'The profile may not exist or may be restricted.');
    }

    const rows = [
      { field: 'nickname', value: data.nickname },
      { field: 'secUid', value: data.secUid },
      { field: 'uid', value: data.uid },
      { field: 'desc', value: data.desc },
      { field: 'gender', value: data.gender },
      { field: 'avatarUrl', value: data.avatarUrl },
      { field: 'awemeCount', value: String(data.awemeCount) },
      { field: 'followingCount', value: String(data.followingCount) },
      { field: 'followerCount', value: String(data.followerCount) },
      { field: 'totalFavorited', value: String(data.totalFavorited) },
      { field: 'favoritingCount', value: String(data.favoritingCount) },
      { field: 'uniqueId', value: data.uniqueId },
      { field: 'customVerify', value: data.customVerify },
      { field: 'enterpriseVerifyReason', value: data.enterpriseVerifyReason },
      { field: 'province', value: data.province },
      { field: 'city', value: data.city },
      { field: 'roomId', value: data.roomId },
      { field: 'url', value: targetUrl },
    ];

    return rows;
  },
});
