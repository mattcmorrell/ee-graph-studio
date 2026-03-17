// app.js — EE Graph Studio application logic
// Canvas node tree with prompt chips (knowledge=right, action=below)

(() => {

  // --- Layout Constants ---
  const COL_WIDTH = 560;
  const COL_GAP = 32;
  const ROW_GAP = 16;
  const PROMPT_GAP = 16;
  const PROMPT_WIDTH = 240;

  // --- State ---
  let conversationId = null;
  let isStreaming = false;
  let focusedNodeId = null;
  let nodeIdCounter = 0;
  const canvasNodes = new Map(); // id → { id, type, parentId, direction, data, el, children, _layoutCol, _layoutX, _layoutY }
  const decisions = [];          // shopping cart

  function genId() { return 'node-' + (++nodeIdCounter); }

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
  // CANVAS NODE TREE
  // =============================================

  function addCanvasNode(type, parentId, direction, data, el) {
    const id = genId();
    const node = {
      id, type, parentId,
      direction: direction || 'below',
      data, el,
      children: [],
      _layoutCol: 0,
      _layoutX: 0,
      _layoutY: 0
    };
    canvasNodes.set(id, node);
    if (parentId) {
      const parent = canvasNodes.get(parentId);
      if (parent) parent.children.push(id);
    }
    el.classList.add('canvas-node');
    el.dataset.nodeId = id;
    CanvasEngine.addBlock(id, el, 0, 0);
    return id;
  }

  function removeCanvasNode(id) {
    const node = canvasNodes.get(id);
    if (!node) return;
    // Remove from parent's children
    if (node.parentId) {
      const parent = canvasNodes.get(node.parentId);
      if (parent) {
        parent.children = parent.children.filter(cid => cid !== id);
      }
    }
    // Remove children recursively
    for (const childId of [...node.children]) {
      removeCanvasNode(childId);
    }
    CanvasEngine.removeBlock(id);
    canvasNodes.delete(id);
  }

  // =============================================
  // LAYOUT ALGORITHM
  // =============================================

  function layoutAll() {
    const roots = [...canvasNodes.values()].filter(n => !n.parentId);
    const colBottoms = {};

    function getBottom(col) { return colBottoms[col] || 0; }
    function setBottom(col, y) { colBottoms[col] = Math.max(colBottoms[col] || 0, y); }

    function layoutNode(id) {
      const node = canvasNodes.get(id);
      if (!node || !node.el) return;

      const parent = node.parentId ? canvasNodes.get(node.parentId) : null;
      let col, y;

      if (!parent) {
        col = 0;
        y = getBottom(0);
      } else if (node.direction === 'right') {
        col = (parent._layoutCol || 0) + 1;
        y = Math.max(parent._layoutY || 0, getBottom(col));
      } else {
        col = parent._layoutCol || 0;
        y = getBottom(col);
      }

      node._layoutCol = col;
      node._layoutY = y;

      let x = col * (COL_WIDTH + COL_GAP);

      // Prompt chips snug against parent card edge
      if (parent && node.direction === 'right' && (node.type === 'prompts' || node.type === 'action-prompts')) {
        const parentX = parent._layoutX || 0;
        const parentW = parent.el.offsetWidth || COL_WIDTH;
        x = parentX + parentW + PROMPT_GAP;
      }

      node._layoutX = x;
      CanvasEngine.moveBlock(id, x, y, true);

      // Size prompt chips
      if (node.type === 'prompts' || node.type === 'action-prompts') {
        if (node.direction === 'right') {
          node.el.style.width = PROMPT_WIDTH + 'px';
        } else if (parent) {
          const parentWidth = parent.el.offsetWidth;
          if (parentWidth > 0) node.el.style.width = parentWidth + 'px';
        }
      }

      // Cap response cards in right columns
      if (node.type === 'card' && node.direction === 'right') {
        node.el.style.maxWidth = '520px';
      }

      const h = node.el.offsetHeight || 60;
      setBottom(col, y + h + ROW_GAP);

      // Layout right children first, then below children
      const rightChildren = node.children.filter(cid => {
        const c = canvasNodes.get(cid);
        return c && c.direction === 'right';
      });
      const belowChildren = node.children.filter(cid => {
        const c = canvasNodes.get(cid);
        return c && c.direction !== 'right';
      });

      for (const childId of rightChildren) layoutNode(childId);

      // Push column bottom past all right-branch content
      if (rightChildren.length > 0) {
        let maxRightBottom = 0;
        function collectRightBottoms(cid) {
          const c = canvasNodes.get(cid);
          if (!c) return;
          const cBottom = (c._layoutY || 0) + (c.el.offsetHeight || 60) + ROW_GAP;
          maxRightBottom = Math.max(maxRightBottom, cBottom);
          for (const grandchild of c.children) collectRightBottoms(grandchild);
        }
        for (const childId of rightChildren) collectRightBottoms(childId);
        setBottom(col, maxRightBottom);
      }

      for (const childId of belowChildren) layoutNode(childId);
    }

    for (const root of roots) {
      layoutNode(root.id);
    }
  }

  // =============================================
  // FOCUS MANAGEMENT
  // =============================================

  function setFocus(nodeId) {
    focusedNodeId = nodeId;
    for (const [id, node] of canvasNodes) {
      // Toggle selected on cards
      if (node.type === 'card') {
        if (id === nodeId) {
          node.el.classList.add('node-selected');
        } else {
          node.el.classList.remove('node-selected');
        }
      }

      // Manage prompt visibility
      if (node.type === 'prompts' || node.type === 'action-prompts') {
        const isFocusChild = node.parentId === nodeId;

        node.el.querySelectorAll('.prompt-chip').forEach(chip => {
          if (chip.classList.contains('prompt-chip-active') || chip.classList.contains('prompt-chip-loading')) return;
          if (isFocusChild) {
            chip.classList.remove('prompt-chip-dimmed');
            chip.disabled = false;
          } else {
            chip.classList.add('prompt-chip-dimmed');
            chip.disabled = true;
          }
        });

        if (isFocusChild) {
          node.el.classList.remove('node-dimmed');
        } else if (!node.el.querySelector('.prompt-chip-active, .prompt-chip-loading')) {
          node.el.classList.add('node-dimmed');
        }
      }

      // Manage option card visibility
      if (node.type === 'options') {
        const isFocusChild = node.parentId === nodeId;
        if (isFocusChild) {
          node.el.classList.remove('node-dimmed');
        } else if (!node.el.querySelector('.option-card-selected')) {
          node.el.classList.add('node-dimmed');
        }
      }
    }
  }

  // =============================================
  // PROMPT CHIPS
  // =============================================

  function renderPromptChips(prompts) {
    const container = document.createElement('div');
    container.className = 'prompt-chips';

    for (const p of prompts) {
      const chip = document.createElement('button');
      chip.className = `prompt-chip prompt-chip-${p.category || 'knowledge'}`;
      chip.textContent = p.text;
      chip.dataset.promptText = p.text;
      chip.dataset.promptCategory = p.category || 'knowledge';

      chip.addEventListener('click', () => {
        const nodeEl = chip.closest('.canvas-node');
        const nodeId = nodeEl?.dataset.nodeId;
        if (nodeId && !chip.classList.contains('prompt-chip-active')) {
          explorePrompt(nodeId, p, chip);
        }
      });

      container.appendChild(chip);
    }

    return container;
  }

  function placePromptsForCard(cardNodeId, prompts) {
    const knowledgePrompts = (prompts || []).filter(p => p.category !== 'action');
    const actionPrompts = (prompts || []).filter(p => p.category === 'action');

    if (knowledgePrompts.length > 0) {
      const el = renderPromptChips(knowledgePrompts);
      const header = document.createElement('div');
      header.className = 'prompt-group-header';
      header.textContent = 'What should I know';
      el.prepend(header);
      addCanvasNode('prompts', cardNodeId, 'right', { prompts: knowledgePrompts }, el);
    }

    if (actionPrompts.length > 0) {
      const el = renderPromptChips(actionPrompts);
      const header = document.createElement('div');
      header.className = 'prompt-group-header';
      header.textContent = 'What we should do';
      el.prepend(header);
      addCanvasNode('action-prompts', cardNodeId, 'below', { prompts: actionPrompts }, el);
    }
  }

  // =============================================
  // OPTION CARDS
  // =============================================

  function renderOptionCards(options) {
    const container = document.createElement('div');
    container.className = 'option-cards';

    for (const opt of options) {
      const card = document.createElement('div');
      card.className = 'option-card';
      card.dataset.optionId = opt.id;

      let avatarHtml = '';
      if (opt.personId) {
        avatarHtml = `<img src="https://mattcmorrell.github.io/ee-graph/data/avatars/${opt.personId}.jpg" class="option-card-avatar" onerror="this.style.display='none'" />`;
      }

      card.innerHTML = `
        ${avatarHtml}
        <div class="option-card-info">
          <div class="option-card-name">${escapeHtml(opt.name)}</div>
          <div class="option-card-role">${escapeHtml(opt.role || '')}</div>
          <div class="option-card-reason">${escapeHtml(opt.reason || '')}</div>
        </div>
      `;

      card.addEventListener('click', () => {
        const nodeEl = card.closest('.canvas-node');
        const nodeId = nodeEl?.dataset.nodeId;
        if (nodeId && !card.classList.contains('option-card-selected')) {
          selectOption(nodeId, opt, card);
        }
      });

      container.appendChild(card);
    }

    return container;
  }

  function placeOptionsForCard(cardNodeId, options) {
    if (!options || options.length === 0) return;

    const el = renderOptionCards(options);
    const header = document.createElement('div');
    header.className = 'prompt-group-header';
    header.textContent = 'Choose an option';
    el.prepend(header);
    addCanvasNode('options', cardNodeId, 'below', { options }, el);
  }

  function selectOption(optionNodeId, option, cardEl) {
    if (isStreaming) return;
    isStreaming = true;

    const optionNode = canvasNodes.get(optionNodeId);
    if (!optionNode) return;

    // Mark selected, dim siblings
    cardEl.classList.add('option-card-selected');
    optionNode.el.querySelectorAll('.option-card').forEach(card => {
      if (card !== cardEl) {
        card.classList.add('option-card-dimmed');
      }
    });

    // Disable input
    $chatInput.disabled = true;
    $chatSend.disabled = true;

    // Show in conversation
    renderUserMessage(`I choose: ${option.id} — ${option.name}`);
    const statusEl = renderStatus('Thinking...');

    // The parent of the options is the card
    const parentOfOptions = optionNode.parentId;

    // Call API
    callChat(`I choose: ${option.id} — ${option.name}`, (data) => {
      if (statusEl) statusEl.remove();

      renderAIConvoMessage(data.message);

      // Remove the options container
      removeCanvasNode(optionNodeId);

      if (data.card) {
        data.card.parentId = parentOfOptions;

        const el = createCardElement(data.card);
        const cardNodeId = addCanvasNode('card', parentOfOptions, 'below', data.card, el);

        // Place new prompts + options
        placePromptsForCard(cardNodeId, data.prompts);
        placeOptionsForCard(cardNodeId, data.options);

        // Handle decisions from AI response
        if (data.decisions) {
          for (const d of data.decisions) addDecision(d);
        }

        // Focus
        focusedNodeId = cardNodeId;
        setFocus(cardNodeId);

        requestAnimationFrame(() => {
          layoutAll();
          setTimeout(() => {
            layoutAll();
            CanvasEngine.focusOn(cardNodeId, 0.85);
            isStreaming = false;
            $chatInput.disabled = false;
            $chatSend.disabled = false;
            $chatInput.focus();
          }, 100);
        });
      } else {
        isStreaming = false;
        $chatInput.disabled = false;
        $chatSend.disabled = false;
      }
    });
  }

  // =============================================
  // EXPLORE PROMPT (click handler)
  // =============================================

  function explorePrompt(promptNodeId, prompt, chipEl) {
    if (isStreaming) return;
    isStreaming = true;

    const promptNode = canvasNodes.get(promptNodeId);
    if (!promptNode) return;

    // Loading state: pulse clicked chip, dim siblings
    chipEl.classList.add('prompt-chip-loading');
    promptNode.el.querySelectorAll('.prompt-chip').forEach(chip => {
      if (chip !== chipEl) {
        chip.classList.add('prompt-chip-dimmed');
        chip.disabled = true;
      }
    });

    // Disable input while streaming
    $chatInput.disabled = true;
    $chatSend.disabled = true;

    // Show in conversation
    renderUserMessage(prompt.text);
    const statusEl = renderStatus('Thinking...');

    // Flow direction based on category
    const flowDir = (prompt.category || 'knowledge') === 'action' ? 'below' : 'right';

    // The parent of the prompts is the card
    const parentOfPrompts = promptNode.parentId;

    // Call API
    callChat(prompt.text, (data) => {
      if (statusEl) statusEl.remove();

      // Show AI message in conversation
      renderAIConvoMessage(data.message);

      // Remove the prompt chip container
      removeCanvasNode(promptNodeId);

      // Place the response card as child of the parent card
      if (data.card) {
        data.card.parentId = parentOfPrompts;

        const el = createCardElement(data.card);
        const cardNodeId = addCanvasNode('card', parentOfPrompts, flowDir, data.card, el);

        // Place new prompts + options for this card
        placePromptsForCard(cardNodeId, data.prompts);
        placeOptionsForCard(cardNodeId, data.options);

        // Handle decisions
        if (data.decisions) {
          for (const d of data.decisions) addDecision(d);
        }

        // Focus on new card
        focusedNodeId = cardNodeId;
        setFocus(cardNodeId);

        requestAnimationFrame(() => {
          layoutAll();
          setTimeout(() => {
            layoutAll();
            CanvasEngine.focusOn(cardNodeId, 0.85);
            isStreaming = false;
            $chatInput.disabled = false;
            $chatSend.disabled = false;
            $chatInput.focus();
          }, 100);
        });
      } else {
        isStreaming = false;
        $chatInput.disabled = false;
        $chatSend.disabled = false;
      }
    });
  }

  // =============================================
  // API
  // =============================================

  async function callChat(message, onResult) {
    try {
      const body = { conversationId, message };
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
              // Update status in conversation
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
  // INITIAL MESSAGE (from conversation input)
  // =============================================

  async function sendMessage(text) {
    if (isStreaming || !text) return;
    isStreaming = true;
    $chatInput.disabled = true;
    $chatSend.disabled = true;

    renderUserMessage(text);
    const statusEl = renderStatus('Thinking...');

    callChat(text, (data) => {
      if (statusEl) statusEl.remove();

      renderAIConvoMessage(data.message);

      if (data.card) {
        $canvasEmpty.classList.add('hidden');

        const el = createCardElement(data.card);
        const cardNodeId = addCanvasNode('card', null, 'below', data.card, el);

        // Update scenario title
        $scenarioTitle.textContent = data.card.title;

        // Place prompts + options
        placePromptsForCard(cardNodeId, data.prompts);
        placeOptionsForCard(cardNodeId, data.options);

        // Handle decisions
        if (data.decisions) {
          for (const d of data.decisions) addDecision(d);
        }

        // Focus
        focusedNodeId = cardNodeId;
        setFocus(cardNodeId);

        requestAnimationFrame(() => {
          layoutAll();
          setTimeout(() => {
            layoutAll();
            CanvasEngine.focusOn(cardNodeId, 0.85);
            isStreaming = false;
            $chatInput.disabled = false;
            $chatSend.disabled = false;
            $chatInput.focus();
          }, 100);
        });
      } else {
        isStreaming = false;
        $chatInput.disabled = false;
        $chatSend.disabled = false;
      }
    });
  }

  // =============================================
  // CARD RENDERING
  // =============================================

  function createCardElement(card) {
    const el = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'canvas-card-header';
    header.textContent = card.title || 'Analysis';
    el.appendChild(header);

    const body = document.createElement('div');
    body.className = 'canvas-card-body';
    body.innerHTML = card.html || '';

    el.appendChild(body);

    // Click card to refocus
    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      if (!e.target.closest('button, .prompt-chip, a')) {
        const nodeId = el.dataset.nodeId;
        if (nodeId) {
          setFocus(nodeId);
          CanvasEngine.focusOn(nodeId);
        }
      }
    });

    return el;
  }

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

    // Group by category
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
  // EVENT LISTENERS
  // =============================================

  $chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = $chatInput.value.trim();
      if (text) {
        $chatInput.value = '';
        const welcome = document.querySelector('.convo-welcome');
        if (welcome) welcome.remove();
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

  $dlToggle.addEventListener('click', toggleDecisionLog);

  $zoomFit.addEventListener('click', () => CanvasEngine.zoomToFit());

  $dlExecute.addEventListener('click', () => {
    if (decisions.length === 0) return;
    const summary = decisions.map(d => `- ${d.title}`).join('\n');
    sendMessage(`Execute these decisions:\n${summary}`);
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

  $chatInput.focus();

})();
