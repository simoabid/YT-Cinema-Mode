/**
 * Regression tests for title extraction.
 *
 * YouTube's search-result thumbnails carry `alt="true"` on the thumbnail
 * image. `getVideoTitle` used to trust any non-empty alt, so the overlay,
 * screenshot filename and copy toast all showed "true" instead of the title.
 */

const { loadExtension } = require('./harness');

function setupSearchCard() {
    const env = loadExtension();
    const { document } = env;

    const card = document.createElement('ytd-video-renderer');
    const link = document.createElement('a');
    link.id = 'thumbnail';
    link.setAttribute('href', 'https://www.youtube.com/watch?v=vid123');
    link.setAttribute('aria-hidden', 'true');
    link.setAttribute('tabindex', '-1');

    const img = document.createElement('img');
    img.setAttribute('alt', 'true');
    link.appendChild(img);

    const titleLink = document.createElement('a');
    titleLink.id = 'video-title';
    titleLink.setAttribute('title', 'Real Video Title');
    titleLink.textContent = 'Real Video Title';

    card.appendChild(link);
    card.appendChild(titleLink);
    document.body.appendChild(card);

    return { env, document, card, link, img, titleLink };
}

describe('video title extraction', () => {
    it('ignores the boolean alt YouTube puts on search thumbnails', () => {
        const { env, link } = setupSearchCard();

        const title = env.YTC.video.getVideoTitle(link);
        if (title !== 'Real Video Title') {
            throw new Error(`expected the card title, got "${title}"`);
        }
    });

    it('ignores a boolean aria-label as well', () => {
        const { env, link } = setupSearchCard();
        link.setAttribute('aria-label', 'true');

        const title = env.YTC.video.getVideoTitle(link);
        if (title !== 'Real Video Title') {
            throw new Error(`expected the card title, got "${title}"`);
        }
    });

    it('ignores alt="false" too', () => {
        const { env, link, img } = setupSearchCard();
        img.setAttribute('alt', 'false');

        const title = env.YTC.video.getVideoTitle(link);
        if (title !== 'Real Video Title') {
            throw new Error(`expected the card title, got "${title}"`);
        }
    });

    it('prefers an explicit title attribute', () => {
        const { env, link } = setupSearchCard();
        link.setAttribute('title', 'Direct Title');

        if (env.YTC.video.getVideoTitle(link) !== 'Direct Title') {
            throw new Error('explicit title did not win');
        }
    });

    it('still uses a meaningful image alt', () => {
        const env = loadExtension();
        const link = env.document.createElement('a');
        const img = env.document.createElement('img');
        img.setAttribute('alt', 'Meaningful Alt');
        link.appendChild(img);
        env.document.body.appendChild(link);

        if (env.YTC.video.getVideoTitle(link) !== 'Meaningful Alt') {
            throw new Error('a legitimate alt was discarded');
        }
    });

    it('falls back when nothing usable is present', () => {
        const env = loadExtension();
        const link = env.document.createElement('a');
        const img = env.document.createElement('img');
        img.setAttribute('alt', 'true');
        link.appendChild(img);
        env.document.body.appendChild(link);

        if (env.YTC.video.getVideoTitle(link) !== 'YouTube Video') {
            throw new Error('fallback title is missing');
        }
        if (env.YTC.video.getVideoTitle(null) !== 'YouTube Video') {
            throw new Error('null element should return the fallback title');
        }
    });
});
