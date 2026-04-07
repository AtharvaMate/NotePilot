// NotePilot Background Service Worker
// Handles captureVisibleTab requests from the content script

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'captureVisibleTab') {
        chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 92 })
            .then(dataUrl => sendResponse({ success: true, dataUrl }))
            .catch(err => sendResponse({ success: false, error: err.message }));
        return true; // async response
    }
});
