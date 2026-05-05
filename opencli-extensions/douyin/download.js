/**
 * Douyin download — download video or images from a post.
 *
 * Usage:
 *   opencli douyin download <aweme-id-or-url> --output ./douyin-downloads
 *
 * Accepts an aweme_id or full douyin.com/video/<aweme_id> URL.
 * Navigates to the detail page, extracts media URLs from React fiber,
 * and downloads video (mp4) or images (webp/jpeg) to the output directory.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { formatCookieHeader, httpDownload } from '@jackwener/opencli/download';
import { CliError } from '@jackwener/opencli/errors';

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

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
      const text = document.body?.innerText || '';
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
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve('timeout'); }, 8000);
  })
`;

/**
 * Extract media URLs from React fiber tree on the detail page.
 * Walks all DOM elements to find the component holding awemeInfo.
 */
const EXTRACT_MEDIA_JS = `
  (() => {
    const result = {
      awemeId: '',
      title: '',
      author: '',
      media: []
    };

    const seen = new Set();
    const pushMedia = (type, url) => {
      if (!url) return;
      const key = type + ':' + url;
      if (seen.has(key)) return;
      seen.add(key);
      result.media.push({ type, url });
    };

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
          result.awemeId = info.awemeId;
          result.title = (info.desc || info.itemTitle || '').replace(/\\s+/g, ' ').trim() || 'untitled';
          result.author = info.authorInfo?.nickname || 'unknown';

          const isImage = info.awemeType === 68 || info.mediaType === 2;

          if (isImage) {
            const images = info.images || [];
            for (const img of images) {
              const urls = img.urlList || [];
              if (urls[0]) pushMedia('image', urls[0]);
            }
          } else {
            const video = info.video || {};
            const playAddr = video.playAddr || [];
            if (playAddr[0]?.src) pushMedia('video', playAddr[0].src);
          }

          return result;
        }
        current = current.return;
      }
    }

    return result;
  })()
`;

cli({
  site: 'douyin',
  name: 'download',
  description: '下载抖音视频或图文中的图片',
  domain: 'www.douyin.com',
  strategy: Strategy.COOKIE,
  navigateBefore: false,
  args: [
    { name: 'aweme-id', positional: true, required: true, help: 'aweme_id 或完整 URL (e.g. https://www.douyin.com/video/7597309249148046602)' },
    { name: 'output', default: './douyin-downloads', help: '输出目录' },
  ],
  columns: ['index', 'type', 'status', 'size'],
  func: async (page, kwargs) => {
    const rawInput = String(kwargs['aweme-id']);
    const output = kwargs.output;
    const awemeId = parseAwemeId(rawInput);

    // If input is a full URL, navigate directly; otherwise construct /video/ path
    const isFullUrl = /^https?:\/\//.test(rawInput);
    const targetUrl = isFullUrl ? rawInput : `https://www.douyin.com/video/${awemeId}`;

    await page.goto(targetUrl);

    const waitResult = await page.evaluate(WAIT_FOR_CONTENT_JS);
    if (waitResult === 'login_wall') {
      throw new CliError('AUTH_REQUIRED', 'Douyin requires login to view this post', 'Make sure you are logged in to douyin.com in the browser.');
    }

    const data = await page.evaluate(EXTRACT_MEDIA_JS);

    if (!data || !data.media || data.media.length === 0) {
      return [{ index: 0, type: '-', status: 'failed', size: 'No media found' }];
    }

    const cookies = formatCookieHeader(await page.getCookies({ domain: 'douyin.com' }));
    const outputDir = path.join(output, awemeId);
    fs.mkdirSync(outputDir, { recursive: true });

    const results = [];
    for (let i = 0; i < data.media.length; i++) {
      const media = data.media[i];
      const isVideo = media.type !== 'image';
      const ext = isVideo ? 'mp4' : 'jpg';
      const filename = `${awemeId}_${i + 1}.${ext}`;
      const destPath = path.join(outputDir, filename);

      try {
        const result = await httpDownload(media.url, destPath, {
          cookies,
          headers: { Referer: 'https://www.douyin.com/' },
          timeout: isVideo ? 60000 : 30000,
        });

        results.push({
          index: i + 1,
          type: media.type,
          status: result.success ? 'success' : 'failed',
          size: result.success ? formatBytes(result.size) : (result.error || 'unknown error'),
        });
      } catch (err) {
        results.push({
          index: i + 1,
          type: media.type,
          status: 'failed',
          size: err.message || 'unknown error',
        });
      }
    }

    return results;
  },
});