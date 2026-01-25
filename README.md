<div align="center">

<img src="icons/icon128.png" width="50" height="50"> 

# YouTube Cinema Mode

### 🎬 Watch YouTube Videos in Stunning Cinema-Style Overlay

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg?style=for-the-badge)](https://github.com/simoabid/YT-Cinema-Mode)
[![Made with Love](https://img.shields.io/badge/Made%20with-❤️-red.svg?style=for-the-badge)](https://github.com/simoabid/YT-Cinema-Mode)

<p align="center">
  <img src="https://readme-typing-svg.herokuapp.com?font=Fira+Code&weight=600&size=28&pause=1000&color=FF0000&center=true&vCenter=true&width=600&lines=Transform+Your+YouTube+Experience;Cinema+Mode+On+Any+Page;Hover+%26+Watch+Instantly!" alt="Typing SVG" />
</p>

**A beautiful Chrome extension that lets you watch any YouTube video in a stunning cinema-style overlay without leaving the current page.**

[🚀 Features](#-features) • [📦 Installation](#-installation) • [🎯 Usage](#-usage) • [⚙️ Settings](#️-settings) • [🤝 Contributing](#-contributing)

---

</div>

## 📋 Table of Contents

- [✨ Features](#-features)
- [📦 Installation](#-installation)
- [🎯 Usage](#-usage)
- [⚙️ Settings](#️-settings)
- [⌨️ Keyboard Shortcuts](#️-keyboard-shortcuts)
- [🛠️ Tech Stack](#️-tech-stack)
- [🔧 Technical Notes](#-technical-notes)
- [🌐 Browser Support](#-browser-support)
- [🤝 Contributing](#-contributing)
- [📝 License](#-license)
- [👨‍💻 Author](#-author)
- [⭐ Show Your Support](#-show-your-support)

## ✨ Features

<table>
<tr>
<td width="50%">

### 🎥 **Hover & Watch**
Simply hover over any video thumbnail and press `H` to open it in cinema mode

### 🎨 **Modern UI**
Sleek, dark-themed overlay with smooth animations

### 🎬 **Full YouTube Player**
Uses the actual YouTube watch page (not embed) for full functionality

### 🖼️ **Picture-in-Picture**
Built-in PiP button for multitasking

</td>
<td width="50%">

### 🔗 **Open in New Tab**
Quick access to open video in a new tab

### ⚙️ **Customizable**
Settings popup to customize hotkey and behavior

### 👁️ **Hover Indicator**
Visual feedback showing which video will open

### ⚡ **Lightning Fast**
Instant loading with optimized performance

</td>
</tr>
</table>

## 📦 Installation

<details open>
<summary><b>📌 Installation Steps</b></summary>

1. **Download or Clone** this repository
   ```bash
   git clone https://github.com/simoabid/YT-Cinema-Mode.git
   ```

2. **Open Chrome** and navigate to `chrome://extensions/`

3. **Enable Developer Mode** (toggle in top-right corner)

4. **Click "Load unpacked"**

5. **Select** the `YouTube-Cinema-Mode-Extension` folder

6. **Done!** 🎉 The extension is now installed

</details>

## 🎯 Usage

<div align="center">

```mermaid
graph LR
    A[Go to YouTube] --> B[Hover over Video]
    B --> C[See 'Press H' Indicator]
    C --> D[Press H Key]
    D --> E[Enjoy Cinema Mode! 🎬]
    E --> F[Press ESC to Close]
```

</div>

1. 🌐 Navigate to **YouTube** (youtube.com)
2. 🖱️ **Hover** your mouse over any video thumbnail
3. 👀 You'll see a small **red "Press H" indicator**
4. ⌨️ Press the **`H` key** to open the video in cinema mode
5. ❌ Press **`ESC`** or click outside to close

## ⚙️ Settings

Click the extension icon 🧩 in your toolbar to access settings:

| Setting | Description | Options |
|---------|-------------|---------|
| **🔑 Hotkey** | Change the activation key | H, C, P, or M |
| **🎭 Auto Theater Mode** | Automatically enable theater mode in the player | ON/OFF |
| **👁️ Show Hover Indicator** | Toggle the "Press H" indicator visibility | ON/OFF |

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| <kbd>H</kbd> | 🎬 Open cinema mode for hovered video |
| <kbd>ESC</kbd> | ❌ Close the overlay |
| <kbd>F</kbd> | ⛶ Toggle fullscreen |
| <kbd>T</kbd> | 🎭 Toggle theater mode inside player |

## 🛠️ Tech Stack

<div align="center">

![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)

</div>

**Built with:** Vanilla JavaScript, Chrome Extension Manifest V3, Modern CSS

## 🔧 Technical Notes

- ✅ Uses the full YouTube watch page inside an iframe (not the restricted embed API)
- 🎨 Injects CSS to hide YouTube UI elements and maximize the video player
- 🔒 Sandbox permissions allow scripts while preventing unwanted redirects
- ☁️ Settings are synced across Chrome browsers using `chrome.storage.sync`
- ⚡ Lightweight and optimized for performance
- 🎯 DOM mutation observers for dynamic content detection

## 🌐 Browser Support

<div align="center">

| Browser | Support | Version |
|---------|---------|---------|
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/chrome/chrome_48x48.png" width="24"> **Google Chrome** | ✅ Full Support | Latest (Manifest V3) |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/edge/edge_48x48.png" width="24"> **Microsoft Edge** | ✅ Full Support | Chromium-based |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/brave/brave_48x48.png" width="24"> **Brave** | ✅ Full Support | Chromium-based |
| <img src="https://raw.githubusercontent.com/alrra/browser-logos/master/src/opera/opera_48x48.png" width="24"> **Opera** | ✅ Full Support | Chromium-based |

</div>

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

## 📝 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

```
MIT License - feel free to use this project for personal or commercial purposes
```

## 👨‍💻 Author

<div align="center">

### **Made with ❤️ and ☕ by [ABID.Dev](https://github.com/simoabid/) 🇲🇦**

[![GitHub](https://img.shields.io/badge/GitHub-100000?style=for-the-badge&logo=github&logoColor=white)](https://github.com/simoabid)

</div>

## ⭐ Show Your Support

Give a ⭐️ if this project helped you!

<div align="center">

### 🎬 **Happy Watching!** 🍿

[![Made with Love](https://forthebadge.com/images/badges/built-with-love.svg)](https://github.com/simoabid/YT-Cinema-Mode)
[![Powered by Coffee](https://forthebadge.com/images/badges/powered-by-coffee.svg)](https://github.com/simoabid/YT-Cinema-Mode)

---

**If you found this extension useful, consider giving it a ⭐ on GitHub!**

</div>
