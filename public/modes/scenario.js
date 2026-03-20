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
  let pendingParentCardId = null; // card ID of the card whose prompt was clicked
  let focusedNodeId = null;      // currently focused canvas node
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
  // CANVAS — Layout Engine + Connectors
  // =============================================

  const V_GAP = 50;   // vertical gap between tree levels
  const H_GAP = 40;   // horizontal gap between siblings

  function clearCanvas() {
    canvasNodes.clear();
    CanvasEngine.reset();
    destroySvgOverlay();
    S.$canvasEmpty.classList.add('hidden');
  }

  // --- SVG Overlay for connector lines ---

  function createSvgOverlay() {
    if (svgOverlay) return svgOverlay;
    svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgOverlay.classList.add('scenario-connectors');
    svgOverlay.style.width = '8000px';
    svgOverlay.style.height = '8000px';
    // Offset so connectors work with negative positions
    svgOverlay.style.left = '-2000px';
    svgOverlay.style.top = '-2000px';
    svgOverlay.setAttribute('viewBox', '-2000 -2000 8000 8000');
    document.getElementById('world').appendChild(svgOverlay);
    return svgOverlay;
  }

  function destroySvgOverlay() {
    if (svgOverlay) {
      svgOverlay.remove();
      svgOverlay = null;
    }
  }

  function drawConnectors() {
    const svg = createSvgOverlay();
    svg.querySelectorAll('.scenario-conn').forEach(p => p.remove());

    for (const [id, node] of canvasNodes) {
      if (!node.parentId) continue;
      const parent = canvasNodes.get(node.parentId);
      if (!parent) continue;

      // Use layout-computed positions
      const x1 = parent._lx + parent._lw / 2;
      const y1 = parent._ly + parent._lh;
      const x2 = node._lx + node._lw / 2;
      const y2 = node._ly;

      const midY = (y1 + y2) / 2;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`);
      path.classList.add('scenario-conn');
      svg.appendChild(path);
    }
  }

  // --- Add card to tree (no positioning — layoutTree handles that) ---

  function addCanvasCard(type, parentId, el) {
    const id = genId();
    const node = { id, type, parentId, el, children: [],
                   _lx: 0, _ly: 0, _lw: 0, _lh: 0, _subtreeW: 0 };
    canvasNodes.set(id, node);
    if (parentId) {
      const parent = canvasNodes.get(parentId);
      if (parent) parent.children.push(id);
    }
    el.dataset.scNodeId = id;
    // Add at origin — layoutTree will move it
    CanvasEngine.addBlock(id, el, 0, 0);
    return id;
  }

  // --- Layout algorithm (Reingold-Tilford inspired) ---

  function layoutTree() {
    const roots = [...canvasNodes.values()].filter(n => !n.parentId);
    if (roots.length === 0) return;

    // Phase 1: Measure all nodes (must be in DOM already)
    for (const [id, node] of canvasNodes) {
      node._lw = node.el.offsetWidth || 200;
      node._lh = node.el.offsetHeight || 100;
    }

    // Phase 2: Compute subtree widths (bottom-up)
    function computeSubtreeWidth(id) {
      const node = canvasNodes.get(id);
      if (!node) return 0;
      if (node.children.length === 0) {
        node._subtreeW = node._lw;
        return node._subtreeW;
      }
      let total = 0;
      for (let i = 0; i < node.children.length; i++) {
        if (i > 0) total += H_GAP;
        total += computeSubtreeWidth(node.children[i]);
      }
      node._subtreeW = Math.max(node._lw, total);
      return node._subtreeW;
    }

    // Phase 3: Position nodes (top-down, centered under parent)
    function positionNode(id, centerX, y) {
      const node = canvasNodes.get(id);
      if (!node) return;

      node._lx = centerX - node._lw / 2;
      node._ly = y;

      if (node.children.length > 0) {
        const childY = y + node._lh + V_GAP;

        // Total width needed for children
        let totalChildW = 0;
        for (let i = 0; i < node.children.length; i++) {
          if (i > 0) totalChildW += H_GAP;
          totalChildW += canvasNodes.get(node.children[i])._subtreeW;
        }

        // Distribute children centered under this node
        let childX = centerX - totalChildW / 2;
        for (const childId of node.children) {
          const child = canvasNodes.get(childId);
          const childCx = childX + child._subtreeW / 2;
          positionNode(childId, childCx, childY);
          childX += child._subtreeW + H_GAP;
        }
      }
    }

    // Run layout for each root
    for (const root of roots) {
      computeSubtreeWidth(root.id);
      positionNode(root.id, root._subtreeW / 2, 0);
    }

    // Phase 4: Apply positions with animation
    for (const [id, node] of canvasNodes) {
      CanvasEngine.moveBlock(id, node._lx, node._ly, true);
    }

    // Phase 5: Draw connectors (after a tick so positions settle)
    requestAnimationFrame(() => {
      drawConnectors();
      CanvasEngine.zoomToFit(80);
    });
  }

  // --- Render entity card on canvas ---

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

    const entityNodeId = addCanvasCard('entity', null, el);
    S.$canvasEmpty.classList.add('hidden');

    // Layout and fit
    requestAnimationFrame(() => layoutTree());

    return entityNodeId;
  }

  // =============================================
  // FOCUS MANAGEMENT
  // =============================================

  function setFocus(nodeId) {
    const prev = focusedNodeId;
    focusedNodeId = nodeId;

    for (const [id, node] of canvasNodes) {
      if (id === nodeId) {
        // Focused card: glow, full opacity, explore bar enabled
        node.el.classList.add('scenario-focused');
        node.el.classList.remove('scenario-dimmed');
        const bar = node.el.querySelector('.scenario-explore-bar');
        if (bar) bar.classList.remove('scenario-explore-disabled');
      } else if (node.type === 'entity') {
        // Entity never dims
        node.el.classList.remove('scenario-focused', 'scenario-dimmed');
      } else {
        // Other cards: dim, explore bar disabled
        node.el.classList.remove('scenario-focused');
        node.el.classList.add('scenario-dimmed');
        const bar = node.el.querySelector('.scenario-explore-bar');
        if (bar) bar.classList.add('scenario-explore-disabled');
        // Collapse other cards' explore bars
        const expanded = node.el.querySelector('.scenario-explore-expanded');
        const arrow = node.el.querySelector('.scenario-explore-arrow');
        if (expanded) expanded.style.display = 'none';
        if (arrow) arrow.innerHTML = '&#9654;';
      }
    }

    // Open the focused card's explore bar
    if (nodeId) {
      const focused = canvasNodes.get(nodeId);
      if (focused) {
        const expanded = focused.el.querySelector('.scenario-explore-expanded');
        const arrow = focused.el.querySelector('.scenario-explore-arrow');
        if (expanded && expanded.style.display === 'none') {
          expanded.style.display = '';
          if (arrow) arrow.innerHTML = '&#9660;';
        }
      }
    }
  }

  function setupCardClickToFocus(el, nodeId) {
    el.addEventListener('click', (e) => {
      // Don't refocus if clicking a button, chip, input, or link inside the card
      if (e.target.closest('button, input, a, .scenario-chip')) return;
      setFocus(nodeId);
    });
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
    trigger.innerHTML = `<span class="scenario-explore-arrow">&#9660;</span> Explore <span class="scenario-explore-chev">&#9654;</span>`;
    bar.appendChild(trigger);

    // Badge area — shows consumed prompts when collapsed
    const badge = document.createElement('div');
    badge.className = 'scenario-explore-badge';
    badge.style.display = 'none';
    bar.appendChild(badge);

    const expanded = document.createElement('div');
    expanded.className = 'scenario-explore-expanded';

    const chips = document.createElement('div');
    chips.className = 'scenario-explore-chips';
    for (const p of prompts) {
      const chip = document.createElement('span');
      chip.className = 'scenario-chip scenario-chip-' + (p.category === 'knowledge' ? 'k' : 'a');
      chip.textContent = p.text;
      chip.addEventListener('click', () => {
        // Mark chip as used
        chip.classList.add('scenario-chip-used');
        chip.style.pointerEvents = 'none';

        // Collapse explore bar and show badge
        expanded.style.display = 'none';
        trigger.querySelector('.scenario-explore-arrow').innerHTML = '&#9654;';
        badge.textContent = p.text;
        badge.style.display = '';

        // Track parent and send
        const cardEl = parentEl.closest('[data-card-id]');
        if (cardEl) pendingParentCardId = cardEl.dataset.cardId;
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
        trigger.querySelector('.scenario-explore-arrow').innerHTML = '&#9654;';
        badge.textContent = text;
        badge.style.display = '';
        const cardEl = parentEl.closest('[data-card-id]');
        if (cardEl) pendingParentCardId = cardEl.dataset.cardId;
        handleSendMessage(text);
        input.value = '';
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
      // Don't toggle if disabled (not focused)
      if (bar.classList.contains('scenario-explore-disabled')) return;
      const isOpen = expanded.style.display !== 'none';
      expanded.style.display = isOpen ? 'none' : '';
      trigger.querySelector('.scenario-explore-arrow').innerHTML = isOpen ? '&#9654;' : '&#9660;';
      // Hide badge when expanded, show when collapsed
      if (badge.textContent) badge.style.display = isOpen ? '' : 'none';
    });

    parentEl.appendChild(bar);
  }

  // =============================================
  // DOMAIN PROPOSALS (in conversation)
  // =============================================

  function renderDomainProposals(proposed) {
    proposedDomains = proposed;
    // Nothing pre-selected — user chooses
    selectedProposals.clear();

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
        <div class="scenario-proposal-row">
          <span class="scenario-proposal-sev ${sevClass}">${sevLabel}</span>
          <span class="scenario-proposal-title">${S.escapeHtml(d.title)}</span>
        </div>
        <div class="scenario-proposal-meta">${S.escapeHtml(d.meta || '')}</div>
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
    confirmBtn.textContent = 'Select areas to explore';
    confirmBtn.disabled = true;
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

    // Find parent node: AI's parentId > pendingParentCardId > entity
    let parentNodeId = null;
    const lookupCardId = data.card.parentId || pendingParentCardId;
    if (lookupCardId) {
      for (const [nid, node] of canvasNodes) {
        if (node.el?.dataset?.cardId === lookupCardId) {
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
    pendingParentCardId = null; // consumed

    cardEl.dataset.cardId = data.card.id;
    const nodeId = addCanvasCard('card', parentNodeId, cardEl);

    // Add explore bar with prompts
    if (data.prompts && data.prompts.length > 0) {
      renderExploreBar(cardEl, data.prompts);
    }

    // Wire click-to-focus
    setupCardClickToFocus(cardEl, nodeId);

    // Auto-focus this new card
    requestAnimationFrame(() => {
      layoutTree();
      setFocus(nodeId);
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
      focusedNodeId = null;
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
