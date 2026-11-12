/**
 * Icons — every inline SVG used by the overlay, in one place.
 * Keeping the markup here means a visual tweak is a one-line change.
 */
(function (YTC) {
    'use strict';

    const svg = (attrs, path) => `<svg ${attrs} fill="currentColor"><path d="${path}"/></svg>`;

    const CHECK_PATH = 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z';
    const INFO_PATH = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z';
    const ALERT_PATH = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z';

    /** The check mark as a node, used to mark the active row in a menu. */
    const checkSvg = (className) =>
        `<svg class="${className}" viewBox="0 0 24 24" fill="currentColor"><path d="${CHECK_PATH}"/></svg>`;

    YTC.icons = {
        CHECK_PATH,
        checkSvg,
        // Header / chrome
        clapper: svg('viewBox="0 0 24 24"', 'M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z'),
        dragGrip: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M9 3c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6-12c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>',
        shortsBadge: `<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M17.77 10.32l-1.2-.5L18 9.06c1.84-.96 2.53-3.23 1.56-5.06s-3.24-2.53-5.07-1.56L6 6.94c-1.29.68-2.07 2.04-2 3.49.07 1.42.93 2.67 2.22 3.25.03.01 1.2.5 1.2.5L6 14.93c-1.83.97-2.53 3.24-1.56 5.07.97 1.83 3.24 2.53 5.07 1.56l8.49-4.5c1.29-.68 2.06-2.04 1.99-3.49-.07-1.42-.92-2.67-2.22-3.25zM10 14.5v-5l4.5 2.5-4.5 2.5z"/></svg>Shorts`,
        resizeGrip: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M10 2L2 10M10 6L6 10M10 10L10 10.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',

        // Header buttons
        previous: svg('viewBox="0 0 24 24"', 'M6 6h2v12H6zm3.5 6l8.5 6V6z'),
        next: svg('viewBox="0 0 24 24"', 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z'),
        dock: svg('viewBox="0 0 24 24"', 'M19 11h-8v6h8v-6zm4-8H1v18h22V3zm-2 16H3V5h18v14z'),
        expand: svg('viewBox="0 0 24 24"', 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'),
        screenshot: svg('viewBox="0 0 24 24"', 'M12 9c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zm0 4.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm7-7.5h-3.17L14.41 4H9.59L8.17 6H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 14H5V8h3.88l1.42-2h3.4l1.42 2H19v12z'),
        copyLink: svg('viewBox="0 0 24 24"', 'M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z'),
        pip: svg('viewBox="0 0 24 24"', 'M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z'),
        newTab: svg('viewBox="0 0 24 24"', 'M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z'),
        close: svg('viewBox="0 0 24 24"', 'M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'),

        // Engagement
        thumbsUp: svg('viewBox="0 0 24 24"', 'M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z'),
        thumbsDown: svg('viewBox="0 0 24 24"', 'M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z'),
        comment: svg('viewBox="0 0 24 24"', 'M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z'),

        // Menus
        speed: svg('viewBox="0 0 24 24"', 'M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.28-10.43zM10.59 15.41a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z'),
        quality: svg('viewBox="0 0 24 24"', 'M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 11H9.5v-2h-2v2H6V9h1.5v2.5h2V9H11v6zm7-1c0 .55-.45 1-1 1h-4V9h4c.55 0 1 .45 1 1v4zm-1.5-3.5h-2v3h2v-3z'),

        // v2.0 controls
        loop: svg('viewBox="0 0 24 24" aria-hidden="true"', 'M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z'),
        chapters: svg('viewBox="0 0 24 24" aria-hidden="true"', 'M4 6h2v2H4V6zm0 5h2v2H4v-2zm0 5h2v2H4v-2zm4-10h12v2H8V6zm0 5h12v2H8v-2zm0 5h12v2H8v-2z'),
        queue: svg('viewBox="0 0 24 24" aria-hidden="true"', 'M4 10h12v2H4v-2zm0-4h12v2H4V6zm0 8h8v2H4v-2zm10 0v6l5-3-5-3z'),
        filters: svg('viewBox="0 0 24 24" aria-hidden="true"', 'M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z'),
        zen: svg('viewBox="0 0 24 24" aria-hidden="true"', 'M5 15H3v4c0 1.1.9 2 2 2h4v-2H5v-4zM5 5h4V3H5c-1.1 0-2 .9-2 2v4h2V5zm14-2h-4v2h4v4h2V5c0-1.1-.9-2-2-2zm0 16h-4v2h4c1.1 0 2-.9 2-2v-4h-2v4zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'),

        // Volume HUD
        volumeHigh: svg('viewBox="0 0 24 24"', 'M3 9v6h4l5 5V4L9 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z'),
        volumeLow: svg('viewBox="0 0 24 24"', 'M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z'),
        volumeMuted: svg('viewBox="0 0 24 24"', 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27l4.73 4.73H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z'),

        // Notifications
        info: svg('viewBox="0 0 24 24"', INFO_PATH),
        alert: svg('viewBox="0 0 24 24"', ALERT_PATH),
        alertSmall: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="${ALERT_PATH}"/></svg>`,
        successSmall: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="${CHECK_PATH}"/></svg>`
    };
})(globalThis.YTC);
