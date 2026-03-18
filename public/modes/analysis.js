// modes/analysis.js — Analysis mode (tree exploration with prompt chips)
(function() {
  const S = window.Studio;

  // --- Layout Constants ---
  const COL_WIDTH = 560;
  const COL_GAP = 32;
  const ROW_GAP = 16;
  const PROMPT_GAP = 16;
  const PROMPT_WIDTH = 240;

  // --- State ---
  let focusedNodeId = null;
  let nodeIdCounter = 0;
  const canvasNodes = new Map();

  function genId() { return 'node-' + (++nodeIdCounter); }

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
    if (node.parentId) {
      const parent = canvasNodes.get(node.parentId);
      if (parent) {
        parent.children = parent.children.filter(cid => cid !== id);
      }
    }
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

      if (parent && node.direction === 'right' && (node.type === 'prompts' || node.type === 'action-prompts')) {
        const parentX = parent._layoutX || 0;
        const parentW = parent.el.offsetWidth || COL_WIDTH;
        x = parentX + parentW + PROMPT_GAP;
      }

      node._layoutX = x;
      CanvasEngine.moveBlock(id, x, y, true);

      if (node.type === 'prompts' || node.type === 'action-prompts') {
        if (node.direction === 'right') {
          node.el.style.width = PROMPT_WIDTH + 'px';
        } else if (parent) {
          const parentWidth = parent.el.offsetWidth;
          if (parentWidth > 0) node.el.style.width = parentWidth + 'px';
        }
      }

      if (node.type === 'card' && node.direction === 'right') {
        node.el.style.maxWidth = '520px';
      }

      const h = node.el.offsetHeight || 60;
      setBottom(col, y + h + ROW_GAP);

      const rightChildren = node.children.filter(cid => {
        const c = canvasNodes.get(cid);
        return c && c.direction === 'right';
      });
      const belowChildren = node.children.filter(cid => {
        const c = canvasNodes.get(cid);
        return c && c.direction !== 'right';
      });

      for (const childId of rightChildren) layoutNode(childId);

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
      if (node.type === 'card') {
        if (id === nodeId) {
          node.el.classList.add('node-selected');
        } else {
          node.el.classList.remove('node-selected');
        }
      }

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

  function createPromptInput(category, cardNodeId) {
    const wrap = document.createElement('div');
    wrap.className = 'prompt-input-wrap';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = `prompt-input prompt-input-${category}`;
    input.placeholder = 'Ask your own question...';
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        e.preventDefault();
        const text = input.value.trim();
        input.value = '';
        const fakePrompt = { text, category };
        const nodeEl = wrap.closest('.canvas-node');
        const nodeId = nodeEl?.dataset.nodeId;
        if (nodeId) {
          input.disabled = true;
          input.placeholder = 'Thinking...';
          wrap.classList.add('prompt-input-loading');
          explorePrompt(nodeId, fakePrompt, wrap);
        }
      }
    });
    wrap.appendChild(input);
    return wrap;
  }

  function placePromptsForCard(cardNodeId, prompts) {
    const knowledgePrompts = (prompts || []).filter(p => p.category !== 'action');
    const actionPrompts = (prompts || []).filter(p => p.category === 'action');

    if (knowledgePrompts.length > 0) {
      const el = renderPromptChips(knowledgePrompts);
      const header = document.createElement('div');
      header.className = 'prompt-group-header';
      header.textContent = 'Dig deeper';
      el.prepend(header);
      el.appendChild(createPromptInput('knowledge', cardNodeId));
      addCanvasNode('prompts', cardNodeId, 'right', { prompts: knowledgePrompts }, el);
    }

    if (actionPrompts.length > 0) {
      const el = renderPromptChips(actionPrompts);
      const header = document.createElement('div');
      header.className = 'prompt-group-header';
      header.textContent = 'Explore decisions';
      el.prepend(header);
      el.appendChild(createPromptInput('action', cardNodeId));
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
          <div class="option-card-name">${S.escapeHtml(opt.name)}</div>
          <div class="option-card-role">${S.escapeHtml(opt.role || '')}</div>
          <div class="option-card-reason">${S.escapeHtml(opt.reason || '')}</div>
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
    if (S.isStreaming) return;
    S.isStreaming = true;

    const optionNode = canvasNodes.get(optionNodeId);
    if (!optionNode) return;

    cardEl.classList.add('option-card-selected');
    optionNode.el.querySelectorAll('.option-card').forEach(card => {
      if (card !== cardEl) {
        card.classList.add('option-card-dimmed');
      }
    });

    S.$chatInput.disabled = true;
    S.$chatSend.disabled = true;

    S.renderUserMessage(`I choose: ${option.id} — ${option.name}`);
    const statusEl = S.renderStatus('Thinking...');

    const parentOfOptions = optionNode.parentId;

    S.callChat(`I choose: ${option.id} — ${option.name}`, (data) => {
      if (statusEl) statusEl.remove();

      S.renderAIConvoMessage(data.message);

      removeCanvasNode(optionNodeId);

      if (data.card) {
        data.card.parentId = parentOfOptions;

        const el = createCardElement(data.card);
        const cardNodeId = addCanvasNode('card', parentOfOptions, 'below', data.card, el);

        placePromptsForCard(cardNodeId, data.prompts);
        placeOptionsForCard(cardNodeId, data.options);

        if (data.decisions) {
          for (const d of data.decisions) S.addDecision(d);
        }

        focusedNodeId = cardNodeId;
        setFocus(cardNodeId);

        requestAnimationFrame(() => {
          layoutAll();
          setTimeout(() => {
            layoutAll();
            CanvasEngine.focusOn(cardNodeId, 0.85);
            S.isStreaming = false;
            S.$chatInput.disabled = false;
            S.$chatSend.disabled = false;
            S.$chatInput.focus();
          }, 100);
        });
      } else {
        S.isStreaming = false;
        S.$chatInput.disabled = false;
        S.$chatSend.disabled = false;
      }
    });
  }

  // =============================================
  // EXPLORE PROMPT (click handler)
  // =============================================

  function explorePrompt(promptNodeId, prompt, chipEl) {
    if (S.isStreaming) return;
    S.isStreaming = true;

    const promptNode = canvasNodes.get(promptNodeId);
    if (!promptNode) return;

    chipEl.classList.add('prompt-chip-loading');
    promptNode.el.querySelectorAll('.prompt-chip, .prompt-input-wrap').forEach(el => {
      if (el !== chipEl) {
        el.classList.add('prompt-chip-dimmed');
        if (el.tagName === 'BUTTON') el.disabled = true;
        const input = el.querySelector?.('.prompt-input');
        if (input) input.disabled = true;
      }
    });

    S.$chatInput.disabled = true;
    S.$chatSend.disabled = true;

    S.renderUserMessage(prompt.text);
    const statusEl = S.renderStatus('Thinking...');

    const flowDir = (prompt.category || 'knowledge') === 'action' ? 'below' : 'right';
    const parentOfPrompts = promptNode.parentId;

    S.callChat(prompt.text, (data) => {
      if (statusEl) statusEl.remove();

      S.renderAIConvoMessage(data.message);

      removeCanvasNode(promptNodeId);

      if (data.card) {
        data.card.parentId = parentOfPrompts;

        const el = createCardElement(data.card);
        const cardNodeId = addCanvasNode('card', parentOfPrompts, flowDir, data.card, el);

        placePromptsForCard(cardNodeId, data.prompts);
        placeOptionsForCard(cardNodeId, data.options);

        if (data.decisions) {
          for (const d of data.decisions) S.addDecision(d);
        }

        focusedNodeId = cardNodeId;
        setFocus(cardNodeId);

        requestAnimationFrame(() => {
          layoutAll();
          setTimeout(() => {
            layoutAll();
            CanvasEngine.focusOn(cardNodeId, 0.85);
            S.isStreaming = false;
            S.$chatInput.disabled = false;
            S.$chatSend.disabled = false;
            S.$chatInput.focus();
          }, 100);
        });
      } else {
        S.isStreaming = false;
        S.$chatInput.disabled = false;
        S.$chatSend.disabled = false;
      }
    });
  }

  // =============================================
  // INITIAL MESSAGE (from conversation input)
  // =============================================

  function sendMessage(text) {
    if (S.isStreaming || !text) return;
    S.isStreaming = true;
    S.$chatInput.disabled = true;
    S.$chatSend.disabled = true;

    S.renderUserMessage(text);
    const statusEl = S.renderStatus('Thinking...');

    S.callChat(text, (data) => {
      if (statusEl) statusEl.remove();

      S.renderAIConvoMessage(data.message);

      if (data.card) {
        S.$canvasEmpty.classList.add('hidden');

        const el = createCardElement(data.card);
        const cardNodeId = addCanvasNode('card', null, 'below', data.card, el);

        S.$scenarioTitle.textContent = data.card.title;

        placePromptsForCard(cardNodeId, data.prompts);
        placeOptionsForCard(cardNodeId, data.options);

        if (data.decisions) {
          for (const d of data.decisions) S.addDecision(d);
        }

        focusedNodeId = cardNodeId;
        setFocus(cardNodeId);

        requestAnimationFrame(() => {
          layoutAll();
          setTimeout(() => {
            layoutAll();
            CanvasEngine.focusOn(cardNodeId, 0.85);
            S.isStreaming = false;
            S.$chatInput.disabled = false;
            S.$chatSend.disabled = false;
            S.$chatInput.focus();
          }, 100);
        });
      } else {
        S.isStreaming = false;
        S.$chatInput.disabled = false;
        S.$chatSend.disabled = false;
      }
    });
  }

  // =============================================
  // CARD RENDERING
  // =============================================

  function createCardElement(card) {
    const el = document.createElement('div');
    el.style.width = '560px';

    const header = document.createElement('div');
    header.className = 'canvas-card-header';
    header.textContent = card.title || 'Analysis';
    el.appendChild(header);

    const body = document.createElement('div');
    body.className = 'canvas-card-body';
    body.innerHTML = card.html || '';

    el.appendChild(body);

    el.style.cursor = 'pointer';
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-drill]')) return;
      if (!e.target.closest('button, .prompt-chip, a')) {
        const nodeId = el.dataset.nodeId;
        if (nodeId) {
          setFocus(nodeId);
          CanvasEngine.focusOn(nodeId);
        }
      }
    });

    attachDrillHandlers(body);

    return el;
  }

  // =============================================
  // INLINE DRILL-DOWN
  // =============================================

  function attachDrillHandlers(container) {
    container.addEventListener('click', (e) => {
      const drillEl = e.target.closest('[data-drill]');
      if (!drillEl) return;
      e.stopPropagation();

      const type = drillEl.dataset.drill;
      const id = drillEl.dataset.id;
      if (!type || !id) return;

      const cardBody = drillEl.closest('.canvas-card-body');

      if (drillEl.classList.contains('drill-active')) {
        if (cardBody) cardBody.querySelectorAll('.drill-expansion').forEach(el => el.remove());
        drillEl.classList.remove('drill-active');
        requestAnimationFrame(() => layoutAll());
        return;
      }

      if (cardBody) {
        cardBody.querySelectorAll('.drill-expansion').forEach(el => el.remove());
        cardBody.querySelectorAll('.drill-active').forEach(el => el.classList.remove('drill-active'));
      }

      drillEl.classList.add('drill-active');
      fetchDrillData(type, id, drillEl);
    });
  }

  function findDrillInsertionPoint(anchorEl) {
    let target = anchorEl;
    while (target.parentElement) {
      const parent = target.parentElement;
      if (parent.classList.contains('canvas-card-body')) {
        return { parent, after: target };
      }
      const display = getComputedStyle(parent).display;
      if (display === 'flex' && parent.children.length > 1) {
        return { parent: parent.parentElement, after: parent };
      }
      target = parent;
    }
    return { parent: anchorEl.parentElement, after: anchorEl };
  }

  async function fetchDrillData(type, id, anchorEl) {
    const { parent, after } = findDrillInsertionPoint(anchorEl);

    const expansion = document.createElement('div');
    expansion.className = 'drill-expansion drill-loading';
    expansion.textContent = 'Loading...';
    after.insertAdjacentElement('afterend', expansion);
    requestAnimationFrame(() => layoutAll());

    try {
      const res = await fetch(`/api/drill/${type}/${id}`);
      const data = await res.json();

      expansion.classList.remove('drill-loading');
      expansion.innerHTML = '';

      if (!data.items || data.items.length === 0) {
        expansion.textContent = 'No data found';
        requestAnimationFrame(() => layoutAll());
        return;
      }

      switch (type) {
        case 'reports':
        case 'mentees':
        case 'team-members':
          renderPeopleDrill(expansion, data.items);
          break;
        case 'projects':
          renderProjectsDrill(expansion, data.items);
          break;
        case 'skills':
          renderSkillsDrill(expansion, data.items);
          break;
        case 'teams':
          renderTeamsDrill(expansion, data.items);
          break;
        default:
          expansion.textContent = JSON.stringify(data.items);
      }

      requestAnimationFrame(() => {
        layoutAll();
        setTimeout(() => layoutAll(), 100);
      });
    } catch (err) {
      expansion.classList.remove('drill-loading');
      expansion.textContent = 'Failed to load';
    }
  }

  function renderPeopleDrill(container, items) {
    const AVATAR_BASE = 'https://mattcmorrell.github.io/ee-graph/data/avatars/';
    for (const p of items) {
      const row = document.createElement('div');
      row.className = 'drill-person';
      row.innerHTML = `
        <img src="${AVATAR_BASE}${p.id}.jpg" class="drill-avatar" onerror="this.style.display='none'" />
        <div class="drill-person-info">
          <span class="drill-person-name">${S.escapeHtml(p.name)}</span>
          <span class="drill-person-role">${S.escapeHtml(p.role || '')}</span>
        </div>
      `;
      container.appendChild(row);
    }
  }

  function renderProjectsDrill(container, items) {
    for (const p of items) {
      const row = document.createElement('div');
      row.className = 'drill-row';
      const meta = [p.priority, p.role, p.otherContributors === 0 ? 'solo' : null].filter(Boolean).join(' · ');
      row.innerHTML = `
        <span class="drill-row-label">${S.escapeHtml(p.name)}</span>
        <span class="drill-row-value">${S.escapeHtml(meta)}</span>
      `;
      container.appendChild(row);
    }
  }

  function renderSkillsDrill(container, items) {
    const chips = document.createElement('div');
    chips.className = 'drill-chips';
    for (const s of items) {
      const chip = document.createElement('span');
      chip.className = 'drill-chip';
      chip.textContent = s.name + (s.proficiency ? ` (${s.proficiency})` : '');
      if (s.othersCount === 0) chip.classList.add('drill-chip-unique');
      chips.appendChild(chip);
    }
    container.appendChild(chips);
  }

  function renderTeamsDrill(container, items) {
    for (const t of items) {
      const row = document.createElement('div');
      row.className = 'drill-row';
      row.innerHTML = `
        <span class="drill-row-label">${S.escapeHtml(t.name)}</span>
        <span class="drill-row-value">${t.memberCount} members${t.personRole ? ' · ' + S.escapeHtml(t.personRole) : ''}</span>
      `;
      container.appendChild(row);
    }
  }

  // =============================================
  // REGISTER MODE
  // =============================================

  S.registerMode({
    id: 'analysis',
    label: 'Analysis',

    init() {
      // Canvas starts empty — nothing to set up
    },

    cleanup() {
      canvasNodes.clear();
      focusedNodeId = null;
      nodeIdCounter = 0;
    },

    handleSendMessage(text) {
      sendMessage(text);
    },

    getSystemPromptId() {
      return 'analysis';
    },

    getStarters() {
      return [
        { text: 'What if Raj Patel resigns?', query: 'What happens if Raj Patel resigns?' },
        { text: 'Single points of failure', query: 'Show me the biggest single points of failure in the org' },
        { text: 'Hiring freeze impact', query: 'Which teams are most at risk if we have a hiring freeze?' },
        { text: 'Engineering vs Sales', query: 'Compare the Engineering and Sales departments' },
        { text: 'Overloaded people', query: 'Who are the most overloaded people — on 3+ projects, managing reports, and mentoring?' },
        { text: 'Austin office closure', query: 'If the Austin office closed, what would we lose?' }
      ];
    }
  });

})();
