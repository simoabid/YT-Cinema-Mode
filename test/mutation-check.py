#!/usr/bin/env python3
"""
Mutation check: revert each bug fix in turn and confirm the test suite fails.

This proves the tests actually guard the fixes rather than passing vacuously.
Every patch below is the reverse of a real change made to the extension.
"""
import subprocess, shutil, signal, sys, tempfile, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MUTATIONS = [
    ("transport.js", "volume-down silently unmutes", "content/modules/controls/transport.js",
     [("""                if (playerObj && typeof playerObj.setVolume === 'function') {
                    playerObj.setVolume(target);
                }
                if (video) video.volume = target / 100;
            } catch (_) {}
            return target;""",
       """                if (playerObj && typeof playerObj.setVolume === 'function') {
                    playerObj.setVolume(target);
                }
                if (video) video.volume = target / 100;

                if (target > 0 && getVolumeState().isMuted) {
                    unmute();
                }
            } catch (_) {}
            return target;""")]),

    ("navigation.js", "recordNavigation skips overlay mirrors", "content/modules/controls/navigation.js",
     [("""            syncOverlayIdentity(newId, Boolean(isShortVideo));

            // The bridge re-reports this video's quality list, and the reset
            // makes the remembered quality eligible to apply once again.
            ctx.quality.resetForNewVideo();
            ctx.history.onVideoChanged(newId);

            if (newTitle) updateHeaderTitle(newTitle, Boolean(isShortVideo));""",
       """            ctx.currentVideoId = newId;

            // The bridge re-reports this video's quality list, and the reset
            // makes the remembered quality eligible to apply once again.
            ctx.quality.resetForNewVideo();
            ctx.history.onVideoChanged(newId);

            if (newTitle) updateHeaderTitle(newTitle, Boolean(isShortVideo));""")]),

    ("quality.js", "injectBridge stacks a listener per call", "content/modules/controls/quality.js",
     [("""                if (doc._ytCinemaBridgeListener) {
                    doc.removeEventListener('yt-cinema-quality-bridge-event', doc._ytCinemaBridgeListener);
                }
                doc._ytCinemaBridgeListener = handleBridgeEvent;
                doc.addEventListener('yt-cinema-quality-bridge-event', handleBridgeEvent);""",
       """                doc.addEventListener('yt-cinema-quality-bridge-event', handleBridgeEvent);""")]),

    ("quality.js", "message listener accepts any sender", "content/modules/controls/quality.js",
     [("""        function handleWindowMessage(event) {
            if (!isFromEmbed(event)) return;
""",
       """        function handleWindowMessage(event) {
""")]),

    ("toast.js", "clear() leaves the toast visible", "content/modules/controls/toast.js",
     [("""                timer = null;
            }
            toast?.classList.remove('yt-cinema-toast-visible');
        }""",
       """                timer = null;
            }
        }""")]),

    ("toast.js", "flashSuccess timers are not per-button", "content/modules/controls/toast.js",
     [("""        if (flashTimers.has(btn)) clearTimeout(flashTimers.get(btn));
        flashTimers.set(btn, setTimeout(() => {
            flashTimers.delete(btn);
            btn.classList.remove('yt-cinema-copied');
            btn.setAttribute('title', originalTitle);
            checkIcon.style.display = 'none';
            if (mainIcon) mainIcon.style.display = 'inline-block';
        }, SUCCESS_FEEDBACK_MS));""",
       """        setTimeout(() => {
            btn.classList.remove('yt-cinema-copied');
            btn.setAttribute('title', originalTitle);
            checkIcon.style.display = 'none';
            if (mainIcon) mainIcon.style.display = 'inline-block';
        }, SUCCESS_FEEDBACK_MS);""")]),

    ("core.js", "ambientQuality branches unreachable", "content/modules/core.js",
     [("""        let blurVal = resolveAmbientBlur();""",
       """        let blurVal = 80;
        if (settings.ambientBlur !== undefined) {
            blurVal = parseInt(settings.ambientBlur, 10);
            if (isNaN(blurVal)) blurVal = 80;
        } else if (settings.ambientQuality === 'medium') {
            blurVal = 40;
        } else if (settings.ambientQuality === 'low') {
            blurVal = 0;
        }""")]),

    ("theme.js", "unknown flavor is not normalized", "content/modules/theme.js",
     [("""    function normalize(themeId) {
        return THEMES.includes(themeId) ? themeId : DEFAULT_THEME;
    }""",
       """    function normalize(themeId) {
        return themeId;
    }""")]),

    ("controller.js", "quality menu not closed on teardown", "content/modules/controller.js",
     [("""        ctx.speed.closeMenu();
        ctx.quality.closeMenu();
        ctx.transport.clearTimers();""",
       """        ctx.speed.closeMenu();
        ctx.transport.clearTimers();""")]),

    ("keyboard.js", "dispose leaves the iframe load listener", "content/modules/controls/keyboard.js",
     [("""            window.removeEventListener('keydown', keyHandler, true);
            iframe.removeEventListener('load', attachIframeListeners);""",
       """            window.removeEventListener('keydown', keyHandler, true);""")]),

    ("transport.js", "clearTimers leaves the HUD visible", "content/modules/controls/transport.js",
     [("""                hudTimer = null;
            }
            els.volumeHud?.classList.remove('yt-cinema-volume-hud-visible');""",
       """                hudTimer = null;
            }""")]),

    ("navigation.js", "embed navigation does not reset quality", "content/modules/controls/navigation.js",
     [("""            // The bridge re-reports this video's quality list, and the reset
            // makes the remembered quality eligible to apply once again.
            ctx.quality.resetForNewVideo();
            ctx.history.onVideoChanged(newId);""",
       """            ctx.history.onVideoChanged(newId);""")]),

    ("content.js", "hover stops tracking when the badge is hidden", "content/content.js",
     [("""        // Always track, so hotkeys work even when the indicator is disabled.
        state.currentTarget = link;
        if (settings.showIndicator) scheduleIndicator(link);""",
       """        if (settings.showIndicator) {
            state.currentTarget = link;
            scheduleIndicator(link);
        }""")]),

    ("launcher.js", "invalid links are launched anyway", "content/modules/launcher.js",
     [("""        const videoId = video.getVideoID(link.href);
        if (!videoId) return false;

        const title = video.getVideoTitle(link);""",
       """        const videoId = video.getVideoID(link.href);

        const title = video.getVideoTitle(link);""")]),

    ("dock.js", "drag edge snapping is dead", "content/modules/controls/dock.js",
     [("""            if (value <= MARGIN + SNAP_THRESHOLD) return { value: MARGIN, snapped: true };
            if (value >= max - SNAP_THRESHOLD) return { value: max, snapped: true };""",
       """            if (value <= MARGIN + SNAP_THRESHOLD) return { value: MARGIN, snapped: false };
            if (value >= max - SNAP_THRESHOLD) return { value: max, snapped: false };""")]),

    ("01-overlay.css", "hidden hover badge captures clicks", "content/styles/01-overlay.css",
     [("""/* A faded badge keeps its last position, so it must not swallow clicks on the
   thumbnail underneath it. */
.yt-cinema-hover-indicator:not(.yt-cinema-hover-visible) {
    pointer-events: none;
}

""", "")]),

    ("video.js", "junk thumbnail alt text is accepted as a title", "content/modules/video.js",
     [("""        if (!text || UNUSABLE_TITLE_TEXT.has(text.toLowerCase())) return null;""",
       """        if (!text) return null;""")]),

    ("history.js", "beacons are minted for an embedded watch", "content/modules/controls/history.js",
     [("""        url += `ver=2&cpn=${encodeURIComponent(opts.cpn)}&c=WEB&cmt=${opts.cmt}&el=detailpage`;""",
       """        url += `ver=2&cpn=${encodeURIComponent(opts.cpn)}&c=WEB&cmt=${opts.cmt}&el=embedded`;""")]),

    ("history.js", "local progress is never saved", "content/modules/controls/history.js",
     [("""            } else if (!skipProgress) {
                YTC.progress.save(current.videoId, positionMs, duration);
            }""",
       """            }""")]),

    ("history.js", "completed videos are not marked to the end", "content/modules/controls/history.js",
     [("""            const cmt = completion && tracking.lengthSeconds > 1
                ? Math.max(0, Math.floor(tracking.lengthSeconds) - 1)
                : Math.max(0, Math.round(clamped / 1000));""",
       """            const cmt = Math.max(0, Math.round(clamped / 1000));""")]),

    ("history.js", "page-realm fetch is skipped", "content/modules/controls/history.js",
     [("""        const pageWindow = window.wrappedJSObject;
        if (pageWindow && typeof pageWindow.fetch === 'function' && typeof cloneInto === 'function') {""",
       """        const pageWindow = window.wrappedJSObject;
        if (false) {""")]),

    ("history.js", "history requests omit the account selector", "content/modules/controls/history.js",
     [("""        if (authUser !== null && authUser !== undefined && authUser !== '') {
            headers['X-Goog-AuthUser'] = String(authUser);
        }""",
       """        if (false) {
            headers['X-Goog-AuthUser'] = String(authUser);
        }""")]),

    ("history.js", "history requests omit the authorization header", "content/modules/controls/history.js",
     [("""        if (auth) {
            headers.Authorization = auth.authorization;
            if (auth.pageId) headers['X-Goog-PageId'] = auth.pageId;
        }""",
       """        if (auth) {
            if (auth.pageId) headers['X-Goog-PageId'] = auth.pageId;
        }""")]),

    ("background.js", "SAPISIDHASH input order is wrong", "background/background.js",
     [("""        const input = userSession
            ? `${userSession} ${timestamp} ${cookie} ${AUTH_ORIGIN}`
            : `${timestamp} ${cookie} ${AUTH_ORIGIN}`;""",
       """        const input = userSession
            ? `${timestamp} ${userSession} ${cookie} ${AUTH_ORIGIN}`
            : `${timestamp} ${cookie} ${AUTH_ORIGIN}`;""")]),

    ("history.js", "final beacons are not marked ended", "content/modules/controls/history.js",
     [("""        if (opts.final) url += '&state=ended';""",
       """        if (opts.final) url += '&state=playing';""")]),

    ("history.js", "ads are reported as playback", "content/modules/controls/history.js",
     [("""            if (!ctx.currentVideoId) return;
            if (isAdPlaying()) return;""",
       """            if (!ctx.currentVideoId) return;""")]),

    ("controller.js", "close does not commit the history session", "content/modules/controller.js",
     [("""        ctx.transport.clearTimers();
        ctx.history.stop();""",
       """        ctx.transport.clearTimers();""")]),

    ("navigation.js", "embed navigation does not tell history", "content/modules/controls/navigation.js",
     [("""            ctx.quality.resetForNewVideo();
            ctx.history.onVideoChanged(newId);""",
       """            ctx.quality.resetForNewVideo();""")]),

    ("launcher.js", "saved progress is ignored on launch", "content/modules/launcher.js",
     [("""        const timestamp = video.getVideoTimestamp(link.href) ||
            YTC.progress.resumeTimestamp(videoId);""",
       """        const timestamp = video.getVideoTimestamp(link.href);""")]),
]

def run_tests():
    r = subprocess.run(["node", "test/run.js"], cwd=ROOT,
                       capture_output=True, text=True,
                       env={**os.environ, "PATH": os.environ.get("NODE_BIN", "") + ":" + os.environ["PATH"]})
    return r.returncode, r.stdout + r.stderr

def _interrupt(signum, frame):
    raise KeyboardInterrupt(f"signal {signum}")


def main():
    signal.signal(signal.SIGTERM, _interrupt)
    node_bin = sys.argv[1] if len(sys.argv) > 1 else ""
    if node_bin:
        os.environ["NODE_BIN"] = node_bin

    rc, out = run_tests()
    if rc != 0:
        print("Baseline suite is not green; aborting mutation check.")
        print(out)
        return 1
    print(f"baseline: all tests pass ({out.strip().splitlines()[-1]})\n")

    survived = []
    for name, label, rel, patches in MUTATIONS:
        path = os.path.join(ROOT, rel)
        original = open(path, encoding="utf-8").read()
        mutated = original
        try:
            for old, new in patches:
                if old not in mutated:
                    raise SystemExit(f"!! patch anchor not found for '{label}' in {rel}")
                mutated = mutated.replace(old, new, 1)
        except SystemExit as e:
            print(e); return 1

        try:
            open(path, "w", encoding="utf-8").write(mutated)
            rc, out = run_tests()
        finally:
            # Always restore, even if the run is interrupted mid-mutation.
            open(path, "w", encoding="utf-8").write(original)

        name = name.split()[0]
        if rc == 0:
            survived.append(f"{name}: {label}")
            print(f"  NOT CAUGHT  {name:<14} {label}")
        else:
            summary = [l for l in out.splitlines() if "passed," in l]
            print(f"  caught      {name:<14} {label}  ({summary[-1].strip() if summary else 'crash'})")

    print()
    if survived:
        print(f"{len(survived)} mutation(s) survived - tests are missing coverage:")
        for s in survived:
            print(f"  - {s}")
        return 1
    print(f"all {len(MUTATIONS)} mutations caught by the suite")
    return 0

if __name__ == "__main__":
    sys.exit(main())
