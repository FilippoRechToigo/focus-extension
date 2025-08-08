// Function to check if current time is within any of the rule's time ranges with second precision
function isTimeInAnyRange(schedules) {
  try {
    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentSeconds = now.getSeconds();
    const currentTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), currentHours, currentMinutes, currentSeconds);

    for (const schedule of schedules) {
      const { startTime, endTime } = schedule;

      // Validate time format
      if (!startTime || !endTime || !startTime.includes(':') || !endTime.includes(':')) {
        console.warn('Invalid time format in schedule:', { startTime, endTime });
        continue;
      }

      // Parse start and end times (HH:MM) into Date objects for comparison
      const startParts = startTime.split(':');
      const endParts = endTime.split(':');

      if (startParts.length !== 2 || endParts.length !== 2) {
        console.warn('Time format should be HH:MM:', { startTime, endTime });
        continue;
      }

      const startHours = parseInt(startParts[0], 10);
      const startMinutes = parseInt(startParts[1], 10);
      const endHours = parseInt(endParts[0], 10);
      const endMinutes = parseInt(endParts[1], 10);

      // Validate time values
      if (isNaN(startHours) || isNaN(startMinutes) || isNaN(endHours) || isNaN(endMinutes) ||
          startHours < 0 || startHours > 23 || endHours < 0 || endHours > 23 ||
          startMinutes < 0 || startMinutes > 59 || endMinutes < 0 || endMinutes > 59) {
        console.warn('Invalid time values in schedule:', { startHours, startMinutes, endHours, endMinutes });
        continue;
      }

      const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHours, startMinutes, 0);
      const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endHours, endMinutes, 0);

      // Handle overnight time ranges (e.g., 23:00 to 02:00)
      if (startDate.getTime() > endDate.getTime()) {
        // If current time is after start time (on the same day) OR before end time (on the next day)
        if (currentTime.getTime() >= startDate.getTime() || currentTime.getTime() < endDate.getTime()) {
          return true; // Found an active schedule
        }
      } else {
        // Standard time range (e.g., 09:00 to 17:00)
        if (currentTime.getTime() >= startDate.getTime() && currentTime.getTime() < endDate.getTime()) {
          return true; // Found an active schedule
        }
      }
    }
    return false; // No active schedules found
  } catch (error) {
    console.error('Error in isTimeInAnyRange:', error, { schedules });
    return false;
  }
}

// Function to check and redirect tabs based on current mode
async function checkAndRedirectBlockedTabs() {
  try {
    const { rules = [] } = await chrome.storage.sync.get('rules');
    let activeBlockDomains = new Set();
    let activeExceptionDomains = new Set();
    let isExceptionModeActive = false;

    rules.forEach(rule => {
      if (rule && rule.websites && rule.type && rule.schedules) {
        if (isTimeInAnyRange(rule.schedules)) {
          if (rule.type === 'block') {
            rule.websites.forEach(website => activeBlockDomains.add(website));
          } else if (rule.type === 'exception') {
            isExceptionModeActive = true;
            rule.websites.forEach(website => activeExceptionDomains.add(website));
          }
        }
      }
    });

    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*", "chrome://*/*"] });
    console.log(`Checking ${tabs.length} tabs for blocking/exception rules`);

    for (const tab of tabs) {
      try {
        let tabUrl;
        let tabDomain;

        // Handle chrome:// URLs separately as new URL() throws for them
        if (tab.url.startsWith('chrome://')) {
          tabUrl = tab.url;
          tabDomain = tab.url.split('/')[2]; // Extract "extensions", "settings", etc.
        } else {
          tabUrl = new URL(tab.url);
          tabDomain = tabUrl.hostname;
        }

        let shouldBlock = false;

        if (isExceptionModeActive) {
          // In exception mode, block all domains NOT in activeExceptionDomains (broad match for exceptions)
          shouldBlock = ![...activeExceptionDomains].some(exceptionDomain =>
            tabDomain === exceptionDomain || tabDomain.endsWith('.' + exceptionDomain)
          );
        } else {
          // In normal block mode, block domains in activeBlockDomains (broad match)
          shouldBlock = [...activeBlockDomains].some(blockedDomain =>
            tabDomain === blockedDomain || tabDomain.endsWith('.' + blockedDomain)
          );
        }

        if (shouldBlock && !tab.url.includes('blocked.html')) {
          console.log(`🚫 BLOCKING: Redirecting tab on URL: ${tab.url} (domain/path: ${tabDomain})`);
          const blockedPageUrl = chrome.runtime.getURL(`blocked.html?url=${encodeURIComponent(tabUrl)}`);

          try {
            await chrome.tabs.update(tab.id, { url: blockedPageUrl });
            console.log(`✅ Successfully redirected tab ${tab.id} to blocked page`);
          } catch (updateError) {
            console.error(`Failed to redirect tab ${tab.id}:`, updateError);
            try {
              await chrome.tabs.remove(tab.id);
              console.log(`Tab ${tab.id} removed as fallback`);
            } catch (removeError) {
              console.error(`Failed to remove tab ${tab.id}:`, removeError);
            }
          }
        }
      } catch (e) {
        console.warn(`Could not process tab URL: ${tab.url}, Error: ${e.message}`);
      }
    }
  } catch (error) {
    console.error('Error checking blocked tabs:', error);
  }
}

// Function to update the blocking rules using declarativeNetRequest
async function updateBlockingRules() {
  try {
    const { rules = [] } = await chrome.storage.sync.get('rules');
    
    let activeBlockDomains = new Set();
    let activeExceptionDomains = new Set();
    let isExceptionModeActive = false;

    rules.forEach(rule => {
      if (rule && rule.websites && rule.type && rule.schedules) {
        if (isTimeInAnyRange(rule.schedules)) {
          if (rule.type === 'block') {
            rule.websites.forEach(website => activeBlockDomains.add(website));
          } else if (rule.type === 'exception') {
            isExceptionModeActive = true;
            rule.websites.forEach(website => activeExceptionDomains.add(website));
          }
        }
      }
    });

    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = existingRules.map(rule => rule.id);
    
    const rulesToAdd = [];
    const blockedPagePath = "/blocked.html"; // Use relative path

    if (isExceptionModeActive) {
      // In exception mode, block all requests except those matching the exception domains.
      // Rule ID 1 is for the general block rule.
      rulesToAdd.push({
        id: 1,
        priority: 1,
        action: {
          type: 'redirect',
          redirect: { extensionPath: blockedPagePath }
        },
        condition: {
          urlFilter: "*", // Block all URLs by default
          resourceTypes: ['main_frame']
        }
      });

      // Add exception rules (allow list)
      [...activeExceptionDomains].forEach((domain, index) => {
        // Rule IDs for exceptions start from 2
        const exceptionRuleId = 2 + index; 
        rulesToAdd.push({
          id: exceptionRuleId,
          priority: 2, // Higher priority to override the general block rule
          action: { type: 'allow' },
          condition: {
            urlFilter: `*://*.${domain}/*`, // Allow domain and all subdomains
            resourceTypes: ['main_frame']
          }
        });
        rulesToAdd.push({
          id: exceptionRuleId + 1000, // Add another rule for the exact domain without subdomain
          priority: 2,
          action: { type: 'allow' },
          condition: {
            urlFilter: `*://${domain}/*`,
            resourceTypes: ['main_frame']
          }
        });
      });
    } else {
      // In normal block mode, block specific domains.
      [...activeBlockDomains].forEach((domain, index) => {
        const declarativeRuleId = 10000 + index; 
        rulesToAdd.push({
          id: declarativeRuleId,
          priority: 1,
          action: {
            type: 'redirect',
            redirect: { extensionPath: blockedPagePath }
          },
          condition: {
            urlFilter: `*://*.${domain}/*`, // Block domain and all subdomains
            resourceTypes: ['main_frame']
          }
        });
        rulesToAdd.push({
          id: declarativeRuleId + 1000, // Add another rule for the exact domain without subdomain
          priority: 1,
          action: {
            type: 'redirect',
            redirect: { extensionPath: blockedPagePath }
          },
          condition: {
            urlFilter: `*://${domain}/*`,
            resourceTypes: ['main_frame']
          }
        });
      });
    }
    
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingRuleIds,
      addRules: rulesToAdd
    });
    
    console.log(`Blocking rules updated at: ${new Date().toLocaleTimeString()}`);
    console.log(`Active declarative rules: ${rulesToAdd.length}`);
    console.log(`Is Exception Mode Active: ${isExceptionModeActive}`);
    console.log(`Active Block Domains: [${[...activeBlockDomains].join(', ')}]`);
    console.log(`Active Exception Domains: [${[...activeExceptionDomains].join(', ')}]`);
    
  } catch (error) {
    console.error('Error updating blocking rules:', error);
  }
}

// Run on startup
chrome.runtime.onStartup.addListener(async () => {
  console.log('Extension startup - updating rules');

  try {
    await chrome.alarms.clear('ruleChecker');
    chrome.alarms.create('ruleChecker', {
      periodInMinutes: 0.0167 // Every 1 second for immediate blocking
    });

    await updateBlockingRules();
    await checkAndRedirectBlockedTabs(); // Check and redirect existing tabs on startup
  } catch (error) {
    console.error('Error during startup setup:', error);
  }
});

// On installation or update, set up the alarm and update rules
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Extension installed/updated:', details.reason);

  try {
    await chrome.alarms.clear('ruleChecker');
    chrome.alarms.create('ruleChecker', {
      periodInMinutes: 0.0167 // Every 1 second for immediate blocking
    });

    await updateBlockingRules();
    await checkAndRedirectBlockedTabs(); // Check and redirect existing tabs on install/update
  } catch (error) {
    console.error('Error during installation setup:', error);
  }
});

// Listen for the alarm
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'ruleChecker') {
    console.log(`🔔 Alarm triggered at ${new Date().toLocaleTimeString()} - checking rules`);
    await updateBlockingRules();
    await checkAndRedirectBlockedTabs(); // Check and redirect existing tabs when alarm fires
  }
});

// Listen for tab updates (navigation, refresh, etc.)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // No direct blocking logic here, declarativeNetRequest handles it.
  // This listener remains for potential future needs or specific edge cases not covered by declarativeNetRequest.
});

// Listen for tab activation (switching between tabs)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  // No direct blocking logic here, declarativeNetRequest handles it.
});

// Listen for messages from the popup (when rules are changed)
console.log('Background script loaded');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateRules") {
    console.log('Received updateRules message from popup');
    updateBlockingRules()
      .then(() => checkAndRedirectBlockedTabs()) // Check and redirect after rules are updated
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Error updating rules from message:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  } else if (message.action === "getRuleStatus") {
    chrome.declarativeNetRequest.getDynamicRules()
      .then(rules => {
        sendResponse({
          activeRules: rules.length,
          rules: rules.map(r => ({ id: r.id, domain: r.condition.requestDomains ? r.condition.requestDomains[0] : r.condition.urlFilter }))
        });
      })
      .catch(error => {
        sendResponse({ error: error.message });
      });
    return true;
  } else if (message.action === "forceCheck") {
    console.log('Force checking rules from popup request');
    updateBlockingRules()
      .then(() => checkAndRedirectBlockedTabs()) // Force check and redirect
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Error updating rules from message:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});
