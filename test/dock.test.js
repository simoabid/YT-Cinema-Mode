/**
 * Tests for the dock control — modal/docked transitions, saved geometry and
 * the pointer-driven drag and resize paths.
 */

const { loadExtension, createContext, makeEvent } = require('./harness');

const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function setupDock() {
    const env = loadExtension();
    const ctx = createContext(env);

    env.YTC.state.activeModalOverlay = ctx.overlayElement;
    ctx.overlayElement.dataset.aspectRatio = String(16 / 9);
    ctx.els.container.offsetWidth = 540;
    ctx.els.container.offsetHeight = 340;

    const dock = env.YTC.controls.dock.createDockControl(ctx);
    dock.bind();

    return { env, ctx, dock };
}

function findResizeHandle(container, direction) {
    return container.querySelectorAll('.yt-cinema-resize-handle')
        .find((el) => el.dataset.direction === direction);
}

describe('dock transitions', () => {
    it('docks into the saved/default corner and returns to modal mode', () => {
        const { env, ctx, dock } = setupDock();
        const { state } = env.YTC;

        dock.toggle();

        if (!ctx.isDocked) throw new Error('ctx.isDocked was not set');
        if (!state.activeDockedOverlays.has(ctx.overlayElement)) {
            throw new Error('overlay was not registered as docked');
        }
        if (!ctx.overlayElement.classList.contains('yt-cinema-docked')) {
            throw new Error('overlay is missing the docked class');
        }
        if (!ctx.els.container.classList.contains('yt-cinema-docked')) {
            throw new Error('container is missing the docked class');
        }
        if (ctx.els.container.style.getPropertyValue('--yt-dock-w') !== '540px') {
            throw new Error(`wrong default dock width: ${ctx.els.container.style.getPropertyValue('--yt-dock-w')}`);
        }
        if (ctx.els.container.dataset.dockX !== '1364' || ctx.els.container.dataset.dockY !== '724') {
            throw new Error(`wrong default dock position: ${ctx.els.container.dataset.dockX}, ${ctx.els.container.dataset.dockY}`);
        }

        dock.toggle();

        if (ctx.isDocked) throw new Error('ctx.isDocked was not cleared');
        if (state.activeDockedOverlays.has(ctx.overlayElement)) {
            throw new Error('overlay stayed registered as docked');
        }
        if (state.activeModalOverlay !== ctx.overlayElement) {
            throw new Error('overlay was not restored as the modal');
        }
        if (ctx.els.container.classList.contains('yt-cinema-docked')) {
            throw new Error('docked class survived the return to modal mode');
        }
        if (ctx.els.container.style.getPropertyValue('--yt-dock-w') !== '') {
            throw new Error('dock geometry variables were not cleared');
        }
    });

    it('the dock button toggles the same state', () => {
        const { ctx, dock } = setupDock();

        ctx.els.dockBtn.dispatchEvent(makeEvent('click'));
        if (!ctx.isDocked) throw new Error('dock button did not dock the player');

        ctx.els.dockBtn.dispatchEvent(makeEvent('click'));
        if (ctx.isDocked) throw new Error('dock button did not undock the player');

        dock.toggle(false);
        if (ctx.isDocked) throw new Error('toggling to the current state should be a no-op');
    });
});

describe('dock dragging', () => {
    it('snaps to the left and bottom edges and remembers the position', async () => {
        const { env, ctx, dock } = setupDock();
        const header = ctx.els.header;

        dock.toggle();

        header.dispatchEvent(makeEvent('pointerdown', {
            button: 0, clientX: 1500, clientY: 700, pointerId: 1, target: header
        }));
        header.dispatchEvent(makeEvent('pointermove', { clientX: 20, clientY: 700 }));

        if (!ctx.els.container.classList.contains('yt-cinema-snap-edge')) {
            throw new Error('dragging to the edge did not engage snapping');
        }

        await wait();

        if (ctx.els.container.dataset.dockX !== '16') {
            throw new Error(`expected snapped x=16, got ${ctx.els.container.dataset.dockX}`);
        }
        if (ctx.els.container.dataset.dockY !== '724') {
            throw new Error(`expected snapped y=724, got ${ctx.els.container.dataset.dockY}`);
        }

        header.dispatchEvent(makeEvent('pointerup', { pointerId: 1 }));

        if (ctx.els.container.classList.contains('yt-cinema-snap-edge')) {
            throw new Error('snap feedback survived pointerup');
        }
        const saved = env.YTC.state.savedDockedPos;
        if (!saved || saved.x !== 16 || saved.y !== 724) {
            throw new Error(`dock position was not remembered: ${JSON.stringify(saved)}`);
        }
        if (!env.store.local[env.YTC.KEYS.dockedPos]) {
            throw new Error('dock position was not persisted');
        }
    });
});

describe('dock resizing', () => {
    it('resizes from the west edge and remembers the size', async () => {
        const { env, ctx, dock } = setupDock();

        dock.toggle();

        const handle = findResizeHandle(ctx.els.container, 'w');
        if (!handle) throw new Error('west resize handle is missing');

        handle.dispatchEvent(makeEvent('pointerdown', {
            button: 0, clientX: 1000, clientY: 500, pointerId: 2, target: handle
        }));

        if (!ctx.els.container.classList.contains('yt-cinema-resizing')) {
            throw new Error('resizing class was not applied');
        }

        env.window.dispatchEvent(makeEvent('pointermove', { clientX: 1100, clientY: 500 }));

        await wait();

        if (ctx.els.container.style.getPropertyValue('--yt-dock-w') !== '440px') {
            throw new Error(`wrong resized width: ${ctx.els.container.style.getPropertyValue('--yt-dock-w')}`);
        }
        if (ctx.els.container.style.getPropertyValue('--yt-dock-x') !== '1464px') {
            throw new Error(`west resize moved the wrong way: ${ctx.els.container.style.getPropertyValue('--yt-dock-x')}`);
        }

        env.window.dispatchEvent(makeEvent('pointerup', { pointerId: 2, target: handle }));

        if (ctx.els.container.classList.contains('yt-cinema-resizing')) {
            throw new Error('resizing class survived pointerup');
        }
        const saved = env.YTC.state.savedDockedSize;
        if (!saved || saved.width !== 440 || saved.height !== 340) {
            throw new Error(`dock size was not remembered: ${JSON.stringify(saved)}`);
        }
        if (!env.store.local[env.YTC.KEYS.dockedSize]) {
            throw new Error('dock size was not persisted');
        }
    });
});
