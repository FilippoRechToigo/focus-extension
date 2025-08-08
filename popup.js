document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('add-rule-form');
  const rulesList = document.getElementById('rules-list');

  // Load and display existing rules
  const loadRules = () => {
    chrome.storage.sync.get({ rules: [] }, (data) => {
      rulesList.innerHTML = ''; // Clear current list
      data.rules.forEach((rule, index) => {
        const listItem = document.createElement('li');
        listItem.textContent = `${rule.domain} (${rule.startTime} - ${rule.endTime})`;
        
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.className = 'delete-btn';
        deleteBtn.addEventListener('click', () => {
          deleteRule(index);
        });
        
        listItem.appendChild(deleteBtn);
        rulesList.appendChild(listItem);
      });
    });
  };

  // Add a new rule
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const domain = document.getElementById('domain').value;
    const startTime = document.getElementById('start-time').value;
    const endTime = document.getElementById('end-time').value;

    chrome.storage.sync.get({ rules: [] }, (data) => {
      const newRules = [...data.rules, { domain, startTime, endTime }];
      chrome.storage.sync.set({ rules: newRules }, () => {
        form.reset();
        loadRules();
        // Notify background script that rules have changed
        chrome.runtime.sendMessage({ action: "updateRules" });
      });
    });
  });

  // Delete a rule
  const deleteRule = (indexToDelete) => {
    chrome.storage.sync.get({ rules: [] }, (data) => {
      const filteredRules = data.rules.filter((_, index) => index !== indexToDelete);
      chrome.storage.sync.set({ rules: filteredRules }, () => {
        loadRules();
        // Notify background script that rules have changed
        chrome.runtime.sendMessage({ action: "updateRules" });
      });
    });
  };

  // Test button for force checking blocked tabs
  document.getElementById('force-check-btn').addEventListener('click', () => {
    const statusMessage = document.getElementById('status-message');
    statusMessage.textContent = 'Checking blocked tabs...';
    statusMessage.style.color = 'blue';

    chrome.runtime.sendMessage({ action: "forceCheck" }, (response) => {
      if (response && response.success) {
        statusMessage.textContent = 'Force check completed successfully!';
        statusMessage.style.color = 'green';
      } else {
        statusMessage.textContent = `Error: ${response?.error || 'Unknown error'}`;
        statusMessage.style.color = 'red';
      }

      // Clear message after 3 seconds
      setTimeout(() => {
        statusMessage.textContent = '';
      }, 3000);
    });
  });

  // Initial load
  loadRules();
});
