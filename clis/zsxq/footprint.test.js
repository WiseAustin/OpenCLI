import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '../../dist/src/registry.js';
import './footprint.js';

describe('zsxq footprint command', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        fs.rmSync(path.resolve('./.test-exports'), { recursive: true, force: true });
    });

    it('collects matching topics and comments for a target author', async () => {
        const command = getRegistry().get('zsxq/footprint');
        expect(command?.func).toBeTypeOf('function');

        const mockPage = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    url: 'https://api.zsxq.com/v2/groups',
                    data: {
                        succeeded: true,
                        resp_data: {
                            groups: [{
                                group_id: 88512145458842,
                                name: '测试星球',
                            }],
                        },
                    },
                })
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    url: 'https://api.zsxq.com/v2/groups/88512145458842/topics?scope=all&count=20',
                    data: {
                        succeeded: true,
                        resp_data: {
                            topics: [{
                                topic_id: 'topic-1',
                                type: 'talk',
                                title: '第一条发言',
                                owner: { name: '反诈先锋' },
                                talk: { text: '第一条发言正文', owner: { name: '反诈先锋' } },
                                comments_count: 1,
                                likes_count: 2,
                                create_time: '2026-04-16T10:00:00+08:00',
                            }],
                            end_time: '',
                        },
                    },
                })
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    url: 'https://api.zsxq.com/v2/groups/88512145458842/topics/topic-1',
                    data: {
                        succeeded: true,
                        resp_data: {
                            topic: {
                                topic_id: 'topic-1',
                                type: 'talk',
                                owner: { name: '反诈先锋' },
                                talk: { text: '第一条发言正文', owner: { name: '反诈先锋' } },
                                attachments: [{ name: '附件.pdf', url: 'https://example.com/a.pdf' }],
                                comments_count: 1,
                                likes_count: 2,
                                create_time: '2026-04-16T10:00:00+08:00',
                            },
                        },
                    },
                })
                .mockResolvedValueOnce({
                    ok: true,
                    status: 200,
                    url: 'https://api.zsxq.com/v2/groups/88512145458842/topics/topic-1/comments?sort=asc&count=20',
                    data: {
                        succeeded: true,
                        resp_data: {
                            comments: [{
                                comment_id: 'comment-1',
                                owner: { name: '反诈先锋' },
                                text: '这是评论里的回复',
                                created_at: '2026-04-16T11:00:00+08:00',
                                repliee: { name: '其他人' },
                            }],
                            end_time: '',
                        },
                    },
                }),
        };

        const rows = await command.func(mockPage, {
            author: '反诈先锋',
            group_id: '88512145458842',
            output: './.test-exports',
        });

        expect(mockPage.goto).toHaveBeenCalledWith('https://wx.zsxq.com/group/88512145458842');
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            kind: 'comment',
            author: '反诈先锋',
            reply_to: '其他人',
            content: '这是评论里的回复',
        });
        expect(rows[1]).toMatchObject({
            kind: 'topic',
            author: '反诈先锋',
            attachments: '附件.pdf (https://example.com/a.pdf)',
        });
        expect(fs.existsSync(path.resolve('./.test-exports/zsxq/group-88512145458842/反诈先锋/footprint.json'))).toBe(true);
        expect(fs.existsSync(path.resolve('./.test-exports/zsxq/group-88512145458842/反诈先锋/footprint.md'))).toBe(true);
    });
});
