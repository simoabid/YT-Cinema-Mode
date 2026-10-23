/**
 * Tests for local resume progress — the in-overlay counterpart to YouTube's
 * own watch history.
 */

const { loadExtension } = require('./harness');

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('local progress', () => {
    it('resumes at the saved position', () => {
        const env = loadExtension();
        env.YTC.progress.save('vid123', 42000, 600000);

        if (env.YTC.progress.resumeTimestamp('vid123') !== '42') {
            throw new Error(`wrong resume timestamp: ${env.YTC.progress.resumeTimestamp('vid123')}`);
        }
        const entry = env.YTC.progress.get('vid123');
        if (!entry || entry.position !== 42000 || entry.duration !== 600000) {
            throw new Error(`wrong saved entry: ${JSON.stringify(entry)}`);
        }
    });

    it('does not let a fresh start erase an earlier resume point', () => {
        const env = loadExtension();
        env.YTC.progress.save('vid123', 42000, 600000);
        env.YTC.progress.save('vid123', 5000, 600000);

        const entry = env.YTC.progress.get('vid123');
        if (!entry || entry.position !== 42000) {
            throw new Error(`early playback overwrote progress: ${JSON.stringify(entry)}`);
        }
    });

    it('does not resume a finished video', () => {
        const env = loadExtension();
        env.YTC.progress.save('vid123', 42000, 600000);
        env.YTC.progress.save('vid123', 590000, 600000);

        if (env.YTC.progress.get('vid123')) throw new Error('finished video still has progress');
        if (env.YTC.progress.resumeTimestamp('vid123')) throw new Error('finished video still resumes');
    });

    it('clears progress explicitly', () => {
        const env = loadExtension();
        env.YTC.progress.save('vid123', 42000, 600000);
        env.YTC.progress.clear('vid123');

        if (env.YTC.progress.get('vid123')) throw new Error('clear did not remove the entry');
        if (env.YTC.progress.resumeTimestamp('vid123')) throw new Error('cleared video still resumes');
    });

    it('keeps the map bounded', () => {
        const env = loadExtension();
        for (let i = 0; i < 105; i++) {
            env.YTC.progress.save(`vid${i}`, 20000 + i, 600000);
        }
        if (Object.keys(env.YTC.state.progress).length > 100) {
            throw new Error(`progress map grew to ${Object.keys(env.YTC.state.progress).length}`);
        }
    });

    it('loads persisted progress on startup', async () => {
        const env = loadExtension();
        env.store.local[env.YTC.KEYS.progress] = {
            vid123: { position: 123000, duration: 600000, updated: 1 }
        };

        env.YTC.initSettings();
        await wait();

        if (env.YTC.progress.resumeTimestamp('vid123') !== '123') {
            throw new Error('persisted progress was not restored');
        }
    });
});
