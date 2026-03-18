// app.js — EE Graph Studio shared core + mode registry

(() => {

  // --- State ---
  let conversationId = null;
  let isStreaming = false;
  const decisions = [];

  // --- Mode Registry ---
  const modes = {};
  let activeMode = null;

  // --- DOM refs ---
  const $messages = document.getElementById('messages');
  const $chatInput = document.getElementById('chatInput');
  const $chatSend = document.getElementById('chatSend');
  const $canvasEmpty = document.getElementById('canvasEmpty');
  const $scenarioTitle = document.getElementById('scenarioTitle');
  const $zoomFit = document.getElementById('zoomFit');
  const $decisionLog = document.getElementById('decisionLog');
  const $dlToggle = document.getElementById('dlToggle');
  const $dlContent = document.getElementById('dlContent');
  const $dlCount = document.getElementById('dlCount');
  const $dlEmpty = document.getElementById('dlEmpty');
  const $dlExecute = document.getElementById('dlExecute');
  const $dlExecuteCount = document.getElementById('dlExecuteCount');

  // --- Init canvas engine ---
  CanvasEngine.init(
    document.getElementById('viewport'),
    document.getElementById('world')
  );

  // =============================================
  // CONVERSATION RENDERING
  // =============================================

  function renderUserMessage(text) {
    const el = document.createElement('div');
    el.className = 'msg msg-user';
    el.textContent = text;
    $messages.appendChild(el);
    scrollMessages();
  }

  function renderAIConvoMessage(text) {
    if (!text) return;
    const el = document.createElement('div');
    el.className = 'msg msg-ai';
    el.innerHTML = `<div class="msg-ai-content">${escapeHtml(text)}</div>`;
    $messages.appendChild(el);
    scrollMessages();
  }

  function renderStatus(text) {
    const el = document.createElement('div');
    el.className = 'msg msg-ai';
    el.innerHTML = `
      <div class="msg-status">
        <span class="msg-status-dot"></span>
        <span class="msg-status-text">${escapeHtml(text)}</span>
      </div>
    `;
    $messages.appendChild(el);
    scrollMessages();
    return el;
  }

  function scrollMessages() {
    requestAnimationFrame(() => {
      $messages.scrollTop = $messages.scrollHeight;
    });
  }

  // =============================================
  // DECISION LOG
  // =============================================

  function addDecision(decision) {
    if (decisions.find(d => d.id === decision.id)) return;
    decisions.push(decision);
    updateDecisionLog();
    if ($decisionLog.classList.contains('collapsed')) toggleDecisionLog();
  }

  function removeDecision(id) {
    const idx = decisions.findIndex(d => d.id === id);
    if (idx !== -1) decisions.splice(idx, 1);
    updateDecisionLog();
  }

  function updateDecisionLog() {
    const count = decisions.length;

    $dlCount.style.display = count > 0 ? '' : 'none';
    $dlCount.textContent = count;
    $dlExecute.disabled = count === 0;
    $dlExecuteCount.textContent = count > 0 ? `(${count} pending)` : '';
    $dlEmpty.style.display = count > 0 ? 'none' : '';

    const groups = {};
    for (const d of decisions) {
      const cat = d.category || 'General';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(d);
    }

    $dlContent.querySelectorAll('.dl-section').forEach(el => el.remove());

    for (const [category, items] of Object.entries(groups)) {
      const section = document.createElement('div');
      section.className = 'dl-section';

      const header = document.createElement('div');
      header.className = 'dl-section-header';
      header.innerHTML = `<span class="dl-section-chevron">&#9662;</span> ${escapeHtml(category)}`;
      header.addEventListener('click', () => section.classList.toggle('collapsed'));
      section.appendChild(header);

      const itemsEl = document.createElement('div');
      itemsEl.className = 'dl-items';

      for (const d of items) {
        const item = document.createElement('div');
        item.className = 'dl-item';
        item.innerHTML = `
          <button class="dl-item-remove" title="Remove">&times;</button>
          <div class="dl-item-title">${escapeHtml(d.title)}</div>
          <div class="dl-item-desc">${escapeHtml(d.description || '')}</div>
        `;

        item.querySelector('.dl-item-remove').addEventListener('click', (e) => {
          e.stopPropagation();
          removeDecision(d.id);
        });

        itemsEl.appendChild(item);
      }

      section.appendChild(itemsEl);
      $dlContent.appendChild(section);
    }
  }

  function toggleDecisionLog() {
    $decisionLog.classList.toggle('collapsed');
    const isCollapsed = $decisionLog.classList.contains('collapsed');
    $dlToggle.innerHTML = isCollapsed ? '&#9656;' : '&#9666;';
  }

  // =============================================
  // API
  // =============================================

  async function callChat(message, onResult) {
    try {
      const body = {
        conversationId,
        message,
        mode: activeMode ? activeMode.getSystemPromptId() : 'analysis'
      };
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6));

          switch (data.type) {
            case 'conversationId':
              conversationId = data.id;
              break;
            case 'status':
              const statusText = document.querySelector('.msg-status-text');
              if (statusText) statusText.textContent = data.message;
              break;
            case 'result':
              onResult(data);
              break;
            case 'error':
              onResult({ message: `Error: ${data.message}`, card: null, prompts: [], decisions: [] });
              break;
          }
        }
      }
    } catch (err) {
      onResult({ message: `Connection error: ${err.message}`, card: null, prompts: [], decisions: [] });
    }
  }

  // =============================================
  // MODE MANAGEMENT
  // =============================================

  function registerMode(mode) {
    modes[mode.id] = mode;
  }

  function switchMode(id) {
    const mode = modes[id];
    if (!mode) return;

    // Cleanup current mode
    if (activeMode) {
      activeMode.cleanup();
    }

    // Reset shared state
    conversationId = null;
    decisions.length = 0;
    isStreaming = false;
    updateDecisionLog();

    // Reset canvas
    CanvasEngine.reset();
    $canvasEmpty.classList.remove('hidden');
    $scenarioTitle.textContent = 'New Scenario';

    // Collapse decision log
    if (!$decisionLog.classList.contains('collapsed')) {
      $decisionLog.classList.add('collapsed');
      $dlToggle.innerHTML = '&#9656;';
    }

    // Reset conversation pane with mode starters
    resetConversationPane(mode);

    // Re-enable input
    $chatInput.disabled = false;
    $chatSend.disabled = false;

    // Activate new mode
    activeMode = mode;
    mode.init();

    // Update mode switcher buttons
    updateModeSwitcherUI(id);

    $chatInput.focus();
  }

  function resetConversationPane(mode) {
    $messages.innerHTML = '';

    const welcome = document.createElement('div');
    welcome.className = 'convo-welcome';

    const title = document.createElement('div');
    title.className = 'convo-welcome-title';
    title.textContent = 'EE Graph Studio';
    welcome.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'convo-welcome-sub';
    sub.textContent = 'Explore scenarios, compare options, plan actions';
    welcome.appendChild(sub);

    const starters = document.createElement('div');
    starters.className = 'convo-starters';

    for (const s of mode.getStarters()) {
      const btn = document.createElement('button');
      btn.className = 'convo-starter';
      btn.dataset.q = s.query;
      btn.textContent = s.text;
      starters.appendChild(btn);
    }

    welcome.appendChild(starters);
    $messages.appendChild(welcome);
  }

  // =============================================
  // MODE SWITCHER UI
  // =============================================

  function initModeSwitcher() {
    const container = document.getElementById('modeSwitcher');
    if (!container) return;

    for (const mode of Object.values(modes)) {
      const btn = document.createElement('button');
      btn.className = 'mode-btn';
      btn.textContent = mode.label;
      btn.dataset.mode = mode.id;
      btn.addEventListener('click', () => switchMode(mode.id));
      container.appendChild(btn);
    }
  }

  function updateModeSwitcherUI(activeId) {
    const container = document.getElementById('modeSwitcher');
    if (!container) return;
    container.querySelectorAll('.mode-btn').forEach(btn => {
      btn.classList.toggle('mode-btn-active', btn.dataset.mode === activeId);
    });
  }

  // =============================================
  // EVENT LISTENERS
  // =============================================

  function handleChatSubmit() {
    const text = $chatInput.value.trim();
    if (!text || isStreaming || !activeMode) return;
    $chatInput.value = '';
    const welcome = document.querySelector('.convo-welcome');
    if (welcome) welcome.remove();
    activeMode.handleSendMessage(text);
  }

  $chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleChatSubmit();
    }
  });

  $chatSend.addEventListener('click', handleChatSubmit);

  // Delegated click for starters (rebuilt dynamically per mode)
  $messages.addEventListener('click', (e) => {
    const btn = e.target.closest('.convo-starter');
    if (btn?.dataset.q && activeMode && !isStreaming) {
      $chatInput.value = '';
      const welcome = document.querySelector('.convo-welcome');
      if (welcome) welcome.remove();
      activeMode.handleSendMessage(btn.dataset.q);
    }
  });

  $dlToggle.addEventListener('click', toggleDecisionLog);

  $zoomFit.addEventListener('click', () => CanvasEngine.zoomToFit());

  $dlExecute.addEventListener('click', () => {
    if (decisions.length === 0 || !activeMode || isStreaming) return;
    const summary = decisions.map(d => `- ${d.title}`).join('\n');
    const welcome = document.querySelector('.convo-welcome');
    if (welcome) welcome.remove();
    activeMode.handleSendMessage(`Execute these decisions:\n${summary}`);
  });

  // =============================================
  // UTILITIES
  // =============================================

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // =============================================
  // PUBLIC API
  // =============================================

  window.Studio = {
    get isStreaming() { return isStreaming; },
    set isStreaming(v) { isStreaming = v; },
    get conversationId() { return conversationId; },
    set conversationId(v) { conversationId = v; },
    decisions,

    $messages, $chatInput, $chatSend, $canvasEmpty, $scenarioTitle,

    renderUserMessage,
    renderAIConvoMessage,
    renderStatus,
    scrollMessages,

    addDecision,
    removeDecision,

    callChat,
    escapeHtml,

    registerMode,
    switchMode,
    get activeMode() { return activeMode; },

    boot() {
      initModeSwitcher();
      const defaultMode = modes['analysis'] || Object.values(modes)[0];
      if (defaultMode) {
        switchMode(defaultMode.id);
      }
      $chatInput.focus();
    }
  };

})();
