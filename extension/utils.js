// Utilities shared by background scripts
function make(base) {
    return {
        16: `${base}/16.png`,
        32: `${base}/32.png`,
        64: `${base}/64.png`,
        128: `${base}/128.png`
    };
}

const ICONS = {
    red: make("assets/icons/red"),
    blue: make("assets/icons/blue")
};

let flashInProgress = false;
function flashRed() {
    if (flashInProgress) return;
    flashInProgress = true;

    try {
        chrome.action.setIcon({ path: ICONS.red });
    } catch (e) {
        console.log('flashRed setIcon failed:', e);
    }
    setTimeout(() => {
        try {
            chrome.action.setIcon({ path: ICONS.blue });
        } catch (e) {
            console.log('flashRed restore icon failed:', e);
        }

        setTimeout(() => {
            flashInProgress = false;
        }, 300);
    }, 300);
}

// Export as ES module for service worker/module usage
export { ICONS, flashRed };
