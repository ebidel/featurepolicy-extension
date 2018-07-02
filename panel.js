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

const FP_HEADER = 'Feature-Policy';

const persisteAcrossReload = document.querySelector('#persist-on-reload');
const activePoliciesEl = document.querySelector('#active-policies');
const errorEl = document.querySelector('#error-msg');
const restoreButton = document.querySelector('#restore-button');

let _allFeaturePolicies = []; /* Array<string> all feature policy names supported by the browser. */
let _originalPoliciesUsedOnPage = {};
let _customizedPolicies = {};

function getFeaturePolicyAllowListOnPage(features) {
  const map = {};
  for (const feature of features) {
    map[feature] = {
      allowed: document.policy.allowsFeature(feature),
      allowList: document.policy.getAllowlistForFeature(feature),
      customized: false,
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
    //const feature = policyManager.customizedPolicies[e.target.value];
    // const feature = policyManager.originalPoliciesSetByPage[e.target.value];
    // feature.allowed = e.target.checked;

    // const feature = policyManager.customizedPolicies[e.target.value];
    // if (feature) {
    //   feature.customized = false;
    //   feature.allowed = policyManager.originalPoliciesSetByPage[e.target.value].allowed;
    //   feature.allowList = policyManager.originalPoliciesSetByPage[e.target.value].allowList;
    // } else {
    //   policyManager.customizedPolicies[e.target.value] = {
    //     allowed: e.target.checked,
    //     allowList: [],
    //     customized: true,
    //   };
    // }
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
          ${repeat(features, ([feature, val]) => feature, ([feature, val], i) => {
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
  }
};

class FeaturePolicyMananger {
  get allFeaturePoliciesSupportedByBrowser() {
    if (!_allFeaturePolicies.length) {
      console.warn('List of feature policies supported by the browser was not set.');
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
    UI.updateDOMLists(this.originalPoliciesSetByPage);
  }

  buildCustomizedPolicyList(featureList) {
    const list = JSON.parse(JSON.stringify(this.originalPoliciesSetByPage));
    Object.entries(list).forEach(([feature, val]) => {
      if (this.customizedPolicies[feature]) {
        list[feature] = this.customizedPolicies[feature];
      }
    });
    return list;
  }

  getFeaturePolicies() {
    // Inject the _getFeaturePolicyAllowListOnPage function into the page and return its eval'd result.
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
    const feature = this.customizedPolicies[policyName];
    if (feature) {
      delete this.customizedPolicies[policyName];
      // feature.customized = false;
      // feature.allowed = this.originalPoliciesSetByPage[policyName].allowed;
      // feature.allowList = this.originalPoliciesSetByPage[policyName].allowList;
    } else {
      this.customizedPolicies[policyName] = {
        // allowed: true,
        allowList: ["'none'"],
        customized: true,
      };
    }
  }
}

const policyManager = new FeaturePolicyMananger();

// Refresh policy lists if page is navigated.
chrome.devtools.network.onNavigated.addListener(url => {
  policyManager.getFeaturePolicies();
});

// Create "Feature Policies" Devtools panel.
chrome.devtools.panels.create('Feature Policy', null, 'page.html', async panel => {

  // // From https://stackoverflow.com/questions/18310484/modify-http-responses-from-a-chrome-extension/45220932#
  // chrome.debugger.getTargets(targets => {
  //   const target = /* Find the target. */;
  //   const debuggee = {targetId: target.id};

  //   chrome.debugger.attach(debuggee, '1.3', () => {
  //     chrome.debugger.sendCommand(debuggee, 'Network.setRequestInterception', {urlPattern: '*'});
  //   });

  //   chrome.debugger.onEvent.addListener((source, method, params) => {
  //     if (source.targetId === target.id && method === 'Network.requestIntercepted') {
  //       // TODO

  //       chrome.debugger.detach(target, () => {

  //       });
  //     }
  //   });
  // });

  // panel.onShown.addListener(() => { });
  // panel.onHidden.addListener(() => { });

  if (!('policy' in document)) {
    UI.displayError('This extension requires the Feature Policy JS API to work (e.g. `document.policy`). Please turn it on in --enable-experimental-web-platform-features flag in about:flags.');
  }

  const bgPage = await getBackgroundPage();
  policyManager.allFeaturePoliciesSupportedByBrowser = bgPage.getAllFeaturePolicies();
  policyManager.getFeaturePolicies();

  restoreButton.addEventListener('click', e => {
    policyManager.restoreOriginalPoliciesSetByPage();
    reloadPage();
  });
});


chrome.webRequest.onHeadersReceived.addListener(details => {
  // If it is not the top-frame, we just ignore it.
  if (details.frameId !== 0 || chrome.devtools.inspectedWindow.tabId !== details.tabId) {
    return;
  }

  const responseHeaders = [];
  const collectedFPHeaderVals = [];

  // Preserve headers sent by page and collect separate Feature-Policy headers
  // into an aggreated, single header.
  details.responseHeaders.forEach((header, i) => {
    if (header.name === FP_HEADER) {
      collectedFPHeaderVals.push(header.value);
    } else {
      responseHeaders.push(header);
    }
  });

  for (const [key, val] of Object.entries(policyManager.customizedPolicies)) {
    collectedFPHeaderVals.push(`${key} ${val.allowList.join(' ')}`);
  }

  if (collectedFPHeaderVals.length) {
    // Note: the DevTools network panel won't show the updated response headers
    // but our changes will work. The panel shows the original headers as seen
    // from the network. See https://crbug.com258064.
    // TODO: figure out how to communicate this to users. It'll be confusing
    // if they check the DevTools and it doesn't show correct values.
    responseHeaders.push({
      name: FP_HEADER,
      value: collectedFPHeaderVals.join('; ')
    });
  }

  return {responseHeaders};
}, {urls: ['<all_urls>'], types: ['main_frame']}, ['blocking', 'responseHeaders']);


// chrome.webRequest.onResponseStarted.addListener(details => {
chrome.webRequest.onCompleted.addListener(details => {
  console.log('onCompleted', details)
}, {urls: ['<all_urls>'], types: ['main_frame']}, ['responseHeaders']);
