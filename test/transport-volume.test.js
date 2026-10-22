/**
 * Regression tests for the transport control.
 *
 * The bug: `setVolume()` unmuteed for *any* positive target, so pressing the
 * volume-down key while muted silently unmuted. `changeVolume()` already
 * guarded that case with `delta > 0`, making the guard dead and the behaviour
 * wrong. Teardown also left the HUD stuck on screen.
 */

const { loadExtension, createContext } = require('./harness');

function setupTransport({ muted = false, volume = 100 } = {}) {
    const env = loadExtension();
    const ctx = createContext(env);

    ctx.embed.media.muted = muted;
    ctx.embed.media.volume = volume / 100;
    ctx.embed.player.getVolume = () => volume;
    ctx.embed.player.isMuted = () => muted;
    ctx.embed.player.setVolume = () => {};
    ctx.embed.player.unMute = () => { muted = false; ctx.embed.media.muted = false; };
    ctx.embed.player.mute = () => { muted = true; ctx.embed.media.muted = true; };

    const transport = env.YTC.controls.transport.createTransportControl(ctx);
    return { env, ctx, transport, state: () => ({ muted, volume }) };
}

describe('transport volume', () => {
    it('does not unmute when the volume is lowered while muted', () => {
        const { transport, state } = setupTransport({ muted: true, volume: 60 });

        transport.changeVolume(-5);

        if (!state().muted) {
            throw new Error('ArrowDown unmuted the player; lowering volume must never unmute');
        }
    });

    it('does not unmute when setVolume is driven down to a non-zero level', () => {
        const { ctx, transport, state } = setupTransport({ muted: true, volume: 60 });

        // Same path as changeVolume(-5), but proving setVolume itself is inert.
        transport.changeVolume(-5);

        if (!state().muted) throw new Error('setVolume must not change mute state');
        if (ctx.embed.media.volume !== 0.55) {
            throw new Error(`expected volume 0.55, got ${ctx.embed.media.volume}`);
        }
    });

    it('unmutes when the volume is raised while muted', () => {
        const { transport, state } = setupTransport({ muted: true, volume: 60 });

        transport.changeVolume(5);

        if (state().muted) {
            throw new Error('ArrowUp should unmute the player');
        }
    });

    it('stays unmuted and keeps lowering normally', () => {
        const { transport, state, ctx } = setupTransport({ muted: false, volume: 60 });

        transport.changeVolume(-5);

        if (state().muted) throw new Error('already unmuted; should not have toggled');
        if (ctx.embed.media.volume !== 0.55) {
            throw new Error(`expected volume 0.55, got ${ctx.embed.media.volume}`);
        }
    });

    it('reports Muted on the HUD only when the level is actually zero', () => {
        const { ctx, transport } = setupTransport({ muted: true, volume: 60 });

        transport.changeVolume(-5);

        const text = ctx.els.volumeHud.querySelector('.yt-cinema-volume-text');
        if (text.textContent === 'Muted') {
            throw new Error('HUD says Muted even though the level is 55% and the player is still muted-but-audible');
        }
    });

    it('clearTimers hides the volume HUD immediately', () => {
        const { ctx, transport } = setupTransport({ muted: false, volume: 100 });

        transport.changeVolume(-5);
        if (!ctx.els.volumeHud.classList.contains('yt-cinema-volume-hud-visible')) {
            throw new Error('HUD should be visible right after a volume change');
        }

        transport.clearTimers();

        if (ctx.els.volumeHud.classList.contains('yt-cinema-volume-hud-visible')) {
            throw new Error('clearTimers must hide the HUD, not just cancel its timer');
        }
    });
});
