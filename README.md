# Meej Web Extension

Control volume of separate tabs in your browser with Mixy. 

It is experimental, but seems to work fine and without known bugs.

The extension uses a browser permission that allows capturing audio from tabs (tabCapture). There is no viable alternative to this approach, which is why Firefox is not supported, as it does not implement it.

It can capture only these tabs for which it was activated by clicking its icon when the tab was focused.

## Install 
Simply drop the extension.zip from [Releases](https://github.com/MixyLabs/meej/releases/latest) into browser's extensions page.

`Load unpacked` with extension directory works fine too.

## Usage
1. Make sure a Meej instance is running with tab volume control enabled in the config.
2. Open the tab you want to control and click the extension icon to activate it for that tab.
3. If there is an appropriate binding in Meej's config, volume control should work immediately for this tab.

## Roadmap
- Add optional build/minification step and a proper packaging pipeline.
- Consider publishing to the Chrome Web Store / Edge Add-ons store if there is user demand.

