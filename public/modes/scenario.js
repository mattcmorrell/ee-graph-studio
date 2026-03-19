// modes/scenario.js — Scenario mode (nav list + canvas + conversation)
(function() {
  const S = window.Studio;

  // --- State ---
  let entity = null;           // { id, name, role, badge, badgeType, avatarUrl }
  let domains = [];            // [{ id, title, icon, severity, meta }]
  let proposedDomains = [];    // domains proposed but not yet confirmed
  let selectedProposals = new Set(); // IDs the user has toggled on
  let activeDomainId = null;
  let navPanelEl = null;
  let svgOverlay = null;       // SVG element for connector lines
  let nodeIdCounter = 0;
  const canvasNodes = new Map(); // id → { id, type, parentId, el, children, x, y }

  function genId() { return 'sc-' + (++nodeIdCounter); }

  // =============================================
  // NAV PANEL
  // =============================================

  function createNavPanel() {
    if (navPanelEl) return;

    navPanelEl = document.createElement('div');
    navPanelEl.className = 'scenario-nav';
    navPanelEl.innerHTML = `
      <div class="scenario-nav-header">
        <div class="scenario-nav-label">Impact Areas</div>
      </div>
      <div class="scenario-nav-list" id="scenarioNavList">
        <div class="scenario-nav-empty">Start a conversation to identify impact areas</div>
      </div>
      <div class="scenario-nav-decisions" id="scenarioDecisions">
        <div class="scenario-decisions-header" id="scenarioDecisionsToggle">
          <div class="scenario-decisions-title">
            Decisions
            <span class="scenario-decisions-count" id="scenarioDecCount" style="display:none">0</span>
          </div>
          <span class="scenario-decisions-chevron" id="scenarioDecChevron">&#9660;</span>
        </div>
        <div class="scenario-decisions-body" id="scenarioDecBody">
          <div class="scenario-decisions-empty" id="scenarioDecEmpty">No decisions yet</div>
          <div class="scenario-decisions-list" id="scenarioDecList"></div>
          <div class="scenario-decisions-action" id="scenarioDecAction" style="display:none">
            <button class="scenario-execute-btn" id="scenarioExecuteBtn">Put plan into action</button>
          </div>
        </div>
      </div>
    `;

    // Insert before canvas-area
    const layout = document.querySelector('.layout');
    const canvasArea = document.querySelector('.canvas-area');
    layout.insertBefore(navPanelEl, canvasArea);

    // Wire decision toggle
    document.getElementById('scenarioDecisionsToggle').addEventListener('click', () => {
      const body = document.getElementById('scenarioDecBody');
      const chev = document.getElementById('scenarioDecChevron');
      body.classList.toggle('collapsed');
      chev.textContent = body.classList.contains('collapsed') ? '&#9654;' : '&#9660;';
    });

    // Wire execute button
    document.getElementById('scenarioExecuteBtn').addEventListener('click', () => {
      if (S.decisions.length === 0 || S.isStreaming) return;
      const summary = S.decisions.map(d => `- ${d.title}`).join('\n');
      handleSendMessage(`Execute these decisions:\n${summary}`);
    });
  }

  function destroyNavPanel() {
    if (navPanelEl) {
      navPanelEl.remove();
      navPanelEl = null;
    }
  }

  function setEntity(e) {
    entity = e;
  }

  function setDomains(newDomains) {
    domains = newDomains;
    renderNavList();
  }

  function renderNavList() {
    const list = document.getElementById('scenarioNavList');
    if (!list) return;
    list.innerHTML = '';

    if (domains.length === 0) {
      list.innerHTML = '<div class="scenario-nav-empty">Start a conversation to identify impact areas</div>';
      return;
    }

    for (const d of domains) {
      const card = document.createElement('div');
      card.className = 'scenario-nav-card' + (d.id === activeDomainId ? ' selected' : '');
      card.dataset.domainId = d.id;

      const iconClass = 'scenario-icon-' + (d.icon || 'default');
      const statusClass = d.status === 'resolved' ? 'scenario-status-resolved' :
                          d.status === 'deferred' ? 'scenario-status-deferred' :
                          d.status === 'active' ? 'scenario-status-active' : '';
      const statusLabel = d.status === 'resolved' ? 'Done' :
                          d.status === 'deferred' ? 'Later' :
                          d.status === 'active' ? 'Active' : '';

      card.innerHTML = `
        <div class="scenario-nav-card-icon ${iconClass}">${getIconChar(d.icon)}</div>
        <div class="scenario-nav-card-body">
          <div class="scenario-nav-card-title">
            ${S.escapeHtml(d.title)}
            ${statusLabel ? `<span class="scenario-nav-card-status ${statusClass}">${statusLabel}</span>` : ''}
          </div>
          <div class="scenario-nav-card-meta">${S.escapeHtml(d.meta || '')}</div>
        </div>
      `;

      card.addEventListener('click', () => selectDomain(d.id));
      list.appendChild(card);
    }
  }

  function selectDomain(domainId) {
    if (domainId === activeDomainId) return;
    activeDomainId = domainId;
    renderNavList();

    // Clear canvas and show entity + domain impact card
    clearCanvas();
    renderEntityOnCanvas();

    // Tell the AI to explore this domain
    const domain = domains.find(d => d.id === domainId);
    if (domain && !domain._explored) {
      domain._explored = true;
      handleSendMessage(`Let's explore the ${domain.title} impact area.`);
    }
  }

  // =============================================
  // DECISION CART (in nav panel)
  // =============================================

  function updateNavDecisions() {
    const count = S.decisions.length;
    const countEl = document.getElementById('scenarioDecCount');
    const emptyEl = document.getElementById('scenarioDecEmpty');
    const listEl = document.getElementById('scenarioDecList');
    const actionEl = document.getElementById('scenarioDecAction');

    if (!countEl) return;

    countEl.style.display = count > 0 ? '' : 'none';
    countEl.textContent = count;
    emptyEl.style.display = count > 0 ? 'none' : '';
    actionEl.style.display = count > 0 ? '' : 'none';

    listEl.innerHTML = '';
    for (const d of S.decisions) {
      const item = document.createElement('div');
      item.className = 'scenario-decision-item';
      item.innerHTML = `
        <div class="scenario-decision-check">&#10003;</div>
        <div class="scenario-decision-body">
          <div class="scenario-decision-title">${S.escapeHtml(d.title)}</div>
          <div class="scenario-decision-meta">${S.escapeHtml(d.category || '')}</div>
        </div>
        <button class="scenario-decision-remove">&times;</button>
      `;
      item.querySelector('.scenario-decision-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        S.removeDecision(d.id);
        updateNavDecisions();
      });
      listEl.appendChild(item);
    }
  }

  // =============================================
  // CANVAS — Entity + Connector SVG
  // =============================================

  function clearCanvas() {
    canvasNodes.clear();
    CanvasEngine.reset();
    destroySvgOverlay();
    S.$canvasEmpty.classList.add('hidden');
  }

  function createSvgOverlay() {
    if (svgOverlay) return svgOverlay;
    svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgOverlay.classList.add('scenario-connectors');
    svgOverlay.setAttribute('width', '4000');
    svgOverlay.setAttribute('height', '4000');
    document.getElementById('world').appendChild(svgOverlay);
    return svgOverlay;
  }

  function destroySvgOverlay() {
    if (svgOverlay) {
      svgOverlay.remove();
      svgOverlay = null;
    }
  }

  function addConnector(fromId, toId) {
    const svg = createSvgOverlay();
    const fromNode = canvasNodes.get(fromId);
    const toNode = canvasNodes.get(toId);
    if (!fromNode || !toNode) return;

    const fromRect = fromNode.el.getBoundingClientRect();
    const toRect = toNode.el.getBoundingClientRect();
    const world = document.getElementById('world');
    const worldRect = world.getBoundingClientRect();
    const scale = CanvasEngine.scale || 1;

    // Convert to world coordinates
    const x1 = (fromRect.left + fromRect.width / 2 - worldRect.left) / scale;
    const y1 = (fromRect.bottom - worldRect.top) / scale;
    const x2 = (toRect.left + toRect.width / 2 - worldRect.left) / scale;
    const y2 = (toRect.top - worldRect.top) / scale;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const midY = (y1 + y2) / 2;
    path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
    path.classList.add('scenario-conn');
    path.dataset.from = fromId;
    path.dataset.to = toId;
    svg.appendChild(path);
  }

  function refreshConnectors() {
    if (!svgOverlay) return;
    // Remove all existing paths
    svgOverlay.querySelectorAll('.scenario-conn').forEach(p => p.remove());
    // Redraw based on parent-child relationships
    for (const [id, node] of canvasNodes) {
      if (node.parentId && canvasNodes.has(node.parentId)) {
        addConnector(node.parentId, id);
      }
    }
  }

  function addCanvasCard(type, parentId, el, x, y) {
    const id = genId();
    const node = { id, type, parentId, el, children: [], x, y };
    canvasNodes.set(id, node);
    if (parentId) {
      const parent = canvasNodes.get(parentId);
      if (parent) parent.children.push(id);
    }
    el.dataset.scNodeId = id;
    // Position in grid units (96px per brick)
    const col = Math.round(x / 96);
    const row = Math.round(y / 96);
    CanvasEngine.addBlock(id, el, col, row);
    return id;
  }

  function renderEntityOnCanvas() {
    if (!entity) return;

    const el = document.createElement('div');
    el.className = 'scenario-canvas-entity';
    el.innerHTML = `
      <div class="scenario-ce-avatar">${entity.avatarUrl ?
        `<img src="${entity.avatarUrl}" onerror="this.parentElement.textContent='${getInitials(entity.name)}'" />` :
        getInitials(entity.name)}</div>
      <div class="scenario-ce-info">
        <div class="scenario-ce-name">${S.escapeHtml(entity.name)}</div>
        <div class="scenario-ce-role">${S.escapeHtml(entity.role || '')}</div>
        ${entity.badge ? `<span class="scenario-ce-badge badge-${entity.badgeType || 'info'}">${S.escapeHtml(entity.badge)}</span>` : ''}
      </div>
    `;

    const entityNodeId = addCanvasCard('entity', null, el, 96, 48);
    S.$canvasEmpty.classList.add('hidden');

    // After render, focus on it
    requestAnimationFrame(() => {
      CanvasEngine.zoomToFit(80);
    });

    return entityNodeId;
  }

  // =============================================
  // CARD RENDERING (from AI response)
  // =============================================

  function createCardElement(card) {
    const el = document.createElement('div');
    el.className = 'scenario-canvas-card';
    el.innerHTML = `
      <div class="scenario-cc-header">${S.escapeHtml(card.title)}</div>
      <div class="scenario-cc-body">${card.html}</div>
    `;
    return el;
  }

  function renderExploreBar(parentEl, prompts) {
    if (!prompts || prompts.length === 0) return;

    const bar = document.createElement('div');
    bar.className = 'scenario-explore-bar';

    const trigger = document.createElement('button');
    trigger.className = 'scenario-explore-trigger';
    trigger.innerHTML = `<span class="scenario-explore-arrow">&#9654;</span> Explore <span class="scenario-explore-chev">&#9654;</span>`;
    bar.appendChild(trigger);

    const expanded = document.createElement('div');
    expanded.className = 'scenario-explore-expanded';
    expanded.style.display = 'none';

    const chips = document.createElement('div');
    chips.className = 'scenario-explore-chips';
    for (const p of prompts) {
      const chip = document.createElement('span');
      chip.className = 'scenario-chip scenario-chip-' + (p.category === 'knowledge' ? 'k' : 'a');
      chip.textContent = p.text;
      chip.addEventListener('click', () => {
        // Collapse explore bar, send prompt as message
        expanded.style.display = 'none';
        trigger.querySelector('.scenario-explore-arrow').innerHTML = '&#9654;';
        handleSendMessage(p.text);
      });
      chips.appendChild(chip);
    }
    expanded.appendChild(chips);

    // Custom input
    const askRow = document.createElement('div');
    askRow.className = 'scenario-explore-ask';
    askRow.innerHTML = `<input class="scenario-explore-input" placeholder="Ask something else..." /><button class="scenario-explore-send">&#8593;</button>`;
    askRow.querySelector('.scenario-explore-send').addEventListener('click', () => {
      const input = askRow.querySelector('.scenario-explore-input');
      const text = input.value.trim();
      if (text) {
        expanded.style.display = 'none';
        handleSendMessage(text);
      }
    });
    askRow.querySelector('.scenario-explore-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        askRow.querySelector('.scenario-explore-send').click();
      }
    });
    expanded.appendChild(askRow);

    bar.appendChild(expanded);

    trigger.addEventListener('click', () => {
      const isOpen = expanded.style.display !== 'none';
      expanded.style.display = isOpen ? 'none' : '';
      trigger.querySelector('.scenario-explore-arrow').innerHTML = isOpen ? '&#9654;' : '&#9660;';
    });

    parentEl.appendChild(bar);
  }

  // =============================================
  // DOMAIN PROPOSALS (in conversation)
  // =============================================

  function renderDomainProposals(proposed) {
    proposedDomains = proposed;
    // Pre-select high severity domains
    selectedProposals.clear();
    for (const d of proposed) {
      if (d.severity === 'high') selectedProposals.add(d.id);
    }

    const container = document.createElement('div');
    container.className = 'msg msg-ai';

    const inner = document.createElement('div');
    inner.className = 'scenario-proposals';

    const chips = document.createElement('div');
    chips.className = 'scenario-proposal-chips';

    for (const d of proposed) {
      const chip = document.createElement('button');
      chip.className = 'scenario-proposal-chip' + (selectedProposals.has(d.id) ? ' selected' : '');
      chip.dataset.domainId = d.id;

      const sevClass = d.severity === 'high' ? 'sev-high' :
                       d.severity === 'medium' ? 'sev-med' : 'sev-low';
      const sevLabel = d.severity === 'high' ? 'HIGH' :
                       d.severity === 'medium' ? 'MED' : 'LOW';

      chip.innerHTML = `
        <span class="scenario-proposal-sev ${sevClass}">${sevLabel}</span>
        <span class="scenario-proposal-title">${S.escapeHtml(d.title)}</span>
        <span class="scenario-proposal-meta">${S.escapeHtml(d.meta || '')}</span>
      `;

      chip.addEventListener('click', () => {
        if (selectedProposals.has(d.id)) {
          selectedProposals.delete(d.id);
          chip.classList.remove('selected');
        } else {
          selectedProposals.add(d.id);
          chip.classList.add('selected');
        }
        // Update confirm button count
        const btn = container.querySelector('.scenario-proposal-confirm');
        if (btn) {
          const count = selectedProposals.size;
          btn.textContent = count > 0 ? `Explore ${count} area${count > 1 ? 's' : ''}` : 'Select areas to explore';
          btn.disabled = count === 0;
        }
      });

      chips.appendChild(chip);
    }
    inner.appendChild(chips);

    // Confirm button
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'scenario-proposal-confirm';
    const initCount = selectedProposals.size;
    confirmBtn.textContent = initCount > 0 ? `Explore ${initCount} area${initCount > 1 ? 's' : ''}` : 'Select areas to explore';
    confirmBtn.disabled = initCount === 0;
    confirmBtn.addEventListener('click', () => {
      if (selectedProposals.size === 0) return;
      commitDomainSelection();
      // Disable the proposal UI after confirming
      container.querySelectorAll('.scenario-proposal-chip').forEach(c => {
        c.style.pointerEvents = 'none';
        if (!c.classList.contains('selected')) c.style.opacity = '0.3';
      });
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Exploring...';
    });
    inner.appendChild(confirmBtn);

    container.appendChild(inner);
    S.$messages.appendChild(container);
    S.scrollMessages();
  }

  function commitDomainSelection() {
    // Move selected proposals into the nav as active domains
    const selected = proposedDomains.filter(d => selectedProposals.has(d.id));
    const unselected = proposedDomains.filter(d => !selectedProposals.has(d.id));

    // Set selected as active, unselected as available but not shown
    for (const d of selected) d.status = 'active';
    setDomains(selected);

    // Store unselected for later access
    proposedDomains = unselected;

    // Render entity on canvas
    renderEntityOnCanvas();

    // Tell the AI what was selected, then auto-explore the first domain
    const names = selected.map(d => d.title).join(', ');
    const first = selected[0];

    S.renderUserMessage(`Let's explore: ${names}`);
    const statusEl = S.renderStatus('Setting up...');

    S.callChat(`Selected domains: ${names}. Start with ${first.title}.`, (data) => {
      if (statusEl) statusEl.remove();
      S.isStreaming = false;
      S.renderAIConvoMessage(data.message);

      // Auto-select first domain and handle any card in the response
      activeDomainId = first.id;
      first._explored = true;
      renderNavList();

      if (data.card) {
        handleCardResponse(data);
      }
    });

    S.isStreaming = true;
  }

  // =============================================
  // MESSAGE HANDLING
  // =============================================

  async function handleSendMessage(text) {
    if (S.isStreaming) return;
    S.isStreaming = true;

    S.renderUserMessage(text);
    const statusEl = S.renderStatus('Thinking...');

    S.callChat(text, (data) => {
      // Remove status
      if (statusEl) statusEl.remove();
      S.isStreaming = false;

      // Render AI conversation message
      S.renderAIConvoMessage(data.message);

      // Handle entity (initial response)
      if (data.entity) {
        setEntity(data.entity);
        S.$scenarioTitle.textContent = entity.name + (entity.badge ? ` — ${entity.badge}` : '');
      }

      // Handle proposed domains — render as selectable chips in conversation
      if (data.proposedDomains && data.proposedDomains.length > 0) {
        renderDomainProposals(data.proposedDomains);
      }

      // Legacy: handle direct domains (in case AI sends them)
      if (data.domains && data.domains.length > 0) {
        setDomains(data.domains);
      }

      // Handle canvas card + options + decisions
      if (data.card) {
        handleCardResponse(data);
      }

      // Handle options without a card
      if (!data.card && data.options && data.options.length > 0) {
        renderOptions(data.options, null);
      }

      // Handle decisions
      if (data.decisions) {
        for (const d of data.decisions) {
          S.addDecision(d);
        }
        updateNavDecisions();
      }
    });
  }

  function handleCardResponse(data) {
    const cardEl = createCardElement(data.card);

    // Find parent node (entity or previous card)
    let parentNodeId = null;
    if (data.card.parentId) {
      for (const [nid, node] of canvasNodes) {
        if (node.el?.dataset?.cardId === data.card.parentId) {
          parentNodeId = nid;
          break;
        }
      }
    }
    // Default parent: entity node
    if (!parentNodeId) {
      for (const [nid, node] of canvasNodes) {
        if (node.type === 'entity') { parentNodeId = nid; break; }
      }
    }

    // Position below parent
    const parent = parentNodeId ? canvasNodes.get(parentNodeId) : null;
    const px = parent ? parent.x : 96;
    const py = parent ? parent.y + 200 : 250;

    cardEl.dataset.cardId = data.card.id;
    const nodeId = addCanvasCard('card', parentNodeId, cardEl, px, py);

    // Add explore bar with prompts
    if (data.prompts && data.prompts.length > 0) {
      renderExploreBar(cardEl, data.prompts);
    }

    // Draw connectors
    requestAnimationFrame(() => {
      refreshConnectors();
      CanvasEngine.zoomToFit(80);
    });

    // Handle options on this card
    if (data.options && data.options.length > 0) {
      renderOptions(data.options, data.card.id);
    }

    // Handle decisions
    if (data.decisions) {
      for (const d of data.decisions) {
        S.addDecision(d);
      }
      updateNavDecisions();
    }
  }

  function renderOptions(options, parentCardId) {
    // TODO: Phase 3 — comparison columns
    // For now, render as simple option cards in conversation
    for (const opt of options) {
      S.renderAIConvoMessage(`Option: ${opt.name} — ${opt.reason}`);
    }
  }

  // =============================================
  // UTILITIES
  // =============================================

  function getInitials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  }

  function getIconChar(icon) {
    const icons = {
      compliance: '!',
      staffing: '\u25B2',   // ▲
      knowledge: '\u25C6',   // ◆
      project: '\u25CF',     // ●
      morale: '\u2665',      // ♥
      budget: '$',
      facilities: '\u25A0',  // ■
      attrition: '\u26A0',   // ⚠
      legal: '\u00A7',       // §
    };
    return icons[icon] || '\u25CF';
  }

  // =============================================
  // MODE REGISTRATION
  // =============================================

  S.registerMode({
    id: 'scenario',
    label: 'Scenario',

    init() {
      createNavPanel();
      // Hide the default decision log — we use our own in the nav panel
      const dl = document.getElementById('decisionLog');
      if (dl) dl.style.display = 'none';
    },

    cleanup() {
      destroyNavPanel();
      entity = null;
      domains = [];
      proposedDomains = [];
      selectedProposals.clear();
      activeDomainId = null;
      canvasNodes.clear();
      nodeIdCounter = 0;
      destroySvgOverlay();
      // Re-show default decision log
      const dl = document.getElementById('decisionLog');
      if (dl) dl.style.display = '';
    },

    handleSendMessage(text) {
      handleSendMessage(text);
    },

    getSystemPromptId() {
      return 'scenario';
    },

    getStarters() {
      return [
        { text: 'What if Raj Patel resigned?', query: 'Raj Patel just resigned. What do we need to handle?' },
        { text: 'Evaluate a team restructuring', query: 'What would happen if we merged the Platform and Infrastructure teams?' },
        { text: 'Assess a policy change', query: 'What if we mandated 3 days in office for everyone?' },
        { text: 'Explore a skill gap', query: 'We need machine learning capability by Q3 but have no ML engineers. What are our options?' }
      ];
    }
  });

})();
