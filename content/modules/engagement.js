/**
 * Engagement — reads and changes the things the embedded player cannot show:
 * the like/dislike state of a video and its comments.
 *
 * The embed iframe is a stripped-down WEB_EMBEDDED_PLAYER surface: no like
 * buttons, no comment section, no counts. So this module asks YouTube's own
 * web API (InnerTube) from the parent page, which is the same origin and
 * carries the session cookies, and normalizes the nested renderer payloads
 * into a small, stable shape the overlay can paint:
 *
 *   - `fetchVideoEngagement(videoId)` → like counts/rating, comment total and
 *     the continuation token that opens the comment section.
 *   - `fetchComments(token)` → one page of comments (top level, newest first,
 *     as YouTube returns them) plus the token for the next page.
 *   - `rateVideo(videoId, rating)` → like / dislike / remove a rating.
 *
 * Parsing is deliberately shape-tolerant: YouTube moves these payloads between
 * renderer names fairly often, so the extractors walk for the fields they know
 * rather than trusting one fixed path. Every field is optional; a caller that
 * gets `likeCount: ''` simply shows no count.
 */
(function (YTC) {
    'use strict';

    const NEXT_ENDPOINT = '/youtubei/v1/next';

    /** InnerTube's rating endpoints; removing a rating is its own command. */
    const RATING_ENDPOINTS = {
        like: '/youtubei/v1/like/like',
        dislike: '/youtubei/v1/like/dislike',
        none: '/youtubei/v1/like/removelike'
    };

    const MAX_WALK_DEPTH = 48;
    const COUNT_SUFFIXES = { K: 1e3, M: 1e6, B: 1e9 };

    // ------------------------------------------------------------- JSON walk

    /**
     * Depth-first search for the first object matching `predicate`.
     * Arrays are containers, never matches.
     */
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

    /** Visit every object in the tree (used for entity collections). */
    function forEachObject(root, visit, depth = 0) {
        if (!root || typeof root !== 'object' || depth > MAX_WALK_DEPTH) return;
        if (Array.isArray(root)) {
            for (const child of root) forEachObject(child, visit, depth + 1);
            return;
        }
        visit(root);
        for (const child of Object.values(root)) forEachObject(child, visit, depth + 1);
    }

    // ------------------------------------------------------------ text utils

    /** InnerTube wraps text three different ways; flatten all of them. */
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

    /** `19,493,041`, `19493041`, `1,4K` (European) and `19M` all become a number (or null). */
    function parseCount(value) {
        if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value) : null;

        const text = String(value === null || value === undefined ? '' : value).trim();
        if (!text) return null;

        const match = /(\d[\d.,]*)\s*([KMB])?/i.exec(text);
        if (!match) return null;

        let rawNum = match[1];
        const suffix = (match[2] || '').toUpperCase();

        if (suffix && rawNum.includes(',')) {
            // In European locales (e.g. "1,4K" or "1,45M"), a comma before a suffix is a decimal separator.
            if (/^\d+,\d{1,2}$/.test(rawNum)) {
                rawNum = rawNum.replace(',', '.');
            } else {
                rawNum = rawNum.replace(/,/g, '');
            }
        } else {
            rawNum = rawNum.replace(/,/g, '');
        }

        const base = parseFloat(rawNum);
        if (!Number.isFinite(base)) return null;

        return Math.round(base * (COUNT_SUFFIXES[suffix] || 1));
    }

    /** 19493041 → `19.5M`; small numbers stay exact. */
    function formatCount(value) {
        const count = typeof value === 'number' ? value : parseCount(value);
        if (count === null || !Number.isFinite(count)) return '';
        if (count < 1000) return String(count);

        const trim = (num) => (num >= 100 ? String(Math.round(num)) : String(Math.round(num * 10) / 10).replace(/\.0$/, ''));
        if (count < 1e6) return `${trim(count / 1e3)}K`;
        if (count < 1e9) return `${trim(count / 1e6)}M`;
        return `${trim(count / 1e9)}B`;
    }

    // ------------------------------------------------------ like / dislike

    /** Read `isToggled` anywhere inside a button view model. */
    function readToggleState(viewModel) {
        const toggle = findFirst(viewModel, (node) => typeof node.isToggled === 'boolean');
        return toggle ? toggle.isToggled : null;
    }

    function ratingFromStatus(status) {
        const normalized = String(status || '').toUpperCase();
        if (normalized === 'LIKE') return 'like';
        if (normalized === 'DISLIKE') return 'dislike';
        return 'none';
    }

    /** The segmented like/dislike view model, whichever renderer name it uses. */
    function findSegmentedButtons(data) {
        const host = findFirst(data, (node) => node.segmentedLikeDislikeButtonViewModel);
        return host ? host.segmentedLikeDislikeButtonViewModel : null;
    }

    function extractEngagement(data) {
        if (!data) return null;

        const segmented = findSegmentedButtons(data);
        const countEntity = (segmented && segmented.likeCountEntity) || null;

        // 1. Rating: the like status entity is the authoritative answer.
        const statusHost = findFirst(data, (node) =>
            node.likeStatusEntity && typeof node.likeStatusEntity.likeStatus === 'string');

        let rating = statusHost ? ratingFromStatus(statusHost.likeStatusEntity.likeStatus) : 'none';
        if (!statusHost && segmented) {
            const likeToggled = readToggleState(segmented.likeButtonViewModel);
            const dislikeToggled = readToggleState(segmented.dislikeButtonViewModel);
            if (likeToggled === true) rating = 'like';
            else if (dislikeToggled === true) rating = 'dislike';
        }

        // 2. Like counts: exact number, plus the short label YouTube displays.
        let likeExact = null;
        let likeShort = '';
        if (countEntity) {
            const suffix = rating === 'like' ? 'IfLiked' : rating === 'dislike' ? 'IfDisliked' : 'IfIndifferent';
            likeExact = parseCount(countEntity[`likeCount${suffix}Number`]);
            likeShort = readText(countEntity[`likeCount${suffix}`]);
            if (likeExact === null) {
                likeExact = parseCount(readText(countEntity[`expandedLikeCount${suffix}`]));
            }
        }

        // 3. Fallback for older payloads: the button's own accessibility text,
        //    e.g. "like this video along with 19,493,042 other people".
        if (likeExact === null || !likeShort) {
            const a11yHost = findFirst(data, (node) => node.likeButtonA11yText || node.likeCountA11y);
            if (a11yHost) {
                const a11yText = readText(a11yHost.likeButtonA11yText || a11yHost.likeCountA11y);
                if (likeExact === null) {
                    const match = /along with ([\d,.]+)/i.exec(a11yText);
                    if (match) likeExact = parseCount(match[1]);
                }
                if (!likeShort && /^[\d.,]+\s*[KMB]?$/i.test(a11yText)) likeShort = a11yText;
            }
        }

        // 4. Comment section: the item section carries both the total and the
        //    continuation token the first comment page is fetched with.
        const commentSection = findFirst(data, (node) => node.sectionIdentifier === 'comment-item-section');
        const continuationHost = commentSection
            ? findFirst(commentSection, (node) =>
                node.continuationCommand && typeof node.continuationCommand.token === 'string')
            : null;
        const continuation = continuationHost ? continuationHost.continuationCommand.token : null;

        let commentCountText = '';
        const entryPoint = findFirst(data, (node) => node.commentsEntryPointHeaderRenderer);
        if (entryPoint) {
            commentCountText = readText(entryPoint.commentsEntryPointHeaderRenderer.commentCount);
        }
        if (!commentCountText && commentSection && commentSection.header) {
            const countText = readText(commentSection.header.commentsHeaderRenderer?.countText);
            if (/\d/.test(countText)) commentCountText = countText;
        }
        commentCountText = commentCountText.replace(/\s*[^\d.,\sKMBkmb].*$/, '').trim();

        return {
            rating,
            likeExact,
            likeShort: likeShort || formatCount(likeExact),
            commentCountText,
            commentCount: parseCount(commentCountText),
            continuation
        };
    }

    // ------------------------------------------------------------- comments

    function firstThumbnailUrl(thumbnail) {
        const thumbs = thumbnail && Array.isArray(thumbnail.thumbnails) ? thumbnail.thumbnails : [];
        const last = thumbs[thumbs.length - 1];
        return (last && last.url) || '';
    }

    /** Legacy `commentRenderer` (still used for some shelves and replies). */
    function normalizeLegacyComment(renderer) {
        if (!renderer) return null;
        const viewReplies = renderer.replies &&
            renderer.replies.commentRepliesRenderer &&
            renderer.replies.commentRepliesRenderer.viewReplies;
        return {
            id: renderer.commentId || null,
            author: readText(renderer.authorText),
            avatar: firstThumbnailUrl(renderer.authorThumbnail),
            text: readText(renderer.contentText) || readText(renderer.commentText),
            publishedTime: readText(renderer.publishedTimeText),
            likes: readText(renderer.voteCount),
            replies: readText(viewReplies && viewReplies.buttonRenderer && viewReplies.buttonRenderer.text),
            isCreator: Boolean(renderer.authorIsChannelOwner),
            isHearted: Boolean(renderer.isHearted)
        };
    }

    /** New-style `commentViewModel`, which often only carries the id. */
    function normalizeCommentViewModel(viewModel) {
        if (!viewModel) return null;
        return {
            id: viewModel.commentId || null,
            author: readText(viewModel.authorButtonA11y),
            avatar: firstThumbnailUrl(viewModel.authorThumbnail),
            text: readText(viewModel.contentText),
            publishedTime: readText(viewModel.publishedTimeText),
            likes: readText(viewModel.voteCount),
            replies: readText(viewModel.replyCount),
            isCreator: Boolean(viewModel.authorIsChannelOwner),
            isHearted: Boolean(viewModel.isHearted)
        };
    }

    /**
     * Current YouTube ships comment bodies out-of-band as entities in
     * `frameworkUpdates.entityBatchUpdate.mutations`, keyed by comment id. The
     * visible `commentThreadRenderer` only carries the id, so both are needed.
     */
    function normalizeCommentEntity(payload) {
        if (!payload) return null;

        const properties = payload.properties || {};
        const author = payload.author || {};
        const toolbar = payload.toolbar || {};
        const text = readText(properties.content) || readText(payload.content);

        return {
            id: properties.commentId || payload.commentId || null,
            author: author.displayName || readText(properties.authorButtonA11y),
            avatar: author.avatarThumbnailUrl || '',
            text,
            publishedTime: properties.publishedTime || readText(payload.publishedTime),
            likes: toolbar.likeCountNotliked || toolbar.likeCountLiked || '',
            replies: toolbar.replyCount || '',
            isCreator: Boolean(author.isCreator),
            isHearted: Boolean(properties.isHeartedByUploader) || /❤/.test(toolbar.heartActiveTooltip || '')
        };
    }

    function collectCommentEntities(data) {
        const entities = new Map();
        forEachObject(data, (node) => {
            if (!node.commentEntityPayload) return;
            const comment = normalizeCommentEntity(node.commentEntityPayload);
            if (comment && comment.id) entities.set(comment.id, comment);
        });
        return entities;
    }

    function extractComments(data) {
        if (!data) return { comments: [], continuation: null };

        const entities = collectCommentEntities(data);
        const comments = [];
        const seen = new Set();
        let continuation = null;

        const push = (comment) => {
            if (!comment || !comment.text) return;
            const key = comment.id || `${comment.author}|${comment.text}`;
            if (seen.has(key)) return;
            seen.add(key);
            comments.push(comment);
        };

        const visitItem = (item) => {
            if (!item || typeof item !== 'object') return;

            if (item.commentThreadRenderer) {
                const thread = item.commentThreadRenderer;
                const viewModelHost = thread.commentViewModel;
                const viewModel = viewModelHost && viewModelHost.commentViewModel
                    ? viewModelHost.commentViewModel
                    : viewModelHost;

                const entity = viewModel && viewModel.commentId ? entities.get(viewModel.commentId) : null;
                if (entity) {
                    push(entity);
                } else if (viewModel) {
                    push(normalizeCommentViewModel(viewModel));
                } else if (thread.comment && thread.comment.commentRenderer) {
                    push(normalizeLegacyComment(thread.comment.commentRenderer));
                }
                // Reply continuations belong to the thread, never to the page.
                return;
            }

            if (item.commentRenderer) {
                push(normalizeLegacyComment(item.commentRenderer));
                return;
            }

            if (item.continuationItemRenderer) {
                const host = findFirst(item.continuationItemRenderer, (node) =>
                    node.continuationCommand && typeof node.continuationCommand.token === 'string');
                if (host) continuation = host.continuationCommand.token;
            }
        };

        const batches = []
            .concat(data.onResponseReceivedEndpoints || [])
            .concat(data.onResponseReceivedActions || []);

        for (const batch of batches) {
            for (const key of ['reloadContinuationItemsCommand', 'appendContinuationItemsAction']) {
                const action = batch && batch[key];
                if (!action) continue;

                const items = action.continuationItems ||
                    (action.continuationItemRenderer ? [action.continuationItemRenderer] : []);
                items.forEach(visitItem);
            }
        }

        return { comments, continuation };
    }

    // -------------------------------------------------------------- requests

    async function fetchVideoEngagement(videoId) {
        if (!videoId) return { ok: false, reason: 'no-video' };

        const cfg = YTC.innertube.readConfig();
        if (!cfg) return { ok: false, reason: 'no-config' };

        const res = await YTC.innertube.post(NEXT_ENDPOINT, {
            context: cfg.context,
            videoId
        }, { cfg, signed: true });

        if (!res.ok) return { ok: false, reason: 'http', status: res.status };

        const engagement = extractEngagement(res.data);
        if (!engagement) return { ok: false, reason: 'empty' };

        return { ok: true, engagement };
    }

    async function fetchComments(continuation) {
        if (!continuation) return { ok: false, reason: 'no-token' };

        const cfg = YTC.innertube.readConfig();
        if (!cfg) return { ok: false, reason: 'no-config' };

        const res = await YTC.innertube.post(NEXT_ENDPOINT, {
            context: cfg.context,
            continuation
        }, { cfg, signed: true });

        if (!res.ok) return { ok: false, reason: 'http', status: res.status };

        const parsed = extractComments(res.data);
        return { ok: true, comments: parsed.comments, continuation: parsed.continuation };
    }

    /** Like, dislike or (with 'none') remove the rating on a video. */
    async function rateVideo(videoId, rating) {
        const endpoint = RATING_ENDPOINTS[rating];
        if (!videoId || !endpoint) return { ok: false, reason: 'bad-request' };

        const cfg = YTC.innertube.readConfig();
        if (!cfg) return { ok: false, reason: 'no-config' };
        if (cfg.loggedIn === false) return { ok: false, reason: 'signed-out' };

        const auth = await YTC.innertube.requestAuth(cfg);
        if (!auth) return { ok: false, reason: 'signed-out' };

        const res = await YTC.innertube.post(endpoint, {
            context: cfg.context,
            target: { videoId }
        }, { cfg, auth });

        if (!res.ok) return { ok: false, reason: 'http', status: res.status };
        return { ok: true, rating };
    }

    YTC.engagement = {
        fetchVideoEngagement,
        fetchComments,
        rateVideo,
        extractEngagement,
        extractComments,
        formatCount,
        parseCount
    };
})(globalThis.YTC);
