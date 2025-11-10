# AB Download Manager Browser Legacy Integration Repository

![Status](https://img.shields.io/badge/status-beta-red)

This extension is a port of [ab-download-manager-browser-integration](https://github.com/amir1376/ab-download-manager-browser-integration) for XUL-based browsers; so far, it has only been tested on Palemoon 33.9.1 x64 Windows.

> If you are looking for the main app repository, use [this link](https://github.com/amir1376/ab-download-manager).
## Usage

In order to use this extension you need to [install](https://abdownloadmanager.com/#download) AB Download Manager.

### This extension does the following

- [ ] Adds a `Download With AB DM` in browser's context menu
- [x] Automatically captures download links when the user wants to download the file from their browser
- [ ] Show a `Download Selected` popup when the user selects some section of the page that contains links

## How To Build (needs Python)
In order to build this extension locally:

```bash
build
```

The output .xpi file containing the extension will be placed at the root of the repository.

## Repositories And Source Code

There are multiple repositories related to the **AB Download Manager** project:

| Repository                                                                                                 | Description                                                                   |
|------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| [Main Application](https://github.com/amir1376/ab-download-manager)                                        | Contains the  **Application** that runs on your  **device**                   |
| [Browser Legacy Integration](https://github.com/Jalkhov/abdm-browser-legacy-integration)  (You are here) | Contains the **Browser Extension** to be installed on your  **browser**       |
| [Website](https://github.com/amir1376/ab-download-manager-website)                                         | Contains the **AB Download Manager** [website](https://abdownloadmanager.com) |

Much of this port was made possible thanks to GitHub Copilot.

If you like this work, please consider giving it a star ⭐. Also, leave one for the main project. Thank you ❤️ [AmirHossein Abdolmotallebi](https://github.com/amir1376) for this amazing program.
