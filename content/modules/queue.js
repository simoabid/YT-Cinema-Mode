/**
 * Watch Queue store — ordered Up Next queue persisted in storage.local
 * under `YTC.KEYS.queue` with pub/sub updates for open overlay drawers.
 */
(function (YTC) {
    'use strict';

    const state = YTC.state;
    const listeners = new Set();

    function normalizeItem(item) {
        if (!item || !item.videoId) return null;
        return {
            videoId: String(item.videoId),
            title: String(item.title || 'YouTube Video').trim() || 'YouTube Video',
            isShort: Boolean(item.isShort)
        };
    }

    function ensureQueueArray() {
        if (!Array.isArray(state.queue)) state.queue = [];
        return state.queue;
    }

    function notify() {
        const snapshot = getAll();
        for (const listener of [...listeners]) {
            try {
                listener(snapshot);
            } catch (_) {}
        }
    }

    function persist() {
        YTC.storage.setLocal(YTC.KEYS.queue, ensureQueueArray());
    }

    function getAll() {
        return [...ensureQueueArray()];
    }

    function add(item) {
        const entry = normalizeItem(item);
        if (!entry) return false;
        const queue = ensureQueueArray();
        if (queue.some((existing) => existing.videoId === entry.videoId)) return false;
        queue.push(entry);
        persist();
        notify();
        return true;
    }

    function remove(videoId) {
        if (!videoId) return false;
        const queue = ensureQueueArray();
        const next = queue.filter((item) => item.videoId !== videoId);
        if (next.length === queue.length) return false;
        state.queue = next;
        persist();
        notify();
        return true;
    }

    function shift() {
        const queue = ensureQueueArray();
        if (queue.length === 0) return null;
        const first = queue.shift();
        persist();
        notify();
        return first;
    }

    function clear() {
        const queue = ensureQueueArray();
        if (queue.length === 0) return;
        state.queue = [];
        persist();
        notify();
    }

    function count() {
        return ensureQueueArray().length;
    }

    function subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    }

    function loadStoredQueue() {
        try {
            YTC.api.storage.local.get([YTC.KEYS.queue], (res) => {
                const stored = res && res[YTC.KEYS.queue];
                if (!Array.isArray(stored)) return;
                state.queue = stored.map(normalizeItem).filter(Boolean);
                notify();
            });
        } catch (_) {}
    }

    YTC.queue = { getAll, add, remove, shift, clear, count, subscribe, loadStoredQueue };
})(globalThis.YTC);
