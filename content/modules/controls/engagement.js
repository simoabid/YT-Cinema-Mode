/**
 * Engagement control — the like/dislike buttons and the comments drawer.
 *
 * The overlay keeps its embedded player untouched; everything here talks to
 * YouTube's web API through `YTC.engagement` and paints the result into chrome
 * that belongs to us:
 *
 *   - header pills for like / dislike (with the like count) and comments,
 *   - a sliding comment panel inside the player wrapper, so the video keeps
 *     playing and keeps its exact size while comments are open.
 */
(function (YTC) {
    'use strict';

    const icons = YTC.icons;

    const RATING_NONE = 'none';

    const RATING_ERRORS = {
        'signed-out': 'Sign in to YouTube to like or dislike videos',
        'no-config': 'YouTube data is unavailable right now',
        'bad-request': 'That video cannot be rated right now',
        http: 'YouTube rejected that request',
        network: 'Network error — check your connection'
    };

    const COMMENT_ERRORS = {
        'no-token': 'Comments are turned off for this video',
        'no-config': 'YouTube data is unavailable right now',
        http: 'Couldn\'t load comments right now',
        network: 'Network error — could not load comments',
        empty: 'Comments are unavailable right now'
    };

    function createEngagementControl(ctx) {
        const { els, flags } = ctx;

        let videoId = ctx.currentVideoId || null;
        let rating = RATING_NONE;
        let likeExact = null;
        let likeShort = '';
        let commentTotal = '';
        let continuation = null;

        let ratingBusy = false;
        let commentsLoaded = false;
        let commentsLoading = false;
        /** Bumped by every refresh; stale responses compare against it and bail. */
        let requestSeq = 0;

        // ------------------------------------------------------- presentation

        function renderRating() {
            const countEl = els.likeBtn?.querySelector('.yt-cinema-rating-count');
            if (countEl) countEl.textContent = likeShort || '';

            els.likeBtn?.classList.toggle('yt-cinema-rating-active', rating === 'like');
            els.dislikeBtn?.classList.toggle('yt-cinema-rating-active', rating === 'dislike');

            if (els.likeBtn) {
                els.likeBtn.setAttribute('title', rating === 'like' ? 'Remove like' : 'Like this video');
                els.likeBtn.setAttribute('aria-pressed', rating === 'like' ? 'true' : 'false');
            }
            if (els.dislikeBtn) {
                els.dislikeBtn.setAttribute('title', rating === 'dislike' ? 'Remove dislike' : 'Dislike this video');
                els.dislikeBtn.setAttribute('aria-pressed', rating === 'dislike' ? 'true' : 'false');
            }
        }

        function updateCommentsCount() {
            const countEl = els.commentsBtn?.querySelector('.yt-cinema-comments-count');
            if (countEl) countEl.textContent = commentTotal || '';
            if (els.commentsTotal) els.commentsTotal.textContent = commentTotal || '';
            els.commentsBtn?.setAttribute('title',
                commentTotal ? `Comments (${commentTotal}) (Shift+C)` : 'Comments (Shift+C)');
        }

        function setStatus(text, isError = false) {
            if (!els.commentsStatus) return;
            els.commentsStatus.textContent = text || '';
            els.commentsStatus.classList.toggle('yt-cinema-comments-status-error',
                Boolean(text) && isError);
        }

        function updateMoreButton() {
            els.commentsMore?.classList.toggle('yt-cinema-comments-more-visible', Boolean(continuation));
        }

        function isOpen() {
            return Boolean(els.commentsPanel?.classList.contains('yt-cinema-comments-open'));
        }

        // ---------------------------------------------------------- comments

        function renderComment(comment) {
            const item = document.createElement('div');
            item.className = 'yt-cinema-comment';

            const avatar = document.createElement('img');
            avatar.className = 'yt-cinema-comment-avatar';
            avatar.alt = '';
            avatar.loading = 'lazy';
            if (comment.avatar && /^(https?:|\/\/)/i.test(comment.avatar)) {
                avatar.src = comment.avatar;
            } else {
                avatar.classList.add('yt-cinema-comment-avatar-empty');
            }
            item.appendChild(avatar);

            const body = document.createElement('div');
            body.className = 'yt-cinema-comment-body';

            const meta = document.createElement('div');
            meta.className = 'yt-cinema-comment-meta';

            const author = document.createElement('span');
            author.className = 'yt-cinema-comment-author';
            author.textContent = comment.author || 'YouTube user';
            meta.appendChild(author);

            if (comment.isCreator) {
                const badge = document.createElement('span');
                badge.className = 'yt-cinema-comment-badge';
                badge.textContent = 'Creator';
                meta.appendChild(badge);
            }

            if (comment.publishedTime) {
                const time = document.createElement('span');
                time.className = 'yt-cinema-comment-time';
                time.textContent = comment.publishedTime;
                meta.appendChild(time);
            }
            body.appendChild(meta);

            const text = document.createElement('div');
            text.className = 'yt-cinema-comment-text';
            text.textContent = comment.text || '';
            body.appendChild(text);

            if (comment.likes || comment.replies) {
                const actions = document.createElement('div');
                actions.className = 'yt-cinema-comment-actions';

                if (comment.likes) {
                    const likes = document.createElement('span');
                    likes.className = 'yt-cinema-comment-likes';
                    likes.textContent = comment.likes === '1' ? '1 like' : `${comment.likes} likes`;
                    actions.appendChild(likes);
                }
                if (comment.replies) {
                    const replies = document.createElement('span');
                    replies.className = 'yt-cinema-comment-replies';
                    replies.textContent = /\brepl/i.test(comment.replies)
                        ? comment.replies
                        : `${comment.replies} replies`;
                    actions.appendChild(replies);
                }
                body.appendChild(actions);
            }

            item.appendChild(body);
            return item;
        }

        async function loadCommentsPage(token, { replace = false, seq = requestSeq } = {}) {
            if (!token || commentsLoading) return;

            commentsLoading = true;
            els.commentsMore?.classList.remove('yt-cinema-comments-more-visible');
            setStatus(replace ? 'Loading comments…' : 'Loading more comments…');

            try {
                const result = await YTC.engagement.fetchComments(token);
                if (seq !== requestSeq) return;

                if (!result.ok) {
                    // Let closing and reopening the drawer retry the same page.
                    if (replace) commentsLoaded = false;
                    setStatus(COMMENT_ERRORS[result.reason] || COMMENT_ERRORS.http, true);
                    updateMoreButton();
                    return;
                }

                if (replace && els.commentsList) els.commentsList.innerHTML = '';
                for (const comment of result.comments) {
                    els.commentsList?.appendChild(renderComment(comment));
                }

                continuation = result.continuation || null;
                commentsLoaded = true;

                const rendered = els.commentsList ? els.commentsList.children.length : 0;
                setStatus(rendered === 0 ? 'No comments yet' : '');
                updateMoreButton();
            } finally {
                if (seq === requestSeq) commentsLoading = false;
            }
        }

        async function loadFirstPage() {
            if (!videoId) return;

            const seq = requestSeq;
            commentsLoading = true;
            setStatus('Loading comments…');

            try {
                const result = await YTC.engagement.fetchVideoEngagement(videoId);
                if (seq !== requestSeq) return;

                if (!result.ok) {
                    setStatus(COMMENT_ERRORS[result.reason] || COMMENT_ERRORS.http, true);
                    return;
                }

                applyEngagement(result.engagement);
                commentsLoaded = true;

                if (!result.engagement.continuation) {
                    setStatus('Comments are turned off for this video');
                    return;
                }
                await loadCommentsPage(result.engagement.continuation, { replace: true, seq });
            } finally {
                if (seq === requestSeq) commentsLoading = false;
            }
        }

        function toggleComments(force) {
            if (!els.commentsPanel) return;

            const open = typeof force === 'boolean' ? force : !isOpen();
            if (open === isOpen()) return;

            els.commentsPanel.classList.toggle('yt-cinema-comments-open', open);
            els.commentsPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
            els.commentsBtn?.classList.toggle('active', open);
            flags.commentsOpen = open;
            ctx.autohide?.reset();

            if (open) {
                els.commentsClose?.focus();
                if (!commentsLoaded && !commentsLoading) {
                    if (continuation) {
                        loadCommentsPage(continuation, { replace: true, seq: requestSeq });
                    } else {
                        loadFirstPage();
                    }
                }
            } else {
                els.commentsBtn?.focus();
            }
        }

        // ------------------------------------------------------ like/dislike

        function applyOptimistic(target) {
            if (likeExact !== null) {
                let delta = 0;
                if (rating !== 'like' && target === 'like') delta = 1;
                else if (rating === 'like' && target !== 'like') delta = -1;
                likeExact = Math.max(0, likeExact + delta);
                likeShort = YTC.engagement.formatCount(likeExact);
            }
            rating = target;
            renderRating();
        }

        async function rate(next) {
            if (ratingBusy || !videoId) return;

            const target = rating === next ? RATING_NONE : next;
            const previous = { rating, likeExact, likeShort };
            const targetVideoId = videoId;
            const seq = requestSeq;

            ratingBusy = true;
            applyOptimistic(target);

            const result = await YTC.engagement.rateVideo(targetVideoId, target);
            ratingBusy = false;

            // If the user navigated away while the request was in-flight, discard rollback & toasts
            if (targetVideoId !== videoId || seq !== requestSeq) return;

            if (!result.ok) {
                // Optimistic UI must not survive a rejected request.
                rating = previous.rating;
                likeExact = previous.likeExact;
                likeShort = previous.likeShort;
                renderRating();
                ctx.toast?.show(RATING_ERRORS[result.reason] || RATING_ERRORS.http, icons.alertSmall);
                return;
            }

            ctx.toast?.show(
                target === 'like' ? 'Liked this video'
                    : target === 'dislike' ? 'Disliked this video'
                        : 'Rating removed',
                target === 'like' ? icons.thumbsUp
                    : target === 'dislike' ? icons.thumbsDown
                        : icons.info
            );
            ctx.autohide?.reset();
        }

        function applyEngagement(info) {
            rating = info.rating || RATING_NONE;
            likeExact = info.likeExact === undefined ? null : info.likeExact;
            likeShort = info.likeShort || (likeExact !== null ? YTC.engagement.formatCount(likeExact) : '');
            commentTotal = info.commentCount ? YTC.engagement.formatCount(info.commentCount) : (info.commentCountText || '');
            continuation = info.continuation || null;

            renderRating();
            updateCommentsCount();
            updateMoreButton();
        }

        /** Load (or reload) everything for a video; safe to call repeatedly. */
        async function refresh(nextVideoId) {
            videoId = nextVideoId || ctx.currentVideoId || null;

            const seq = ++requestSeq;
            rating = RATING_NONE;
            likeExact = null;
            likeShort = '';
            commentTotal = '';
            continuation = null;
            commentsLoaded = false;
            commentsLoading = false;

            if (els.commentsList) els.commentsList.innerHTML = '';
            setStatus('');
            renderRating();
            updateCommentsCount();
            updateMoreButton();

            if (!videoId) return;

            const result = await YTC.engagement.fetchVideoEngagement(videoId);
            if (seq !== requestSeq) return;

            if (!result.ok) {
                if (isOpen()) setStatus(COMMENT_ERRORS[result.reason] || COMMENT_ERRORS.http, true);
                return;
            }

            applyEngagement(result.engagement);

            if (!isOpen()) return;
            if (result.engagement.continuation) {
                loadCommentsPage(result.engagement.continuation, { replace: true, seq });
            } else {
                setStatus('Comments are turned off for this video');
            }
        }

        function bind() {
            els.likeBtn?.addEventListener('click', (event) => {
                event.stopPropagation();
                rate('like');
            });
            els.dislikeBtn?.addEventListener('click', (event) => {
                event.stopPropagation();
                rate('dislike');
            });
            els.commentsBtn?.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleComments();
            });
            els.commentsClose?.addEventListener('click', (event) => {
                event.stopPropagation();
                toggleComments(false);
            });
            els.commentsMore?.addEventListener('click', (event) => {
                event.stopPropagation();
                if (continuation) loadCommentsPage(continuation, { replace: false });
            });

            refresh(videoId);
        }

        function dispose() {
            requestSeq++;
            flags.commentsOpen = false;
            els.commentsPanel?.classList.remove('yt-cinema-comments-open');
            els.commentsPanel?.setAttribute('aria-hidden', 'true');
            els.commentsBtn?.classList.remove('active');
        }

        return {
            bind,
            refresh,
            resetForNewVideo: refresh,
            toggleComments,
            dispose,
            isCommentsOpen: isOpen
        };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.engagement = { createEngagementControl };
})(globalThis.YTC);
