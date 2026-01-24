# <img src="icons/icon128.png" width="32" height="32"> YouTube Cinema Mode - Chrome Extension

A beautiful simple Chrome extension that lets you watch any YouTube video in a stunning cinema-style overlay without leaving the current page.

## Features

- **Hover & Watch**: Simply hover over any video thumbnail and press `H` to open it in cinema mode
- **Modern UI**: Sleek, dark-themed overlay with smooth animations
- **Full YouTube Player**: Uses the actual YouTube watch page (not embed) for full functionality
- **Keyboard Shortcuts**:
  - `H` - Open cinema mode for hovered video
  - `ESC` - Close the overlay
  - `F` - Toggle fullscreen
  - `T` - Toggle theater mode inside player
- **Picture-in-Picture**: Built-in PiP button
- **Open in New Tab**: Quick access to open video in a new tab
- **Customizable**: Settings popup to customize hotkey and behavior
- **Hover Indicator**: Visual feedback showing which video will open

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `YouTube-Cinema-Mode-Extension` folder
5. The extension is now installed!

## Usage

1. Go to YouTube (youtube.com)
2. Hover your mouse over any video thumbnail
3. You'll see a small red "Press H" indicator
4. Press the `H` key to open the video in cinema mode
5. Press `ESC` or click outside to close

## Settings

Click the extension icon in your toolbar to access settings:
- **Hotkey**: Change the activation key (H, C, P, or M)
- **Auto Theater Mode**: Automatically enable theater mode in the player
- **Show Hover Indicator**: Toggle the "Press H" indicator visibility

## Technical Notes

- Uses the full YouTube watch page inside an iframe (not the restricted embed API)
- Injects CSS to hide YouTube UI elements and maximize the video player
- Sandbox permissions allow scripts while preventing unwanted redirects
- Settings are synced across Chrome browsers using `chrome.storage.sync`

## Browser Support

- Google Chrome (Manifest V3)
- Microsoft Edge (Chromium-based)
- Other Chromium-based browsers

## Version

1.0.0

## Contributing

Contributions are welcome! Feel free to open an issue or submit a pull request if you have suggestions or improvements.

## License

This project is licensed under the [MIT License](LICENSE).

