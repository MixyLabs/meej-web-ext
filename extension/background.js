let platform = chrome ? chrome : browser;


import { ICONS, flashRed } from './utils.js';

// We handle audio capture/AudioContext inside an offscreen document (offscreen.html)
// because service workers don't provide a DOM or AudioContext.

let portReady = false;

// Native host connector (keeps existing resilient reconnect logic)
let port = null;
let reconnectTimeout = null;
let backoff = 1000; // start 1s
const maxBackoff = 20000; // max 20s

function scheduleReconnect() {
    chrome.action.setIcon({ path: ICONS["red"] });
    if (reconnectTimeout) return;
    const delay = backoff;
    console.log('Scheduling native host reconnect in', delay, 'ms');
    reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        backoff = Math.min(backoff * 2, maxBackoff);
        connectToNativeHost();
    }, delay);
}

function connectToNativeHost() {
    if (port) return;
    try {
        port = platform.runtime.connectNative('com.volume.control');
        //console.log("connect done");
    } catch (e) {
        console.log("connectNative failed:", e);
        scheduleReconnect();
        return;
    }

    chrome.action.setIcon({ path: ICONS["blue"] });
    backoff = 1000;

    port.onMessage.addListener((req) => {
        if (platform.runtime.lastError) {
            console.log(platform.runtime.lastError.message);
        }
        handleMessage(req);
    });

    port.onDisconnect.addListener(() => {
        if (platform.runtime.lastError) {
            console.log(platform.runtime.lastError.message);
        }
        console.log('Native host disconnected');
        portReady = false;
        port = null;
        scheduleReconnect();
    });

    try {
        port.postMessage({ message: 'ping' });
        //console.log("ping send done");
    } catch (e) {
        console.log("ping failed:", e);
        try { port.disconnect && port.disconnect(); } catch (_) { }
        port = null;
        scheduleReconnect();
    }
}

// start the connection attempts at extension startup
connectToNativeHost();

// Helper: send tab list only when native host is ready

function sendTabList() {
    /* DISABLED
    if (!port || !portReady) return;
    platform.tabs.query({}, function (tabs) {
        const tabList = tabs.map(tab => ({ id: tab.id, title: tab.title }));
        try {
            port.postMessage(tabList);
        } catch (e) {
            // ignore if port is closed/disconnected
        }
    });
    */
}


// Send updated tab list when a tab's URL or title changes.
/* DISABLED
platform.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.title) {
        sendTabList();
    }
});
*/

// Send updated tab list when a tab is closed/removed.
/* DISABLED
platform.tabs.onRemoved.addListener((tabId, removeInfo) => {
    try {
        console.log('Tab removed:', tabId, removeInfo);
        // Clean up any cached tab stream id from session storage to avoid stale entries
        try {
            const key = `streamId_${tabId}`;
            platform.storage && platform.storage.session && platform.storage.session.remove && platform.storage.session.remove([key], () => {
                if (platform.runtime && platform.runtime.lastError) {
                    console.log('storage.session.remove failed:', platform.runtime.lastError.message);
                }
            });
        } catch (e) {
            console.log('storage.session.remove exception:', e);
        }
        sendTabList();
    } catch (e) {
        console.log('onRemoved handler error:', e);
    }
});
*/


// Ensure an offscreen document exists so we can run AudioContext/tabCapture.
async function ensureOffscreen() {
    const url = 'offscreen.html';
    try {
        const exists = await chrome.offscreen.hasDocument();
        if (!exists) {
            await chrome.offscreen.createDocument({ url, reasons: ['AUDIO_PLAYBACK', 'USER_MEDIA'], justification: 'Audio processing for volume control' });
            console.log('Created offscreen document');
        }
    } catch (e) {
        console.log('Offscreen create/hasDocument failed:', e);
    }
}

async function forwardToOffscreen(message) {
    try {
        await ensureOffscreen();
    } catch (e) {
        console.log('Failed ensuring offscreen:', e);
    }

    return new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (response) => {
            // response may be undefined if the listener doesn't send anything
            resolve(response);
        });
    });
}

let applyVolumeUpdateLocked = false;

function applyVolumeUpdate(tabId, volume) {
    if (applyVolumeUpdateLocked) return Promise.resolve(true);  // block re-entry
    applyVolumeUpdateLocked = true;

    return new Promise((resolve) => {
        // Obtain a media stream id for the target tab and forward to offscreen
        getStreamIdForTab(tabId).then((streamId) => {
            if (!streamId) {
                console.log("Failed to obtain streamId for tab", tabId);
                applyVolumeUpdateLocked = false;
                return resolve(false);
            }

            forwardToOffscreen({ type: 'setvol', streamId, tab: tabId, volume: volume }).then((res) => {
                if (!res || !res.ok) {
                    console.log("Failed to set volume (capture failed)");
                    applyVolumeUpdateLocked = false;
                    return resolve(false);
                }

                platform.tabs.get(tabId, (tab) => {
                    try {
                        let domain = tab.url.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n]+)/im)[1];
                        let items = {};
                        items[domain] = volume;
                        platform.storage.local.set(items);
                    } catch (e) {
                        // ignore any parsing/storage errors
                    }
                });

                try {
                    chrome.action.setBadgeText({ tabId: tabId, text: volume === 100 ? "" : String(volume) });
                } catch (e) {
                    console.log('setBadgeText failed:', e);
                }

                applyVolumeUpdateLocked = false;
                return resolve(true);
            }).catch((e) => {
                console.log('forwardToOffscreen error:', e);
                applyVolumeUpdateLocked = false;
                return resolve(false);
            });
        }).catch((e) => {
            console.log('Error getting stream id:', e);
            applyVolumeUpdateLocked = false;
            return resolve(false);
        });
    });

}

function handleMessage(req) {
    //console.log(JSON.stringify(req));
    if (req.type === 'allready') {
        portReady = true;
        console.log('Native host ready — NOT sending tab list');
        sendTabList();
        return;
    }

    if (req.type == 'setvol') {
        try {
            // native host requested a volume change for tabs by title filters
            // Expecting: { type: 'setvol', tabTargets: [<string>], volume: <number> }

            platform.tabs.query({}, function (tabs) {
                const filters = Array.isArray(req.tabTargets) ? req.tabTargets.map(s => String(s || '').toLowerCase()).filter(Boolean) : [];

                if (filters.length === 0) {
                    return;
                }

                const matchingTabs = tabs.filter(tab => {
                    const title = String(tab.title || '').toLowerCase();
                    return filters.some(f => title.includes(f));
                });

                if (matchingTabs.length === 0) {
                    return;
                }

                matchingTabs.forEach(tab => {
                    applyVolumeUpdate(tab.id, req.volume).then((ok) => {
                        if (!ok) {
                            flashRed();
                            console.log('Native setvol failed for tab id', tab.id);
                        }
                    }).catch((e) => {
                        flashRed();
                        console.log('applyVolumeUpdate exception for tab', tab.id, e);
                    });
                });
            });
        } catch (e) {
            flashRed();
            console.log("Error setting volume: " + e);
            return;
        }
    }
}

// Helper: get a tab capture media stream id for a tab (returns Promise<string|undefined>)
function getStreamIdForTab(tabId) {
    return new Promise((resolve) => {
        const key = `streamId_${tabId}`;
        try {
            chrome.storage.session.get([key], (items) => {
                if (chrome.runtime.lastError) {
                    console.log('storage.session.get failed:', chrome.runtime.lastError.message);
                }

                const cached = items && items[key];
                if (cached) {
                    return resolve(cached);
                }

                // Not cached: obtain a new stream id and store it in session storage
                chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
                    if (chrome.runtime.lastError) {
                        console.log('getMediaStreamId failed:', chrome.runtime.lastError.message);
                        return resolve(undefined);
                    }

                    try {
                        chrome.storage.session.set({ [key]: streamId }, () => {
                            if (chrome.runtime.lastError) {
                                console.log('storage.session.set failed:', chrome.runtime.lastError.message);
                            }
                        });
                    } catch (e) {
                        console.log('storage.session.set exception:', e);
                    } finally {
                        resolve(streamId);
                    }
                });
            });

        } catch (e) {
            console.log('getStreamIdForTab error:', e);
            resolve(undefined);
        }
    });
}

// Listen for messages from popup/content scripts and forward to offscreen for audio handling.
platform.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.id == -1 && sender && sender.tab) {
        request.id = sender.tab.id;
    }
    // If this message carries a `volume` payload, treat as a set-volume request.
    if (typeof request.volume !== 'undefined') {
        try {
            // Apply the volume update and reply to the sender with success/failure.
            applyVolumeUpdate(request.id, request.volume).then((ok) => {
                try { sendResponse(!!ok); } catch (_) { }
            }).catch((e) => {
                console.log('applyVolumeUpdate error:', e);
                try { sendResponse(false); } catch (_) { }
            });
        } catch (e) {
            try { sendResponse(false); } catch (_) { }
        }
        return true; // indicate we'll respond asynchronously
    }

    return false;
});

/*  Direct WS communication PoC
async function queryLocal(timeoutMs = 5000) {
    try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);

        const res = await fetch('http://localhost:8080/', { signal: controller.signal, cache: 'no-store' });
        clearTimeout(id);

        if (!res.ok) {
            console.log('localhost fetch failed:', res.status, res.statusText);
            return { ok: false, status: res.status, statusText: res.statusText };
        }

        const contentType = res.headers.get('content-type') || '';
        const body = contentType.includes('application/json') ? await res.json() : await res.text();

        console.log('localhost response:', body);

        // Broadcast response to all extension clients (popup/content scripts)
        self.clients.matchAll().then(clients => {
            for (const client of clients) {
                client.postMessage({ type: 'local-response', ok: true, body });
            }
        });

        return { ok: true, body };
    } catch (err) {
        console.log('localhost fetch error:', err);
        return { ok: false, error: String(err) };
    }
}

// Immediate query at startup
queryLocal();*/
