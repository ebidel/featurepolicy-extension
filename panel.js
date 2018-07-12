/**
 * Copyright 2018 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {html, render} from './node_modules/lit-html/lib/lit-extended.js';
import {repeat} from './node_modules/lit-html/lib/repeat.js';
// import './pptr-crx.js';

const persisteAcrossReload = document.querySelector('#persist-on-reload');
const activePoliciesEl = document.querySelector('#active-policies');
const errorEl = document.querySelector('#error-msg');
const restoreButton = document.querySelector('#restore-button');

let _allFeaturePolicies = []; /* Array<string> all feature policy names supported by the browser. */
let _originalPoliciesUsedOnPage = {};
let _customizedPolicies = {};
let _oldUrl = null; // previous url of inspected tab after a reload/navigation.

function getFeaturePolicyAllowListOnPage(features) {
  const map = {};
  for (const feature of features) {
    map[feature] = {
      allowed: document.policy.allowsFeature(feature),
      allowList: document.policy.getAllowlistForFeature(feature),
    };
  }
  return map;
}

function reloadPage() {
  chrome.devtools.inspectedWindow.reload();
  // chrome.tabs.query({active: true}, tab => chrome.tabs.reload(tab.tabId));
}

function sortObjectByKey(obj) {
  const sortedByName = {};
  Object.keys(obj).sort().forEach(key => {
    sortedByName[key] = obj[key];
  });
  return sortedByName;
}

function getBackgroundPage() {
  return new Promise(resolve => {
    chrome.runtime.getBackgroundPage(resolve);
  });
}

const UI = {
  togglePolicy(e) {
    policyManager.togglePolicyOnPage(e.target.value);
    UI.updateDOMLists();
    reloadPage();
  },

  displayError(msg) {
    errorEl.classList.add('show');
    render(html`${msg}`, errorEl);
  },

  clearError() {
    errorEl.classList.remove('show');
  },

  updateDOMLists() {
    const buildList = function(features) {
      return html`
        <table>
          <tr>
            <th colspan="2">Name</th><th>Allowed by page</th><th>Allowed origins</th>
          </tr>
          ${repeat(features, null, ([feature, val], i) => {
            return html`
              <tr data-feature$="${feature}">
                <td>
                  <input type="checkbox" id$="${feature}-check" checked="${val.allowed}"
                         on-input="${UI.togglePolicy}" value="${feature}">
                </td>
                <td><label for$="${feature}-check">${feature}</label></td>
                <td><span class="allowed-check" data-allowed$="${val.allowed}"></span></td>
                <td>
                  <span>${val.allowList.length ? val.allowList : ''}</span>
                </td>
              </tr>`;
            }
          )}
          <tr>
        </table>`;
    };

    const featureList = policyManager.buildCustomizedPolicyList();
    render(buildList(Object.entries(featureList)), activePoliciesEl);
  },

  debugResponseHeaders(responseHeaders) {
    const out = document.querySelector('output');
    out.innerHTML = responseHeaders.reduce((accum, curr) => {
      accum += `${JSON.stringify(curr)}\n`;
      return accum;
    }, '');
  }
};

class FeaturePolicyMananger {
  get allFeaturePoliciesSupportedByBrowser() {
    if (!_allFeaturePolicies.length) {
      console.warn(
        'List of feature policies supported by the browser was not set.');
    }
    return _allFeaturePolicies || [];
  }

  set allFeaturePoliciesSupportedByBrowser(features) {
    _allFeaturePolicies = features;
  }

  get originalPoliciesSetByPage() {
    return _originalPoliciesUsedOnPage || {};
  }

  set originalPoliciesSetByPage(policies) {
    _originalPoliciesUsedOnPage = policies;
  }

  get customizedPolicies() {
    return _customizedPolicies || {};
  }

  set customizedPolicies(policies) {
    _customizedPolicies = policies;
  }

  restoreOriginalPoliciesSetByPage() {
    this.customizedPolicies = {};
    this.originalPoliciesSetByPage = {};
    UI.updateDOMLists();
  }

  buildCustomizedPolicyList() {
    const list = JSON.parse(JSON.stringify(this.originalPoliciesSetByPage));
    Object.entries(list).forEach(([feature, val]) => {
      if (this.customizedPolicies[feature]) {
        list[feature] = this.customizedPolicies[feature];
      }
    });
    return list;
  }

  getFeaturePolicies() {
    // Inject the _getFeaturePolicyAllowListOnPage function into the page
    // and return its eval'd result.
    const expression = `(function() {
      ${getFeaturePolicyAllowListOnPage.toString()};
      const allPolicies = ${JSON.stringify(this.allFeaturePoliciesSupportedByBrowser)};
      return getFeaturePolicyAllowListOnPage(allPolicies);
    })()`;

    chrome.devtools.inspectedWindow.eval(expression, (result, isException) => {
      UI.clearError();

      if (isException) {
        UI.displayError("Error getting page's feature policy list");
        return;
      }

      result = sortObjectByKey(result);

      if (!Object.keys(this.originalPoliciesSetByPage).length) {
        this.originalPoliciesSetByPage = result;
      }

      UI.updateDOMLists();
    });
  }

  togglePolicyOnPage(policyName) {
    const customizedFeature = this.customizedPolicies[policyName];
    if (customizedFeature) {
      const newAllowed = !customizedFeature.allowed;
      customizedFeature.allowed = newAllowed;
      customizedFeature.allowList = [newAllowed ? "*" : "'none'"];
    } else {
      const newAllowed = !this.originalPoliciesSetByPage[policyName].allowed;
      this.customizedPolicies[policyName] = {
        allowed: newAllowed,
        allowList: [newAllowed ? "*" : "'none'"],
      };
    }
  }
}

const policyManager = new FeaturePolicyMananger();

// Refresh policy lists if page is navigated.
chrome.devtools.network.onNavigated.addListener(newUrl => {
  const navigatedToDifferentPage = _oldUrl !== newUrl;
  const persistSettings = persisteAcrossReload.checked;

  _oldUrl = newUrl;

  if (navigatedToDifferentPage && !persistSettings) {
    policyManager.restoreOriginalPoliciesSetByPage();
    // Refresh page so chrome.webRequest.onHeadersReceived can run in
    // background page update remove/restore the headers accordingly. The UI
    // then updates the feature list when this handler runs again.
    reloadPage();
    return; // Prevent rest of handler from being run.
  }

  policyManager.getFeaturePolicies();
});

// Create "Feature Policies" Devtools panel.
chrome.devtools.panels.create('Feature Policy', null, 'page.html', async panel => {
  // panel.onShown.addListener(() => {
  //   // bgPage.log('panel.onShown');
  //   policyManager.restoreOriginalPoliciesSetByPage();
  // });
  // panel.onHidden.addListener(() => {
  //   // bgPage.log('panel.onHidden');
  // });

  if (!('policy' in document)) {
    UI.displayError(
      `This extension requires the Feature Policy JS API to work
      (e.g. document.policy). Please turn it on in
      --enable-experimental-web-platform-features flag in about:flags.`);
  }

  const bgPage = await getBackgroundPage();
  const tab = await bgPage.getCurrentTab();
  if (!tab.url) {
    UI.displayError(`Initial url was not populated by tab.url.
      Check manifest 'tabs' permission`);
  }
  _oldUrl = tab.url; // Set initial URL being inspected..

  policyManager.allFeaturePoliciesSupportedByBrowser = bgPage.getAllFeaturePolicies();
  policyManager.getFeaturePolicies();

  bgPage.setPolicyManager(chrome.devtools.inspectedWindow.tabId, policyManager);

  restoreButton.addEventListener('click', e => {
    policyManager.restoreOriginalPoliciesSetByPage();
    reloadPage();
  });
});



// chrome.webRequest.onCompleted.addListener(details => {
//   //UI.debugResponseHeaders(details.responseHeaders);
//   console.log('onCompleted', details);
// }, {urls: ['<all_urls>'], types: ['main_frame']}, ['responseHeaders']);

const bgPageConnection = chrome.runtime.connect({name: 'devtools-page'});
bgPageConnection.postMessage({
  name: 'init',
  tabId: chrome.devtools.inspectedWindow.tabId,
});

window.UI = UI;
window.policyManager = policyManager;

// bgPageConnection.onMessage.addListener((message, sender, sendResponse) => {
//   if (message.name === 'getPagePolicies') {
//     bgPageConnection.postMessage({customizedPolicies: policyManager.customizedPolicies});
//   }
// });

