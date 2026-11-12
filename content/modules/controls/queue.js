/**
 * Queue control — header badge and slide-over Up Next watch queue drawer.
 */
(function (YTC) {
    'use strict';

    const icons = YTC.icons;

    function createQueueControl(ctx) {
        const { els, flags } = ctx;

        let unsubscribe = null;

        function isOpen() {
            return Boolean(els.queuePanel?.classList.contains('yt-cinema-queue-open'));
        }

        function render(items = YTC.queue.getAll()) {
            const countEl = els.queueBtn?.querySelector('.yt-cinema-queue-count');
            if (countEl) countEl.textContent = items.length > 0 ? String(items.length) : '';
            els.queueBtn?.setAttribute('title',
                items.length > 0 ? `Watch Queue (${items.length}) (U)` : 'Watch Queue (U)');

            if (els.queueClear) {
                els.queueClear.disabled = items.length === 0;
            }

            if (els.queueStatus) {
                els.queueStatus.textContent = items.length === 0
                    ? 'Queue is empty. Hover any thumbnail and click + Queue or press Alt+Q.'
                    : '';
            }

            if (!els.queueList) return;
            els.queueList.innerHTML = '';

            items.forEach((item, idx) => {
                const row = document.createElement('div');
                row.className = 'yt-cinema-queue-item';
                row.dataset.videoId = item.videoId;

                const indexEl = document.createElement('span');
                indexEl.className = 'yt-cinema-queue-item-index';
                indexEl.textContent = String(idx + 1);

                const titleBtn = document.createElement('button');
                titleBtn.type = 'button';
                titleBtn.className = 'yt-cinema-queue-item-title';
                titleBtn.textContent = item.title || 'YouTube Video';
                titleBtn.setAttribute('title', `Play ${item.title || 'video'}`);
                titleBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    YTC.queue.remove(item.videoId);
                    ctx.navigation?.loadVideo?.(item.videoId, item.title, item.isShort);
                    ctx.toast?.show(`Playing from Queue: ${item.title}`, icons.queue);
                    ctx.autohide?.reset();
                });

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'yt-cinema-queue-item-remove';
                removeBtn.setAttribute('title', 'Remove from queue');
                removeBtn.setAttribute('aria-label', 'Remove from queue');
                removeBtn.innerHTML = icons.close;
                removeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    YTC.queue.remove(item.videoId);
                    ctx.autohide?.reset();
                });

                row.appendChild(indexEl);
                row.appendChild(titleBtn);
                row.appendChild(removeBtn);
                els.queueList.appendChild(row);
            });
        }

        function togglePanel(force) {
            if (!els.queuePanel) return;

            const open = typeof force === 'boolean' ? force : !isOpen();
            if (open === isOpen()) return;

            if (open) {
                if (flags.commentsOpen) ctx.engagement?.toggleComments?.(false);
                if (flags.chaptersOpen) ctx.chapters?.togglePanel?.(false);
            }

            els.queuePanel.classList.toggle('yt-cinema-queue-open', open);
            els.queuePanel.setAttribute('aria-hidden', open ? 'false' : 'true');
            els.queueBtn?.classList.toggle('active', open);
            flags.queueOpen = open;
            ctx.autohide?.reset();

            if (open) {
                render();
                els.queueClose?.focus();
            } else if (force === undefined) {
                els.queueBtn?.focus();
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

        function onClearClick(e) {
            e.stopPropagation();
            YTC.queue.clear();
            ctx.toast?.show('Watch queue cleared', icons.queue);
            ctx.autohide?.reset();
        }

        function bind() {
            els.queueBtn?.addEventListener('click', onBtnClick);
            els.queueClose?.addEventListener('click', onCloseClick);
            els.queueClear?.addEventListener('click', onClearClick);
            unsubscribe = YTC.queue.subscribe(render);
            render();
        }

        function dispose() {
            if (unsubscribe) {
                unsubscribe();
                unsubscribe = null;
            }
            els.queueBtn?.removeEventListener('click', onBtnClick);
            els.queueClose?.removeEventListener('click', onCloseClick);
            els.queueClear?.removeEventListener('click', onClearClick);
            flags.queueOpen = false;
            els.queuePanel?.classList.remove('yt-cinema-queue-open');
            els.queuePanel?.setAttribute('aria-hidden', 'true');
            els.queueBtn?.classList.remove('active');
        }

        return { bind, togglePanel, isOpen, render, dispose };
    }

    YTC.controls = YTC.controls || {};
    YTC.controls.queue = { createQueueControl };
})(globalThis.YTC);
