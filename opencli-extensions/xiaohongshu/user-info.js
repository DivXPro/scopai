import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
cli({
    site: 'xiaohongshu',
    name: 'user-info',
    description: '获取小红书博主信息（名字、粉丝数、头像、IP属地等）',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'author_id', type: 'string', required: true, positional: true, help: '小红书作者ID或主页URL' },
    ],
    columns: ['author_id', 'name', 'avatar', 'followers', 'following', 'ip', 'redId'],
    func: async (page, args) => {
        const rawInput = String(args.author_id || '');
        // Support both bare user ID and full profile URL
        const idMatch = rawInput.match(/\/user\/profile\/([a-zA-Z0-9]+)/i);
        const userId = idMatch ? idMatch[1] : rawInput.trim();
        if (!userId)
            throw new CliError('INVALID_ARGUMENT', 'userId is required');
        const url = `https://www.xiaohongshu.com/user/profile/${userId}`;
        await page.goto(url, { waitUntil: 'load', timeout: 20000 });
        await page.wait({ time: 5 });
        const evalStr = `
      (() => {
        const result = {
          name: '',
          avatar: '',
          followers: '0',
          following: '0',
          ip: '',
          redId: ''
        };

        // Name from title
        result.name = document.title.replace(' - 小红书', '').trim();

        // Avatar - find first image with naturalWidth >= 300 (avatar is typically 300+)
        const imgs = document.querySelectorAll('img');
        for (let i = 0; i < imgs.length; i++) {
          if (imgs[i].naturalWidth >= 300 && imgs[i].naturalHeight >= 300) {
            result.avatar = imgs[i].src;
            break;
          }
        }

        // Followers and following from meta description
        const meta = document.querySelector('meta[name="description"]');
        if (meta && meta.content) {
          let m = meta.content.match(/有(\\d+)位粉丝/);
          if (m) result.followers = m[1];
          m = meta.content.match(/已关注(\\d+)人/);
          if (m) result.following = m[1];
        }

        // IP属地
        const bodyText = document.body.innerText || '';
        const ipMatch = bodyText.match(/IP属地：([^\\n]+)/);
        if (ipMatch) result.ip = ipMatch[1].trim();

        // 小红书号 - look for pattern "小红书号：数字"
        const redIdMatch = bodyText.match(/小红书号：([A-Za-z0-9]+)/);
        if (redIdMatch) result.redId = redIdMatch[1];

        // Fallback: scan for followers in DOM if not found in meta
        if (result.followers === '0') {
          const allEls = document.querySelectorAll('*');
          for (let i = 0; i < allEls.length; i++) {
            const t = allEls[i].textContent.trim();
            if (/^\\d+粉丝$/.test(t) && t.length < 20) {
              result.followers = t.replace('粉丝', '');
              break;
            }
          }
        }

        return result;
      })()
    `;
        const result = await page.evaluate(evalStr);
        if (!result || !result.name) {
            throw new CliError('NO_DATA', '无法获取到博主信息，请确认userId正确');
        }
        return [{
                author_id: userId,
                name: result.name,
                avatar: result.avatar || '',
                followers: result.followers || '0',
                following: result.following || '0',
                ip: result.ip || '',
                redId: result.redId || '',
            }];
    },
});
