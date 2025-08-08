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

// Global sets to store active domains for quick lookup
let activeBlockDomains = new Set();
let activeExceptionDomains = new Set();
let isExceptionModeActive = false;

// Function to update the blocking rules (declarativeNetRequest for block rules)
async function updateBlockingRules() {
  try {
    const { rules = [] } = await chrome.storage.sync.get('rules');
    
    activeBlockDomains.clear();
    activeExceptionDomains.clear();
    isExceptionModeActive = false;

    rules.forEach(rule => {
      if (rule && rule.websites && rule.type && rule.schedules) {
        if (isTimeInAnyRange(rule.schedules)) {
          if (rule.type === 'block') {
            rule.websites.forEach(website => activeBlockDomains.add(website));
          } else if (rule.type === 'exception') {
            isExceptionModeActive = true; // Activate exception mode if any exception rule is active
            rule.websites.forEach(website => activeExceptionDomains.add(website));
          }
        }
      }
    });

    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = existingRules.map(rule => rule.id);
    
    const rulesToAdd = [];

    if (!isExceptionModeActive) {
      // If not in exception mode, apply block rules using declarativeNetRequest
      [...activeBlockDomains].forEach((domain, index) => {
        const declarativeRuleId = 10000 + index; 
        rulesToAdd.push({
          id: declarativeRuleId,
          priority: 1,
          action: {
            type: 'redirect',
            redirect: {
              extensionPath: `/blocked.html?url=${encodeURIComponent(domain)}`
            }
          },
          condition: {
            requestDomains: [domain],
            resourceTypes: ['main_frame']
          }
        });
      });
    } else {
      // If in exception mode, clear all declarative rules.
      // Programmatic blocking will handle the "block all except" logic.
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

    // Always check and redirect tabs for currently active blocking rules
    await checkAndRedirectBlockedTabs();
    
  } catch (error) {
    console.error('Error updating blocking rules:', error);
  }
}

// Function to check and redirect tabs based on current mode
async function checkAndRedirectBlockedTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    console.log(`Checking ${tabs.length} tabs for blocking/exception rules`);

    for (const tab of tabs) {
      try {
        const tabUrl = new URL(tab.url);
        const tabDomain = tabUrl.hostname;

        let shouldBlock = false;

        if (isExceptionModeActive) {
          // In exception mode, block all domains NOT in activeExceptionDomains (exact match)
          shouldBlock = !activeExceptionDomains.has(tabDomain);
        } else {
          // In normal block mode, block domains in activeBlockDomains (broad match)
          shouldBlock = [...activeBlockDomains].some(blockedDomain =>
            tabDomain === blockedDomain || tabDomain.endsWith('.' + blockedDomain)
          );
        }

        if (shouldBlock && !tab.url.includes('blocked.html')) {
          console.log(`🚫 BLOCKING: Redirecting tab on domain: ${tab.url} (domain: ${tabDomain})`);
          const blockedPageUrl = chrome.runtime.getURL(`blocked.html?url=${encodeURIComponent(tabDomain)}`);

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

// Run on startup
chrome.runtime.onStartup.addListener(async () => {
  console.log('Extension startup - updating rules');

  try {
    await chrome.alarms.clear('ruleChecker');
    chrome.alarms.create('ruleChecker', {
      periodInMinutes: 0.0167 // Every 1 second for immediate blocking
    });

    updateBlockingRules();
    setTimeout(() => checkAndRedirectBlockedTabs(), 1000);
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

    updateBlockingRules();
    setTimeout(() => checkAndRedirectBlockedTabs(), 1000);

  } catch (error) {
    console.error('Error during installation setup:', error);
  }
});

// Listen for the alarm
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'ruleChecker') {
    console.log(`🔔 Alarm triggered at ${new Date().toLocaleTimeString()} - checking rules`);
    await updateBlockingRules();
    console.log('🔍 Force checking all tabs for immediate blocking...');
    await checkAndRedirectBlockedTabs();
  }
});

// Listen for tab updates (navigation, refresh, etc.)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only process when the tab is loading or has completed loading and is a valid URL
  if (changeInfo.status === 'loading' && tab.url && !tab.url.includes('blocked.html')) {
    try {
      const tabUrl = new URL(tab.url);
      const tabDomain = tabUrl.hostname;

      let shouldBlock = false;

      if (isExceptionModeActive) {
        // In exception mode, block all domains NOT in activeExceptionDomains (exact match)
        shouldBlock = !activeExceptionDomains.has(tabDomain);
      } else {
        // In normal block mode, block domains in activeBlockDomains (broad match)
        shouldBlock = [...activeBlockDomains].some(blockedDomain =>
          tabDomain === blockedDomain || tabDomain.endsWith('.' + blockedDomain)
        );
      }

      if (shouldBlock) {
        console.log(`Blocking navigation to: ${tab.url}`);
        const blockedPageUrl = chrome.runtime.getURL(`blocked.html?url=${encodeURIComponent(tabDomain)}`);
        await chrome.tabs.update(tabId, { url: blockedPageUrl });
      }
    } catch (e) {
      // Ignore errors for non-http URLs or malformed URLs
    }
  }
});

// Listen for tab activation (switching between tabs)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url && !tab.url.includes('blocked.html')) {
      const tabUrl = new URL(tab.url);
      const tabDomain = tabUrl.hostname;

      let shouldBlock = false;

      if (isExceptionModeActive) {
        // In exception mode, block all domains NOT in activeExceptionDomains (exact match)
        shouldBlock = !activeExceptionDomains.has(tabDomain);
      } else {
        // In normal block mode, block domains in activeBlockDomains (broad match)
        shouldBlock = [...activeBlockDomains].some(blockedDomain =>
          tabDomain === blockedDomain || tabDomain.endsWith('.' + blockedDomain)
        );
      }

      if (shouldBlock) {
        console.log(`Blocking activated tab: ${tab.url}`);
        const blockedPageUrl = chrome.runtime.getURL(`blocked.html?url=${encodeURIComponent(tabDomain)}`);
        await chrome.tabs.update(activeInfo.tabId, { url: blockedPageUrl });
      }
    }
  } catch (e) {
    // Ignore errors for non-http URLs or when tab doesn't exist
  }
});

// Listen for messages from the popup (when rules are changed)
console.log('Background script loaded - checking for blocked tabs immediately');
setTimeout(() => {
  checkAndRedirectBlockedTabs();
}, 500);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateRules") {
    console.log('Received updateRules message from popup');
    updateBlockingRules()
      .then(() => {
        return checkAndRedirectBlockedTabs();
      })
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
          rules: rules.map(r => ({ id: r.id, domain: r.condition.requestDomains[0] }))
        });
      })
      .catch(error => {
        sendResponse({ error: error.message });
      });
    return true;
  } else if (message.action === "forceCheck") {
    console.log('Force checking blocked tabs from popup request');
    checkAndRedirectBlockedTabs()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
});
