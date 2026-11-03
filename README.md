<div align="center">

<img src="icons/icon128.png" width="64" height="64" alt="YouTube Cinema Mode Logo"> 

# YouTube Cinema Mode 📽️🎞️

### 🎬 Watch YouTube Videos in a Stunning Cinema-Style Overlay

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore)
[![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--on-FF7139?style=for-the-badge&logo=firefox-browser&logoColor=white)](https://addons.mozilla.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.2.0-blue.svg?style=for-the-badge)](https://github.com/simoabid/YT-Cinema-Mode)
[![Made with Love](https://img.shields.io/badge/Made%20with-❤️-red.svg?style=for-the-badge)](https://github.com/simoabid/YT-Cinema-Mode)

<p align="center">
  <img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code&weight=600&size=28&pause=1000&color=FF0000&center=true&vCenter=true&width=650&lines=Transform+Your+YouTube+Experience+🚀;Cinema+Mode+On+Any+Page+🎬;Hover+%26+Watch+Instantly+🎥!;Dock+into+Floating+Mini--Player+📌;Ambient+Glow+%26+Shorts+Ready+✨" alt="Typing SVG" />
</p>

**A beautiful, feature-packed browser extension that lets you watch any YouTube video in a stunning cinema-style overlay without leaving the current page.**

[✨ Features](#-features) • [📦 Installation](#-installation--loading) • [🎯 Usage](#-usage) • [⚙️ Settings](#-settings) • [⌨️ Shortcuts](#-keyboard-shortcuts) • [🌐 Browser Support](#-browser-support) • [🤝 Contributing](#-contributing)

---

</div>

## 📋 Table of Contents

- [✨ Features](#-features)
- [📦 Installation & Loading](#-installation--loading)
- [🛠️ Build & Packaging](#-build--packaging)
- [🧪 Testing](#-testing)
- [🎯 Usage](#-usage)
- [⚙️ Settings](#-settings)
- [⌨️ Keyboard Shortcuts](#-keyboard-shortcuts)
- [🛠️ Tech Stack](#-tech-stack)
- [🔧 Technical Architecture](#-technical-architecture)
- [🌐 Browser Support](#-browser-support)
- [🤝 Contributing](#-contributing)
- [📝 License](#-license)
- [👨‍💻 Author](#-author)
- [⭐ Show Your Support](#-show-your-support)

---

## ✨ Features

<table>
<tr>
<td width="50%" valign="top">

### 🎥 **Hover & Watch**
Hover over any video thumbnail and press your configured hotkey (default <kbd>Space</kbd>), or press <kbd>Alt</kbd>+<kbd>H</kbd> as a global toggle, to immediately open cinema mode.

### 📌 **Draggable & Resizable Mini-Player**
Dock the player into a floating desktop window (`D`). Resize from any edge/corner or corner grip with smooth hardware acceleration. Includes edge snapping and position memory.

### 🪟 **Multiple Floating Videos**
Float multiple videos at once! Dock one video, then hover and pop open more videos. Each player operates independently with smart z-index elevation.

### ✨ **Real-Time Dynamic Ambient Glow**
HTML5 canvas samples video colors in real time to cast reactive ambient lighting (Ambilight). Choose between full-screen aura or player halo, with an intensity slider (20%–100%).

### 📱 **Vertical Shorts Cinema Mode**
Tailored 9:16 smartphone-like frame with auto-looping, camera notch bezel, and mobile dimensions for YouTube Shorts.

### 📸 **High-Res Screenshot Tool**
Capture uncompressed video frames (`S`) with shutter-flash feedback. Use `Shift+S` or `Shift+Click` to copy frames directly to your clipboard!

</td>
<td width="50%" valign="top">

### ⏩ **Speed Controller & Presets**
Speed pill with dropdown menu (`0.25x` to `3x`) and keyboard step controls (`[` / `]`). Optionally persist speed across videos.

### 🕶️ **Backdrop Customizer**
Switch between modern **Frosted Glass** (with 50%–100% opacity slider) and pure **OLED Blackout** mode — and reskin every surface of the extension with any of the four **Catppuccin** flavors (Latte, Frappé, Macchiato, Mocha).

### 🔊 **Glass Volume HUD**
Smooth volume adjustment (`↑` / `↓`) and instant mute/unmute (`M`) with a real-time glass HUD overlay.

### ⏭️ **Playlist & Up Next Navigation**
Skip to the next recommendation/playlist video (`N`) or previous video (`P`) without leaving the overlay.

### 🕘 **Watch History & Resume Sync**
Playback is reported to your signed-in YouTube account with the watch page's own tracking beacons, so videos land in history with progress. Cinema Mode also remembers your place locally.

### 🖱️ **Mouse Triggers & Key Recorder**
`Alt+Click` or middle-click any thumbnail, or bind any keyboard key using the interactive hotkey recorder.

### 🖼️ **Picture-in-Picture & Auto-Pause**
Built-in PiP mode, optional Direct PiP launching, and smart auto-pause/resume for existing tab videos.

### 👍 **Real Likes & Comments In The Overlay**
See the video's actual like count, like or dislike it, and read the real comment threads without leaving cinema mode (`Shift+C`). The embedded player is untouched — comments slide in over the right edge of the video.

</td>
</tr>
</table>

---

## 📦 Installation & Loading

<details open>
<summary><b>📌 Google Chrome / Chromium (Brave, Edge, Opera, Vivaldi)</b></summary>

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the extension directory (or `dist/chrome` after running the build script)
5. Done! 🎉 The extension is now active

</details>

<details>
<summary><b>🦊 Mozilla Firefox (109+)</b></summary>

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select either:
   - `manifest.firefox.json` in the root folder, or
   - `manifest.json` inside the `dist/firefox` folder (after running `npm run build`)
4. Done! 🎉 Fully functional in Firefox with full API support

</details>

---

## 🛠️ Build & Packaging

The project includes an automated cross-platform build script to package clean releases for both stores:

```bash
# Run build using npm
npm run build

# Or directly with Node.js
node build.js
```

This generates:
- `dist/chrome/` & `dist/youtube-cinema-mode-chrome.zip`: Ready for the **Chrome Web Store** (Manifest V3 service worker).
- `dist/firefox/` & `dist/youtube-cinema-mode-firefox.zip`: Ready for **Firefox Add-ons (AMO)** (Manifest V3 background scripts with Gecko ID).

---

## 🧪 Testing

The extension ships with a zero-dependency test suite that runs the real content
modules against a small DOM/browser mock — no bundler, no headless browser, no
`npm install` (there are no runtime dependencies at all).

```bash
npm test       # run the suite
npm run lint   # manifest / namespace / CSS cross-checks
npm run verify # suite + mutation check (see below)
node test/run.js quality   # filter by name
```

`test/mutation-check.py` reverts each bug fix in turn and asserts the suite goes
red, which is what proves the tests are guarding the fixes rather than passing
vacuously.

`test/lint.js` checks the invariants that caused real bugs here:

- every file a manifest lists exists, and no source file is left unlisted
- both manifests agree with `package.json` on the version
- the Chrome manifest requests no permission MV3 forbids
- no `YTC.*` member is referenced that is never defined
- every class applied from JS has a rule in `content/styles/`
- every `var(--x)` read is either defined in CSS or set from JS
- no exported namespace member is dead

---

## 🎯 Usage

<div align="center">

```mermaid
graph LR
    A[Go to YouTube] --> B[Hover or Alt+Click]
    B --> C[Press Hotkey 'Space']
    C --> D[Cinema Mode 🎬]
    D --> E[Dock Mini-Player 'D' 📌]
    D --> F[Screenshot 'S' 📸]
    D --> G[Press ESC to Close ❌]
```

</div>

1. 🌐 Navigate to **YouTube** (youtube.com)
2. 🖱️ **Hover** over any video thumbnail (or `Alt + Click` directly)
3. 👀 You'll see a small red **"Press Space" indicator**
4. ⌨️ Press your hotkey (default <kbd>Space</kbd>) to open Cinema Mode
5. 🎮 **Control your playback**:
   - Press `D` to dock into a floating mini-player and drag it anywhere
   - Press `S` for screenshot, or `Shift+S` to copy frame to clipboard
   - Press `[` or `]` to adjust playback speed
   - Press `N` or `P` to navigate videos
6. ❌ Press **`ESC`** or click outside the container to close

---

## ⚙️ Settings

Click the extension icon 🧩 in your toolbar to customize features:

| Setting | Description | Default |
|:---|:---|:---:|
| **🐱 Theme** | Catppuccin flavor for the overlay, menus and popup (Mocha, Macchiato, Frappé, Latte) | `Mocha` |
| **🔑 Cinema Hotkey** | Interactive recorder to assign any key | `Space` |
| **🎨 Backdrop Style** | Choose between Frosted Glass and OLED Blackout | `Frosted Glass` |
| **🌓 Backdrop Opacity** | Adjust background darkness (50% to 100%) | `90%` |
| **✨ Ambient Lighting** | Reactive Ambilight glow matching video colors | `ON` |
| **🌌 Full Screen Glow** | Toggle full-viewport aura vs player container halo | `ON` |
| **💡 Glow Intensity** | Adjust glow intensity and blur spread (20% to 100%) | `75%` |
| **🔮 Glow Quality** | Preset for the glow blur radius (Low / Medium / High) | `High` |
| **⏸️ Auto-Pause Background** | Automatically pause and resume existing tab videos | `ON` |
| **🕶️ Auto-Hide Controls** | Fade out controls and cursor after a short idle delay | `ON` |
| **⏱️ Remember Speed** | Persist chosen playback speed across all videos | `ON` |
| **🎞️ Remember Quality** | Persist the chosen video quality for future videos | `ON` |
| **📌 Direct Mini-Player** | Open straight into mini-player via `Ctrl + Hotkey` | `OFF` |
| **🖼️ Direct PiP** | Open directly in native Picture-in-Picture window | `OFF` |
| **🖱️ Alt + Click Trigger** | Instantly open thumbnail in cinema mode via Alt+Click | `ON` |
| **🖱️ Middle-Click Trigger** | Open thumbnail via middle mouse click | `OFF` |
| **🎭 Auto Theater Mode** | Toggle theater mode in the watch-page fallback player (normal embeds already fill the overlay) | `ON` |
| **👁️ Show Indicator** | Show badge indicator on hovered thumbnails | `ON` |

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|:---|:---|
| <kbd>H</kbd> *(customizable)* | 🎬 Open cinema mode for hovered video |
| <kbd>Ctrl</kbd> + <kbd>H</kbd> | 📌 Open directly into floating Mini-Player |
| <kbd>Alt</kbd> + <kbd>H</kbd> | 🌐 Global command shortcut to toggle cinema mode |
| <kbd>Alt</kbd> + Click | ⚡ Instant trigger on video thumbnail |
| <kbd>D</kbd> | 📌 Toggle Mini-Player / Corner Dock mode (draggable & resizable) |
| <kbd>S</kbd> | 📸 Capture native-res screenshot (Download PNG) |
| <kbd>Shift</kbd> + <kbd>S</kbd> | 📋 Copy native-res screenshot directly to clipboard |
| <kbd>Q</kbd> | 🎚️ Toggle the video quality menu |
| <kbd>Shift</kbd> + <kbd>C</kbd> | 💬 Open / close the comments drawer |
| <kbd>[</kbd> / <kbd>]</kbd> *(or <kbd><</kbd> / <kbd>></kbd>)* | ⏱️ Decrease / Increase playback speed |
| <kbd>↑</kbd> / <kbd>↓</kbd> | 🔊 Volume up / down (±5% with glass HUD) |
| <kbd>M</kbd> | 🔇 Toggle mute / unmute |
| <kbd>P</kbd> / <kbd>N</kbd> | ⏮️ / ⏭️ Previous / Next video |
| <kbd>Space</kbd> / <kbd>K</kbd> | ⏯️ Play / Pause toggle |
| <kbd>←</kbd> / <kbd>→</kbd> | ⏪ / ⏩ Seek backward / forward (5s / 10s) |
| <kbd>F</kbd> | ⛶ Toggle fullscreen |
| <kbd>T</kbd> | 🎭 Toggle theater mode |
| <kbd>ESC</kbd> | ❌ Close active overlay |

---

## 🛠️ Tech Stack

<div align="center">

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)
![Firefox Add-on](https://img.shields.io/badge/Firefox-Add--on-FF7139?style=for-the-badge&logo=firefox-browser&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)

</div>

**Built with:** Vanilla JavaScript (ES2022), Cross-Browser Manifest V3, HTML5 Canvas API, and Modern CSS.

---

## 🔧 Technical Architecture

- **Zero-Build Module System**: The content script is split into small, single-purpose files that the manifest loads **in order** via `content_scripts[].js`. Everything shares one isolated-world namespace (`YTC`), so there is no bundler, no transpiler and no extra dependencies — you can edit a file, hit reload in `chrome://extensions`, and see the change.
- **Tokenized Catppuccin Theming**: every colour the extension paints resolves through semantic `--ytc-*` custom properties defined once in `content/styles/00-themes.css`. The flavor is just a `data-ytc-theme` attribute on the document root, so a new theme is one palette block — no component stylesheet changes.
- **Cross-Browser Universal API Bridge**: Unified wrapper dynamically routing between `chrome.*` and `browser.*` APIs.
- **Sandboxed Full YouTube Player**: Embeds the authentic YouTube player inside an isolated, script-enabled iframe for full native functionality while preventing unwanted navigation.
- **Native Watch-History Reporting**: The embed surface is tracked by YouTube as an embedded player, so it does not update watch history on its own. The extension mints a normal WEB player response and sends the same `videostats` playback/watchtime beacons as the watch page (`el=detailpage`, one stable `cpn`, `st`/`et` windows), which records history and resume progress without giving up the lightweight embed or altering its headers. Authenticated requests carry the same `X-Goog-AuthUser` and `SAPISIDHASH` headers as YouTube itself, which requires the `cookies` permission; the cookie is only used locally to sign those requests and is never stored or sent anywhere else.
- **Local Resume Memory**: Playback positions are also kept in `storage.local` per video, so reopening a video in Cinema Mode resumes where you left off even before the account history round-trips.
- **Real Engagement, Minimal Embed**: The embed stays a plain player, so likes and comments are read from YouTube's own InnerTube API by the signed-in parent page. Like/dislike state and counts come from the same segmented button payload the watch page renders, ratings are submitted with the page's `SAPISIDHASH` auth, and comments are resolved from the `commentEntityPayload` entities YouTube now ships out-of-band.
- **Hardware-Accelerated Ambient Engine**: Low-overhead HTML5 canvas that samples the playing video into a 32×18 buffer and renders responsive CSS glow filters from it.
- **Firefox Xray Vision Security Unwrapping**: Content scripts access `movie_player.wrappedJSObject` to cleanly interface with YouTube playback methods across Firefox boundaries.
- **Dual Manifest Configuration**:
  - `manifest.json`: Universal MV3 with background service worker for Chromium browsers.
  - `manifest.firefox.json`: Firefox MV3 with background scripts and Gecko compatibility.
- **Settings Sync**: Seamless settings synchronization across browser sessions via `storage.sync`.

### 📁 Project Layout

```
.
├── manifest.json / manifest.firefox.json   Extension manifests (list the module load order)
├── background/
│   └── background.js                       Header rules, settings seeding, hotkey command
├── content/
│   ├── content.js                          Bootstrap: page-level triggers + hover badge
│   ├── modules/
│   │   ├── core.js                         Namespace, settings, shared state, storage
│   │   ├── theme.js                        Catppuccin flavor selection (data-ytc-theme)
│   │   ├── icons.js                        Every inline SVG used by the overlay
│   │   ├── video.js                        URL / title / aspect-ratio helpers (pure)
│   │   ├── innertube.js                    YouTube web API config, auth and fetch plumbing
│   │   ├── engagement.js                   Like counts, ratings and comment parsing
│   │   ├── layout.js                       Container sizing, resizing, scroll lock
│   │   ├── player.js                       Everything that reaches into the embed iframe
│   │   ├── overlay.js                      Overlay DOM construction, direct PiP
│   │   ├── launcher.js                     "What to open" decisions for every trigger
│   │   ├── controller.js                   Per-overlay context + wiring of all controls
│   │   └── controls/                       One feature per file
│   │       ├── toast.js  autohide.js  speed.js  quality.js
│   │       ├── transport.js  history.js  ambient.js  screenshot.js
│   │       └── dock.js  navigation.js  engagement.js  keyboard.js
│   └── styles/                             Stylesheet split into 9 ordered partials
│       ├── 00-themes.css                   Catppuccin palette + semantic tokens
│       ├── 01-overlay.css   02-ambient.css   03-docked.css   04-shorts.css
│       └── 05-feedback.css  06-menus.css     07-page.css     08-engagement.css
├── popup/                                  Settings UI
├── icons/                                  Extension icons (+ icon-source.png)
├── docs/                                   Historical audit notes
├── test/                                   Zero-dependency test suite
│   ├── dom.js                              Minimal DOM/browser mock
│   ├── harness.js                          Loads the real modules into that mock
│   ├── run.js                              Test runner
│   ├── lint.js                             Project cross-checks
│   └── *.test.js                           The tests
└── build.js
```

### 🧩 How the overlay works

1. A **trigger** (hotkey, `Alt+Click`, middle-click, hover badge, `Alt+H` command) calls `YTC.launcher`.
2. The launcher resolves the video id, title, timestamp and aspect ratio, then calls `YTC.overlay.createOverlay(...)`.
3. `createOverlay` builds the DOM and hands everything to `YTC.controller.setupOverlayEvents`.
4. The controller creates one **control** per feature (speed, quality, dock, keyboard, …), all sharing a single context object, and publishes the `overlay._*` hooks that the player bootstrap, settings and fallbacks call back into.

Each control is self-contained: it owns its state, its DOM listeners and its own teardown, so a change to (say) the quality selector never touches the docking code.

---

## 🌐 Browser Support

<div align="center">

| Browser | Support | Version |
|:---|:---:|:---|
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/chrome/chrome_48x48.png" width="24"> **Google Chrome** | ✅ Full Support | Manifest V3 (Latest) |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/firefox/firefox_48x48.png" width="24"> **Mozilla Firefox** | ✅ Full Support | Firefox 109+ |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/edge/edge_48x48.png" width="24"> **Microsoft Edge** | ✅ Full Support | Chromium-based |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/brave/brave_48x48.png" width="24"> **Brave** | ✅ Full Support | Chromium-based |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/opera/opera_48x48.png" width="24"> **Opera** | ✅ Full Support | Chromium-based |

</div>

---

## 🤝 Contributing

Contributions, issues, and feature requests are **welcome**! 🎉

<details>
<summary><b>📝 Contribution Guidelines</b></summary>

1. **Fork** the Project
2. **Create** your Feature Branch
   ```bash
   git checkout -b feature/AmazingFeature
   ```
3. **Commit** your Changes
   ```bash
   git commit -m 'Add some AmazingFeature'
   ```
4. **Push** to the Branch
   ```bash
   git push origin feature/AmazingFeature
   ```
5. **Open** a Pull Request

</details>

Feel free to check the [issues page](https://github.com/simoabid/YT-Cinema-Mode/issues) for open issues or to create a new one.

---

## 📝 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

```
MIT License - feel free to use this project for personal or commercial purposes
```

---

## 👨‍💻 Author

<div align="center">

### **Made with ❤️ and ☕ by [ABID.Dev](https://github.com/simoabid/) 🇲🇦**

[![GitHub](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)](https://github.com/simoabid)

</div>

---

## ⭐ Show Your Support

Give a ⭐️ if this project helped you!

<div align="center">

### 🎬 **Happy Watching!** 🍿

[![Made with Love](https://forthebadge.com/images/badges/built-with-love.svg)](https://github.com/simoabid/YT-Cinema-Mode)
[![Powered by Coffee](https://forthebadge.com/images/badges/powered-by-coffee.svg)](https://github.com/simoabid/YT-Cinema-Mode)

---

**If you found this extension useful, consider giving it a ⭐ on GitHub!**

</div>
