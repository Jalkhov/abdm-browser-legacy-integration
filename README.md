# AB Download Manager Browser Legacy Integration

![Status](https://img.shields.io/badge/status-stable-brightgreen)

This extension is a port of the official [ab-download-manager-browser-integration](https://github.com/amir1376/ab-download-manager-browser-integration) specifically designed for **XUL-based browsers** (legacy engine). So far, it has been tested and verified on **Pale Moon**.

> **Note:** If you are looking for the main application repository, please use [this link](https://github.com/amir1376/ab-download-manager).

## Prerequisites

In order to use this extension, you must have the main **AB Download Manager** application installed and running on your system.
* [Download AB Download Manager](https://abdownloadmanager.com/#download)

## Features & Roadmap

The integration aims to provide a seamless downloading experience between your legacy browser and the desktop app.

- [x] **Automatic Link Capture:** Automatically intercepts native downloads and forwards them to AB Download Manager.
- [x] **Header Passthrough:** Securely forwards browser session data (User-Agent, Referer, Cookies) to bypass common hotlink protections and server restrictions.
- [x] **Context Menu Integration:** Add a `Download With AB DM` option when right-clicking links or media.
- [ ] **Batch Downloading:** Show a `Download Selected` popup when the user highlights a section of a webpage containing multiple links.

*Tip: You can manage which file extensions are automatically captured by accessing the add-on options via `Tools > Add-ons > AB Download Manager > Options`.*

## How To Build

To build this extension locally from source, you will need **Python 3**.

Run the following command in your terminal at the root of the repository:

```bash
./build.sh
```

*(On Windows, this executes `build.bat`; on Unix, run `./build.sh`)*

The script will package the extension in store mode (no compression) and output an `.xpi` file in the root directory, ready to be dragged and dropped into your browser.

## Ecosystem Repositories

There are multiple repositories related to the **AB Download Manager** ecosystem:

| Repository | Description |
| --- | --- |
| [Main Application](https://github.com/amir1376/ab-download-manager) | The core desktop **Application** that runs on your device. |
| [Browser Legacy Integration](https://github.com/Jalkhov/abdm-browser-legacy-integration) (You are here) | The **Browser Extension** for XUL-based web browsers. |
| [Website](https://github.com/amir1376/ab-download-manager-website) | The source code for the official [website](https://abdownloadmanager.com). |

## Acknowledgments

Much of this port was made possible thanks to AI assistance (GitHub Copilot).

If you find this integration useful, please consider giving this repository a star ⭐. Also, be sure to leave a star for the main project to support the original developer!

Thank you ❤️ [AmirHossein Abdolmotallebi](https://github.com/amir1376) for creating such an amazing program.
