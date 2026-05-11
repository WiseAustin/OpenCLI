import fs from 'node:fs';
import path from 'node:path';
import { cli, Strategy } from '../../dist/src/registry.js';
import { CliError } from '../../dist/src/errors.js';
import {
    browserJsonRequest,
    ensureZsxqPage,
    fetchFirstJson,
    getCommentsFromResponse,
    getGroupsFromResponse,
    getTopicFromResponse,
    getTopicsFromResponse,
    toTopicRow,
} from './utils.js';

const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_COMMENT_PAGE_SIZE = 20;
const MAX_PAGES = 500;
const DEFAULT_OUTPUT_ROOT = './exports';

function normalizeText(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function sanitizePathSegment(value) {
    const text = normalizeText(value)
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/\s+/g, ' ')
        .trim();
    return text || 'unknown';
}

function getNextCursorTime(payload, batch, itemTimeKeys = ['create_time', 'time', 'created_at']) {
    const data = payload?.resp_data ?? payload?.data ?? payload ?? {};
    const responseCursor = data.begin_time || data.next_begin_time || data.end_time || data.next_end_time || '';
    if (responseCursor) {
        return normalizeText(responseCursor);
    }

    const lastItem = Array.isArray(batch) && batch.length > 0 ? batch[batch.length - 1] : null;
    if (!lastItem) {
        return '';
    }

    for (const key of itemTimeKeys) {
        const value = normalizeText(lastItem?.[key]);
        if (value) {
            return value;
        }
    }

    return '';
}

function getAuthorName(topic) {
    return normalizeText(
        topic?.owner?.name
        || topic?.talk?.owner?.name
        || topic?.question?.owner?.name
        || topic?.answer?.owner?.name
        || topic?.task?.owner?.name
        || topic?.solution?.owner?.name
        || topic?.author?.name
        || topic?.user?.name,
    );
}

function getCommentAuthor(comment) {
    return normalizeText(comment?.owner?.name || comment?.user?.name || comment?.author?.name);
}

function getCommentReplyTo(comment) {
    return normalizeText(
        comment?.repliee?.name
        || comment?.reply_comment?.owner?.name
        || comment?.reply_comment?.user?.screen_name,
    );
}

function summarizeAttachments(topic) {
    const buckets = [
        topic?.attachments,
        topic?.files,
        topic?.file,
        topic?.resources,
        topic?.resource,
        topic?.topic_files,
        topic?.attachments_detail,
    ];

    const flat = [];
    const pushItem = (item) => {
        if (!item || typeof item !== 'object') return;
        const name = normalizeText(item.name || item.filename || item.file_name || item.title || item.text);
        const url = normalizeText(item.url || item.download_url || item.file_url || item.href);
        const id = normalizeText(item.file_id || item.id || item.resource_id);
        const label = name || id || url;
        if (!label) return;
        flat.push(url && url !== label ? `${label} (${url})` : label);
    };

    for (const bucket of buckets) {
        if (Array.isArray(bucket)) {
            bucket.forEach(pushItem);
        } else if (bucket && typeof bucket === 'object') {
            pushItem(bucket);
        }
    }

    return [...new Set(flat)].join(' | ');
}

async function resolveGroupName(page, groupId) {
    try {
        const { data } = await fetchFirstJson(page, ['https://api.zsxq.com/v2/groups']);
        const groups = getGroupsFromResponse(data);
        const found = groups.find(group => String(group.group_id) === String(groupId));
        return normalizeText(found?.name) || String(groupId);
    } catch {
        return String(groupId);
    }
}

async function fetchAllTopics(page, groupId, pageSize) {
    const topics = [];
    const seen = new Set();
    let beginTime = '';

    for (let i = 0; i < MAX_PAGES; i += 1) {
        const url = new URL(`https://api.zsxq.com/v2/groups/${groupId}/topics`);
        url.searchParams.set('scope', 'all');
        url.searchParams.set('count', String(pageSize));
        if (beginTime) {
            url.searchParams.set('begin_time', beginTime);
        }

        let batch = [];
        let data = null;
        try {
            const response = await fetchFirstJson(page, [url.toString()]);
            data = response.data;
            batch = getTopicsFromResponse(data);
        } catch (error) {
            if (topics.length > 0) break;
            throw error;
        }
        if (!batch.length) break;

        for (const topic of batch) {
            const topicId = String(topic?.topic_id ?? '');
            if (!topicId || seen.has(topicId)) continue;
            seen.add(topicId);
            topics.push(topic);
        }

        const nextBeginTime = getNextCursorTime(data, batch, ['create_time', 'time', 'created_at']);
        if (!nextBeginTime || nextBeginTime === beginTime) break;

        beginTime = nextBeginTime;
        if (batch.length < pageSize) break;
    }

    return topics;
}

async function fetchAllComments(page, groupId, topicId, pageSize) {
    const comments = [];
    const seen = new Set();
    let beginTime = '';

    for (let i = 0; i < MAX_PAGES; i += 1) {
        const url = new URL(`https://api.zsxq.com/v2/groups/${groupId}/topics/${topicId}/comments`);
        url.searchParams.set('sort', 'asc');
        url.searchParams.set('count', String(pageSize));
        if (beginTime) {
            url.searchParams.set('begin_time', beginTime);
        }

        let batch = [];
        let data = null;
        try {
            const response = await fetchFirstJson(page, [url.toString()]);
            data = response.data;
            batch = getCommentsFromResponse(data);
        } catch (error) {
            if (comments.length > 0) break;
            throw error;
        }
        if (!batch.length) break;

        for (const comment of batch) {
            const signature = String(
                comment?.comment_id
                || comment?.id
                || comment?.comment_id_str
                || `${comment?.created_at || ''}|${comment?.owner?.name || ''}|${comment?.text || ''}`,
            );
            if (!signature || seen.has(signature)) continue;
            seen.add(signature);
            comments.push(comment);
        }

        const nextBeginTime = getNextCursorTime(data, batch, ['created_at', 'create_time', 'time']);
        if (!nextBeginTime || nextBeginTime === beginTime) break;

        beginTime = nextBeginTime;
        if (batch.length < pageSize) break;
    }

    return comments;
}

function topicToFootprintRow(topic, groupName, source = 'topic') {
    const row = toTopicRow(topic);
    return {
        ...row,
        kind: source,
        group: normalizeText(groupName) || row.group,
        author: normalizeText(row.author),
        title: normalizeText(row.title),
        content: normalizeText(row.content),
        time: normalizeText(row.time),
        attachments: summarizeAttachments(topic),
    };
}

function commentToFootprintRow({ topic, topicTitle, topicUrl, groupName, comment }) {
    const author = getCommentAuthor(comment);
    return {
        kind: 'comment',
        type: 'comment',
        topic_id: String(topic?.topic_id ?? ''),
        group: normalizeText(groupName) || normalizeText(topic?.group?.name),
        author,
        reply_to: getCommentReplyTo(comment),
        title: normalizeText(topicTitle),
        content: normalizeText(comment?.text),
        comments: topic?.comments_count ?? 0,
        likes: topic?.likes_count ?? 0,
        time: normalizeText(comment?.created_at || comment?.create_time),
        url: normalizeText(topicUrl),
        attachments: '',
    };
}

function buildExportPaths(root, site, groupId, author) {
    const safeSite = sanitizePathSegment(site);
    const safeGroup = sanitizePathSegment(`group-${groupId}`);
    const safeAuthor = sanitizePathSegment(author);
    const baseDir = path.resolve(String(root || DEFAULT_OUTPUT_ROOT), safeSite, safeGroup, safeAuthor);
    return {
        baseDir,
        jsonPath: path.join(baseDir, 'footprint.json'),
        mdPath: path.join(baseDir, 'footprint.md'),
    };
}

function escapeMarkdown(value) {
    return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function buildMarkdownReport({ author, groupName, groupId, rows }) {
    const lines = [
        `# ${author} 的知识星球足迹`,
        '',
        `- 群：${groupName} (${groupId})`,
        `- 作者：${author}`,
        `- 记录数：${rows.length}`,
        '',
        '| kind | time | title | reply_to | attachments |',
        '| --- | --- | --- | --- | --- |',
    ];

    for (const row of rows) {
        lines.push(
            `| ${escapeMarkdown(row.kind || '')} | ${escapeMarkdown(row.time || '')} | ${escapeMarkdown(row.title || row.content || '')} | ${escapeMarkdown(row.reply_to || '')} | ${escapeMarkdown(row.attachments || '')} |`,
        );
    }

    return lines.join('\n') + '\n';
}

function writeFootprintExport({ outputRoot, site, groupId, groupName, author, rows }) {
    const paths = buildExportPaths(outputRoot, site, groupId, author);
    fs.mkdirSync(paths.baseDir, { recursive: true });

    const payload = {
        site,
        group_id: String(groupId),
        group_name: groupName,
        author,
        exported_at: new Date().toISOString(),
        row_count: rows.length,
        rows,
    };

    fs.writeFileSync(paths.jsonPath, JSON.stringify(payload, null, 2), 'utf-8');
    fs.writeFileSync(paths.mdPath, buildMarkdownReport({ author, groupName, groupId, rows }), 'utf-8');

    return paths;
}

cli({
    site: 'zsxq',
    name: 'footprint',
    access: 'read',
    description: '抓取指定成员在星球内的发言、回复、文章和文件元信息',
    domain: 'wx.zsxq.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'author', required: true, positional: true, help: 'Display name to match, e.g. 反诈先锋' },
        { name: 'group_id', help: 'Group ID (optional; defaults to the active group in Chrome)' },
        { name: 'limit', type: 'int', default: 0, help: 'Max rows to return (0 = unlimited)' },
        { name: 'page_size', type: 'int', default: DEFAULT_PAGE_SIZE, help: 'Topics per page when paging history' },
        { name: 'comment_page_size', type: 'int', default: DEFAULT_COMMENT_PAGE_SIZE, help: 'Comments per page when scanning replies' },
        { name: 'output', default: DEFAULT_OUTPUT_ROOT, help: 'Root directory for exported crawl data' },
    ],
    columns: ['kind', 'type', 'topic_id', 'group', 'author', 'reply_to', 'title', 'content', 'attachments', 'comments', 'likes', 'time', 'url'],
    func: async (page, kwargs) => {
        const author = normalizeText(kwargs.author);
        if (!author) {
            throw new CliError('ARGUMENT', 'author is required');
        }

        const groupId = String(kwargs.group_id || '');
        await ensureZsxqPage(page, groupId);

        const targetGroupId = groupId || await (async () => {
            try {
                const { data } = await fetchFirstJson(page, ['https://api.zsxq.com/v2/groups']);
                const groups = getGroupsFromResponse(data);
                return String(groups[0]?.group_id || '');
            } catch {
                return '';
            }
        })();

        if (!targetGroupId) {
            throw new CliError('ARGUMENT', 'Cannot determine group_id', 'Pass --group_id <id> or open the target 知识星球 page in Chrome first');
        }

        const limit = Math.max(0, Number(kwargs.limit) || 0);
        const pageSize = Math.max(1, Math.min(Number(kwargs.page_size) || DEFAULT_PAGE_SIZE, 50));
        const commentPageSize = Math.max(1, Math.min(Number(kwargs.comment_page_size) || DEFAULT_COMMENT_PAGE_SIZE, 50));
        const groupName = await resolveGroupName(page, targetGroupId);

        const topics = await fetchAllTopics(page, targetGroupId, pageSize);
        const results = [];

        for (const summary of topics) {
            const topicId = String(summary?.topic_id ?? '');
            if (!topicId) continue;

            const summaryAuthor = normalizeText(getAuthorName(summary));
            const summaryTitle = normalizeText(summary?.title || summary?.talk?.text || summary?.question?.text || summary?.answer?.text || summary?.task?.text || summary?.solution?.text);
            const summaryUrl = normalizeText(summary?.url || `https://wx.zsxq.com/topic/${topicId}`);

            if (summaryAuthor === author) {
                try {
                    const detailResp = await browserJsonRequest(page, `https://api.zsxq.com/v2/groups/${targetGroupId}/topics/${topicId}`);
                    if (detailResp?.ok) {
                        const detailTopic = getTopicFromResponse(detailResp.data) || summary;
                        const row = topicToFootprintRow(detailTopic, groupName, 'topic');
                        results.push({
                            ...row,
                            author,
                            title: row.title || summaryTitle,
                            url: normalizeText(row.url || summaryUrl),
                        });
                    } else {
                        results.push({
                            ...topicToFootprintRow(summary, groupName, 'topic'),
                            author,
                            title: summaryTitle,
                            url: summaryUrl,
                        });
                    }
                } catch {
                    results.push({
                        ...topicToFootprintRow(summary, groupName, 'topic'),
                        author,
                        title: summaryTitle,
                        url: summaryUrl,
                    });
                }
            }

            let comments = [];
            try {
                comments = await fetchAllComments(page, targetGroupId, topicId, commentPageSize);
            } catch {
                comments = [];
            }

            for (const comment of comments) {
                if (normalizeText(getCommentAuthor(comment)) !== author) continue;
                results.push(commentToFootprintRow({
                    topic: summary,
                    topicTitle: summaryTitle,
                    topicUrl: summaryUrl,
                    groupName,
                    comment,
                }));
            }
        }

        results.sort((a, b) => {
            const at = Date.parse(a.time || '');
            const bt = Date.parse(b.time || '');
            if (!Number.isNaN(at) && !Number.isNaN(bt) && at !== bt) return bt - at;
            return normalizeText(b.time).localeCompare(normalizeText(a.time));
        });

        const finalRows = limit > 0 ? results.slice(0, limit) : results;
        writeFootprintExport({
            outputRoot: kwargs.output,
            site: 'zsxq',
            groupId: targetGroupId,
            groupName,
            author,
            rows: finalRows,
        });

        return finalRows;
    },
});
