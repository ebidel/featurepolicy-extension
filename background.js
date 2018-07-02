'use strict';

/**
 * Returns the list of all features policies supported in the browser.
 * Note: Running this in the context of the background page mimics getting the
 * list on about:blank, which will return all the policies supported by the
 * browser (and not just the ones supported by the inspected page).
 */
function getAllFeaturePolicies() {
  return document.policy.allowedFeatures();
}
