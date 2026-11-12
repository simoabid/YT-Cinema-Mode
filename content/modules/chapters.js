/**
 * Chapters & Video Info — extracts timestamps and metadata from InnerTube
 * `/youtubei/v1/next` payloads or raw description text.
 */
(function (YTC) {
    'use strict';

    const NEXT_ENDPOINT = '/youtubei/v1/next';
    const MAX_WALK_DEPTH = 48;

    function findFirst(root, predicate, depth = 0) {
        if (!root || typeof root !== 'object' || depth > MAX_WALK_DEPTH) return null;
        if (!Array.isArray(root) && predicate(root)) return root;

        const children = Array.isArray(root) ? root : Object.values(root);
        for (const child of children) {
            const found = findFirst(child, predicate, depth + 1);
            if (found) return found;
        }
        return null;
    }

    function forEachObject(root, visit, depth = 0) {
        if (!root || typeof root !== 'object' || depth > MAX_WALK_DEPTH) return;
        if (Array.isArray(root)) {
            for (const child of root) forEachObject(child, visit, depth + 1);
            return;
        }
        visit(root);
        for (const child of Object.values(root)) forEachObject(child, visit, depth + 1);
    }

    function readText(value) {
        if (value === null || value === undefined) return '';
        if (typeof value === 'string') return value;
        if (typeof value === 'number') return String(value);
        if (Array.isArray(value.runs)) {
            return value.runs.map((run) => (run && typeof run.text === 'string' ? run.text : '')).join('');
        }
        if (typeof value.simpleText === 'string') return value.simpleText;
        if (typeof value.content === 'string') return value.content;
        if (value.content && typeof value.content === 'object') return readText(value.content);
        return '';
    }

    function formatTimestamp(seconds) {
        const safe = (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0)
            ? Math.floor(seconds)
            : 0;
        const hrs = Math.floor(safe / 3600);
        const mins = Math.floor((safe % 3600) / 60);
        const secs = safe % 60;
        if (hrs > 0) {
            return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
        return `${mins}:${String(secs).padStart(2, '0')}`;
    }

    function parseTimeToken(token) {
        if (!token || typeof token !== 'string') return null;
        const parts = token.trim().split(':').map((p) => parseInt(p, 10));
        if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
        if (parts.length === 2) {
            const [mins, secs] = parts;
            if (secs >= 60) return null;
            return mins * 60 + secs;
        }
        if (parts.length === 3) {
            const [hrs, mins, secs] = parts;
            if (mins >= 60 || secs >= 60) return null;
            return hrs * 3600 + mins * 60 + secs;
        }
        return null;
    }

    function cleanChapterTitle(raw) {
        return String(raw || '')
            .replace(/^[\s\-–—|:•.\])]+/, '')
            .replace(/[\s\-–—|:•\[(]+$/, '')
            .trim();
    }

    function parseTimestamps(descriptionText) {
        if (!descriptionText || typeof descriptionText !== 'string') return [];

        const bySecond = new Map();
        const lines = descriptionText.split(/\r?\n/);

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            // Pattern 1: Leading timestamp, e.g. "0:00 Intro", "1) [01:23] - Setup"
            let match = /^(?:\d+[.)]\s*|[-•*]\s*)?[\[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?(?=$|\s|[-–—|:])\s*(.+)$/.exec(trimmed);
            let timeStr = match ? match[1] : null;
            let rawTitle = match ? match[2] : null;

            // Pattern 2: Trailing timestamp, e.g. "Intro - 0:00" or "Outro (12:30)"
            if (!match) {
                match = /^(.+?)\s*[-–—|:(\[]+\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*[\])]?$/.exec(trimmed);
                if (match) {
                    rawTitle = match[1];
                    timeStr = match[2];
                }
            }

            if (!timeStr) continue;
            const startSeconds = parseTimeToken(timeStr);
            const title = cleanChapterTitle(rawTitle);
            if (startSeconds === null || !title) continue;

            if (!bySecond.has(startSeconds)) {
                bySecond.set(startSeconds, {
                    title,
                    startSeconds,
                    timeText: formatTimestamp(startSeconds)
                });
            }
        }

        return Array.from(bySecond.values()).sort((a, b) => a.startSeconds - b.startSeconds);
    }

    function extractMetadata(data) {
        const primaryHost = findFirst(data, (node) => node.videoPrimaryInfoRenderer);
        const primary = primaryHost ? primaryHost.videoPrimaryInfoRenderer : null;

        const secondaryHost = findFirst(data, (node) => node.videoSecondaryInfoRenderer);
        const secondary = secondaryHost ? secondaryHost.videoSecondaryInfoRenderer : null;

        const descHeaderHost = findFirst(data, (node) => node.videoDescriptionHeaderRenderer);
        const descHeader = descHeaderHost ? descHeaderHost.videoDescriptionHeaderRenderer : null;

        const ownerHost = findFirst(data, (node) => node.videoOwnerRenderer);
        const owner = ownerHost ? ownerHost.videoOwnerRenderer : null;

        const attrDescHost = findFirst(data, (node) =>
            node.attributedDescription || node.attributedDescriptionBodyText);
        const descBodyHost = findFirst(data, (node) => node.descriptionBodyTextRenderer);

        const title = readText(primary && primary.title)
            || readText(descHeader && descHeader.title)
            || '';

        const channelName = readText(owner && owner.title)
            || readText(descHeader && descHeader.channel)
            || '';

        const viewRenderer = primary && primary.viewCount && primary.viewCount.videoViewCountRenderer;
        const viewCountText = readText(viewRenderer && (viewRenderer.shortViewCount || viewRenderer.viewCount))
            || readText(descHeader && descHeader.views)
            || '';

        const publishedText = readText(primary && (primary.relativeDateText || primary.dateText))
            || readText(descHeader && descHeader.publishDate)
            || '';

        const description = readText(attrDescHost && (attrDescHost.attributedDescription || attrDescHost.attributedDescriptionBodyText))
            || readText(secondary && secondary.description)
            || readText(descBodyHost && descBodyHost.descriptionBodyTextRenderer && descBodyHost.descriptionBodyTextRenderer.text)
            || '';

        return { title, channelName, viewCountText, publishedText, description };
    }

    function extractStructuredChapters(data) {
        const bySecond = new Map();

        const pushChapter = (titleRaw, startSecondsRaw) => {
            const title = cleanChapterTitle(readText(titleRaw));
            const startSeconds = Number.isFinite(Number(startSecondsRaw))
                ? Math.max(0, Math.floor(Number(startSecondsRaw)))
                : null;
            if (!title || startSeconds === null) return;
            if (!bySecond.has(startSeconds)) {
                bySecond.set(startSeconds, {
                    title,
                    startSeconds,
                    timeText: formatTimestamp(startSeconds)
                });
            }
        };

        forEachObject(data, (node) => {
            if (node.macroMarkersListEntity && node.macroMarkersListEntity.markersList) {
                const markers = node.macroMarkersListEntity.markersList.markers;
                if (Array.isArray(markers)) {
                    for (const marker of markers) {
                        if (!marker || marker.startMillis === undefined) continue;
                        pushChapter(marker.title, Number(marker.startMillis) / 1000);
                    }
                }
            }

            if (node.chapterRenderer) {
                const ch = node.chapterRenderer;
                if (ch.timeRangeStartMillis !== undefined) {
                    pushChapter(ch.title, Number(ch.timeRangeStartMillis) / 1000);
                }
            }

            if (node.macroMarkersListItemRenderer) {
                const item = node.macroMarkersListItemRenderer;
                const onTapSec = item.onTap?.watchEndpoint?.startTimeSeconds;
                const parsedTime = parseTimeToken(readText(item.timeDescription));
                const sec = onTapSec !== undefined ? Number(onTapSec) : parsedTime;
                if (sec !== null && !Number.isNaN(sec)) {
                    pushChapter(item.title, sec);
                }
            }
        });

        return Array.from(bySecond.values()).sort((a, b) => a.startSeconds - b.startSeconds);
    }

    function extractFromNext(data) {
        if (!data || typeof data !== 'object') {
            return {
                meta: { title: '', channelName: '', viewCountText: '', publishedText: '', description: '' },
                chapters: []
            };
        }

        const meta = extractMetadata(data);
        let chapters = extractStructuredChapters(data);
        if (chapters.length === 0 && meta.description) {
            chapters = parseTimestamps(meta.description);
        }
        return { meta, chapters };
    }

    async function fetchVideoChapters(videoId) {
        if (!videoId) return { ok: false, reason: 'no-video', meta: null, chapters: [] };

        const cfg = YTC.innertube.readConfig();
        if (!cfg) return { ok: false, reason: 'no-config', meta: null, chapters: [] };

        const res = await YTC.innertube.post(NEXT_ENDPOINT, {
            context: cfg.context,
            videoId
        });

        if (!res.ok) return { ok: false, reason: 'http', status: res.status, meta: null, chapters: [] };

        const extracted = extractFromNext(res.data);
        return { ok: true, meta: extracted.meta, chapters: extracted.chapters };
    }

    YTC.chapters = { fetchVideoChapters, extractFromNext, parseTimestamps, formatTimestamp };
})(globalThis.YTC);
