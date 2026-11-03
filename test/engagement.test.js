/**
 * Tests for the overlay's like/dislike and comments support.
 *
 * Two layers are covered:
 *   - the InnerTube payload parsers, against the shapes YouTube actually
 *     returns today (segmented like button + comment entities),
 *   - the control itself, with the network layer stubbed out: counts in the
 *     header, optimistic rating with rollback, and the comment drawer.
 */

const { loadExtension, createContext } = require('./harness');

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const ENGAGEMENT_DATA = {
    contents: {
        twoColumnWatchNextResults: {
            results: {
                results: {
                    contents: [{
                        videoPrimaryInfoRenderer: {
                            videoActions: {
                                menuRenderer: {
                                    topLevelButtons: [{
                                        segmentedLikeDislikeButtonViewModel: {
                                            likeButtonViewModel: {
                                                likeButtonViewModel: {
                                                    toggleButtonViewModel: {
                                                        toggleButtonViewModel: {
                                                            defaultButtonViewModel: {
                                                                buttonViewModel: { iconName: 'LIKE', title: '19M' }
                                                            }
                                                        }
                                                    },
                                                    likeStatusEntityKey: 'like-key',
                                                    likeStatusEntity: { key: 'like-key', likeStatus: 'LIKE' }
                                                }
                                            },
                                            dislikeButtonViewModel: {
                                                dislikeButtonViewModel: {
                                                    toggleButtonViewModel: {
                                                        toggleButtonViewModel: {
                                                            defaultButtonViewModel: {
                                                                buttonViewModel: { iconName: 'DISLIKE', title: 'Dislike' }
                                                            }
                                                        }
                                                    }
                                                }
                                            },
                                            likeCountEntity: {
                                                expandedLikeCountIfIndifferent: { content: '19,493,041' },
                                                expandedLikeCountIfLiked: { content: '19,493,042' },
                                                likeCountIfIndifferent: { content: '19M' },
                                                likeCountIfLiked: { content: '19M' },
                                                likeCountIfIndifferentNumber: '19493041',
                                                likeCountIfLikedNumber: '19493042'
                                            }
                                        }
                                    }]
                                }
                            }
                        }
                    }]
                }
            }
        },
        commentsSection: {
            sectionIdentifier: 'comment-item-section',
            header: {
                commentsHeaderRenderer: {
                    countText: { runs: [{ text: '1.4K Comments' }] }
                }
            },
            contents: [{
                continuationItemRenderer: {
                    continuationEndpoint: {
                        continuationCommand: { token: 'COMMENTS-TOKEN' }
                    }
                }
            }]
        }
    }
};

const COMMENTS_DATA = {
    onResponseReceivedEndpoints: [{
        appendContinuationItemsAction: {
            continuationItems: [{
                commentThreadRenderer: {
                    commentViewModel: { commentViewModel: { commentId: 'c1' } },
                    replies: {
                        commentRepliesRenderer: {
                            subThreads: [{
                                continuationItemRenderer: {
                                    continuationEndpoint: {
                                        continuationCommand: { token: 'REPLIES-TOKEN' }
                                    }
                                }
                            }]
                        }
                    }
                }
            }, {
                commentThreadRenderer: {
                    commentViewModel: { commentViewModel: { commentId: 'c2' } }
                }
            }, {
                continuationItemRenderer: {
                    continuationEndpoint: {
                        continuationCommand: { token: 'NEXT-TOKEN' }
                    }
                }
            }]
        }
    }],
    frameworkUpdates: {
        entityBatchUpdate: {
            mutations: [{
                payload: {
                    commentEntityPayload: {
                        properties: {
                            commentId: 'c1',
                            content: { content: 'Great song' },
                            publishedTime: '6 years ago'
                        },
                        author: {
                            displayName: '@alice',
                            avatarThumbnailUrl: 'https://yt3.ggpht.com/a=s88',
                            isCreator: true
                        },
                        toolbar: { likeCountNotliked: '220K', replyCount: '613' }
                    }
                }
            }, {
                payload: {
                    commentEntityPayload: {
                        properties: {
                            commentId: 'c2',
                            content: { content: 'Second comment' },
                            publishedTime: '1 day ago'
                        },
                        author: { displayName: '@bob' },
                        toolbar: { likeCountNotliked: '1', replyCount: '' }
                    }
                }
            }]
        }
    }
};

function setupControl(overrides = {}) {
    const env = loadExtension();
    const calls = { ratings: [], commentTokens: [] };

    env.YTC.engagement.fetchVideoEngagement = overrides.engagement || (async () => ({
        ok: true,
        engagement: {
            rating: 'none',
            likeExact: 100,
            likeShort: '100',
            commentCountText: '2',
            commentCount: 2,
            continuation: 'T1'
        }
    }));

    env.YTC.engagement.fetchComments = overrides.comments || (async (token) => {
        calls.commentTokens.push(token);
        return {
            ok: true,
            comments: [{
                id: 'c1',
                author: '@a',
                text: 'hello world',
                publishedTime: '1 day ago',
                likes: '3',
                replies: '2'
            }],
            continuation: null
        };
    });

    env.YTC.engagement.rateVideo = overrides.rate || (async (videoId, rating) => {
        calls.ratings.push({ videoId, rating });
        return { ok: true };
    });

    const ctx = createContext(env);
    ctx.currentVideoId = 'vid1';

    const control = env.YTC.controls.engagement.createEngagementControl(ctx);
    control.bind();

    return { env, ctx, control, calls };
}

const likeCountText = (ctx) => ctx.els.likeBtn.querySelector('.yt-cinema-rating-count').textContent;
const commentCountText = (ctx) => ctx.els.commentsBtn.querySelector('.yt-cinema-comments-count').textContent;

describe('engagement payload parsing', () => {
    it('reads the like state, the exact count and the comment continuation', () => {
        const env = loadExtension();
        const info = env.YTC.engagement.extractEngagement(ENGAGEMENT_DATA);

        if (!info) throw new Error('nothing was extracted');
        if (info.rating !== 'like') throw new Error(`wrong rating: ${info.rating}`);
        if (info.likeExact !== 19493042) throw new Error(`wrong exact count: ${info.likeExact}`);
        if (info.likeShort !== '19M') throw new Error(`wrong short count: ${info.likeShort}`);
        if (info.commentCountText !== '1.4K') throw new Error(`wrong comment label: ${info.commentCountText}`);
        if (info.commentCount !== 1400) throw new Error(`wrong comment total: ${info.commentCount}`);
        if (info.continuation !== 'COMMENTS-TOKEN') {
            throw new Error(`wrong continuation: ${info.continuation}`);
        }
    });

    it('reads an indifferent rating as no rating', () => {
        const env = loadExtension();
        const data = JSON.parse(JSON.stringify(ENGAGEMENT_DATA));
        const seg = data.contents.twoColumnWatchNextResults.results.results.contents[0]
            .videoPrimaryInfoRenderer.videoActions.menuRenderer.topLevelButtons[0]
            .segmentedLikeDislikeButtonViewModel;
        seg.likeButtonViewModel.likeButtonViewModel.likeStatusEntity.likeStatus = 'INDIFFERENT';

        const info = env.YTC.engagement.extractEngagement(data);
        if (info.rating !== 'none') throw new Error(`wrong rating: ${info.rating}`);
        if (info.likeExact !== 19493041) throw new Error(`wrong exact count: ${info.likeExact}`);
    });

    it('joins comment entities with their thread renderers in order', () => {
        const env = loadExtension();
        const parsed = env.YTC.engagement.extractComments(COMMENTS_DATA);

        if (parsed.comments.length !== 2) {
            throw new Error(`expected 2 comments, got ${parsed.comments.length}`);
        }
        const [first, second] = parsed.comments;
        if (first.id !== 'c1' || second.id !== 'c2') throw new Error('comments are out of order');
        if (first.text !== 'Great song') throw new Error(`wrong body: ${first.text}`);
        if (first.author !== '@alice') throw new Error(`wrong author: ${first.author}`);
        if (first.avatar !== 'https://yt3.ggpht.com/a=s88') throw new Error('avatar was not read');
        if (first.publishedTime !== '6 years ago') throw new Error('published time was not read');
        if (first.likes !== '220K' || first.replies !== '613') {
            throw new Error(`wrong toolbar: ${first.likes}/${first.replies}`);
        }
        if (!first.isCreator) throw new Error('creator badge was lost');
        if (parsed.continuation !== 'NEXT-TOKEN') {
            throw new Error(`wrong page continuation: ${parsed.continuation}`);
        }
    });

    it('still parses legacy commentRenderer payloads', () => {
        const env = loadExtension();
        const parsed = env.YTC.engagement.extractComments({
            onResponseReceivedActions: [{
                appendContinuationItemsAction: {
                    continuationItems: [{
                        commentRenderer: {
                            commentId: 'old1',
                            authorText: { simpleText: '@legacy' },
                            contentText: { runs: [{ text: 'legacy body' }] },
                            publishedTimeText: { runs: [{ text: '2 years ago' }] },
                            voteCount: { simpleText: '12' },
                            authorThumbnail: { thumbnails: [{ url: 'https://x/1' }] },
                            authorIsChannelOwner: true
                        }
                    }]
                }
            }]
        });

        if (parsed.comments.length !== 1) throw new Error('legacy comment was skipped');
        const comment = parsed.comments[0];
        if (comment.text !== 'legacy body') throw new Error(`wrong body: ${comment.text}`);
        if (comment.author !== '@legacy') throw new Error(`wrong author: ${comment.author}`);
        if (comment.likes !== '12') throw new Error(`wrong likes: ${comment.likes}`);
        if (!comment.isCreator) throw new Error('creator flag was lost');
    });

    it('formats counts the way YouTube does', () => {
        const env = loadExtension();
        const cases = [
            [999, '999'],
            [1000, '1K'],
            [19493042, '19.5M'],
            [1250000000, '1.3B'],
            ['', '']
        ];
        for (const [input, expected] of cases) {
            const actual = env.YTC.engagement.formatCount(input);
            if (actual !== expected) throw new Error(`formatCount(${input}) = ${actual}`);
        }
    });

    it('parses counts correctly including European decimal commas', () => {
        const env = loadExtension();
        const cases = [
            ['999', 999],
            ['1K', 1000],
            ['1,4K', 1400],
            ['1.4K', 1400],
            ['19,493,042', 19493042],
            ['19.5M', 19500000],
            ['1,5M', 1500000],
            ['1.3B', 1300000000],
            ['', null]
        ];
        for (const [input, expected] of cases) {
            const actual = env.YTC.engagement.parseCount(input);
            if (actual !== expected) throw new Error(`parseCount(${input}) = ${actual}, expected ${expected}`);
        }
    });
});

describe('engagement control', () => {
    it('shows the like count and the comment total in the header', async () => {
        const { ctx } = setupControl();
        await wait(5);

        if (likeCountText(ctx) !== '100') throw new Error(`wrong like count: ${likeCountText(ctx)}`);
        if (commentCountText(ctx) !== '2') throw new Error(`wrong comment count: ${commentCountText(ctx)}`);
        if (ctx.els.likeBtn.getAttribute('aria-pressed') !== 'false') {
            throw new Error('like button is not marked unpressed');
        }
    });

    it('likes, updates the count and removes the like on a second click', async () => {
        const { ctx, calls } = setupControl();
        await wait(5);

        ctx.els.likeBtn.click();
        await wait(5);

        if (calls.ratings.length !== 1 || calls.ratings[0].rating !== 'like') {
            throw new Error(`wrong rating request: ${JSON.stringify(calls.ratings)}`);
        }
        if (calls.ratings[0].videoId !== 'vid1') throw new Error('rated the wrong video');
        if (likeCountText(ctx) !== '101') throw new Error(`count did not increment: ${likeCountText(ctx)}`);
        if (!ctx.els.likeBtn.classList.contains('yt-cinema-rating-active')) {
            throw new Error('like button did not become active');
        }

        ctx.els.likeBtn.click();
        await wait(5);

        if (calls.ratings[1].rating !== 'none') {
            throw new Error(`second click did not remove the rating: ${calls.ratings[1].rating}`);
        }
        if (likeCountText(ctx) !== '100') throw new Error(`count did not revert: ${likeCountText(ctx)}`);
        if (ctx.els.likeBtn.classList.contains('yt-cinema-rating-active')) {
            throw new Error('like button stayed active after removal');
        }
    });

    it('swaps the like for a dislike without changing the count', async () => {
        const { ctx, calls } = setupControl();
        await wait(5);

        ctx.els.likeBtn.click();
        await wait(5);
        ctx.els.dislikeBtn.click();
        await wait(5);

        if (calls.ratings[1].rating !== 'dislike') throw new Error('dislike was not sent');
        if (!ctx.els.dislikeBtn.classList.contains('yt-cinema-rating-active')) {
            throw new Error('dislike button did not become active');
        }
        if (ctx.els.likeBtn.classList.contains('yt-cinema-rating-active')) {
            throw new Error('like stayed active after switching');
        }
        if (likeCountText(ctx) !== '100') throw new Error(`count is wrong: ${likeCountText(ctx)}`);
    });

    it('rolls back an optimistic rating that YouTube rejects', async () => {
        const { ctx } = setupControl({ rate: async () => ({ ok: false, reason: 'signed-out' }) });
        await wait(5);

        ctx.els.likeBtn.click();
        await wait(5);

        if (likeCountText(ctx) !== '100') throw new Error(`count was not rolled back: ${likeCountText(ctx)}`);
        if (ctx.els.likeBtn.classList.contains('yt-cinema-rating-active')) {
            throw new Error('failed like stayed active');
        }
        if (!ctx.toast.shown.some((message) => /Sign in to YouTube/.test(message))) {
            throw new Error(`no sign-in feedback: ${ctx.toast.shown.join(' | ')}`);
        }
    });

    it('opens the drawer, loads the first comment page and renders it', async () => {
        const { ctx, calls } = setupControl();
        await wait(5);

        ctx.els.commentsBtn.click();
        await wait(5);

        if (!ctx.els.commentsPanel.classList.contains('yt-cinema-comments-open')) {
            throw new Error('comment panel did not open');
        }
        if (calls.commentTokens[0] !== 'T1') {
            throw new Error(`wrong comment token: ${calls.commentTokens[0]}`);
        }

        const comments = ctx.els.commentsPanel.querySelectorAll('.yt-cinema-comment');
        if (comments.length !== 1) throw new Error(`expected 1 comment, got ${comments.length}`);

        const text = comments[0].querySelector('.yt-cinema-comment-text').textContent;
        if (text !== 'hello world') throw new Error(`wrong comment text: ${text}`);
        const author = comments[0].querySelector('.yt-cinema-comment-author').textContent;
        if (author !== '@a') throw new Error(`wrong author: ${author}`);
        // The fixture has no avatar, so the placeholder hook must be applied.
        if (!comments[0].querySelector('.yt-cinema-comment-avatar')
            .classList.contains('yt-cinema-comment-avatar-empty')) {
            throw new Error('avatar placeholder was not applied');
        }

        ctx.els.commentsClose.click();
        if (ctx.els.commentsPanel.classList.contains('yt-cinema-comments-open')) {
            throw new Error('comment panel did not close');
        }
    });

    it('pages through comments with the continuation token', async () => {
        const { ctx } = setupControl({
            comments: async (token) => (token === 'T1'
                ? { ok: true, comments: [{ id: 'c1', author: '@a', text: 'one' }], continuation: 'T2' }
                : { ok: true, comments: [{ id: 'c2', author: '@b', text: 'two' }], continuation: null })
        });
        await wait(5);

        ctx.els.commentsBtn.click();
        await wait(5);
        if (!ctx.els.commentsMore.classList.contains('yt-cinema-comments-more-visible')) {
            throw new Error('no "show more" button for a page with more comments');
        }

        ctx.els.commentsMore.click();
        await wait(5);

        const comments = ctx.els.commentsPanel.querySelectorAll('.yt-cinema-comment');
        if (comments.length !== 2) throw new Error(`expected 2 comments, got ${comments.length}`);
        if (ctx.els.commentsMore.classList.contains('yt-cinema-comments-more-visible')) {
            throw new Error('"show more" stayed visible at the end of the list');
        }
    });

    it('shows an error when the comment request fails', async () => {
        const { ctx } = setupControl({
            comments: async () => ({ ok: false, reason: 'network' })
        });
        await wait(5);

        ctx.els.commentsBtn.click();
        await wait(5);

        const status = ctx.els.commentsPanel.querySelector('.yt-cinema-comments-status');
        if (!/Network error/.test(status.textContent)) {
            throw new Error(`missing error message: ${status.textContent}`);
        }
        if (!status.classList.contains('yt-cinema-comments-status-error')) {
            throw new Error('error state was not styled as an error');
        }
    });

    it('closes the drawer when the overlay is torn down', async () => {
        const { ctx, control } = setupControl();
        await wait(5);

        ctx.els.commentsBtn.click();
        await wait(5);

        control.dispose();
        if (ctx.els.commentsPanel.classList.contains('yt-cinema-comments-open')) {
            throw new Error('drawer survived teardown');
        }
        if (ctx.flags.commentsOpen) throw new Error('comments flag survived teardown');
    });

    it('requests authenticated engagement and comments data with signed: true', async () => {
        const env = loadExtension();
        const posts = [];
        env.YTC.innertube.readConfig = () => ({ context: { client: {} }, apiKey: 'key123' });
        env.YTC.innertube.post = async (endpoint, body, options) => {
            posts.push({ endpoint, body, options });
            return { ok: true, data: ENGAGEMENT_DATA };
        };

        await env.YTC.engagement.fetchVideoEngagement('vid_test');
        if (posts.length !== 1 || !posts[0].options.signed) {
            throw new Error('fetchVideoEngagement was not called with signed: true');
        }

        await env.YTC.engagement.fetchComments('token_test');
        if (posts.length !== 2 || !posts[1].options.signed) {
            throw new Error('fetchComments was not called with signed: true');
        }
    });

    it('discards rollback if the video changed while rating was in-flight', async () => {
        let resolveRate;
        const { ctx, control, env } = setupControl({
            rate: () => new Promise((resolve) => { resolveRate = resolve; })
        });
        await wait(5);

        // Click like on vid1
        ctx.els.likeBtn.click();
        if (likeCountText(ctx) !== '101') throw new Error('optimistic count failed');

        // Override engagement for vid2 so it has 50 likes
        env.YTC.engagement.fetchVideoEngagement = async (id) => ({
            ok: true,
            engagement: {
                rating: 'none',
                likeExact: id === 'vid2' ? 50 : 100,
                likeShort: id === 'vid2' ? '50' : '100',
                commentCountText: '0',
                continuation: null
            }
        });

        // Video changes to vid2 while rate is pending
        await control.resetForNewVideo('vid2');
        await wait(5);

        if (likeCountText(ctx) !== '50') throw new Error(`vid2 initial count was wrong: ${likeCountText(ctx)}`);

        // Request finishes and fails for vid1
        resolveRate({ ok: false, reason: 'network' });
        await wait(5);

        // vid2 state must not be rolled back with vid1 data
        if (likeCountText(ctx) !== '50') throw new Error(`vid2 like count was corrupted: ${likeCountText(ctx)}`);
        if (ctx.els.likeBtn.classList.contains('yt-cinema-rating-active')) {
            throw new Error('like active class survived video change');
        }
    });

    it('safely rejects non-http avatar URLs', async () => {
        const { ctx } = setupControl({
            comments: async () => ({
                ok: true,
                comments: [{
                    id: 'c_xss',
                    author: '@attacker',
                    avatar: 'javascript:alert(1)',
                    text: 'malicious avatar'
                }],
                continuation: null
            })
        });
        await wait(5);

        ctx.els.commentsBtn.click();
        await wait(5);

        const img = ctx.els.commentsPanel.querySelector('.yt-cinema-comment-avatar');
        if (img.getAttribute('src') === 'javascript:alert(1)') {
            throw new Error('dangerous avatar scheme was set on img element');
        }
        if (!img.classList.contains('yt-cinema-comment-avatar-empty')) {
            throw new Error('empty fallback class was not added for invalid avatar URL');
        }
    });
});
