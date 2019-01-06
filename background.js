'use strict';

/**
 * Returns the list of all features policies supported in the browser.
 * Note: Running this in the context of the background page mimics getting the
 * list on about:blank, which will return all the policies supported by the
 * browser (and not just the ones supported by the inspected page).
 */

const FP_HEADER = 'Feature-Policy';

const connections = new Map();

function log(msg) {
  console.log(msg);
}

function getAllFeaturePolicies() {
  const featurePolicy = document.policy || document.featurePolicy;
  return featurePolicy.allowedFeatures();
}

async function getCurrentTab() {
  return new Promise(resolve => {
    chrome.tabs.query({active: true}, tab => resolve(tab[0]));
  });
}

function setPolicyManager(tabId, policyManager) {
  const connection = connections.get(tabId);
  if (connection) {
    connection.policyManager = policyManager;
  }
}

chrome.webRequest.onHeadersReceived.addListener(details => {
  // If it is not the top-frame, we just ignore it.
  if (details.frameId !== 0 || !connections.has(details.tabId)) {// || tab.id !== details.tabId) {
    return;
  }

  const policyManager = connections.get(details.tabId).policyManager;

  const responseHeaders = [];
  const featurePolicyHeaders = new Map();

  // Preserve headers sent by page and collect separate Feature-Policy headers
  // into an aggregated, single header.
  details.responseHeaders.forEach((header, i) => {
    const regex = RegExp(FP_HEADER, 'i');
    if (regex.test(header.name)) {
      // Support multiple allow lists per policy name.
      // e.g. Feature-Policy: unsized-images 'none'; geolocation *; usb *
      header.value.split(';').map(item => item.trim()).map(item => item.split(' ')).forEach(([policyName, val]) => {
        featurePolicyHeaders.set(policyName, [val]);
      });
    } else {
      responseHeaders.push(Object.assign({}, header));
    }
  });

  // Customizations come last to override any values which were previously set.
  for (const [policyName, val] of Object.entries(policyManager.customizedPolicies)) {
    featurePolicyHeaders.set(policyName, val.allowList);
  }

  for (const [policyName, allowList] of featurePolicyHeaders) {
    responseHeaders.push({name: FP_HEADER, value: `${policyName} ${allowList.join(' ')}`});
  }

  // Note: the DevTools network panel won't show these modified response headers
  // but the changes will work. The panel shows the original headers as returned
  // from the network. See https://crbug.com258064.
  // TODO: figure out how to communicate this to users. It'll be confusing
  // if they check the DevTools and it doesn't show correct values.
  return {responseHeaders};
}, {urls: ['<all_urls>'], types: ['main_frame']}, ['blocking', 'responseHeaders']);

chrome.runtime.onConnect.addListener(port => {

  const extensionListener = (message, sender, sendResponse) => {
    // The original connection event doesn't include the tab ID of the
    // DevTools page, so we need to send it explicitly.
    switch (message.name) {
      case 'init':
        connections.set(message.tabId, {port, policyManager: null});
        break;
      default:
        // noop
    }
  };

  port.onMessage.addListener(extensionListener); // Listen to messages sent from the DevTools page.

  port.onDisconnect.addListener(port => {
    port.onMessage.removeListener(extensionListener);

    for (const [tabId, val] of connections) {
      if (val.port === port) {
        connections.get(tabId).policyManager = null; // TODO: make sure to not leave retaining objects around...?
        connections.delete(tabId);
        break;
      }
    }
  });
});
