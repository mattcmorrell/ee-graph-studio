// app.js — EE Graph Studio application logic
// Manages conversation, canvas cards, options, and decision log

(() => {

  // --- State ---
  const state = {
    conversationId: null,
    cards: new Map(),        // id → { id, title, el, parentId, branchId }
    options: [],             // current pending options
    decisions: [],           // shopping cart
    nextCardX: 0,            // layout tracking (in BRICK units)
    nextCardY: 0,
    isStreaming: false
  };

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

  // --- Conversation ---

  async function sendMessage(text, optionId) {
    if (state.isStreaming) return;
    if (!text && !optionId) return;

    state.isStreaming = true;
    $chatInput.disabled = true;
    $chatSend.disabled = true;

    // Render user message
    if (text) {
      renderUserMessage(text);
    }

    // Show loading
    const statusEl = renderStatus('Thinking...');

    try {
      const body = {
        conversationId: state.conversationId,
        message: text || undefined,
        selectedOptionId: optionId || undefined
      };

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6));

          switch (data.type) {
            case 'conversationId':
              state.conversationId = data.id;
              break;

            case 'status':
              if (statusEl) statusEl.querySelector('.msg-status-text').textContent = data.message;
              break;

            case 'result':
              // Remove status
              if (statusEl) statusEl.remove();
              renderAIMessage(data);
              break;

            case 'error':
              if (statusEl) statusEl.remove();
              renderAIMessage({ message: `Error: ${data.message}`, cards: [], options: [], decisions: [] });
              break;

            case 'done':
              break;
          }
        }
      }
    } catch (err) {
      if (statusEl) statusEl.remove();
      renderAIMessage({ message: `Connection error: ${err.message}`, cards: [], options: [], decisions: [] });
    }

    state.isStreaming = false;
    $chatInput.disabled = false;
    $chatSend.disabled = false;
    $chatInput.focus();
  }

  function renderUserMessage(text) {
    const el = document.createElement('div');
    el.className = 'msg msg-user';
    el.textContent = text;
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

  function renderAIMessage(data) {
    const el = document.createElement('div');
    el.className = 'msg msg-ai';

    // Message content
    let html = `<div class="msg-ai-content">${escapeHtml(data.message)}</div>`;

    // "Drew X on canvas" indicators
    if (data.cards && data.cards.length > 0) {
      for (const card of data.cards) {
        html += `<div class="msg-ai-action" data-card-id="${escapeHtml(card.id)}">Drew ${escapeHtml(card.title)} on canvas</div>`;
      }
    }

    el.innerHTML = html;

    // Place cards on canvas
    if (data.cards && data.cards.length > 0) {
      for (const card of data.cards) {
        placeCard(card);
      }
      // Update scenario title from first card if this is the first response
      if (state.cards.size <= data.cards.length) {
        $scenarioTitle.textContent = data.cards[0].title;
      }
      $canvasEmpty.classList.add('hidden');

      // Focus on the last card placed
      const lastCard = data.cards[data.cards.length - 1];
      setTimeout(() => {
        CanvasEngine.focusOn(lastCard.id);
      }, 100);
    }

    // Render options as chips
    if (data.options && data.options.length > 0) {
      state.options = data.options;
      const chipsEl = document.createElement('div');
      chipsEl.className = 'msg-chips';

      for (const opt of data.options) {
        const chip = document.createElement('button');
        chip.className = 'msg-chip' + (opt.isAction ? ' msg-chip-action' : '');
        chip.textContent = opt.label;
        if (opt.description) chip.title = opt.description;
        chip.dataset.optionId = opt.id;
        chip.addEventListener('click', () => handleOptionClick(chip, opt, chipsEl));
        chipsEl.appendChild(chip);
      }

      el.appendChild(chipsEl);
    }

    // Record decisions
    if (data.decisions && data.decisions.length > 0) {
      for (const decision of data.decisions) {
        addDecision(decision);
      }
    }

    $messages.appendChild(el);
    scrollMessages();

    // Click "drew on canvas" to focus
    el.querySelectorAll('.msg-ai-action[data-card-id]').forEach(action => {
      action.style.cursor = 'pointer';
      action.addEventListener('click', () => {
        CanvasEngine.focusOn(action.dataset.cardId);
      });
    });
  }

  function handleOptionClick(chipEl, option, chipsContainer) {
    // Highlight selected, dim others
    chipsContainer.querySelectorAll('.msg-chip').forEach(c => {
      if (c === chipEl) {
        c.classList.add('selected');
      } else {
        c.classList.add('dimmed');
      }
    });

    // Build message from the option
    const message = option.description
      ? `${option.label}: ${option.description}`
      : option.label;

    // Send as a user choice
    renderUserMessage(option.label);
    sendMessage(message, option.id);
  }

  function scrollMessages() {
    requestAnimationFrame(() => {
      $messages.scrollTop = $messages.scrollHeight;
    });
  }

  // --- Canvas Card Rendering ---

  function placeCard(card) {
    const el = document.createElement('div');

    // Header
    const header = document.createElement('div');
    header.className = 'canvas-card-header';
    header.textContent = card.title;
    if (card.parentId) {
      const branchBadge = document.createElement('span');
      branchBadge.className = 'canvas-card-branch';
      branchBadge.textContent = 'consequence';
      header.appendChild(branchBadge);
    }
    el.appendChild(header);

    // Body — the AI-generated HTML
    const body = document.createElement('div');
    body.className = 'canvas-card-body';
    body.innerHTML = card.html;
    el.appendChild(body);

    // Calculate position
    const pos = calculateCardPosition(card);

    // Add to canvas engine
    CanvasEngine.addBlock(card.id, el, pos.col, pos.row);

    // Track in state
    state.cards.set(card.id, {
      id: card.id,
      title: card.title,
      el,
      parentId: card.parentId || null,
      branchId: card.branchId || null
    });
  }

  function calculateCardPosition(card) {
    const CARD_WIDTH_BRICKS = 5;  // ~480px at 96px brick
    const CARD_HEIGHT_BRICKS = 4; // estimated, cards vary
    const GAP = 1;                // 1 brick gap

    if (card.parentId && state.cards.has(card.parentId)) {
      // Position below and slightly right of parent
      const parentEntry = CanvasEngine.getBlock(card.parentId);
      if (parentEntry) {
        const parentEl = parentEntry.el;
        const parentX = parseFloat(parentEl.style.left) || 0;
        const parentY = parseFloat(parentEl.style.top) || 0;
        const parentH = parentEl.offsetHeight || (CARD_HEIGHT_BRICKS * CanvasEngine.BRICK);

        const col = Math.round(parentX / CanvasEngine.BRICK) + 1;
        const row = Math.round((parentY + parentH + GAP * CanvasEngine.BRICK) / CanvasEngine.BRICK);

        // Update tracking for next card
        state.nextCardX = col + CARD_WIDTH_BRICKS + GAP;
        state.nextCardY = Math.max(state.nextCardY, row);

        return { col, row };
      }
    }

    // Default: horizontal flow
    if (state.cards.size === 0) {
      // First card: centered
      const col = 0;
      const row = 0;
      state.nextCardX = CARD_WIDTH_BRICKS + GAP;
      state.nextCardY = 0;
      return { col, row };
    }

    // Next card to the right
    const col = state.nextCardX;
    const row = state.nextCardY;
    state.nextCardX = col + CARD_WIDTH_BRICKS + GAP;
    return { col, row };
  }

  // --- Decision Log ---

  function addDecision(decision) {
    // Check for duplicates
    if (state.decisions.find(d => d.id === decision.id)) return;

    state.decisions.push(decision);
    updateDecisionLog();

    // Expand decision log if collapsed
    if ($decisionLog.classList.contains('collapsed')) {
      toggleDecisionLog();
    }
  }

  function removeDecision(id) {
    state.decisions = state.decisions.filter(d => d.id !== id);
    updateDecisionLog();
  }

  function updateDecisionLog() {
    const count = state.decisions.length;

    // Update count badge
    if (count > 0) {
      $dlCount.style.display = '';
      $dlCount.textContent = count;
      $dlExecute.disabled = false;
      $dlExecuteCount.textContent = `(${count} pending)`;
      $dlEmpty.style.display = 'none';
    } else {
      $dlCount.style.display = 'none';
      $dlExecute.disabled = true;
      $dlExecuteCount.textContent = '';
      $dlEmpty.style.display = '';
    }

    // Group by category
    const groups = {};
    for (const d of state.decisions) {
      const cat = d.category || 'General';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(d);
    }

    // Clear existing sections (but keep empty placeholder)
    $dlContent.querySelectorAll('.dl-section').forEach(el => el.remove());

    // Render sections
    for (const [category, decisions] of Object.entries(groups)) {
      const section = document.createElement('div');
      section.className = 'dl-section';

      const header = document.createElement('div');
      header.className = 'dl-section-header';
      header.innerHTML = `<span class="dl-section-chevron">&#9662;</span> ${escapeHtml(category)}`;
      header.addEventListener('click', () => section.classList.toggle('collapsed'));
      section.appendChild(header);

      const items = document.createElement('div');
      items.className = 'dl-items';

      for (const d of decisions) {
        const item = document.createElement('div');
        item.className = 'dl-item';
        item.innerHTML = `
          <button class="dl-item-remove" title="Remove">&times;</button>
          <div class="dl-item-title">${escapeHtml(d.title)}</div>
          <div class="dl-item-desc">${escapeHtml(d.description || '')}</div>
        `;

        // Remove button
        item.querySelector('.dl-item-remove').addEventListener('click', (e) => {
          e.stopPropagation();
          removeDecision(d.id);
        });

        // Click to focus card (if there's a related card)
        item.addEventListener('click', (e) => {
          if (e.target.classList.contains('dl-item-remove')) return;
          // Try to find a related card
          const relatedCard = findRelatedCard(d);
          if (relatedCard) {
            CanvasEngine.focusOn(relatedCard);
            // Highlight briefly
            const entry = CanvasEngine.getBlock(relatedCard);
            if (entry) {
              entry.el.classList.add('highlight');
              setTimeout(() => entry.el.classList.remove('highlight'), 2000);
            }
          }
        });

        items.appendChild(item);
      }

      section.appendChild(items);
      $dlContent.appendChild(section);
    }
  }

  function findRelatedCard(decision) {
    // Simple heuristic: find a card whose title contains part of the decision title
    for (const [id, card] of state.cards) {
      if (card.title && decision.title &&
          (card.title.toLowerCase().includes(decision.title.toLowerCase().split(' ')[0]) ||
           decision.title.toLowerCase().includes(card.title.toLowerCase().split(' ')[0]))) {
        return id;
      }
    }
    // Fall back to the last card
    const keys = [...state.cards.keys()];
    return keys.length > 0 ? keys[keys.length - 1] : null;
  }

  function toggleDecisionLog() {
    $decisionLog.classList.toggle('collapsed');
    const isCollapsed = $decisionLog.classList.contains('collapsed');
    $dlToggle.innerHTML = isCollapsed ? '&#9656;' : '&#9666;';
    $dlToggle.title = isCollapsed ? 'Expand Decision Log' : 'Collapse Decision Log';
  }

  // --- Event Listeners ---

  // Send on Enter or click
  $chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = $chatInput.value.trim();
      if (text) {
        $chatInput.value = '';
        sendMessage(text);
      }
    }
  });

  $chatSend.addEventListener('click', () => {
    const text = $chatInput.value.trim();
    if (text) {
      $chatInput.value = '';
      const welcome = document.querySelector('.convo-welcome');
      if (welcome) welcome.remove();
      sendMessage(text);
    }
  });

  // Starter prompts
  const $starters = document.getElementById('starters');
  if ($starters) {
    $starters.addEventListener('click', (e) => {
      const btn = e.target.closest('.convo-starter');
      if (btn?.dataset.q) {
        $chatInput.value = '';
        const welcome = document.querySelector('.convo-welcome');
        if (welcome) welcome.remove();
        sendMessage(btn.dataset.q);
      }
    });
  }

  // Decision log toggle
  $dlToggle.addEventListener('click', toggleDecisionLog);

  // Zoom to fit
  $zoomFit.addEventListener('click', () => {
    CanvasEngine.zoomToFit();
  });

  // Execute button (placeholder for now)
  $dlExecute.addEventListener('click', () => {
    if (state.decisions.length === 0) return;
    const summary = state.decisions.map(d => `- ${d.title}`).join('\n');
    sendMessage(`Execute these decisions:\n${summary}`);
  });

  // --- Utilities ---

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Focus chat input on load
  $chatInput.focus();

})();
