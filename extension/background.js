// Get platform specific interface object.
let platform = chrome ? chrome : browser;

let tabs = {};
function setVol(id, vol, cb) {
    // cb is optional: cb(success:boolean)
    if (typeof cb !== 'function') cb = null;

    function closeContext() {
        if (tabs[id].audioContext !== undefined) {
            tabs[id].audioContext.close();
        }
        if (tabs[id].mediaStream !== undefined) {
            tabs[id].mediaStream.getAudioTracks()[0].stop();
        }
        tabs[id] = {};
    }

    // Setup empty object if not called previously.
    if (tabs[id] === undefined) {
        tabs[id] = {};
    }

    // If volume is default disable everything.
    // if (vol == 100) {
    //     closeContext();

    //     return true;
    // }

    // If volume given map it from 0-100 to 0-1 and scale it exponentially.
    if (vol) {
        vol = Math.pow((vol / 100), 2);
    }

    // Initialize API.
    if (tabs[id].audioContext === undefined) {
        // Get audio context.
        tabs[id].audioContext = new (window.AudioContext || window.webkitAudioContext)();
        // Start tab audio capture.
        platform.tabCapture.capture({ audio: true, video: false }, function (stream) {
            if (chrome.runtime.lastError) {
                console.log("activeTab not triggered!!!");
                closeContext();
                if (cb) cb(false);
                return;
            }

            if (stream === null) {
                closeContext();
                if (cb) cb(false);
                return;
            }
            // Get media source.
            tabs[id].mediaStream = stream;
            let source = tabs[id].audioContext.createMediaStreamSource(tabs[id].mediaStream);
            // Create gain filter.
            tabs[id].gainFilter = tabs[id].audioContext.createGain();
            // Connect gain filter to the source.
            source.connect(tabs[id].gainFilter);
            // Connect the gain filter to the output destination.
            tabs[id].gainFilter.connect(tabs[id].audioContext.destination);
            // Apply volume.
            if (vol !== undefined) {
                tabs[id].gainFilter.gain.value = vol;
            }
            // notify caller success
            if (cb) cb(true);
        });
        // capture is async; return true to indicate request was started
        return true;
    }
    // If volume is given and stream already present.
    if (vol !== undefined && tabs[id].mediaStream !== undefined) {
        tabs[id].gainFilter.gain.value = vol;
    }

    // immediate success
    if (cb) cb(true);
    return true;
}

platform.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.id == -1) {
        request.id = sender.tab.id;
    }

    return setVol(request.id, request.volume);
});

const ICONS = {
  red:  make("assets/icons/red"),
  blue: make("assets/icons/blue")
};

function make(base) {
  return {
    16:  `${base}/16.png`,
    32:  `${base}/32.png`,
    64:  `${base}/64.png`,
    128: `${base}/128.png`
  };
}

let flashInProgress = false;
function flashRed() {
  if (flashInProgress) return; // already flashing, exit immediately

  flashInProgress = true;
  chrome.browserAction.setIcon({ path: ICONS.red });

  setTimeout(() => {
    chrome.browserAction.setIcon({ path: ICONS.blue });
    flashInProgress = false; // reset flag
  }, 300);
}

let portReady = false;

// Replace direct connectNative with a resilient connector:
let port = null;
let reconnectTimeout = null;
let backoff = 1000; // start 1s
const maxBackoff = 60000; // max 60s

function scheduleReconnect() {
	chrome.browserAction.setIcon({ path: ICONS["red"] });
    
    // don't schedule multiple concurrent timers
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
	// already connected
	if (port) return;

	try {
		port = platform.runtime.connectNative('com.volume.control');
		console.log("connect done");
	} catch (e) {
		// connectNative can throw if the host is not registered
		console.log("connectNative failed:", e);
		scheduleReconnect();
		return;
	}

    chrome.browserAction.setIcon({ path: ICONS["blue"] });

	// reset backoff on successful connect
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

	// attempt initial ping; wrap in try/catch in case postMessage fails immediately
	try {
		port.postMessage({ message: 'ping' });
		console.log("ping send done");
	} catch (e) {
		console.log("ping failed:", e);
		// If ping fails, disconnect/cleanup and schedule reconnect
		try { port.disconnect && port.disconnect(); } catch (_) {}
		port = null;
		scheduleReconnect();
	}
}

// start the connection attempts at extension startup
connectToNativeHost();

// Helper: send tab list only when native host is ready
function sendTabList() {
	if (!port || !portReady) return;
	platform.tabs.query({}, function (tabs) {
		const tabList = tabs.map(tab => ({ id: tab.id, title: tab.title }));
		try {
			port.postMessage(tabList);
		} catch (e) {
			// ignore if port is closed/disconnected
		}
	});
}

// Send updated tab list when a tab's URL or title changes.
platform.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.title) {
        sendTabList();
    }
});

function handleMessage(req) {
    console.log(JSON.stringify(req));
    // Wait for native host readiness before sending tab info
    if (req.message === 'allready') {
        portReady = true;
        console.log('Native host ready — sending tab list');
        sendTabList();
        return;
    }

    if (req.message == 'setvol') {
        try {
            // Use async callback so we catch capture failures that happen inside the callback.
            setVol(req.tab, req.volume, function(ok) {
                if (!ok) {
                    console.log("Failed to set volume (capture failed)");
                    flashRed();
                    return;
                }

                platform.tabs.get(req.tab, (tab) => {
                    let domain = tab.url.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:\/\n]+)/im)[1];
                    let items = {};
                    items[domain] = req.volume;
                    platform.storage.local.set(items);
                });

                chrome.browserAction.setBadgeText({ tabId: req.tab, text: String(req.volume) });
            });
        } catch (e) {
            flashRed();
            console.log("Error setting volume: " + e);
            return;
        }
    }
}