// Function to check if current time is within the rule's time range with second precision
function isTimeInRange(startTimeStr, endTimeStr) {
  try {
    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentSeconds = now.getSeconds();

    // Validate time format
    if (!startTimeStr || !endTimeStr || !startTimeStr.includes(':') || !endTimeStr.includes(':')) {
      console.warn('Invalid time format:', { startTimeStr, endTimeStr });
      return false;
    }

    // Parse start and end times (HH:MM) into Date objects for comparison
    const startParts = startTimeStr.split(':');
    const endParts = endTimeStr.split(':');

    if (startParts.length !== 2 || endParts.length !== 2) {
      console.warn('Time format should be HH:MM:', { startTimeStr, endTimeStr });
      return false;
    }

    const startHours = parseInt(startParts[0], 10);
    const startMinutes = parseInt(startParts[1], 10);
    const endHours = parseInt(endParts[0], 10);
    const endMinutes = parseInt(endParts[1], 10);

    // Validate time values
    if (isNaN(startHours) || isNaN(startMinutes) || isNaN(endHours) || isNaN(endMinutes) ||
        startHours < 0 || startHours > 23 || endHours < 0 || endHours > 23 ||
        startMinutes < 0 || startMinutes > 59 || endMinutes < 0 || endMinutes > 59) {
      console.warn('Invalid time values:', { startHours, startMinutes, endHours, endMinutes });
      return false;
    }

    const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHours, startMinutes, 0);
    const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endHours, endMinutes, 0);
    const currentTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), currentHours, currentMinutes, currentSeconds);

    // Handle overnight time ranges (e.g., 23:00 to 02:00)
    if (startDate.getTime() > endDate.getTime()) {
      // If current time is after start time (on the same day) OR before end time (on the next day)
      return currentTime.getTime() >= startDate.getTime() || currentTime.getTime() < endDate.getTime();
    }

    // Standard time range (e.g., 09:00 to 17:00)
    return currentTime.getTime() >= startDate.getTime() && currentTime.getTime() < endDate.getTime();
  } catch (error) {
    console.error('Error in isTimeInRange:', error, { startTimeStr, endTimeStr });
    return false;
  }
}

// Function to check and redirect tabs that are on blocked domains
async function checkAndRedirectBlockedTabs() {
  try {
    const { rules = [] } = await chrome.storage.sync.get('rules');
    const activeBlockedDomains = [];
    const currentTime = new Date().toLocaleTimeString();

    // Get currently active blocked domains
    rules.forEach(rule => {
      if (rule && rule.domain && rule.startTime && rule.endTime) {
        const isActive = isTimeInRange(rule.startTime, rule.endTime);
        console.log(`Rule ${rule.domain} (${rule.startTime}-${rule.endTime}): ${isActive ? 'ACTIVE' : 'inactive'} at ${currentTime}`);
        if (isActive) {
          activeBlockedDomains.push(rule.domain);
        }
      }
    });

    console.log(`Currently active blocked domains: [${activeBlockedDomains.join(', ')}]`);

    if (activeBlockedDomains.length > 0) {
      const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
      console.log(`Checking ${tabs.length} tabs for blocked domains`);

      for (const tab of tabs) {
        try {
          const tabUrl = new URL(tab.url);
          const tabDomain = tabUrl.hostname;

          // Check if this tab is on a blocked domain and not already on the blocked page
          const isBlocked = activeBlockedDomains.some(blockedDomain =>
            tabDomain === blockedDomain || tabDomain.endsWith('.' + blockedDomain)
          );

          if (isBlocked && !tab.url.includes('blocked.html')) {
            console.log(`🚫 BLOCKING: Redirecting tab on blocked domain: ${tab.url} (domain: ${tabDomain})`);
            const blockedPageUrl = chrome.runtime.getURL(`blocked.html?url=${encodeURIComponent(tabDomain)}`);

            try {
              // Force immediate redirection
              await chrome.tabs.update(tab.id, { url: blockedPageUrl });
              console.log(`✅ Successfully redirected tab ${tab.id} to blocked page`);
            } catch (updateError) {
              console.error(`Failed to redirect tab ${tab.id}:`, updateError);
              // Try to close and reopen if update fails
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
    } else {
      console.log('No active blocking rules at this time');
    }
  } catch (error) {
    console.error('Error checking blocked tabs:', error);
  }
}

// Function to update the blocking rules
async function updateBlockingRules() {
  try {
    const { rules = [] } = await chrome.storage.sync.get('rules');
    
    // First, get all existing dynamic rules to remove them
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const existingRuleIds = existingRules.map(rule => rule.id);
    
    const rulesToAdd = [];
    
    // Create new rules for active time periods
    rules.forEach((rule, index) => {
      const ruleId = index + 1; // Use consistent IDs based on array position

      // Validate rule has required properties
      if (!rule || !rule.domain || !rule.startTime || !rule.endTime) {
        console.warn(`Skipping invalid rule at index ${index}:`, rule);
        return;
      }

      try {
        if (isTimeInRange(rule.startTime, rule.endTime)) {
          rulesToAdd.push({
            id: ruleId,
            priority: 1,
            action: {
              type: 'redirect',
              redirect: {
                extensionPath: `/blocked.html?url=${encodeURIComponent(rule.domain)}`
              }
            },
            condition: {
              requestDomains: [rule.domain],
              resourceTypes: ['main_frame']
            }
          });
        }
      } catch (error) {
        console.error(`Error processing rule ${index}:`, error, rule);
      }
    });
    
    // Update the rules
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingRuleIds,
      addRules: rulesToAdd
    });
    
    console.log(`Blocking rules updated at: ${new Date().toLocaleTimeString()}`);
    console.log(`Active rules: ${rulesToAdd.length}, Total rules: ${rules.length}`);

    // Always check and redirect tabs for currently active blocking rules
    await checkAndRedirectBlockedTabs();
    
  } catch (error) {
    console.error('Error updating blocking rules:', error);
  }
}

// Run on startup
chrome.runtime.onStartup.addListener(async () => {
  console.log('Extension startup - updating rules');

  try {
    // Ensure alarm is set up on startup
    await chrome.alarms.clear('ruleChecker');
    chrome.alarms.create('ruleChecker', {
      periodInMinutes: 0.0167 // Every 1 second for immediate blocking
    });

    // Run immediately
    updateBlockingRules();
    // Also immediately check for any tabs that should be blocked
    setTimeout(() => checkAndRedirectBlockedTabs(), 1000);
  } catch (error) {
    console.error('Error during startup setup:', error);
  }
});

// On installation or update, set up the alarm and update rules
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('Extension installed/updated:', details.reason);

  try {
    // Clear any existing alarms first
    await chrome.alarms.clear('ruleChecker');

    // Create recurring alarm to check every 1 second
    chrome.alarms.create('ruleChecker', {
      periodInMinutes: 0.0167 // Every 1 second for immediate blocking
    });

    // Initial rule update
    updateBlockingRules();
    // Also immediately check for any tabs that should be blocked
    setTimeout(() => checkAndRedirectBlockedTabs(), 1000);

  } catch (error) {
    console.error('Error during installation setup:', error);
  }
});

// Listen for the alarm
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'ruleChecker') {
    console.log(`🔔 Alarm triggered at ${new Date().toLocaleTimeString()} - checking rules`);

    // First update the declarative rules
    await updateBlockingRules();

    // Then immediately force check all tabs (this is the critical part for existing tabs)
    console.log('🔍 Force checking all tabs for immediate blocking...');
    await checkAndRedirectBlockedTabs();
  }
});

// Listen for tab updates (navigation, refresh, etc.)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only process when the tab is loading or has completed loading
  if (changeInfo.status === 'loading' && tab.url) {
    try {
      const { rules = [] } = await chrome.storage.sync.get('rules');
      const tabUrl = new URL(tab.url);
      const tabDomain = tabUrl.hostname;

      // Check if this domain is currently blocked
      for (const rule of rules) {
        if (rule && rule.domain === tabDomain && rule.startTime && rule.endTime &&
            isTimeInRange(rule.startTime, rule.endTime) &&
            !tab.url.includes(chrome.runtime.getURL('blocked.html'))) {

          console.log(`Blocking navigation to: ${tab.url}`);
          const blockedPageUrl = chrome.runtime.getURL(`blocked.html?url=${encodeURIComponent(tabDomain)}`);
          await chrome.tabs.update(tabId, { url: blockedPageUrl });
          break;
        }
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
    if (tab.url) {
      const { rules = [] } = await chrome.storage.sync.get('rules');
      const tabUrl = new URL(tab.url);
      const tabDomain = tabUrl.hostname;

      // Check if this domain is currently blocked
      for (const rule of rules) {
        if (rule && rule.domain === tabDomain && rule.startTime && rule.endTime &&
            isTimeInRange(rule.startTime, rule.endTime) &&
            !tab.url.includes(chrome.runtime.getURL('blocked.html'))) {

          console.log(`Blocking activated tab: ${tab.url}`);
          const blockedPageUrl = chrome.runtime.getURL(`blocked.html?url=${encodeURIComponent(tabDomain)}`);
          await chrome.tabs.update(activeInfo.tabId, { url: blockedPageUrl });
          break;
        }
      }
    }
  } catch (e) {
    // Ignore errors for non-http URLs or when tab doesn't exist
  }
});

// Listen for messages from the popup (when rules are changed)
// Execute immediate check when the background script loads
console.log('Background script loaded - checking for blocked tabs immediately');
setTimeout(() => {
  checkAndRedirectBlockedTabs();
}, 500);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateRules") {
    console.log('Received updateRules message from popup');
    updateBlockingRules()
      .then(() => {
        // Also check existing tabs when rules are manually updated
        return checkAndRedirectBlockedTabs();
      })
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error('Error updating rules from message:', error);
        sendResponse({ success: false, error: error.message });
      });

    // Return true to indicate we'll send a response asynchronously
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
    // Manual trigger for testing immediate blocking
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
