/**
 * Douyin search — DOM + React fiber extraction from search results page.
 * The previous XHR interception + API replay approach was fragile and
 * depended on intercepted URLs that may change. This version navigates
 * directly to the search results page, scrolls to load more, and extracts
 * data from rendered DOM elements + React fiber props.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError } from '@jackwener/opencli/errors';

/**
 * Wait for search results or login wall using MutationObserver (max 8s).
 * Returns 'content' if result cards appeared, 'login_wall' if login gate
 * detected, or 'timeout' if neither appeared within the deadline.
 */
const WAIT_FOR_CONTENT_JS = `
  new Promise((resolve) => {
    const detect = () => {
      if (document.querySelector('.search-result-card')) return 'content';
      const text = document.body?.innerText || '';
      if (/登录后查看|请登录/.test(text)) return 'login_wall';
      return null;
    };
    const found = detect();
    if (found) return resolve(found);
    const observer = new MutationObserver(() => {
      const result = detect();
      if (result) { observer.disconnect(); resolve(result); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve('timeout'); }, 8000);
  })
`;

/**
 * Click a filter option in the search filter panel by its exact text content.
 * The filter panel is opened by clicking the "筛选" span first.
 */
const CLICK_FILTER_JS = (label) => `
  (() => {
    const area = document.querySelector('#search-content-area');
    if (!area) return false;
    const spans = area.querySelectorAll('span');
    for (const s of spans) {
      if (s.textContent.trim() === ${JSON.stringify(label)}) {
        s.click();
        return true;
      }
    }
    return false;
  })()
`;

/**
 * Extract awemeInfo from React fiber tree of a search result card.
 * Walks up the fiber tree to find the component that holds `data.awemeInfo`.
 */
const EXTRACT_JS = `
  (() => {
    const cleanText = (v) => (v || '').replace(/\\s+/g, ' ').trim();

    const results = [];
    const seen = new Set();

    const cards = document.querySelectorAll('.search-result-card');
    for (const card of cards) {
      const firstChild = card.firstElementChild;
      if (!firstChild) continue;

      const fiberKey = Object.keys(firstChild).find(k => k.startsWith('__reactFiber$'));
      if (!fiberKey) continue;

      let current = firstChild[fiberKey];
      let awemeInfo = null;
      for (let i = 0; i < 30 && current; i++) {
        const props = current.memoizedProps || {};
        if (props.data && props.data.awemeInfo) {
          awemeInfo = props.data.awemeInfo;
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
      const isImage = awemeInfo.awemeType === 68 || (awemeInfo.mediaType === 2);
      const video = awemeInfo.video || {};
      const images = awemeInfo.images || [];
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
        url: 'https://www.douyin.com/video/' + awemeId,
        isImage: isImage,
      });
    }

    return results;
  })()
`;

cli({
  site: 'douyin',
  name: 'search',
  description: '搜索抖音视频/用户/话题',
  domain: 'www.douyin.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'keyword', type: 'string', required: true, positional: true, help: '搜索关键词' },
    { name: 'limit', type: 'int', default: 10, help: '最终返回数量' },
    { name: 'sort', type: 'string', default: 'general', choices: ['general', 'latest', 'like'], help: '排序方式: general=综合, latest=最新, like=最多点赞' },
    { name: 'period', type: 'string', default: 'any', choices: ['any', 'day', 'week', 'halfyear'], help: '时间范围: any=不限, day=一天, week=一周, halfyear=半年' },
    { name: 'type', type: 'string', default: 'all', choices: ['all', 'video', 'image'], help: '内容形式: all=全部, video=视频, image=图文' },
  ],
  columns: ['awemeId', 'desc', 'diggCount', 'commentCount', 'shareCount', 'collectCount', 'nickname', 'secUid', 'uid', 'cover', 'url'],
  func: async (page, kwargs) => {
    const keyword = kwargs.keyword;
    const targetLimit = Number(kwargs.limit) || 10;

    await page.goto(`https://www.douyin.com/search/${encodeURIComponent(keyword)}`);

    // Wait for search results to render (or login wall to appear)
    const waitResult = await page.evaluate(WAIT_FOR_CONTENT_JS);
    if (waitResult === 'login_wall') {
      throw new AuthRequiredError('www.douyin.com', 'Douyin search results require login');
    }

    // Apply filters via page interaction (Douyin uses client-side filtering, not URL params)
    const needsFilter = kwargs.sort !== 'general' || kwargs.period !== 'any' || kwargs.type !== 'all';

    if (needsFilter) {
      // Open filter panel
      await page.evaluate(CLICK_FILTER_JS('筛选'));
      await page.wait(500);

      const sortLabelMap = { general: '综合排序', latest: '最新发布', like: '最多点赞' };
      const periodLabelMap = { any: '不限', day: '一天内', week: '一周内', halfyear: '半年内' };
      const typeLabelMap = { all: null, video: '视频', image: '图文' };

      // Click sort option
      if (kwargs.sort !== 'general') {
        const label = sortLabelMap[kwargs.sort];
        if (label) await page.evaluate(CLICK_FILTER_JS(label));
        await page.wait(300);
      }

      // Click period option
      if (kwargs.period !== 'any') {
        const label = periodLabelMap[kwargs.period];
        if (label) await page.evaluate(CLICK_FILTER_JS(label));
        await page.wait(300);
      }

      // Click type option
      if (kwargs.type !== 'all') {
        const label = typeLabelMap[kwargs.type];
        if (label) await page.evaluate(CLICK_FILTER_JS(label));
        await page.wait(300);
      }

      // Wait for results to reload after filter changes
      await page.wait(1500);
    }

    // Scroll to load more results
    const scrollTimes = Math.max(2, Math.ceil(targetLimit / 8));
    await page.autoScroll({ times: scrollTimes });

    // Extract data from DOM + React fiber
    const payload = await page.evaluate(EXTRACT_JS);
    const data = Array.isArray(payload) ? payload : [];

    return data.slice(0, targetLimit).map((item, i) => ({
      rank: i + 1,
      ...item,
    }));
  },
});