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

const CHANNEL_DATA = {
    contents: {
        twoColumnWatchNextResults: {
            results: {
                results: {
                    contents: [{
                        videoSecondaryInfoRenderer: {
                            owner: {
                                videoOwnerRenderer: {
                                    title: { runs: [{ text: 'Rick Astley' }] },
                                    channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
                                    subscriberCountText: { simpleText: '18.9M subscribers' },
                                    navigationEndpoint: {
                                        browseEndpoint: { browseId: 'UCuAXFkgsw1L7xaCfnd5JJOw' }
                                    },
                                    subscribeButton: {
                                        subscribeButtonRenderer: {
                                            channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw',
                                            subscribed: true,
                                            subscriberCountText: { simpleText: '18.9M subscribers' }
                                        }
                                    }
                                }
                            }
                        }
                    }]
                }
            }
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
    const calls = { ratings: [], commentTokens: [], subscriptions: [] };

    const channel = overrides.channel === undefined
        ? { id: 'UCchannel', name: 'Test Channel', subscribed: false, subscriberCountText: '12K' }
        : overrides.channel;

    env.YTC.engagement.fetchVideoEngagement = overrides.engagement || (async () => ({
        ok: true,
        engagement: {
            rating: 'none',
            likeExact: 100,
            likeShort: '100',
            commentCountText: '2',
            commentCount: 2,
            continuation: 'T1'
        },
        channel
    }));

    env.YTC.engagement.setSubscribed = overrides.subscribe || (async (channelId, subscribe) => {
        calls.subscriptions.push({ channelId, subscribe });
        return { ok: true, subscribed: subscribe, subscriberCountText: '12K' };
    });

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
const subscribeLabel = (ctx) => ctx.els.subscribeBtn.querySelector('.yt-cinema-subscribe-label').textContent;
const subscribeCount = (ctx) => ctx.els.subscribeBtn.querySelector('.yt-cinema-subscribe-count').textContent;

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

    it('normalizes subscriber text including European suffixes', () => {
        const env = loadExtension();
        const cases = [
            ['18.9M subscribers', '18.9M'],
            ['1.4K subscribers', '1.4K'],
            ['12K', '12K'],
            ['1,4 Tsd. Abonnenten', '1,4Tsd.'],
            ['18,9 Mio. Abonnenten', '18,9Mio.'],
            ['1,2 Mrd. Abonnenten', '1,2Mrd.'],
            ['1000', '1000'],
            ['Subscribers', '']
        ];
        for (const [input, expected] of cases) {
            const actual = env.YTC.engagement.normalizeSubscriberText(input);
            if (actual !== expected) throw new Error(`normalizeSubscriberText(${input}) = ${actual}, expected ${expected}`);
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

describe('subscribe', () => {
    it('reads the owner channel and its subscription state', () => {
        const env = loadExtension();
        const channel = env.YTC.engagement.extractChannel(CHANNEL_DATA);

        if (!channel) throw new Error('no channel was extracted');
        if (channel.id !== 'UCuAXFkgsw1L7xaCfnd5JJOw') throw new Error(`wrong channel: ${channel.id}`);
        if (channel.name !== 'Rick Astley') throw new Error(`wrong channel name: ${channel.name}`);
        if (channel.subscribed !== true) throw new Error('subscription state was lost');
        if (channel.subscriberCountText !== '18.9M') {
            throw new Error(`wrong subscriber label: ${channel.subscriberCountText}`);
        }
    });

    it('leaves the state unknown when the payload carries no subscribe button', () => {
        const env = loadExtension();
        const data = JSON.parse(JSON.stringify(CHANNEL_DATA));
        delete data.contents.twoColumnWatchNextResults.results.results.contents[0]
            .videoSecondaryInfoRenderer.owner.videoOwnerRenderer.subscribeButton;

        const channel = env.YTC.engagement.extractChannel(data);
        if (!channel) throw new Error('the channel was dropped with its button');
        if (channel.subscribed !== null) throw new Error(`guessed a state: ${channel.subscribed}`);
        if (channel.subscriberCountText !== '18.9M') throw new Error('the subscriber count was lost');
    });

    it('finds browseId in nested navigation endpoints', () => {
        const env = loadExtension();
        const payload = {
            contents: {
                twoColumnWatchNextResults: {
                    results: {
                        results: {
                            contents: [{
                                videoSecondaryInfoRenderer: {
                                    owner: {
                                        videoOwnerRenderer: {
                                            title: {
                                                runs: [{
                                                    text: 'Channel Name',
                                                    navigationEndpoint: {
                                                        browseEndpoint: { browseId: 'UCnested123' }
                                                    }
                                                }]
                                            }
                                        }
                                    }
                                }
                            }]
                        }
                    }
                }
            }
        };
        const channel = env.YTC.engagement.extractChannel(payload);
        if (!channel || channel.id !== 'UCnested123') {
            throw new Error(`failed to extract nested browseId: ${channel && channel.id}`);
        }
    });

    it('sends subscribe and unsubscribe to the matching endpoints', async () => {
        const env = loadExtension();
        const posts = [];
        env.YTC.innertube.readConfig = () => ({ context: { client: {} }, apiKey: 'k', loggedIn: true });
        env.YTC.innertube.requestAuth = async () => ({ authorization: 'SAPISIDHASH x', authUser: '0' });
        env.YTC.innertube.post = async (endpoint, body, options) => {
            posts.push({ endpoint, body, options });
            return { ok: true, data: { subscriberCountText: { simpleText: '18.9M subscribers' } } };
        };

        const subscribed = await env.YTC.engagement.setSubscribed('UCabc', true);
        if (!subscribed.ok || subscribed.subscribed !== true) {
            throw new Error(`subscribe did not report success: ${JSON.stringify(subscribed)}`);
        }
        if (posts[0].endpoint !== '/youtubei/v1/subscription/subscribe') {
            throw new Error(`wrong endpoint: ${posts[0].endpoint}`);
        }
        if (!posts[0].body.channelIds || posts[0].body.channelIds[0] !== 'UCabc') {
            throw new Error('the channel id was not sent');
        }
        if (!posts[0].options.auth) throw new Error('subscribe was not authenticated');

        const unsubscribed = await env.YTC.engagement.setSubscribed('UCabc', false);
        if (posts[1].endpoint !== '/youtubei/v1/subscription/unsubscribe') {
            throw new Error(`wrong endpoint: ${posts[1].endpoint}`);
        }
        if (unsubscribed.subscribed !== false) throw new Error('unsubscribe did not report the new state');
        if (unsubscribed.subscriberCountText !== '18.9M') {
            throw new Error(`wrong subscriber label: ${unsubscribed.subscriberCountText}`);
        }
    });

    it('refuses to subscribe when the session is signed out', async () => {
        const env = loadExtension();
        env.YTC.innertube.readConfig = () => ({ context: { client: {} }, apiKey: 'k', loggedIn: false });

        const result = await env.YTC.engagement.setSubscribed('UCabc', true);
        if (result.ok || result.reason !== 'signed-out') {
            throw new Error(`unexpected result: ${JSON.stringify(result)}`);
        }
    });

    it('asks the channel page when the watch payload has no subscribe button', async () => {
        const env = loadExtension();
        const endpoints = [];
        env.YTC.innertube.readConfig = () => ({ context: { client: {} }, apiKey: 'key' });
        env.YTC.innertube.post = async (endpoint) => {
            endpoints.push(endpoint);
            if (endpoint === '/youtubei/v1/next') {
                return {
                    ok: true,
                    data: { videoOwnerRenderer: { channelId: 'UCabc', title: { simpleText: 'Chan' } } }
                };
            }
            return {
                ok: true,
                data: {
                    header: {
                        subscribeButtonRenderer: {
                            channelId: 'UCabc',
                            subscribed: true,
                            subscriberCountText: { simpleText: '1.2K subscribers' }
                        }
                    }
                }
            };
        };

        const result = await env.YTC.engagement.fetchVideoEngagement('vid');
        if (endpoints[0] !== '/youtubei/v1/next' || endpoints[1] !== '/youtubei/v1/browse') {
            throw new Error(`unexpected requests: ${endpoints.join(', ')}`);
        }
        if (!result.channel || result.channel.subscribed !== true) {
            throw new Error('the subscription state was not resolved');
        }
        if (result.channel.subscriberCountText !== '1.2K') {
            throw new Error(`wrong subscriber label: ${result.channel.subscriberCountText}`);
        }
    });

    it('skips channel browse request when user is signed out', async () => {
        const env = loadExtension();
        const endpoints = [];
        env.YTC.innertube.readConfig = () => ({ context: { client: {} }, apiKey: 'key', loggedIn: false });
        env.YTC.innertube.post = async (endpoint) => {
            endpoints.push(endpoint);
            return {
                ok: true,
                data: { videoOwnerRenderer: { channelId: 'UCabc', title: { simpleText: 'Chan' } } }
            };
        };

        const result = await env.YTC.engagement.fetchVideoEngagement('vid');
        if (endpoints.length !== 1 || endpoints[0] !== '/youtubei/v1/next') {
            throw new Error(`expected only next endpoint, got: ${endpoints.join(', ')}`);
        }
        if (!result.channel || result.channel.subscribed !== false) {
            throw new Error('signed-out channel should default to subscribed: false');
        }
    });

    it('subscribes from the header pill and requires confirmation to unsubscribe', async () => {
        const { ctx, calls } = setupControl();
        await wait(5);

        if (subscribeLabel(ctx) !== 'Subscribe') throw new Error(`wrong initial label: ${subscribeLabel(ctx)}`);
        if (subscribeCount(ctx) !== '12K') throw new Error(`wrong subscriber count: ${subscribeCount(ctx)}`);
        if (ctx.els.subscribeBtn.classList.contains('yt-cinema-subscribe-hidden')) {
            throw new Error('the pill is hidden although the channel is known');
        }

        // 1. Subscribe click
        ctx.els.subscribeBtn.click();
        await wait(5);

        if (calls.subscriptions.length !== 1) throw new Error('no subscribe request was sent');
        if (calls.subscriptions[0].channelId !== 'UCchannel') throw new Error('subscribed to the wrong channel');
        if (!calls.subscriptions[0].subscribe) throw new Error('subscribed in the wrong direction');
        if (subscribeLabel(ctx) !== 'Subscribed') throw new Error(`label did not flip: ${subscribeLabel(ctx)}`);
        if (!ctx.els.subscribeBtn.classList.contains('yt-cinema-subscribe-active')) {
            throw new Error('the subscribed state is not styled');
        }
        if (ctx.els.subscribeBtn.getAttribute('aria-pressed') !== 'true') {
            throw new Error('aria-pressed was not updated');
        }
        if (!ctx.toast.shown.some((message) => /Subscribed to Test Channel/.test(message))) {
            throw new Error(`no confirmation toast: ${ctx.toast.shown.join(' | ')}`);
        }

        // 2. First click while subscribed: enters confirmation state
        ctx.els.subscribeBtn.click();
        await wait(5);

        if (calls.subscriptions.length !== 1) {
            throw new Error('first click while subscribed should not unsubscribe immediately');
        }
        if (subscribeLabel(ctx) !== 'Unsubscribe?') {
            throw new Error(`label did not enter confirmation: ${subscribeLabel(ctx)}`);
        }
        if (!ctx.els.subscribeBtn.classList.contains('yt-cinema-subscribe-confirm')) {
            throw new Error('button is missing confirmation class');
        }

        // 3. Second click confirms unsubscribe
        ctx.els.subscribeBtn.click();
        await wait(5);

        if (!calls.subscriptions[1] || calls.subscriptions[1].subscribe) {
            throw new Error('the second click did not unsubscribe');
        }
        if (subscribeLabel(ctx) !== 'Subscribe') throw new Error(`label did not revert: ${subscribeLabel(ctx)}`);
        if (ctx.els.subscribeBtn.classList.contains('yt-cinema-subscribe-confirm')) {
            throw new Error('confirmation class was not removed');
        }
        if (!ctx.toast.shown.some((message) => /Unsubscribed from Test Channel/.test(message))) {
            throw new Error(`no unsubscribe toast: ${ctx.toast.shown.join(' | ')}`);
        }
    });

    it('reverts confirmation state if not confirmed after blur', async () => {
        const { ctx, calls } = setupControl({
            channel: { id: 'UCchannel', name: 'Test Channel', subscribed: true, subscriberCountText: '12K' }
        });
        await wait(5);

        if (subscribeLabel(ctx) !== 'Subscribed') throw new Error(`wrong initial label: ${subscribeLabel(ctx)}`);

        // Click once to enter confirmation
        ctx.els.subscribeBtn.click();
        await wait(5);

        if (subscribeLabel(ctx) !== 'Unsubscribe?') throw new Error('did not enter confirmation');

        // Blur event triggers revert
        ctx.els.subscribeBtn.dispatchEvent(new Event('blur'));
        await wait(250);

        if (subscribeLabel(ctx) !== 'Subscribed') throw new Error(`did not revert after blur: ${subscribeLabel(ctx)}`);
        if (calls.subscriptions.length !== 0) throw new Error('unexpected unsubscribe sent');
    });

    it('rolls back a subscription YouTube rejects', async () => {
        const { ctx } = setupControl({ subscribe: async () => ({ ok: false, reason: 'signed-out' }) });
        await wait(5);

        ctx.els.subscribeBtn.click();
        await wait(5);

        if (subscribeLabel(ctx) !== 'Subscribe') {
            throw new Error(`the optimistic state survived: ${subscribeLabel(ctx)}`);
        }
        if (ctx.els.subscribeBtn.classList.contains('yt-cinema-subscribe-active')) {
            throw new Error('the active style survived the rejection');
        }
        if (ctx.els.subscribeBtn.getAttribute('aria-pressed') !== 'false') {
            throw new Error('aria-pressed was not rolled back');
        }
        if (!ctx.toast.shown.some((message) => /Sign in to YouTube to subscribe/.test(message))) {
            throw new Error(`no sign-in feedback: ${ctx.toast.shown.join(' | ')}`);
        }
    });

    it('hides the pill when the payload names no channel', async () => {
        const { ctx } = setupControl({ channel: null });
        await wait(5);

        if (!ctx.els.subscribeBtn.classList.contains('yt-cinema-subscribe-hidden')) {
            throw new Error('the pill is visible without a channel');
        }
    });

    it('hides the pill when channel subscribed is null (e.g. own channel)', async () => {
        const { ctx } = setupControl({
            channel: { id: 'UCchannel', name: 'Own Channel', subscribed: null, subscriberCountText: '100' }
        });
        await wait(5);

        if (!ctx.els.subscribeBtn.classList.contains('yt-cinema-subscribe-hidden')) {
            throw new Error('the pill is visible when subscribed is null');
        }
    });
});
