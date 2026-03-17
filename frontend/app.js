const toastEl = document.getElementById('toast');
const modalEl = document.getElementById('modal');
const API_BASE = String(window.__API_BASE_URL__ || '').replace(/\/$/, '');

// Modal & Confirmation Management
let pendingConfirmAction = null;

function showModal(title, message, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-message').textContent = message;
  pendingConfirmAction = onConfirm;
  modalEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
  document.getElementById('modal-confirm').focus();
}

function hideModal() {
  modalEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');
  pendingConfirmAction = null;
}

// Button loading state
function setLoading(button, isLoading) {
  if (isLoading) {
    button.classList.add('btn-loading');
    button.disabled = true;
  } else {
    button.classList.remove('btn-loading');
    button.disabled = false;
  }
}

// Keyboard shortcuts
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideModal();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      const activeTab = document.querySelector('.tab.active');
      if (activeTab.id === 'tab-editor') document.getElementById('workflow-save-button')?.click();
      if (activeTab.id === 'tab-rules') document.getElementById('rule-save-button')?.click();
    }
  });
}

// Modal event listeners
document.getElementById('modal-cancel').addEventListener('click', hideModal);
document.getElementById('modal-confirm').addEventListener('click', () => {
  if (pendingConfirmAction) pendingConfirmAction();
  hideModal();
});
modalEl.addEventListener('click', (e) => {
  if (e.target === modalEl) hideModal();
});

// Initialize keyboard shortcuts on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupKeyboardShortcuts);
} else {
  setupKeyboardShortcuts();
}

function withApiBase(path) {
  if (/^https?:\/\//i.test(path)) return path;
  if (!path.startsWith('/')) return `${API_BASE}/${path}`;
  return `${API_BASE}${path}`;
}

const state = {
  authToken: localStorage.getItem('authToken') || '',
  authRole: localStorage.getItem('authRole') || '',
  authUsername: localStorage.getItem('authUsername') || '',
  workflows: [],
  workflowPage: 1,
  workflowLimit: 10,
  workflowSearch: '',
  workflowFilter: 'all',
  workflowPagination: { page: 1, totalPages: 1, total: 0 },
  auditExecutions: [],
  auditFilterStatus: 'all',
  auditSearch: '',
  selectedWorkflowId: '',
  selectedWorkflow: null,
  selectedSteps: [],
  selectedRules: [],
  selectedRuleStepId: ''
};

let auditRefreshTimer = null;

function persistAuthState() {
  if (state.authToken) {
    localStorage.setItem('authToken', state.authToken);
    localStorage.setItem('authRole', state.authRole || '');
    localStorage.setItem('authUsername', state.authUsername || '');
    return;
  }

  localStorage.removeItem('authToken');
  localStorage.removeItem('authRole');
  localStorage.removeItem('authUsername');
}

function clearAuthState() {
  state.authToken = '';
  state.authRole = '';
  state.authUsername = '';
  persistAuthState();
}

function updateAuthStatus() {
  const statusEl = document.getElementById('auth-status');
  const loggedIn = Boolean(state.authToken);
  const displayName = state.authUsername || 'unknown';
  const displayRole = state.authRole || 'unknown';

  statusEl.textContent = loggedIn
    ? `Logged in as ${displayName} (${displayRole})`
    : 'Not logged in';
}

function canStartExecution() {
  return state.authRole === 'employee';
}

function canManageExecution() {
  return state.authRole === 'manager';
}

function applyRoleVisibility() {
  const executeSubmitButton = document.querySelector('#execute-form button[type="submit"]');
  const managerOnlyButtonIds = ['cancel-execution', 'retry-execution', 'approve-execution', 'reject-execution'];

  if (executeSubmitButton) {
    executeSubmitButton.style.display = canStartExecution() ? '' : 'none';
  }

  managerOnlyButtonIds.forEach((id) => {
    const button = document.getElementById(id);
    if (!button) return;
    button.style.display = canManageExecution() ? '' : 'none';
  });

  document.querySelectorAll('[data-action="execute-workflow"]').forEach((button) => {
    button.style.display = canStartExecution() ? '' : 'none';
  });
}

function updateOverviewMetrics() {
  const workflowCountEl = document.getElementById('overview-workflow-count');
  const workflowNoteEl = document.getElementById('overview-workflow-note');
  const activeCountEl = document.getElementById('overview-active-count');
  const activeNoteEl = document.getElementById('overview-active-note');
  const executionCountEl = document.getElementById('overview-execution-count');
  const executionNoteEl = document.getElementById('overview-execution-note');
  const selectionTitleEl = document.getElementById('overview-selection-title');
  const selectionNoteEl = document.getElementById('overview-selection-note');

  const totalWorkflows = Number(state.workflowPagination?.total || state.workflows.length || 0);
  const activeWorkflows = state.workflows.filter(item => item.isActive === true).length;
  const totalExecutions = state.auditExecutions.length;
  const selectedRules = state.selectedRules.length;
  const selectedSteps = state.selectedSteps.length;

  workflowCountEl.textContent = String(totalWorkflows);
  workflowNoteEl.textContent = `Page ${state.workflowPagination.page} of ${state.workflowPagination.totalPages}`;
  activeCountEl.textContent = String(activeWorkflows);
  activeNoteEl.textContent = state.workflowFilter === 'all' ? 'Visible active flows' : `Filter: ${state.workflowFilter}`;
  executionCountEl.textContent = String(totalExecutions);
  executionNoteEl.textContent = totalExecutions > 0 ? 'Audit entries loaded' : 'Load audit data to inspect runs';

  if (state.selectedWorkflow) {
    selectionTitleEl.textContent = state.selectedWorkflow.name || 'Selected workflow';
    selectionNoteEl.textContent = `${selectedSteps} steps configured${selectedRules ? `, ${selectedRules} rules loaded` : ''}`;
    return;
  }

  selectionTitleEl.textContent = 'No workflow selected';
  selectionNoteEl.textContent = 'Choose a workflow to inspect steps and execution context.';
}

function toast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.style.background = isError ? '#b91c1c' : '#111827';
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2000);
}

async function api(path, options = {}) {
  const {
    omitAuth = false,
    headers: customHeaders = {},
    ...fetchOptions
  } = options;

  const headers = {
    'Content-Type': 'application/json',
    ...customHeaders
  };

  if (!omitAuth && state.authToken) {
    headers.Authorization = `Bearer ${state.authToken}`;
  }

  const response = await fetch(withApiBase(path), {
    ...fetchOptions,
    headers
  });

  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    clearAuthState();
    updateAuthStatus();
    applyRoleVisibility();
  }

  if (!response.ok) throw new Error(data.message || 'Request failed');
  return data;
}

async function handleLogin(event) {
  event.preventDefault();
  const username = String(document.getElementById('login-username').value || '').trim();
  const password = String(document.getElementById('login-password').value || '');

  if (!username || !password) {
    toast('Username and password required', true);
    return;
  }

  try {
    const result = await api('/auth/login', {
      method: 'POST',
      omitAuth: true,
      body: JSON.stringify({ username, password })
    });

    state.authToken = result?.token || '';
    state.authRole = result?.user?.role || '';
    state.authUsername = result?.user?.username || username;
    persistAuthState();
    updateAuthStatus();
    applyRoleVisibility();
    document.getElementById('login-password').value = '';
    toast(`Logged in as ${state.authUsername} (${state.authRole})`);
    await loadWorkflows();
    await loadAudit();
  } catch (error) {
    toast(error.message, true);
  }
}

async function handleLogout() {
  try {
    if (state.authToken) {
      await api('/auth/logout', { method: 'POST' });
    }
  } catch {
  } finally {
    clearAuthState();
    updateAuthStatus();
    applyRoleVisibility();
    toast('Logged out');
  }
}

function safeJson(text, fallback = {}) {
  try { return JSON.parse(text || '{}'); } catch { return fallback; }
}

function isLikelyUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

async function copyText(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }

    const area = document.createElement('textarea');
    area.value = value;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    return true;
  } catch {
    return false;
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setActiveTab(tabName) {
  tabButtons.forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  tabSections.forEach(s => s.classList.toggle('active', s.id === `tab-${tabName}`));
}

function renderStatusPill(value, isActiveValue = null) {
  const normalized = typeof value === 'string' ? value : (isActiveValue ? 'active' : 'inactive');
  const statusClass = String(normalized).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const className = `status-pill status-${statusClass}`;
  return `<span class="${className}">${escapeHtml(normalized)}</span>`;
}

function getRequiredActionText(execution) {
  if (!execution) return '-';
  if (execution.status === 'pending_approval') return 'Approve or reject current step';
  if (execution.status === 'failed') return 'Retry failed step';
  if (execution.status === 'in_progress') return 'Monitor current step';
  if (execution.status === 'canceled') return 'No action (canceled)';
  if (execution.status === 'completed') return 'No action (completed)';
  return 'Start or monitor execution';
}

function renderExecutionDetails(execution) {
  const progressIds = {
    executionId: document.getElementById('progress-execution-id'),
    workflowId: document.getElementById('progress-workflow-id'),
    status: document.getElementById('progress-status'),
    currentStep: document.getElementById('progress-current-step'),
    retries: document.getElementById('progress-retries'),
    requiredAction: document.getElementById('progress-required-action')
  };

  if (!execution) {
    progressIds.executionId.textContent = '-';
    progressIds.workflowId.textContent = '-';
    progressIds.status.textContent = '-';
    progressIds.currentStep.textContent = '-';
    progressIds.retries.textContent = '-';
    progressIds.requiredAction.textContent = '-';
    document.getElementById('summary-step-count').textContent = '-';
    document.getElementById('summary-completed-steps').textContent = '-';
    document.getElementById('summary-failed-steps').textContent = '-';
    document.getElementById('summary-duration').textContent = '-';
    const approveButton = document.getElementById('approve-execution');
    const rejectButton = document.getElementById('reject-execution');
    if (approveButton) approveButton.disabled = true;
    if (rejectButton) rejectButton.disabled = true;
    document.getElementById('execution-logs').innerHTML = '<div class="item">No logs</div>';
    document.getElementById('execution-output').textContent = '';
    return;
  }

  progressIds.executionId.textContent = execution.id || '-';
  progressIds.workflowId.textContent = execution.workflowId || '-';
  progressIds.status.innerHTML = renderStatusPill(execution.status);
  progressIds.currentStep.textContent = execution.currentStepId || 'None';
  progressIds.retries.textContent = String(execution.retries ?? 0);
  progressIds.requiredAction.textContent = getRequiredActionText(execution);

  const pendingApproval = execution.status === 'pending_approval';
  const approveButton = document.getElementById('approve-execution');
  const rejectButton = document.getElementById('reject-execution');
  if (approveButton) approveButton.disabled = !pendingApproval;
  if (rejectButton) rejectButton.disabled = !pendingApproval;

  const logs = Array.isArray(execution.logs) ? execution.logs : [];
  const logsContainer = document.getElementById('execution-logs');
  logsContainer.innerHTML = logs.map((log, index) => `
    <div class="item">
      <b>[Step ${index + 1}] ${escapeHtml(log.stepName || log.stepId || 'Unknown Step')}</b>
      <div class="meta">Type: ${escapeHtml(log.stepType || '-')} | Status: ${escapeHtml(log.status || '-')}</div>
      <div>Selected Next Step: ${escapeHtml(log.selectedNextStep || 'END')}</div>
      <div>Error: ${escapeHtml(log.errorMessage || 'None')}</div>
      <div>Duration: ${Number(log.durationMs ?? 0)} ms</div>
      <details>
        <summary>Evaluated Rules</summary>
        <pre class="output small">${escapeHtml(JSON.stringify(log.evaluatedRules || [], null, 2))}</pre>
      </details>
    </div>
  `).join('') || '<div class="item">No logs</div>';

  document.getElementById('execution-output').textContent = JSON.stringify(execution, null, 2);
}

function formatSchema(schema) {
  try {
    return JSON.stringify(schema, null, 2);
  } catch {
    return '{}';
  }
}

function resetRuleForm() {
  document.getElementById('rule-id').value = '';
  document.getElementById('rule-condition').value = '';
  document.getElementById('rule-next-step-id').value = '';
  document.getElementById('rule-priority').value = Math.max((state.selectedRules?.length || 0) + 1, 1);
  document.getElementById('rule-next-step-select').value = '';
  const msg = document.getElementById('rule-syntax-message');
  msg.textContent = 'Syntax validation pending';
  msg.className = 'meta';
}

function renderRuleStepSelectors() {
  const stepSelect = document.getElementById('rule-step-select');
  const nextStepSelect = document.getElementById('rule-next-step-select');
  const stepOptions = (state.selectedSteps || []).slice().sort((a, b) => Number(a.order) - Number(b.order));

  stepSelect.innerHTML = '<option value="">Choose a step from selected workflow</option>';
  nextStepSelect.innerHTML = '<option value="">END (empty next step)</option>';

  stepOptions.forEach((step) => {
    const label = `${Number(step.order)}. ${step.name} (${step.id})`;
    stepSelect.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(step.id)}">${escapeHtml(label)}</option>`);
    nextStepSelect.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(step.id)}">${escapeHtml(label)}</option>`);
  });
}

function setExecutionDemoPayload() {
  document.getElementById('exec-data').value = JSON.stringify({
    amount: 250,
    country: 'US',
    priority: 'High'
  }, null, 2);
}

function validateRuleConditionSyntax(condition) {
  if (!condition || !condition.trim()) {
    return { valid: false, message: 'Condition is required' };
  }

  if (condition.trim().toUpperCase() === 'DEFAULT') {
    return { valid: true, message: 'DEFAULT rule syntax is valid' };
  }

  const text = condition.trim();

  if (/[`;\\]/.test(text) || /\b(?:new|this|window|document|globalThis|Function|eval)\b/.test(text)) {
    return { valid: false, message: 'Invalid condition syntax: disallowed token' };
  }

  if (!/^[\w\s.$'"=!<>()&|,+\-*/%\[\]]+$/.test(text)) {
    return { valid: false, message: 'Invalid condition syntax: unsupported characters' };
  }

  const stack = [];
  const pairs = { ')': '(', ']': '[', '}': '{' };
  for (const char of text) {
    if (char === '(' || char === '[' || char === '{') stack.push(char);
    if (char === ')' || char === ']' || char === '}') {
      if (stack.pop() !== pairs[char]) {
        return { valid: false, message: 'Invalid condition syntax: unbalanced brackets' };
      }
    }
  }

  if (stack.length > 0) {
    return { valid: false, message: 'Invalid condition syntax: unbalanced brackets' };
  }

  return { valid: true, message: 'Condition syntax looks valid' };
}

function showRuleSyntaxMessage(result) {
  const msg = document.getElementById('rule-syntax-message');
  msg.textContent = result.message;
  msg.className = `meta ${result.valid ? 'ok' : 'error'}`;
}

function renderRuleTable() {
  const tableBody = document.getElementById('rule-table-body');
  tableBody.innerHTML = state.selectedRules.map(rule => `
    <tr class="rule-row" draggable="true" data-rule-id="${escapeHtml(rule.id)}">
      <td><span class="priority-badge">${Number(rule.priority)}</span><span class="drag-hint">drag</span></td>
      <td><code>${escapeHtml(rule.condition)}</code></td>
      <td>${escapeHtml(rule.nextStepId || 'END')}</td>
      <td>
        <div class="actions">
          <button class="secondary" data-action="edit-rule" data-id="${escapeHtml(rule.id)}">Edit</button>
          <button class="danger" data-action="delete-rule" data-id="${escapeHtml(rule.id)}">Delete</button>
        </div>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="4">No rules available</td></tr>';

  attachRuleDragHandlers();
}

function attachRuleDragHandlers() {
  const rows = Array.from(document.querySelectorAll('.rule-row'));
  rows.forEach(row => {
    row.addEventListener('dragstart', () => row.classList.add('dragging'));
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (event) => {
      event.preventDefault();
      const dragging = document.querySelector('.rule-row.dragging');
      if (!dragging || dragging === row) return;

      const rowRect = row.getBoundingClientRect();
      const shouldInsertBefore = event.clientY < rowRect.top + rowRect.height / 2;
      row.parentElement.insertBefore(dragging, shouldInsertBefore ? row : row.nextSibling);
    });
  });
}

async function persistRuleReorder() {
  const idsInOrder = Array.from(document.querySelectorAll('.rule-row')).map(row => row.dataset.ruleId);
  if (idsInOrder.length <= 1) return;

  for (let i = 0; i < idsInOrder.length; i += 1) {
    const id = idsInOrder[i];
    const rule = state.selectedRules.find(item => item.id === id);
    if (!rule) continue;
    await api(`/rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify({
        condition: rule.condition,
        nextStepId: rule.nextStepId,
        priority: i + 1
      })
    });
  }

  toast('Rule priorities reordered');
  await loadRules();
}

// Tabs
const tabButtons = document.querySelectorAll('.tabs button');
const tabSections = document.querySelectorAll('.tab');
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    setActiveTab(btn.dataset.tab);
  });
});

// Workflows
async function loadWorkflows() {
  const response = await api(`/workflows?search=${encodeURIComponent(state.workflowSearch)}&page=${state.workflowPage}&limit=${state.workflowLimit}`);
  const rawItems = response.items || [];
  const filteredItems = rawItems.filter(item => {
    if (state.workflowFilter === 'active') return item.isActive === true;
    if (state.workflowFilter === 'inactive') return item.isActive === false;
    return true;
  });

  state.workflows = filteredItems;
  state.workflowPagination = response.pagination || { page: 1, totalPages: 1, total: filteredItems.length };
  updateOverviewMetrics();

  const tableBody = document.getElementById('workflow-table-body');
  tableBody.innerHTML = filteredItems.map(w => `
    <tr>
      <td><div>${escapeHtml(w.id)}</div></td>
      <td>
        <div><b>${escapeHtml(w.name)}</b></div>
        <div class="meta">${escapeHtml(w.description || 'No description')}</div>
      </td>
      <td>${Array.isArray(w.steps) ? Number(w.steps.length) : '-'}</td>
      <td>${escapeHtml(w.version)}</td>
      <td>${renderStatusPill(null, w.isActive)}</td>
      <td>
        <div class="actions">
          <button class="secondary" data-action="edit-workflow" data-id="${escapeHtml(w.id)}">Edit</button>
          <button data-action="execute-workflow" data-id="${escapeHtml(w.id)}">Execute</button>
        </div>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="6">No workflows found</td></tr>';

  applyRoleVisibility();

  document.getElementById('workflow-page-label').textContent = `Page ${state.workflowPagination.page} of ${state.workflowPagination.totalPages}`;
  document.getElementById('workflow-prev-page').disabled = state.workflowPagination.page <= 1;
  document.getElementById('workflow-next-page').disabled = state.workflowPagination.page >= state.workflowPagination.totalPages;
}

async function loadWorkflowDetail(id) {
  const workflow = await api(`/workflows/${id}`);
  state.selectedWorkflowId = id;
  state.selectedWorkflow = workflow;
  state.selectedSteps = workflow.steps || [];
  state.selectedRules = [];

  document.getElementById('wf-id').value = workflow.id;
  document.getElementById('wf-name').value = workflow.name || '';
  document.getElementById('wf-description').value = workflow.description || '';
  document.getElementById('wf-schema').value = formatSchema(workflow.inputSchema || {});
  document.getElementById('step-workflow-id').value = workflow.id;
  document.getElementById('step-list-workflow-id').value = workflow.id;
  document.getElementById('exec-workflow-id').value = workflow.id;
  document.getElementById('workflow-detail-output').textContent = JSON.stringify(workflow, null, 2);

  renderStepTable();
  renderRuleStepSelectors();
  updateOverviewMetrics();
}

function resetWorkflowForm() {
  document.getElementById('wf-id').value = '';
  document.getElementById('wf-name').value = '';
  document.getElementById('wf-description').value = '';
  document.getElementById('wf-schema').value = '{"amount":{"type":"number","required":true},"country":{"type":"string","required":true},"priority":{"type":"string","required":true,"allowed_values":["High","Medium","Low"]}}';
  document.getElementById('workflow-detail-output').textContent = 'Select a workflow to edit or create a new one.';
  state.selectedWorkflowId = '';
  state.selectedWorkflow = null;
  state.selectedSteps = [];
  state.selectedRules = [];
  renderStepTable();
  renderRuleStepSelectors();
  updateOverviewMetrics();
}

function resetStepForm() {
  document.getElementById('step-id').value = '';
  document.getElementById('step-name').value = '';
  document.getElementById('step-type').value = 'task';
  document.getElementById('step-order').value = 1;
  document.getElementById('step-metadata').value = '{"note":"optional"}';
}

function fillStepForm(step) {
  document.getElementById('step-id').value = step.id;
  document.getElementById('step-workflow-id').value = step.workflowId;
  document.getElementById('step-name').value = step.name;
  document.getElementById('step-type').value = step.stepType;
  document.getElementById('step-order').value = step.order;
  document.getElementById('step-metadata').value = formatSchema(step.metadata || {});
}

function renderStepTable() {
  const tableBody = document.getElementById('step-table-body');
  tableBody.innerHTML = state.selectedSteps.map(step => `
    <tr>
      <td>${Number(step.order)}</td>
      <td>
        <div><b>${escapeHtml(step.name)}</b></div>
        <div class="meta">${escapeHtml(step.id)}</div>
      </td>
      <td>${escapeHtml(step.stepType)}</td>
      <td><code>${escapeHtml(JSON.stringify(step.metadata || {}))}</code></td>
      <td>
        <div class="actions">
          <button class="secondary" data-action="edit-step" data-id="${escapeHtml(step.id)}">Edit</button>
          <button class="secondary" data-action="copy-step-id" data-id="${escapeHtml(step.id)}">Copy ID</button>
          <button class="secondary" data-action="use-step-in-rules" data-id="${escapeHtml(step.id)}">Use in Rules</button>
          <button class="danger" data-action="delete-step" data-id="${escapeHtml(step.id)}">Delete</button>
        </div>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5">No steps yet</td></tr>';
}

document.getElementById('workflow-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const id = document.getElementById('wf-id').value.trim();
    const payload = {
      name: document.getElementById('wf-name').value,
      description: document.getElementById('wf-description').value || null,
      inputSchema: safeJson(document.getElementById('wf-schema').value, {})
    };

    const workflow = id
      ? await api(`/workflows/${id}`, { method: 'PUT', body: JSON.stringify(payload) })
      : await api('/workflows', { method: 'POST', body: JSON.stringify(payload) });

    toast(id ? 'Workflow updated' : 'Workflow created');
    setActiveTab('editor');
    await loadWorkflows();
    await loadWorkflowDetail(workflow.id);
  } catch (error) {
    toast(error.message, true);
  }
});

document.getElementById('workflow-search-button').addEventListener('click', async () => {
  state.workflowSearch = document.getElementById('workflow-search').value.trim();
  state.workflowFilter = document.getElementById('workflow-status-filter').value;
  state.workflowLimit = Number(document.getElementById('workflow-limit').value);
  state.workflowPage = 1;
  try {
    await loadWorkflows();
  } catch (error) {
    toast(error.message, true);
  }
});

document.getElementById('workflow-prev-page').addEventListener('click', async () => {
  if (state.workflowPage > 1) {
    state.workflowPage -= 1;
    await loadWorkflows();
  }
});

document.getElementById('workflow-next-page').addEventListener('click', async () => {
  if (state.workflowPage < state.workflowPagination.totalPages) {
    state.workflowPage += 1;
    await loadWorkflows();
  }
});

function openWorkflowEditor() {
  resetWorkflowForm();
  resetStepForm();
  setActiveTab('editor');
}

document.getElementById('open-workflow-editor').addEventListener('click', openWorkflowEditor);
document.getElementById('open-workflow-editor-secondary').addEventListener('click', openWorkflowEditor);

document.getElementById('back-to-workflows').addEventListener('click', () => setActiveTab('workflows'));
document.getElementById('workflow-reset-button').addEventListener('click', resetWorkflowForm);

document.getElementById('workflow-delete-button').addEventListener('click', async () => {
  const deleteButton = document.getElementById('workflow-delete-button');
  const id = document.getElementById('wf-id').value.trim();
  if (!id) return toast('Select a workflow first', true);
  const workflowName = document.getElementById('wf-name').value || 'this workflow';
  showModal('Delete Workflow?', `Are you sure you want to delete "${workflowName}"? This cannot be undone.`, async () => {
    try {
      setLoading(deleteButton, true);
      await api(`/workflows/${id}`, { method: 'DELETE' });
      toast('Workflow deleted');
      resetWorkflowForm();
      await loadWorkflows();
      setActiveTab('workflows');
      setLoading(deleteButton, false);
    } catch (error) {
      toast(error.message, true);
      setLoading(deleteButton, false);
    }
  });
});

document.getElementById('workflow-table-body').addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;

  const action = button.dataset.action;
  const id = button.dataset.id;

  try {
    if (action === 'edit-workflow') {
      await loadWorkflowDetail(id);
      resetStepForm();
      setActiveTab('editor');
    }

    if (action === 'execute-workflow') {
      document.getElementById('exec-workflow-id').value = id;
      setActiveTab('execute');
    }
  } catch (error) {
    toast(error.message, true);
  }
});

// Steps
async function loadSteps() {
  const workflowId = document.getElementById('step-list-workflow-id').value.trim();
  if (!workflowId) return toast('Enter workflow id', true);

  try {
    const steps = await api(`/workflows/${workflowId}/steps`);
    const list = document.getElementById('step-list');
    list.innerHTML = steps.map(s => `<div class="item"><b>${escapeHtml(s.name)}</b><br/>id: ${escapeHtml(s.id)}<br/>type: ${escapeHtml(s.stepType)}<br/>order: ${Number(s.order)}</div>`).join('') || '<div class="item">No steps</div>';

    if (state.selectedWorkflowId === workflowId) {
      state.selectedSteps = steps;
      renderStepTable();
      renderRuleStepSelectors();
    }
  } catch (error) {
    toast(error.message, true);
  }
}

document.getElementById('step-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const stepId = document.getElementById('step-id').value.trim();
    const workflowId = document.getElementById('step-workflow-id').value.trim();
    const payload = {
      name: document.getElementById('step-name').value,
      stepType: document.getElementById('step-type').value,
      order: Number(document.getElementById('step-order').value),
      metadata: safeJson(document.getElementById('step-metadata').value, {})
    };

    await api(stepId ? `/steps/${stepId}` : `/workflows/${workflowId}/steps`, {
      method: stepId ? 'PUT' : 'POST',
      body: JSON.stringify(payload)
    });

    toast(stepId ? 'Step updated' : 'Step created');
    resetStepForm();
    if (workflowId) {
      document.getElementById('step-list-workflow-id').value = workflowId;
      await loadSteps();
      if (state.selectedWorkflowId === workflowId) {
        await loadWorkflowDetail(workflowId);
      }
    }
  } catch (error) {
    toast(error.message, true);
  }
});

document.getElementById('load-steps').addEventListener('click', loadSteps);
document.getElementById('step-reset-button').addEventListener('click', resetStepForm);

document.getElementById('step-table-body').addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;

  const action = button.dataset.action;
  const id = button.dataset.id;
  const step = state.selectedSteps.find(item => item.id === id);
  if (!step) return;

  try {
    if (action === 'edit-step') {
      fillStepForm(step);
    }

    if (action === 'copy-step-id') {
      const copied = await copyText(step.id);
      toast(copied ? 'Step ID copied' : 'Unable to copy step ID', !copied);
    }

    if (action === 'use-step-in-rules') {
      document.getElementById('rule-step-id').value = step.id;
      document.getElementById('rule-list-step-id').value = step.id;
      document.getElementById('rule-step-select').value = step.id;
      setActiveTab('rules');
      toast('Step ID applied in Rules');
    }

    if (action === 'delete-step') {
      const step = state.selectedSteps.find(s => s.id === id);
      const stepName = step?.name || 'this step';
      showModal('Delete Step?', `Are you sure you want to delete the step "${stepName}"?`, async () => {
        try {
          await api(`/steps/${id}`, { method: 'DELETE' });
          toast('Step deleted');
          await loadWorkflowDetail(state.selectedWorkflowId);
          resetStepForm();
        } catch (error) {
          toast(error.message, true);
        }
      });
    }
  } catch (error) {
    toast(error.message, true);
  }
});

// Rules
async function loadRules() {
  const stepId = document.getElementById('rule-list-step-id').value.trim() || document.getElementById('rule-step-id').value.trim();
  if (!stepId) return toast('Enter step id', true);
  if (!isLikelyUuid(stepId)) return toast('Use a valid Step ID (UUID)', true);

  try {
    const rules = await api(`/steps/${stepId}/rules`);
    state.selectedRuleStepId = stepId;
    state.selectedRules = (rules || []).slice().sort((a, b) => a.priority - b.priority);
    document.getElementById('rule-step-id').value = stepId;
    document.getElementById('rule-list-step-id').value = stepId;
    renderRuleTable();
    resetRuleForm();
    updateOverviewMetrics();
  } catch (error) {
    toast(error.message, true);
  }
}

document.getElementById('rule-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const ruleId = document.getElementById('rule-id').value.trim();
    const stepId = document.getElementById('rule-step-id').value.trim();
    document.getElementById('rule-list-step-id').value = stepId;

    if (!isLikelyUuid(stepId)) {
      return toast('Step ID must be a valid UUID', true);
    }

    const condition = document.getElementById('rule-condition').value;
    const syntax = validateRuleConditionSyntax(condition);
    showRuleSyntaxMessage(syntax);
    if (!syntax.valid) return;

    const rawNext = document.getElementById('rule-next-step-id').value.trim();
    if (rawNext && !isLikelyUuid(rawNext)) {
      return toast('Next Step ID must be a valid UUID or empty', true);
    }

    const payload = {
      condition,
      nextStepId: rawNext || null,
      priority: Number(document.getElementById('rule-priority').value)
    };

    await api(ruleId ? `/rules/${ruleId}` : `/steps/${stepId}/rules`, {
      method: ruleId ? 'PUT' : 'POST',
      body: JSON.stringify({
        ...payload
      })
    });

    toast(ruleId ? 'Rule updated' : 'Rule created');
    await loadRules();
  } catch (error) {
    toast(error.message, true);
  }
});

document.getElementById('load-rules').addEventListener('click', loadRules);
document.getElementById('rule-reset-button').addEventListener('click', resetRuleForm);

document.getElementById('rule-condition').addEventListener('input', (event) => {
  const result = validateRuleConditionSyntax(event.target.value);
  showRuleSyntaxMessage(result);
});

document.getElementById('rule-step-select').addEventListener('change', (event) => {
  const value = event.target.value || '';
  document.getElementById('rule-step-id').value = value;
  document.getElementById('rule-list-step-id').value = value;
});

document.getElementById('rule-next-step-select').addEventListener('change', (event) => {
  const value = event.target.value || '';
  document.getElementById('rule-next-step-id').value = value;
});

document.getElementById('rule-quick-default').addEventListener('click', () => {
  document.getElementById('rule-condition').value = 'DEFAULT';
  showRuleSyntaxMessage(validateRuleConditionSyntax('DEFAULT'));
});

document.getElementById('rule-quick-high-us').addEventListener('click', () => {
  const condition = 'amount > 100 && country == "US" && priority == "High"';
  document.getElementById('rule-condition').value = condition;
  showRuleSyntaxMessage(validateRuleConditionSyntax(condition));
});

document.getElementById('rule-table-body').addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button) return;

  const action = button.dataset.action;
  const id = button.dataset.id;
  const rule = state.selectedRules.find(item => item.id === id);
  if (!rule) return;

  try {
    if (action === 'edit-rule') {
      document.getElementById('rule-id').value = rule.id;
      document.getElementById('rule-step-id').value = rule.stepId;
      document.getElementById('rule-step-select').value = rule.stepId;
      document.getElementById('rule-condition').value = rule.condition;
      document.getElementById('rule-next-step-id').value = rule.nextStepId || '';
      document.getElementById('rule-next-step-select').value = rule.nextStepId || '';
      document.getElementById('rule-priority').value = rule.priority;
      showRuleSyntaxMessage(validateRuleConditionSyntax(rule.condition));
    }

    if (action === 'delete-rule') {
      const rule = state.selectedRules.find(r => r.id === id);
      const ruleCondition = rule?.condition || 'this rule';
      showModal('Delete Rule?', `Are you sure you want to delete the rule "${ruleCondition}"?`, async () => {
        try {
          await api(`/rules/${id}`, { method: 'DELETE' });
          toast('Rule deleted');
          await loadRules();
        } catch (error) {
          toast(error.message, true);
        }
      });
    }
  } catch (error) {
    toast(error.message, true);
  }
});

document.getElementById('rule-table-body').addEventListener('drop', async () => {
  try {
    await persistRuleReorder();
  } catch (error) {
    toast(error.message, true);
  }
});

// Execute

document.getElementById('execute-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!canStartExecution()) {
    toast('Only employee can start execution', true);
    return;
  }
  try {
    const workflowId = document.getElementById('exec-workflow-id').value.trim();
    const execution = await api(`/workflows/${workflowId}/execute`, {
      method: 'POST',
      body: JSON.stringify({
        triggeredBy: document.getElementById('exec-triggered-by').value || null,
        data: safeJson(document.getElementById('exec-data').value, {}),
        maxIterations: Number(document.getElementById('exec-max-iterations').value || 100)
      })
    });
    document.getElementById('execution-id').value = execution.id;
    renderExecutionDetails(execution);
    toast('Execution started');
  } catch (error) {
    toast(error.message, true);
  }
});

async function loadExecution() {
  const executionId = document.getElementById('execution-id').value.trim();
  if (!executionId) return toast('Enter execution id', true);
  try {
    const execution = await api(`/executions/${executionId}`);
    renderExecutionDetails(execution);
    await loadExecutionSummary();
  } catch (error) {
    toast(error.message, true);
  }
}

async function cancelExecution() {
  if (!canManageExecution()) {
    toast('Only manager can cancel execution', true);
    return;
  }
  const executionId = document.getElementById('execution-id').value.trim();
  if (!executionId) return toast('Enter execution id', true);
  try {
    const result = await api(`/executions/${executionId}/cancel`, { method: 'POST' });
    renderExecutionDetails(result);
    await loadExecutionSummary();
    toast('Execution canceled');
  } catch (error) {
    toast(error.message, true);
  }
}

async function retryExecution() {
  if (!canManageExecution()) {
    toast('Only manager can retry execution', true);
    return;
  }
  const executionId = document.getElementById('execution-id').value.trim();
  if (!executionId) return toast('Enter execution id', true);
  try {
    const result = await api(`/executions/${executionId}/retry`, {
      method: 'POST',
      body: JSON.stringify({ maxIterations: 100 })
    });
    renderExecutionDetails(result);
    await loadExecutionSummary();
    toast('Execution retried');
  } catch (error) {
    toast(error.message, true);
  }
}

async function approveExecution() {
  if (!canManageExecution()) {
    toast('Only manager can approve execution', true);
    return;
  }
  const executionId = document.getElementById('execution-id').value.trim();
  if (!executionId) return toast('Enter execution id', true);
  try {
    const result = await api(`/executions/${executionId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approvedBy: 'operator', comment: 'Approved from UI' })
    });
    renderExecutionDetails(result);
    await loadExecutionSummary();
    toast('Execution approved');
  } catch (error) {
    toast(error.message, true);
  }
}

async function rejectExecution() {
  if (!canManageExecution()) {
    toast('Only manager can reject execution', true);
    return;
  }
  const executionId = document.getElementById('execution-id').value.trim();
  if (!executionId) return toast('Enter execution id', true);
  try {
    const result = await api(`/executions/${executionId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ rejectedBy: 'operator', reason: 'Rejected from UI' })
    });
    renderExecutionDetails(result);
    await loadExecutionSummary();
    toast('Execution rejected');
  } catch (error) {
    toast(error.message, true);
  }
}

async function loadExecutionSummary() {
  const executionId = document.getElementById('execution-id').value.trim();
  if (!executionId) {
    document.getElementById('summary-step-count').textContent = '-';
    document.getElementById('summary-completed-steps').textContent = '-';
    document.getElementById('summary-failed-steps').textContent = '-';
    document.getElementById('summary-duration').textContent = '-';
    return;
  }

  try {
    const summary = await api(`/executions/${executionId}/summary`);
    document.getElementById('summary-step-count').textContent = String(summary.stepCount ?? 0);
    document.getElementById('summary-completed-steps').textContent = String(summary.completedSteps ?? 0);
    document.getElementById('summary-failed-steps').textContent = String(summary.failedSteps ?? 0);
    const durationMs = Number(summary.totalDurationMs ?? 0);
    document.getElementById('summary-duration').textContent = `${durationMs} ms`;
  } catch {
    document.getElementById('summary-step-count').textContent = '-';
    document.getElementById('summary-completed-steps').textContent = '-';
    document.getElementById('summary-failed-steps').textContent = '-';
    document.getElementById('summary-duration').textContent = '-';
  }
}

document.getElementById('load-execution').addEventListener('click', loadExecution);
document.getElementById('cancel-execution').addEventListener('click', cancelExecution);
document.getElementById('retry-execution').addEventListener('click', retryExecution);
document.getElementById('approve-execution').addEventListener('click', approveExecution);
document.getElementById('reject-execution').addEventListener('click', rejectExecution);
document.getElementById('load-execution-summary').addEventListener('click', loadExecutionSummary);
document.getElementById('exec-use-sample').addEventListener('click', () => {
  setExecutionDemoPayload();
  toast('Demo payload inserted');
});

// Audit
function getAuditActionButtons(execution) {
  const actions = [`<button data-action="view" data-execution-id="${escapeHtml(execution.id)}" class="secondary">View Logs</button>`];

  if (canManageExecution() && execution.status === 'pending_approval') {
    actions.push(`<button data-action="approve" data-execution-id="${escapeHtml(execution.id)}" class="secondary">Approve</button>`);
    actions.push(`<button data-action="reject" data-execution-id="${escapeHtml(execution.id)}" class="danger">Reject</button>`);
  }

  if (canManageExecution() && execution.status === 'failed') {
    actions.push(`<button data-action="retry" data-execution-id="${escapeHtml(execution.id)}">Retry</button>`);
  }

  if (canManageExecution() && execution.status === 'in_progress') {
    actions.push(`<button data-action="cancel" data-execution-id="${escapeHtml(execution.id)}" class="danger">Cancel</button>`);
  }

  return `<div class="actions">${actions.join('')}</div>`;
}

function applyAuditFilters(executions) {
  const normalizedSearch = state.auditSearch.trim().toLowerCase();

  return executions.filter((execution) => {
    const matchesStatus = state.auditFilterStatus === 'all' || execution.status === state.auditFilterStatus;
    if (!matchesStatus) return false;

    if (!normalizedSearch) return true;

    const executionId = String(execution.id || '').toLowerCase();
    const workflowId = String(execution.workflowId || '').toLowerCase();
    return executionId.includes(normalizedSearch) || workflowId.includes(normalizedSearch);
  });
}

function renderAuditTable(executions) {
  const tableBody = document.getElementById('audit-table-body');

  tableBody.innerHTML = executions.map(ex => {
    const workflowLabel = ex.workflowName || ex.workflowId || '-';
    const startedBy = ex.triggeredBy || '-';
    const startedAt = ex.startedAt ? new Date(ex.startedAt).toLocaleString() : '-';
    const endedAt = ex.endedAt ? new Date(ex.endedAt).toLocaleString() : '-';

    return `
      <tr>
        <td>${escapeHtml(ex.id)}</td>
        <td>${escapeHtml(workflowLabel)}</td>
        <td>${escapeHtml(ex.workflowVersion ?? '-')}</td>
        <td>${renderStatusPill(ex.status)}</td>
        <td>${escapeHtml(startedBy)}</td>
        <td>${escapeHtml(startedAt)}</td>
        <td>${escapeHtml(endedAt)}</td>
        <td>${getAuditActionButtons(ex)}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="8">No executions found</td></tr>';
}

async function executeAuditAction(action, executionId) {
  if (action === 'view') {
    document.getElementById('execution-id').value = executionId;
    setActiveTab('execute');
    await loadExecution();
    return;
  }

  if (!canManageExecution()) {
    toast('Only manager can perform this action', true);
    return;
  }

  if (action === 'approve') {
    await api(`/executions/${executionId}/approve`, {
      method: 'POST',
      body: JSON.stringify({ approvedBy: 'auditor', comment: 'Approved from audit tab' })
    });
    toast('Execution approved');
  }

  if (action === 'reject') {
    await api(`/executions/${executionId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ rejectedBy: 'auditor', reason: 'Rejected from audit tab' })
    });
    toast('Execution rejected');
  }

  if (action === 'retry') {
    await api(`/executions/${executionId}/retry`, {
      method: 'POST',
      body: JSON.stringify({ maxIterations: 100 })
    });
    toast('Execution retried');
  }

  if (action === 'cancel') {
    await api(`/executions/${executionId}/cancel`, { method: 'POST' });
    toast('Execution canceled');
  }

  await loadAudit();
}

function handleAuditAutoRefreshToggle() {
  const enabled = document.getElementById('audit-auto-refresh').checked;

  if (auditRefreshTimer) {
    clearInterval(auditRefreshTimer);
    auditRefreshTimer = null;
  }

  if (enabled) {
    auditRefreshTimer = setInterval(() => {
      loadAudit().catch(() => {});
    }, 5000);
  }
}

async function loadAudit() {
  try {
    const executions = await api('/executions');
    state.auditExecutions = Array.isArray(executions) ? executions : [];

    state.auditSearch = document.getElementById('audit-search').value || '';
    state.auditFilterStatus = document.getElementById('audit-status-filter').value || 'all';

    const filteredExecutions = applyAuditFilters(state.auditExecutions);
    renderAuditTable(filteredExecutions);
    updateOverviewMetrics();
  } catch (error) {
    toast(error.message, true);
  }
}

document.getElementById('load-audit').addEventListener('click', loadAudit);
document.getElementById('audit-status-filter').addEventListener('change', loadAudit);
document.getElementById('audit-search').addEventListener('input', loadAudit);
document.getElementById('audit-auto-refresh').addEventListener('change', handleAuditAutoRefreshToggle);
document.getElementById('auth-form').addEventListener('submit', handleLogin);
document.getElementById('logout-button').addEventListener('click', handleLogout);
document.getElementById('audit-table-body').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-execution-id]');
  if (!button) return;

  const action = button.dataset.action || 'view';
  const executionId = button.dataset.executionId;

  try {
    if (action === 'cancel' || action === 'reject') {
      const label = action === 'cancel' ? 'Cancel Execution?' : 'Reject Execution?';
      const message = action === 'cancel'
        ? `Cancel execution ${executionId}?`
        : `Reject execution ${executionId}?`;

      showModal(label, message, async () => {
        try {
          await executeAuditAction(action, executionId);
        } catch (error) {
          toast(error.message, true);
        }
      });
      return;
    }

    await executeAuditAction(action, executionId);
  } catch (error) {
    toast(error.message, true);
  }
});

// Initial load
resetWorkflowForm();
resetStepForm();
resetRuleForm();
renderRuleStepSelectors();
setExecutionDemoPayload();
renderExecutionDetails(null);
updateOverviewMetrics();
updateAuthStatus();
applyRoleVisibility();

if (state.authToken) {
  loadWorkflows().catch(error => toast(error.message, true));
  loadAudit().catch(error => toast(error.message, true));
} else {
  toast('Login as employee or manager to continue');
}
