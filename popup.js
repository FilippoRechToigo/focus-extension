document.addEventListener('DOMContentLoaded', () => {
  const ruleListView = document.getElementById('rule-list-view');
  const ruleEditorView = document.getElementById('rule-editor-view');
  const addNewRuleBtn = document.getElementById('add-new-rule-btn');
  const rulesList = document.getElementById('rules-list');
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
  const forceCheckBtn = document.getElementById('force-check-btn');
  const statusMessage = document.getElementById('status-message');

  let editingRuleId = null; // To store the ID of the rule being edited

  // --- View Management ---
  const showView = (view) => {
    ruleListView.style.display = 'none';
    ruleEditorView.style.display = 'none';
    view.style.display = 'block';
  };

  const showRuleListView = () => {
    showView(ruleListView);
    loadRules(); // Reload rules when returning to list view
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
      rule.schedules.forEach(schedule => addScheduleField(schedule.startTime, schedule.endTime));
    } else {
      addScheduleField(); // Add at least one empty schedule field
    }

    editingRuleId = rule ? rule.id : null;
    showView(ruleEditorView);
  };

  // --- Schedule Management in Editor ---
  const addScheduleField = (startTime = '', endTime = '') => {
    const scheduleItem = document.createElement('div');
    scheduleItem.className = 'schedule-item';
    scheduleItem.innerHTML = `
      <label>From <input type="time" class="start-time" value="${startTime}" required></label>
      <label>To <input type="time" class="end-time" value="${endTime}" required></label>
      <button type="button" class="remove-schedule-btn">Remove</button>
    `;
    schedulesContainer.appendChild(scheduleItem);

    scheduleItem.querySelector('.remove-schedule-btn').addEventListener('click', (e) => {
      if (schedulesContainer.children.length > 1) { // Ensure at least one schedule remains
        e.target.closest('.schedule-item').remove();
      } else {
        alert('At least one schedule is required.');
      }
    });
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
          showRuleEditorView(rule);
        });
        
        listItem.querySelector('.delete-btn').addEventListener('click', () => {
          deleteRule(rule.id);
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
  addNewRuleBtn.addEventListener('click', () => showRuleEditorView());
  addScheduleBtn.addEventListener('click', () => addScheduleField());
  cancelEditBtn.addEventListener('click', () => showRuleListView());

  ruleForm.addEventListener('submit', (e) => {
    e.preventDefault();
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

  forceCheckBtn.addEventListener('click', () => {
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

      setTimeout(() => {
        statusMessage.textContent = '';
      }, 3000);
    });
  });

  // Initial load
  showRuleListView();
});
