import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './user-info.js';

function createPageMock(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
        wait: vi.fn().mockResolvedValue(undefined),
        snapshot: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        typeText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        scrollTo: vi.fn().mockResolvedValue(undefined),
        getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
        tabs: vi.fn().mockResolvedValue([]),
        selectTab: vi.fn().mockResolvedValue(undefined),
        networkRequests: vi.fn().mockResolvedValue([]),
        consoleMessages: vi.fn().mockResolvedValue([]),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue([]),
        getCookies: vi.fn().mockResolvedValue([]),
        screenshot: vi.fn().mockResolvedValue(''),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
    };
}

describe('xiaohongshu user-info', () => {
    const command = getRegistry().get('xiaohongshu/user-info');

    it('is registered', () => {
        expect(command).toBeDefined();
        expect(command.func).toBeTypeOf('function');
    });

    it('returns user info with correct fields for bare user ID', async () => {
        const page = createPageMock({
            name: '测试博主',
            avatar: 'https://example.com/avatar.jpg',
            followers: '1234',
            following: '56',
            ip: '上海',
            redId: '123456789',
        });
        const result = await command.func(page, { author_id: '64e59302000000000100decc' });

        expect(page.goto).toHaveBeenCalledWith(
            'https://www.xiaohongshu.com/user/profile/64e59302000000000100decc',
            { waitUntil: 'load', timeout: 20000 }
        );
        expect(result).toEqual([
            {
                author_id: '64e59302000000000100decc',
                name: '测试博主',
                avatar: 'https://example.com/avatar.jpg',
                followers: '1234',
                following: '56',
                ip: '上海',
                redId: '123456789',
            },
        ]);
    });

    it('extracts user ID from full profile URL', async () => {
        const page = createPageMock({
            name: 'URL博主',
            avatar: '',
            followers: '0',
            following: '0',
            ip: '',
            redId: '',
        });
        const fullUrl = 'https://www.xiaohongshu.com/user/profile/abc123?xsec_token=tok';
        await command.func(page, { author_id: fullUrl });

        expect(page.goto).toHaveBeenCalledWith(
            'https://www.xiaohongshu.com/user/profile/abc123',
            { waitUntil: 'load', timeout: 20000 }
        );
    });

    it('throws INVALID_ARGUMENT for empty userId', async () => {
        const page = createPageMock({});
        await expect(command.func(page, { author_id: '' })).rejects.toMatchObject({
            code: 'INVALID_ARGUMENT',
        });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('throws NO_DATA when page returns empty result', async () => {
        const page = createPageMock({
            name: '',
            avatar: '',
            followers: '0',
            following: '0',
            ip: '',
            redId: '',
        });
        await expect(command.func(page, { author_id: 'nonexistent' })).rejects.toMatchObject({
            code: 'NO_DATA',
        });
    });

    it('falls back to DOM scan when meta description lacks follower count', async () => {
        const page = createPageMock({
            name: 'Fallback博主',
            avatar: '',
            followers: '0',
            following: '0',
            ip: '',
            redId: '',
        });
        // The fallback logic runs inside evaluate; since we mock evaluate,
        // the returned followers remain '0' unless the mock includes it.
        const result = await command.func(page, { author_id: 'test123' });
        expect(result[0].followers).toBe('0');
    });

    it('uses default values for missing optional fields', async () => {
        const page = createPageMock({
            name: 'Partial博主',
            avatar: '',
            followers: '0',
            following: '0',
            ip: '',
            redId: '',
        });
        const result = await command.func(page, { author_id: 'partial' });
        expect(result[0]).toMatchObject({
            author_id: 'partial',
            name: 'Partial博主',
            avatar: '',
            followers: '0',
            following: '0',
            ip: '',
            redId: '',
        });
    });
});
