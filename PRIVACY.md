# Privacy Policy — YouTube Cinema Mode

Last updated: 2026-10-23

YouTube Cinema Mode does not collect, store, sell, or share personal data with the developer.

- **Local data.** Settings and per-video resume positions are stored in the browser's own extension storage (`storage.sync` / `storage.local`). They never leave the browser except through the browser's normal settings-sync mechanism, which is controlled by the browser vendor.
- **YouTube requests.** When you are signed in and use Cinema Mode, the extension reads YouTube's session cookies (SAPISID family) locally to construct the same `Authorization: SAPISIDHASH …` and `X-Goog-AuthUser` headers that YouTube's own watch page sends. Those headers are used only for requests to `https://www.youtube.com` so the video can be played and your own YouTube watch history and resume position can be updated.
- **No cookie storage or logging.** Cookie values are not stored, logged, or transmitted to the developer or to any third party. There are no analytics, ads, telemetry, or external tracking endpoints.
- **Scope.** The content script only runs on `youtube.com`. No data is collected from any other website.

Questions or reports: https://github.com/simoabid/YT-Cinema-Mode/issues
