document.addEventListener('DOMContentLoaded', () => {
  const mainView = document.getElementById('main-view');
  const ruleListView = document.getElementById('rule-list-view'); // This is now part of main-view
  const ruleEditorView = document.getElementById('rule-editor-view');
  const strictModeView = document.getElementById('strict-mode-view');

  const addNewRuleBtn = document.getElementById('add-new-rule-btn');
  const configureStrictModeBtn = document.getElementById('configure-strict-mode-btn');
  const rulesList = document.getElementById('rules-list');
  const strictModeMessageMain = document.getElementById('strict-mode-message-main');

  const ruleForm = document.getElementById('rule-form');
  const editorTitle = document.getElementById('editor-title');
  const ruleNameInput = document.getElementById('rule-name');
  const websitesTextarea = document.getElementById('websites');
  const typeBlockRadio = document.getElementById('type-block');
  const typeExceptionRadio = document.getElementById('type-exception');
  const schedulesContainer = document.getElementById('schedules-container');
  const addScheduleBtn = document.getElementById('add-schedule-btn');
  const saveRuleBtn = document.getElementById('save-rule-btn');
  const cancelEditBtn = document.getElementById('cancel-edit-btn');

  const strictModeToggle = document.getElementById('strict-mode-toggle');
  const strictModeSchedulesContainer = document.getElementById('strict-mode-schedules-container');
  const addStrictModeScheduleBtn = document.getElementById('add-strict-mode-schedule-btn');
  const saveStrictModeBtn = document.getElementById('save-strict-mode-btn');
  const cancelStrictModeEditBtn = document.getElementById('cancel-strict-mode-edit-btn');
  const strictModeForm = document.getElementById('strict-mode-form');


  let editingRuleId = null; // To store the ID of the rule being edited
  let isStrictModeActive = false; // To track strict mode status

  // --- View Management ---
  const showView = (view) => {
    mainView.style.display = 'none';
    ruleEditorView.style.display = 'none';
    strictModeView.style.display = 'none';
    view.style.display = 'block';
  };

  const showMainView = () => {
    showView(mainView);
    loadRules(); // Reload rules when returning to list view
    updateStrictModeUI(); // Update strict mode status on main view
  };

  const showRuleEditorView = (rule = null) => {
    editorTitle.textContent = rule ? 'Edit Rule' : 'Add New Rule';
    ruleNameInput.value = rule ? rule.name : '';
    websitesTextarea.value = rule ? rule.websites.join('\n') : '';
    
    if (rule && rule.type === 'exception') {
      typeExceptionRadio.checked = true;
    } else {
      typeBlockRadio.checked = true;
    }

    schedulesContainer.innerHTML = ''; // Clear existing schedules
    if (rule && rule.schedules && rule.schedules.length > 0) {
      rule.schedules.forEach(schedule => addScheduleField(schedule.startTime, schedule.endTime, schedulesContainer));
    } else {
      addScheduleField('', '', schedulesContainer); // Add at least one empty schedule field
    }

    editingRuleId = rule ? rule.id : null;
    showView(ruleEditorView);
  };

  const showStrictModeView = async () => {
    const { strictModeEnabled = false, strictModeSchedules = [] } = await chrome.storage.sync.get(['strictModeEnabled', 'strictModeSchedules']);
    strictModeToggle.checked = strictModeEnabled;
    
    strictModeSchedulesContainer.innerHTML = '';
    if (strictModeSchedules.length > 0) {
      strictModeSchedules.forEach(schedule => addScheduleField(schedule.startTime, schedule.endTime, strictModeSchedulesContainer));
    } else {
      addScheduleField('', '', strictModeSchedulesContainer); // Add at least one empty schedule field
    }
    showView(strictModeView);
  };

  // --- Schedule Management ---
  const addScheduleField = (startTime = '', endTime = '', container) => {
    const targetContainer = container || schedulesContainer; // Default to schedulesContainer
    const scheduleItem = document.createElement('div');
    scheduleItem.className = 'schedule-item';
    scheduleItem.innerHTML = `
      <label>From <input type="time" class="start-time" value="${startTime}" required></label>
      <label>To <input type="time" class="end-time" value="${endTime}" required></label>
      <button type="button" class="remove-schedule-btn">Remove</button>
    `;
    targetContainer.appendChild(scheduleItem);

    scheduleItem.querySelector('.remove-schedule-btn').addEventListener('click', (e) => {
      if (targetContainer.children.length > 1) {
        e.target.closest('.schedule-item').remove();
        if (targetContainer === strictModeSchedulesContainer) {
          saveStrictModeSettings(); // Save settings after removing a strict mode schedule
        }
      } else {
        alert('At least one schedule is required.');
      }
    });

    if (targetContainer === strictModeSchedulesContainer) {
      scheduleItem.querySelectorAll('input[type="time"]').forEach(input => {
        input.addEventListener('blur', () => {
          // No direct save here, save will happen on form submit
        }); 
      });
    }
  };

  // Function to check if current time is within any of the strict mode's time ranges
  const isTimeInAnyRange = (schedules) => {
    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), currentHours, currentMinutes, 0);

    for (const schedule of schedules) {
      const [startHours, startMinutes] = schedule.startTime.split(':').map(Number);
      const [endHours, endMinutes] = schedule.endTime.split(':').map(Number);

      const startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), startHours, startMinutes, 0);
      const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), endHours, endMinutes, 0);

      if (startDate.getTime() > endDate.getTime()) {
        if (currentTime.getTime() >= startDate.getTime() || currentTime.getTime() < endDate.getTime()) {
          return true;
        }
      } else {
        if (currentTime.getTime() >= startDate.getTime() && currentTime.getTime() < endDate.getTime()) {
          return true;
        }
      }
    }
    return false;
  };

  // --- Strict Mode Management ---
  const updateStrictModeUI = async () => {
    const { strictModeEnabled = false, strictModeSchedules = [] } = await chrome.storage.sync.get(['strictModeEnabled', 'strictModeSchedules']);
    isStrictModeActive = strictModeEnabled && isTimeInAnyRange(strictModeSchedules);
    
    // Update main view message and button states
    strictModeMessageMain.style.display = isStrictModeActive ? 'block' : 'none';
    addNewRuleBtn.disabled = isStrictModeActive;
    configureStrictModeBtn.disabled = isStrictModeActive;
    rulesList.querySelectorAll('.edit-btn, .delete-btn').forEach(btn => {
      btn.disabled = isStrictModeActive;
    });

    // Update strict mode configuration view (when visible)
    if (strictModeView.style.display === 'block') {
      strictModeToggle.checked = strictModeEnabled;
      strictModeToggle.disabled = isStrictModeActive;
      strictModeSchedulesContainer.querySelectorAll('input, button').forEach(element => {
        element.disabled = isStrictModeActive;
      });
      saveStrictModeBtn.disabled = isStrictModeActive;
      addStrictModeScheduleBtn.disabled = isStrictModeActive;
    }
    loadRules(); // Re-render rules to apply disabled state if strict mode changes
  };

  const saveStrictModeSettings = async () => {
    let strictModeEnabled = strictModeToggle.checked;
    const { strictModeEnabled: currentStrictModeEnabled } = await chrome.storage.sync.get('strictModeEnabled');

    if (strictModeEnabled && !currentStrictModeEnabled) { // Only ask for confirmation when enabling
      const confirmed = confirm('Are you sure you want to enable Strict Mode? Once active, you will not be able to modify rules or Strict Mode settings until the scheduled time passes.');
      if (!confirmed) {
        strictModeToggle.checked = false; // Revert toggle if not confirmed
        strictModeEnabled = false;
      }
    }

    const schedules = [];
    strictModeSchedulesContainer.querySelectorAll('.schedule-item').forEach(item => {
      const startTime = item.querySelector('.start-time').value;
      const endTime = item.querySelector('.end-time').value;
      if (startTime && endTime) {
        schedules.push({ startTime, endTime });
      }
    });

    if (strictModeEnabled && schedules.length === 0) {
      alert('Strict Mode requires at least one schedule.');
      strictModeToggle.checked = false;
      return;
    }

    await chrome.storage.sync.set({ strictModeEnabled, strictModeSchedules: schedules });
    showMainView(); // Go back to main view after saving
  };

  // --- Rule Storage and Display ---
  const loadRules = () => {
    chrome.storage.sync.get({ rules: [] }, (data) => {
      rulesList.innerHTML = ''; // Clear current list
      if (data.rules.length === 0) {
        const noRulesItem = document.createElement('li');
        noRulesItem.textContent = 'No rules configured yet.';
        rulesList.appendChild(noRulesItem);
        return;
      }

      data.rules.forEach((rule) => {
        const listItem = document.createElement('li');
        listItem.setAttribute('data-rule-id', rule.id);
        listItem.innerHTML = `
          <div class="rule-info">
            <strong>${rule.name}</strong> (${rule.type === 'block' ? 'Blocking' : 'Exception'})<br>
            <span>${rule.websites.length} website(s) | ${rule.schedules.length} schedule(s)</span>
          </div>
          <div class="rule-actions">
            <button class="edit-btn">Edit</button>
            <button class="delete-btn">Delete</button>
          </div>
        `;
        
        listItem.querySelector('.edit-btn').addEventListener('click', () => {
          if (!isStrictModeActive) showRuleEditorView(rule);
        });
        
        listItem.querySelector('.delete-btn').addEventListener('click', () => {
          if (!isStrictModeActive) deleteRule(rule.id);
        });
        
        rulesList.appendChild(listItem);
      });
    });
  };

  const saveRule = (rule) => {
    chrome.storage.sync.get({ rules: [] }, (data) => {
      let newRules;
      if (rule.id) { // Editing existing rule
        newRules = data.rules.map(r => r.id === rule.id ? rule : r);
      } else { // Adding new rule
        rule.id = Date.now(); // Simple unique ID
        newRules = [...data.rules, rule];
      }
      chrome.storage.sync.set({ rules: newRules }, () => {
        showRuleListView();
        chrome.runtime.sendMessage({ action: "updateRules" });
      });
    });
  };

  const deleteRule = (idToDelete) => {
    if (!confirm('Are you sure you want to delete this rule?')) {
      return;
    }
    chrome.storage.sync.get({ rules: [] }, (data) => {
      const filteredRules = data.rules.filter(rule => rule.id !== idToDelete);
      chrome.storage.sync.set({ rules: filteredRules }, () => {
        showRuleListView();
        chrome.runtime.sendMessage({ action: "updateRules" });
      });
    });
  };

  // --- Event Listeners ---
  addNewRuleBtn.addEventListener('click', () => {
    if (!isStrictModeActive) showRuleEditorView();
  });
  configureStrictModeBtn.addEventListener('click', () => {
    if (!isStrictModeActive) showStrictModeView();
  });
  addScheduleBtn.addEventListener('click', () => addScheduleField('', '', schedulesContainer));
  cancelEditBtn.addEventListener('click', () => showMainView());

  ruleForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (isStrictModeActive) return; // Prevent saving if strict mode is active

    const name = ruleNameInput.value.trim();
    const websites = websitesTextarea.value.split('\n').map(w => w.trim()).filter(w => w !== '');
    const type = typeBlockRadio.checked ? 'block' : 'exception';
    
    const schedules = [];
    schedulesContainer.querySelectorAll('.schedule-item').forEach(item => {
      const startTime = item.querySelector('.start-time').value;
      const endTime = item.querySelector('.end-time').value;
      if (startTime && endTime) {
        schedules.push({ startTime, endTime });
      }
    });

    if (!name || websites.length === 0 || schedules.length === 0) {
      alert('Please fill in all required fields: Rule Name, Websites, and at least one Schedule.');
      return;
    }

    const newRule = {
      id: editingRuleId, // Will be null for new rules, updated in saveRule
      name,
      websites,
      type,
      schedules
    };
    saveRule(newRule);
  });

  strictModeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (isStrictModeActive) return; // Prevent saving if strict mode is active
    saveStrictModeSettings();
  });

  cancelStrictModeEditBtn.addEventListener('click', () => showMainView());
  addStrictModeScheduleBtn.addEventListener('click', () => addScheduleField('', '', strictModeSchedulesContainer));
  
  // Initial load
  showMainView();
});
