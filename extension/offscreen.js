// Offscreen document: provides AudioContext DOM api which is not available in service workers.

// Note: offscreen document doesn't have access to `chrome.tabCapture.capture`. Instead
// the background/service worker should obtain a `media stream id` via
// `chrome.tabCapture.getMediaStreamId({ targetTabId })` and forward that id here.

const contextByStreamId = {};
const gainByStreamId = {};
const mediaStreamByStreamId = {};

function closeContext(streamId) {
  try {
    if (contextByStreamId[streamId]) {
      try { contextByStreamId[streamId].close(); } catch (_) {}
      delete contextByStreamId[streamId];
    }
    if (gainByStreamId[streamId]) {
      delete gainByStreamId[streamId];
    }
    if (mediaStreamByStreamId[streamId]) {
      try { const t = mediaStreamByStreamId[streamId].getAudioTracks()[0]; t && t.stop(); } catch (_) {}
      delete mediaStreamByStreamId[streamId];
    }
  } catch (e) {
    console.log('closeContext error', e);
  }
}

function setVolByStreamId(streamId, vol) {
  return new Promise(async (resolve) => {
    if (!streamId) return resolve({ ok: false });

    // `vol` expected as 0-100 in existing code; convert to linear gain
    let gainValue;
    if (vol !== undefined) {
      gainValue = Math.pow((vol / 100), 2);
    }

    try {
      // If we already have a gain node for this stream, update and return
      const existingGain = gainByStreamId[streamId];
      if (existingGain) {
        if (gainValue !== undefined) existingGain.gain.value = gainValue;
        return resolve({ ok: true });
      }

      // Create a new AudioContext and GainNode, then obtain the media using getUserMedia
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioContext = new AudioCtx();
      contextByStreamId[streamId] = audioContext;

      const gainNode = audioContext.createGain();
      if (gainValue !== undefined) gainNode.gain.value = gainValue;
      gainByStreamId[streamId] = gainNode;


      try {
        const media = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: streamId,
            },
          },
        });


        mediaStreamByStreamId[streamId] = media;
        const source = audioContext.createMediaStreamSource(media);
        source.connect(gainNode).connect(audioContext.destination);

        return resolve({ ok: true });
      } catch (e) {
        console.log('getUserMedia failed in offscreen:', e);
        closeContext(streamId);
        return resolve({ ok: false });
      }
    } catch (e) {
      console.log('setVolByStreamId error', e);
      closeContext(streamId);
      return resolve({ ok: false });
    }
  });
}

// Handle incoming messages from background/service worker
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'setvol') return undefined;

  // Expect the background to supply a `streamId` (as background cannot rely on tabCapture here)
  const streamId = msg.streamId;
  const volume = msg.volume;

  setVolByStreamId(streamId, volume).then((res) => {
    if (typeof sendResponse === 'function') sendResponse(res);
  });

  return true; // async
});


window.addEventListener('unload', () => {
  Object.keys(contextByStreamId).forEach(k => closeContext(k));
});
