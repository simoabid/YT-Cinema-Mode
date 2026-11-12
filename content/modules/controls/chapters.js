/**
 * Chapters control — header pill and slide-over chapters / video info drawer.
 */
(function (YTC) {
    'use strict';

    const DESC_COLLAPSE_THRESHOLD = 180;

    function createChaptersControl(ctx) {
        const { els, flags } = ctx;

        let videoId = ctx.currentVideoId || null;
        let chapters = [];
        let meta = null;
        let loaded = false;
        let loading = false;
        let requestSeq = 0;
        let activeIndex = -1;
        let descExpanded = false;

        function isOpen() {
            return Boolean(els.chaptersPanel?.classList.contains('yt-cinema-chapters-open'));
        }

        function setStatus(text, isError = false) {
            if (!els.chaptersStatus) return;
            els.chaptersStatus.textContent = text || '';
            els.chaptersStatus.classList.toggle('yt-cinema-chapters-status-error', Boolean(text) && isError);
        }

        function updateCountBadge() {
            const countEl = els.chaptersBtn?.querySelector('.yt-cinema-chapters-count');
            if (countEl) countEl.textContent = chapters.length > 0 ? String(chapters.length) : '';
            if (els.chaptersTotal) {
                els.chaptersTotal.textContent = chapters.length > 0 ? `${chapters.length}` : '';
            }
            els.chaptersBtn?.setAttribute('title',
                chapters.length > 0 ? `Chapters (${chapters.length}) (O)` : 'Chapters & Info (O)');
        }

        function renderMeta() {
            if (!els.chaptersMeta) return;
            els.chaptersMeta.innerHTML = '';

            if (!meta || (!meta.channelName && !meta.viewCountText && !meta.publishedText && !meta.description)) {
                return;
            }

            if (meta.channelName || meta.viewCountText || meta.publishedText) {
                const line = document.createElement('div');
                line.className = 'yt-cinema-chapters-meta-line';
                const parts = [meta.channelName, meta.viewCountText, meta.publishedText].filter(Boolean);
                line.textContent = parts.join(' • ');
                els.chaptersMeta.appendChild(line);
            }

            if (meta.description) {
                const descEl = document.createElement('div');
                descEl.className = 'yt-cinema-chapters-desc';
                if (descExpanded) descEl.classList.add('yt-cinema-chapters-desc-expanded');
                descEl.textContent = meta.description;
                if (meta.description.length > DESC_COLLAPSE_THRESHOLD) {
                    descEl.setAttribute('title', descExpanded ? 'Click to collapse description' : 'Click to expand description');
                    descEl.addEventListener('click', (e) => {
                        e.stopPropagation();
                        descExpanded = !descExpanded;
                        descEl.classList.toggle('yt-cinema-chapters-desc-expanded', descExpanded);
                    });
                }
                els.chaptersMeta.appendChild(descEl);
            }
        }

        function renderList() {
            if (!els.chaptersList) return;
            els.chaptersList.innerHTML = '';

            chapters.forEach((chapter, idx) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'yt-cinema-chapter-item';
                if (idx === activeIndex) item.classList.add('yt-cinema-chapter-active');
                item.dataset.index = String(idx);
                item.dataset.start = String(chapter.startSeconds);

                const timeEl = document.createElement('span');
                timeEl.className = 'yt-cinema-chapter-time';
                timeEl.textContent = chapter.timeText || YTC.chapters.formatTimestamp(chapter.startSeconds);

                const titleEl = document.createElement('span');
                titleEl.className = 'yt-cinema-chapter-title';
                titleEl.textContent = chapter.title;

                item.appendChild(timeEl);
                item.appendChild(titleEl);

                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    ctx.transport?.seekToSeconds?.(chapter.startSeconds);
                    setActiveIndex(idx);
                    ctx.autohide?.reset();
                });

                els.chaptersList.appendChild(item);
            });
        }

        function setActiveIndex(nextIndex) {
            if (nextIndex === activeIndex) return;
            activeIndex = nextIndex;
            if (!els.chaptersList) return;
            els.chaptersList.querySelectorAll('.yt-cinema-chapter-item').forEach((el, idx) => {
                el.classList.toggle('yt-cinema-chapter-active', idx === activeIndex);
            });
        }

        function syncActiveChapter(currentTime) {
            if (chapters.length === 0 || typeof currentTime !== 'number' || !Number.isFinite(currentTime)) {
                return;
            }
            let found = -1;
            for (let i = 0; i < chapters.length; i++) {
                if (currentTime + 0.5 >= chapters[i].startSeconds) {
                    found = i;
                } else {
                    break;
                }
            }
            setActiveIndex(found);
        }

        async function loadChapters() {
            if (!videoId || loading) return;

            const seq = requestSeq;
            loading = true;
            setStatus('Loading chapters…');

            try {
                const result = await YTC.chapters.fetchVideoChapters(videoId);
                if (seq !== requestSeq) return;

                if (!result.ok) {
                    setStatus('Could not load chapters for this video', true);
                    return;
                }

                meta = result.meta;
                chapters = Array.isArray(result.chapters) ? result.chapters : [];
                loaded = true;
                activeIndex = -1;

                renderMeta();
                renderList();
                updateCountBadge();

                if (chapters.length === 0) {
                    setStatus('No chapters found for this video');
                } else {
                    setStatus('');
                    const { video } = ctx.getPlayerElements();
                    if (video && typeof video.currentTime === 'number') {
                        syncActiveChapter(video.currentTime);
                    }
                }
            } finally {
                if (seq === requestSeq) loading = false;
            }
        }

        function togglePanel(force) {
            if (!els.chaptersPanel) return;

            const open = typeof force === 'boolean' ? force : !isOpen();
            if (open === isOpen()) return;

            if (open) {
                if (flags.commentsOpen) ctx.engagement?.toggleComments?.(false);
                if (flags.queueOpen) ctx.queue?.togglePanel?.(false);
            }

            els.chaptersPanel.classList.toggle('yt-cinema-chapters-open', open);
            els.chaptersPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
            els.chaptersBtn?.classList.toggle('active', open);
            flags.chaptersOpen = open;
            ctx.autohide?.reset();

            if (open) {
                els.chaptersClose?.focus();
                if (!loaded && !loading) loadChapters();
            } else if (force === undefined) {
                els.chaptersBtn?.focus();
            }
        }

        function resetForNewVideo(nextVideoId) {
            videoId = nextVideoId || ctx.currentVideoId || null;
            requestSeq++;
            chapters = [];
            meta = null;
            loaded = false;
            loading = false;
            activeIndex = -1;
            descExpanded = false;

            if (els.chaptersList) els.chaptersList.innerHTML = '';
            if (els.chaptersMeta) els.chaptersMeta.innerHTML = '';
            setStatus('');
            updateCountBadge();

            if (videoId && (isOpen() || YTC.innertube?.readConfig?.())) {
                loadChapters();
            }
        }

        function onBtnClick(e) {
            e.stopPropagation();
            togglePanel();
        }

        function onCloseClick(e) {
            e.stopPropagation();
            togglePanel(false);
        }

        function bind() {
            els.chaptersBtn?.addEventListener('click', onBtnClick);
            els.chaptersClose?.addEventListener('click', onCloseClick);
            updateCountBadge();
            if (videoId && YTC.innertube?.readConfig?.()) {
                loadChapters();
            }
        }

        function dispose() {
            requestSeq++;
            loading = false;
            els.chaptersBtn?.removeEventListener('click', onBtnClick);
            els.chaptersClose?.removeEventListener('click', onCloseClick);
            flags.chaptersOpen = false;
            els.chaptersPanel?.classList.remove('yt-cinema-chapters-open');
            els.chaptersPanel?.setAttribute('aria-hidden', 'true');
            els.chaptersBtn?.classList.remove('active');
        }

        return { bind, togglePanel, isOpen, syncActiveChapter, resetForNewVideo, dispose };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.chapters = { createChaptersControl };
})(globalThis.YTC);
