// modes/scenario.js — Scenario mode (nav list + canvas + conversation)
(function() {
  const S = window.Studio;

  // --- State ---
  let entity = null;           // { id, name, role, badge, badgeType, avatarUrl }
  let entityLocked = false;    // once primary entity is set, ignore further entity_preview events
  let domains = [];            // [{ id, title, icon, severity, meta }]
  let proposedDomains = [];    // domains proposed but not yet confirmed
  let selectedProposals = new Set(); // IDs the user has toggled on
  let activeDomainId = null;
  let navPanelEl = null;
  let svgOverlay = null;       // SVG element for connector lines
  let nodeIdCounter = 0;
  let pendingParentCardId = null; // card ID of the card whose prompt was clicked
  let focusedNodeId = null;      // currently focused canvas node
  let comparisonLayout = 'compact'; // 'full' or 'compact'
  const canvasNodes = new Map(); // id → { id, type, parentId, el, children, x, y }
  const domainCanvasStates = new Map(); // domainId → { nodes, svgEl, focusedId, entityNodeId }

  function genId() { return 'sc-' + (++nodeIdCounter); }

  // =============================================
  // NAV PANEL
  // =============================================

  // Floating window references
  let floatImpactEl = null;
  let floatDecisionsEl = null;

  function createNavPanel() {
    if (floatImpactEl) return;
    const canvasArea = document.querySelector('.canvas-area');

    // --- Impact Areas floating window ---
    floatImpactEl = document.createElement('div');
    floatImpactEl.className = 'scenario-float scenario-float-impact';
    floatImpactEl.style.display = 'none'; // hidden until domains arrive
    floatImpactEl.innerHTML = `
      <div class="scenario-float-header" id="scenarioImpactHeader">
        <div class="scenario-float-title">Impact Areas</div>
        <button class="scenario-float-toggle" id="scenarioImpactToggle"></button>
      </div>
      <div class="scenario-float-body" id="scenarioNavList"></div>
    `;
    canvasArea.appendChild(floatImpactEl);

    document.getElementById('scenarioImpactHeader').addEventListener('click', () => {
      floatImpactEl.classList.toggle('scenario-float-collapsed');
      requestAnimationFrame(repositionFloats);
    });

    // --- Decisions floating window ---
    floatDecisionsEl = document.createElement('div');
    floatDecisionsEl.className = 'scenario-float scenario-float-decisions';
    floatDecisionsEl.style.display = 'none'; // hidden until decisions exist
    floatDecisionsEl.innerHTML = `
      <div class="scenario-float-header" id="scenarioDecHeader">
        <div class="scenario-float-title">
          Decisions
          <span class="scenario-decisions-count" id="scenarioDecCount" style="display:none">0</span>
        </div>
        <button class="scenario-float-toggle" id="scenarioDecToggle"></button>
      </div>
      <div class="scenario-float-body">
        <div class="scenario-decisions-list" id="scenarioDecList"></div>
        <div class="scenario-decisions-action" id="scenarioDecAction" style="display:none">
          <button class="scenario-execute-btn" id="scenarioExecuteBtn">Put plan into action</button>
        </div>
      </div>
    `;
    canvasArea.appendChild(floatDecisionsEl);

    document.getElementById('scenarioDecHeader').addEventListener('click', () => {
      floatDecisionsEl.classList.toggle('scenario-float-collapsed');
    });

    document.getElementById('scenarioExecuteBtn').addEventListener('click', () => {
      if (S.decisions.length === 0 || S.isStreaming) return;
      const summary = S.decisions.map(d => `- ${d.title}`).join('\n');
      handleSendMessage(`Execute these decisions:\n${summary}`);
    });

    // Keep reference for legacy compatibility
    navPanelEl = floatImpactEl;
  }

  function repositionFloats() {
    if (!floatDecisionsEl || !floatImpactEl) return;
    // If impact areas visible, stack decisions below it
    if (floatImpactEl.style.display !== 'none') {
      const gap = 12;
      const impactBottom = floatImpactEl.offsetTop + floatImpactEl.offsetHeight;
      floatDecisionsEl.style.top = (impactBottom + gap) + 'px';
    } else {
      floatDecisionsEl.style.top = '16px';
    }
  }

  function destroyNavPanel() {
    if (floatImpactEl) { floatImpactEl.remove(); floatImpactEl = null; }
    if (floatDecisionsEl) { floatDecisionsEl.remove(); floatDecisionsEl = null; }
    navPanelEl = null;
  }

  function setEntity(e) {
    entity = e;
    entityLocked = true;
  }

  function updateTitleBar() {
    if (!entity) return;
    const domain = domains.find(d => d.id === activeDomainId);
    const parts = [entity.name];
    if (entity.badge) parts.push(entity.badge);
    if (domain) parts.push(domain.title);
    S.$scenarioTitle.textContent = parts.join(' — ');
  }

  function setDomains(newDomains) {
    domains = newDomains;
    renderNavList();
    if (floatImpactEl) {
      floatImpactEl.style.display = newDomains.length > 0 ? '' : 'none';
    }
    requestAnimationFrame(repositionFloats);
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
                          d.status === 'deferred' ? 'scenario-status-deferred' : '';
      const statusLabel = d.status === 'resolved' ? 'Done' :
                          d.status === 'deferred' ? 'Later' : '';

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

  function saveDomainState(domainId) {
    if (!domainId) return;
    // Detach all canvas elements from DOM and store them
    const savedNodes = new Map();
    for (const [id, node] of canvasNodes) {
      if (node.el && node.el.parentElement) {
        node.el.remove();
      }
      savedNodes.set(id, { ...node });
    }
    const t = CanvasEngine.transform;
    domainCanvasStates.set(domainId, {
      nodes: savedNodes,
      svgEl: svgOverlay,
      focusedId: focusedNodeId,
      allocStates: new Map(allocState),
      camera: { x: t.x, y: t.y, scale: t.scale }
    });
    allocState.clear();
    // Detach SVG without destroying
    if (svgOverlay && svgOverlay.parentElement) {
      svgOverlay.remove();
    }
    // Clear local state (don't destroy elements)
    canvasNodes.clear();
    svgOverlay = null;
    focusedNodeId = null;
    // Clear canvas engine blocks
    CanvasEngine.reset();
  }

  function restoreDomainState(domainId) {
    const saved = domainCanvasStates.get(domainId);
    if (!saved) return false;

    const world = document.getElementById('world');

    // Restore canvas nodes
    canvasNodes.clear();
    for (const [id, node] of saved.nodes) {
      canvasNodes.set(id, node);
      // Re-add element to DOM via canvas engine
      CanvasEngine.addBlock(id, node.el, 0, 0);
      // Move to saved position
      CanvasEngine.moveBlock(id, node._lx, node._ly, false);
    }

    // Restore SVG overlay
    if (saved.svgEl) {
      svgOverlay = saved.svgEl;
      world.appendChild(svgOverlay);
    }

    // Restore allocation states
    allocState.clear();
    if (saved.allocStates) {
      for (const [k, v] of saved.allocStates) allocState.set(k, v);
    }

    // Restore focus
    focusedNodeId = saved.focusedId;
    if (focusedNodeId) {
      setFocus(focusedNodeId);
    }

    S.$canvasEmpty.classList.add('hidden');

    requestAnimationFrame(() => {
      drawConnectors();
      // Restore exact camera position — no animation, no jumping
      if (saved.camera) {
        const ct = CanvasEngine.transform;
        ct.x = saved.camera.x;
        ct.y = saved.camera.y;
        ct.scale = saved.camera.scale;
        // Apply immediately via the world transform
        document.getElementById('world').style.transform =
          `translate(${ct.x}px, ${ct.y}px) scale(${ct.scale})`;
      }
    });

    // Process any response that arrived while viewing another domain
    if (saved.pendingResponse) {
      const data = saved.pendingResponse;
      saved.pendingResponse = null;
      if (data.card) handleCardResponse(data);
      if (!data.card && !data.allocation && data.options && data.options.length > 0) {
        renderOptions(data.options, null);
      }
      if (data.allocation) {
        S.$canvasEmpty.classList.add('hidden');
        renderAllocation(data.allocation, null);
      }
      if (data.decisions) {
        for (const d of data.decisions) S.addDecision(d);
        updateNavDecisions();
      }
      handleRecommendation(data);
    }

    return true;
  }

  function selectDomain(domainId) {
    if (domainId === activeDomainId) return;

    // Save current domain's canvas state
    saveDomainState(activeDomainId);

    activeDomainId = domainId;
    renderNavList();
    updateTitleBar();

    // Try to restore saved state for this domain
    if (restoreDomainState(domainId)) {
      return; // Restored — done
    }

    // First visit to this domain — fresh canvas with entity
    S.$canvasEmpty.classList.add('hidden');
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
    const listEl = document.getElementById('scenarioDecList');
    const actionEl = document.getElementById('scenarioDecAction');

    if (!countEl) return;

    // Show/hide the floating decisions window
    if (floatDecisionsEl) {
      floatDecisionsEl.style.display = count > 0 ? '' : 'none';
    }

    countEl.style.display = count > 0 ? '' : 'none';
    countEl.textContent = count;
    if (actionEl) actionEl.style.display = count > 0 ? '' : 'none';
    requestAnimationFrame(repositionFloats);

    listEl.innerHTML = '';
    for (const d of S.decisions) {
      const item = document.createElement('div');
      item.className = 'scenario-decision-item';
      if (d._canvasNodeId) item.style.cursor = 'pointer';
      const title = d.title || d.name || d.description || d.label || (typeof d === 'string' ? d : 'Decision');
      const meta = d.category || d.domain || '';
      item.innerHTML = `
        <div class="scenario-decision-check">&#10003;</div>
        <div class="scenario-decision-body">
          <div class="scenario-decision-title">${S.escapeHtml(title)}</div>
          ${meta ? `<div class="scenario-decision-meta">${S.escapeHtml(meta)}</div>` : ''}
        </div>
        <button class="scenario-decision-remove">&times;</button>
      `;
      // Click to navigate to source card
      item.addEventListener('click', (e) => {
        if (e.target.closest('.scenario-decision-remove')) return;
        if (!d._canvasNodeId) return;
        // Switch domain if needed
        if (d._domainId && d._domainId !== activeDomainId) {
          selectDomain(d._domainId);
        }
        CanvasEngine.focusOn(d._canvasNodeId);
        setFocus(d._canvasNodeId);
      });
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

  // --- Canvas Placeholder (loading card) ---

  function findEntityNodeId() {
    for (const [nid, node] of canvasNodes) {
      if (node.type === 'entity') return nid;
    }
    return null;
  }

  function findNodeByCardId(cardId) {
    for (const [nid, node] of canvasNodes) {
      if (node.el?.dataset?.cardId === cardId || node.el?.dataset?.allocId === cardId) return nid;
    }
    return null;
  }

  function createCanvasPlaceholder(parentNodeId) {
    const el = document.createElement('div');
    el.className = 'scenario-canvas-placeholder';
    el.innerHTML = `
      <div class="scenario-ph-dots">
        <div class="scenario-ph-dot"></div>
        <div class="scenario-ph-dot"></div>
        <div class="scenario-ph-dot"></div>
      </div>
      <div class="scenario-ph-text">Thinking...</div>
    `;

    const nodeId = addCanvasCard('placeholder', parentNodeId, el);
    S.$canvasEmpty.classList.add('hidden');
    requestAnimationFrame(() => layoutTree());
    return nodeId;
  }

  function updateCanvasPlaceholder(nodeId, message) {
    const node = canvasNodes.get(nodeId);
    if (!node) return;
    const textEl = node.el.querySelector('.scenario-ph-text');
    if (textEl) textEl.textContent = message;
  }

  function removeCanvasPlaceholder(nodeId) {
    const node = canvasNodes.get(nodeId);
    if (!node) return;
    if (node.parentId) {
      const parent = canvasNodes.get(node.parentId);
      if (parent) parent.children = parent.children.filter(c => c !== nodeId);
    }
    CanvasEngine.removeBlock(nodeId);
    canvasNodes.delete(nodeId);
    drawConnectors();
  }

  // --- New Card Indicator ---

  function isNodeInViewport(nodeId) {
    const node = canvasNodes.get(nodeId);
    if (!node) return true;
    const t = CanvasEngine.transform;
    const vp = document.getElementById('viewport');
    if (!vp) return true;
    // Card's screen position
    const sx = node._lx * t.scale + t.x;
    const sy = node._ly * t.scale + t.y;
    const sw = node._lw * t.scale;
    const sh = node._lh * t.scale;
    const vpW = vp.clientWidth;
    const vpH = vp.clientHeight;
    // Check if any part of the card is visible
    return sx + sw > 0 && sx < vpW && sy + sh > 0 && sy < vpH;
  }

  function showNewCardIndicatorIfNeeded(nodeId) {
    if (isNodeInViewport(nodeId)) return;
    dismissNewCardIndicator();

    const node = canvasNodes.get(nodeId);
    if (!node) return;
    const t = CanvasEngine.transform;
    const vp = document.getElementById('viewport');
    const cardScreenY = node._ly * t.scale + t.y;
    const isBelow = cardScreenY >= vp.clientHeight;

    const pill = document.createElement('div');
    pill.className = 'scenario-new-card-pill';
    pill.classList.add(isBelow ? 'scenario-pill-bottom' : 'scenario-pill-top');
    pill.innerHTML = `<span class="scenario-pill-arrow">${isBelow ? '↓' : '↑'}</span> New card ${isBelow ? 'below' : 'above'}`;
    pill.addEventListener('click', () => {
      CanvasEngine.focusOn(nodeId);
      dismissNewCardIndicator();
    });
    document.querySelector('.canvas-area').appendChild(pill);
  }

  function dismissNewCardIndicator() {
    document.querySelectorAll('.scenario-new-card-pill').forEach(el => el.remove());
  }

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
    // Only center on the first layout — not during exploration
    const isFirstLayout = roots.length === 1 && roots[0].children.length === 0;
    requestAnimationFrame(() => {
      drawConnectors();
      if (isFirstLayout) CanvasEngine.focusOn(roots[0].id, 1);
    });
  }

  // --- Render entity card on canvas ---

  function hasEntityOnCanvas() {
    for (const [, node] of canvasNodes) {
      if (node.type === 'entity') return true;
    }
    return false;
  }

  function updateEntityBadge() {
    if (!entity || !entity.badge) return;
    for (const [, node] of canvasNodes) {
      if (node.type === 'entity') {
        // Find existing badge or append one
        let badgeEl = node.el.querySelector('.scenario-ce-badge');
        if (badgeEl) {
          badgeEl.className = `scenario-ce-badge badge-${entity.badgeType || 'info'}`;
          badgeEl.textContent = entity.badge;
        } else {
          const info = node.el.querySelector('.scenario-ce-info');
          if (info) {
            badgeEl = document.createElement('span');
            badgeEl.className = `scenario-ce-badge badge-${entity.badgeType || 'info'}`;
            badgeEl.textContent = entity.badge;
            // Animate in
            badgeEl.style.opacity = '0';
            badgeEl.style.transform = 'scale(0.8)';
            badgeEl.style.transition = 'opacity 0.3s, transform 0.3s';
            info.appendChild(badgeEl);
            requestAnimationFrame(() => {
              badgeEl.style.opacity = '1';
              badgeEl.style.transform = 'scale(1)';
            });
          }
        }
        break;
      }
    }
  }

  function renderEntityOnCanvas() {
    if (!entity) return;
    // Guard: skip if entity node already exists
    if (hasEntityOnCanvas()) return;

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
  // INLINE DRILL-DOWN (ported from analysis mode)
  // =============================================

  function attachDrillHandlers(container) {
    container.addEventListener('click', (e) => {
      const drillEl = e.target.closest('[data-drill]');
      if (!drillEl) return;
      e.stopPropagation();

      const type = drillEl.dataset.drill;
      const id = drillEl.dataset.id;
      if (!type || !id) return;

      const cardBody = drillEl.closest('.scenario-cc-body');

      if (drillEl.classList.contains('drill-active')) {
        if (cardBody) cardBody.querySelectorAll('.drill-expansion').forEach(el => el.remove());
        drillEl.classList.remove('drill-active');
        requestAnimationFrame(() => layoutTree());
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
      if (parent.classList.contains('scenario-cc-body')) {
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
    requestAnimationFrame(() => layoutTree());

    try {
      const res = await fetch(`/api/drill/${type}/${id}`);
      const data = await res.json();

      expansion.classList.remove('drill-loading');
      expansion.innerHTML = '';

      if (!data.items || data.items.length === 0) {
        expansion.textContent = 'No data found';
        requestAnimationFrame(() => layoutTree());
        return;
      }

      const AVATAR_BASE = 'https://mattcmorrell.github.io/ee-graph/data/avatars/';

      switch (type) {
        case 'reports':
        case 'mentees':
        case 'team-members':
          for (const p of data.items) {
            const row = document.createElement('div');
            row.className = 'drill-person';
            row.innerHTML = `
              <img src="${AVATAR_BASE}${p.id}.jpg" class="drill-avatar" onerror="this.style.display='none'" />
              <div class="drill-person-info">
                <span class="drill-person-name">${S.escapeHtml(p.name)}</span>
                <span class="drill-person-role">${S.escapeHtml(p.role || '')}</span>
              </div>
            `;
            expansion.appendChild(row);
          }
          break;
        case 'projects':
          for (const p of data.items) {
            const row = document.createElement('div');
            row.className = 'drill-row';
            const meta = [p.priority, p.role, p.otherContributors === 0 ? 'solo' : null].filter(Boolean).join(' · ');
            row.innerHTML = `
              <span class="drill-row-label">${S.escapeHtml(p.name)}</span>
              <span class="drill-row-value">${S.escapeHtml(meta)}</span>
            `;
            expansion.appendChild(row);
          }
          break;
        case 'skills':
          const chips = document.createElement('div');
          chips.className = 'drill-chips';
          for (const s of data.items) {
            const chip = document.createElement('span');
            chip.className = 'drill-chip';
            chip.textContent = s.name + (s.proficiency ? ` (${s.proficiency})` : '');
            if (s.othersCount === 0) chip.classList.add('drill-chip-unique');
            chips.appendChild(chip);
          }
          expansion.appendChild(chips);
          break;
        case 'teams':
          for (const t of data.items) {
            const row = document.createElement('div');
            row.className = 'drill-row';
            row.innerHTML = `
              <span class="drill-row-label">${S.escapeHtml(t.name)}</span>
              <span class="drill-row-value">${t.memberCount} members${t.personRole ? ' · ' + S.escapeHtml(t.personRole) : ''}</span>
            `;
            expansion.appendChild(row);
          }
          break;
        default:
          expansion.textContent = JSON.stringify(data.items);
      }

      requestAnimationFrame(() => layoutTree());
    } catch (err) {
      expansion.classList.remove('drill-loading');
      expansion.textContent = 'Failed to load';
    }
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
    // Attach drill handlers for data-drill elements
    attachDrillHandlers(el);
    return el;
  }

  function renderCta(parentEl, cta) {
    const row = document.createElement('div');
    row.className = 'scenario-cta-row';

    const btn = document.createElement('button');
    const styleClass = cta.style === 'approve' ? 'scenario-cta-approve' :
                       cta.style === 'warning' ? 'scenario-cta-warning' :
                       'scenario-cta-info';
    btn.className = `scenario-cta-btn ${styleClass}`;
    btn.textContent = cta.label;

    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = cta.label + ' — Done';
      btn.classList.add('scenario-cta-done');
      // Track parent for the consequence card
      const cardEl = parentEl.closest('[data-card-id]');
      if (cardEl) pendingParentCardId = cardEl.dataset.cardId;
      handleSendMessage(cta.action);
    });

    row.appendChild(btn);
    parentEl.appendChild(row);
  }

  function renderExploreBar(parentEl, prompts) {
    if (!prompts || prompts.length === 0) return;

    const bar = document.createElement('div');
    bar.className = 'scenario-explore-bar';

    const trigger = document.createElement('button');
    trigger.className = 'scenario-explore-trigger';
    trigger.innerHTML = `<span class="scenario-explore-arrow">&#9660;</span> Explore`;
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
      container.remove();
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

    // Render entity on canvas (guarded — skips if already present from preview)
    renderEntityOnCanvas();

    // Tell the AI what was selected, then auto-explore the first domain
    const names = selected.map(d => d.title).join(', ');
    const first = selected[0];

    S.renderUserMessage(`Let's explore: ${names}`);
    const statusEl = S.renderStatus('Setting up...');

    // Create placeholder under entity for the first domain card
    let phNodeId = null;
    const eid = findEntityNodeId();
    if (eid) phNodeId = createCanvasPlaceholder(eid);

    setCanvasLoading(true);
    S.callChat(`Selected domains: ${names}. Start with ${first.title}.`, (data) => {
      if (phNodeId) {
        removeCanvasPlaceholder(phNodeId);
        phNodeId = null;
      }
      if (statusEl) statusEl.remove();
      S.isStreaming = false;
      setCanvasLoading(false);
      S.renderAIConvoMessage(data.message);

      // Auto-select first domain and handle any card in the response
      activeDomainId = first.id;
      first._explored = true;
      renderNavList();

      if (data.cards && data.cards.length > 0) {
        handleCardsResponse(data);
      } else if (data.card) {
        handleCardResponse(data);
      }
    }, (intermediate) => {
      if (intermediate.type === 'status' && phNodeId) {
        updateCanvasPlaceholder(phNodeId, intermediate.message);
      }
    });

    S.isStreaming = true;
  }

  // =============================================
  // MESSAGE HANDLING
  // =============================================

  function setCanvasLoading(loading) {
    // Disable/enable all prompt chips and CTA buttons on canvas
    const world = document.getElementById('world');
    if (!world) return;
    world.querySelectorAll('.scenario-chip, .scenario-cta-btn, .scenario-comp-choose, .scenario-explore-send, .scenario-alloc-action-btn, .scenario-alloc-chip').forEach(el => {
      el.style.pointerEvents = loading ? 'none' : '';
    });
    // Show/hide a loading indicator on the focused card
    if (loading && focusedNodeId) {
      const node = canvasNodes.get(focusedNodeId);
      if (node && node.el) {
        let indicator = node.el.querySelector('.scenario-loading-indicator');
        if (!indicator) {
          indicator = document.createElement('div');
          indicator.className = 'scenario-loading-indicator';
          indicator.innerHTML = '<div class="scenario-loading-dot"></div><div class="scenario-loading-dot"></div><div class="scenario-loading-dot"></div>';
          node.el.appendChild(indicator);
        }
      }
    } else {
      world.querySelectorAll('.scenario-loading-indicator').forEach(el => el.remove());
    }
  }

  function buildAllocContext() {
    if (allocState.size === 0) return '';
    const parts = [];
    for (const [, state] of allocState) {
      const groupLines = state.groups.map(g => {
        const people = (g.people || []).map(p => {
          let desc = p.name;
          if (p.movedBy === 'user') desc += ' [moved by user]';
          return desc;
        }).join(', ');
        return `  ${g.title} (${g.people?.length || 0}): ${people}`;
      }).join('\n');
      let status = '';
      if (state.decided) status = ' [DECIDED]';
      else if (state.analysisStale) status = ' [user edited, analysis stale]';
      if (state.recommended) status += ' [AI recommended]';
      parts.push(`Allocation "${state.title}" (allocId: ${state.id})${status}\n${groupLines}`);
    }
    return '\n\n---CANVAS STATE---\n' + parts.join('\n\n') + '\n---END CANVAS STATE---';
  }

  async function handleSendMessage(text) {
    if (S.isStreaming) return;
    S.isStreaming = true;

    // Capture which domain this request belongs to
    const requestDomainId = activeDomainId;

    S.renderUserMessage(text);
    const statusEl = S.renderStatus('Thinking...');
    setCanvasLoading(true);

    // Create canvas placeholder if we have a parent to attach to
    let phNodeId = null;
    const phParent = pendingParentCardId
      ? findNodeByCardId(pendingParentCardId)
      : findEntityNodeId();
    if (phParent) {
      phNodeId = createCanvasPlaceholder(phParent);
    }

    S.callChat(text + buildAllocContext(), (data) => {
      // If user switched domains while waiting, queue the response for later
      if (requestDomainId && activeDomainId !== requestDomainId) {
        if (statusEl) statusEl.remove();
        S.isStreaming = false;
        setCanvasLoading(false);
        S.renderAIConvoMessage(data.message);
        // Stash the response — it'll render when the user navigates back
        const saved = domainCanvasStates.get(requestDomainId);
        if (saved) saved.pendingResponse = data;
        return;
      }

      // Remove placeholder
      if (phNodeId) {
        removeCanvasPlaceholder(phNodeId);
        phNodeId = null;
      }

      // Remove status and loading
      if (statusEl) statusEl.remove();
      S.isStreaming = false;
      setCanvasLoading(false);

      // Render AI conversation message
      S.renderAIConvoMessage(data.message);

      // Handle entity (initial response — only from Phase 1, not comparison lookups)
      if (data.entity) {
        setEntity(data.entity);
        updateTitleBar();
        if (hasEntityOnCanvas()) {
          updateEntityBadge();
        } else {
          renderEntityOnCanvas();
        }
      }

      // Handle proposed domains — render as selectable chips in conversation
      if (data.proposedDomains && data.proposedDomains.length > 0) {
        renderDomainProposals(data.proposedDomains);
      }

      // Legacy: handle direct domains (in case AI sends them)
      if (data.domains && data.domains.length > 0) {
        setDomains(data.domains);
      }

      // Handle allocation card (team restructuring)
      if (data.allocation) {
        S.$canvasEmpty.classList.add('hidden');
        const parentCardId = pendingParentCardId;
        pendingParentCardId = null;
        renderAllocation(data.allocation, parentCardId);
      }

      // Handle allocation analysis update
      if (data.allocation_update) {
        for (const [id, state] of allocState) {
          if (state.analysisStale) {
            if (data.allocation_update.analysis) {
              state.analysis = data.allocation_update.analysis;
            }
            state.analysisStale = false;
            softRebuildAlloc(state);
            break;
          }
        }
      }

      // Handle AI recommendation badge
      handleRecommendation(data);

      // Handle decomposed cards (array) or single card
      if (data.cards && data.cards.length > 0) {
        handleCardsResponse(data);
      } else if (data.card) {
        handleCardResponse(data);
      }

      // Handle options without a card
      if (!data.card && !data.cards && !data.allocation && data.options && data.options.length > 0) {
        renderOptions(data.options, null);
      }

      // Handle decisions
      if (data.decisions) {
        for (const d of data.decisions) {
          S.addDecision(d);
        }
        updateNavDecisions();
      }
    }, (intermediate) => {
      // Entity preview — show entity card early (ignore if entity already locked)
      if (intermediate.type === 'entity_preview' && intermediate.entity && !entityLocked) {
        setEntity(intermediate.entity);
        updateTitleBar();
        renderEntityOnCanvas();
        // Now that entity exists, create placeholder as its child
        if (!phNodeId) {
          const eid = findEntityNodeId();
          if (eid) {
            phNodeId = createCanvasPlaceholder(eid);
          }
        }
      }
      // Status — update placeholder text
      if (intermediate.type === 'status' && phNodeId) {
        updateCanvasPlaceholder(phNodeId, intermediate.message);
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

    // Add CTA button if present
    if (data.cta) {
      renderCta(cardEl, data.cta);
    }

    // Add explore bar with prompts
    if (data.prompts && data.prompts.length > 0) {
      renderExploreBar(cardEl, data.prompts);
    }

    // Wire click-to-focus
    setupCardClickToFocus(cardEl, nodeId);

    // Layout and focus
    requestAnimationFrame(() => {
      layoutTree();
      setFocus(nodeId);
      requestAnimationFrame(() => showNewCardIndicatorIfNeeded(nodeId));
    });

    // Handle options on this card
    if (data.options && data.options.length > 0) {
      renderOptions(data.options, data.card.id);
    }

    // Handle decisions — tag with canvas node for click-to-navigate
    if (data.decisions) {
      for (const d of data.decisions) {
        d._canvasNodeId = nodeId;
        d._domainId = activeDomainId;
        S.addDecision(d);
      }
      updateNavDecisions();
    }
  }

  // Handle decomposed cards (multiple cards in one response)
  function handleCardsResponse(data) {
    // Resolve shared parent: pendingParentCardId > entity
    let parentNodeId = null;
    const lookupCardId = pendingParentCardId;
    if (lookupCardId) {
      for (const [nid, node] of canvasNodes) {
        if (node.el?.dataset?.cardId === lookupCardId) {
          parentNodeId = nid;
          break;
        }
      }
    }
    if (!parentNodeId) {
      for (const [nid, node] of canvasNodes) {
        if (node.type === 'entity') { parentNodeId = nid; break; }
      }
    }
    pendingParentCardId = null; // consumed once for the batch

    let firstNodeId = null;

    for (const card of data.cards) {
      const cardEl = createCardElement(card);
      cardEl.dataset.cardId = card.id;
      cardEl.classList.add('scenario-card-decomposed');

      const nodeId = addCanvasCard('card', parentNodeId, cardEl);
      if (!firstNodeId) firstNodeId = nodeId;

      // Per-card CTA
      if (card.cta) {
        renderCta(cardEl, card.cta);
      }

      // Per-card explore bar (use card-level prompts)
      if (card.prompts && card.prompts.length > 0) {
        renderExploreBar(cardEl, card.prompts);
      }

      // Wire click-to-focus
      setupCardClickToFocus(cardEl, nodeId);
    }

    // Handle top-level decisions
    if (data.decisions) {
      for (const d of data.decisions) {
        d._canvasNodeId = firstNodeId;
        d._domainId = activeDomainId;
        S.addDecision(d);
      }
      updateNavDecisions();
    }

    // Layout all cards, then focus the first one
    requestAnimationFrame(() => {
      layoutTree();
      if (firstNodeId) setFocus(firstNodeId);
      requestAnimationFrame(() => {
        if (firstNodeId) showNewCardIndicatorIfNeeded(firstNodeId);
      });
    });
  }

  function buildFullDetailCol(opt, AVATAR_BASE) {
    const hasAvatar = opt.personId;
    const col = document.createElement('div');
    col.className = 'scenario-comp-col';
    col.dataset.optionId = opt.id;
    col.innerHTML = `
      <div class="scenario-comp-header">
        ${hasAvatar ?
          `<img src="${AVATAR_BASE}${opt.personId}.jpg" class="scenario-comp-avatar" onerror="this.style.display='none'" />` :
          `<div class="scenario-comp-avatar-placeholder">?</div>`}
        <div class="scenario-comp-identity">
          <div class="scenario-comp-name">${S.escapeHtml(opt.name)}</div>
          <div class="scenario-comp-role">${S.escapeHtml(opt.role || '')}</div>
        </div>
        ${opt.tag ? `<span class="scenario-comp-tag">${S.escapeHtml(opt.tag)}</span>` : ''}
      </div>
      ${opt.metrics && opt.metrics.length > 0 ? `
        <div class="scenario-comp-metrics">
          ${opt.metrics.map(m => `
            <div class="scenario-comp-metric">
              <span class="scenario-comp-metric-label">${S.escapeHtml(m.label)}</span>
              <span class="scenario-comp-metric-value scenario-comp-${m.sentiment || 'neutral'}">${S.escapeHtml(m.value)}</span>
            </div>
          `).join('')}
        </div>
      ` : ''}
      ${opt.strengths && opt.strengths.length > 0 ? `
        <div class="scenario-comp-section">
          <div class="scenario-comp-section-label scenario-comp-section-label-strengths">Strengths</div>
          ${opt.strengths.map(s => `<div class="scenario-comp-pro">+ ${S.escapeHtml(s)}</div>`).join('')}
        </div>
      ` : ''}
      ${opt.risks && opt.risks.length > 0 ? `
        <div class="scenario-comp-section">
          <div class="scenario-comp-section-label scenario-comp-section-label-risks">Risks</div>
          ${opt.risks.map(r => `<div class="scenario-comp-con">&minus; ${S.escapeHtml(r)}</div>`).join('')}
        </div>
      ` : ''}
      ${opt.summary ? `<div class="scenario-comp-summary">${S.escapeHtml(opt.summary)}</div>` : ''}
      <button class="scenario-comp-choose">Choose ${S.escapeHtml(opt.name.split(' ')[0])}</button>
    `;
    return col;
  }

  function renderOptions(options, parentCardId) {
    if (!options || options.length === 0) return;
    if (comparisonLayout === 'compact') return renderOptionsCompact(options, parentCardId);

    const AVATAR_BASE = 'https://mattcmorrell.github.io/ee-graph/data/avatars/';

    // Full row layout — one card per candidate, flex row
    const rowEl = document.createElement('div');
    rowEl.className = 'scenario-comp-row scenario-comp-row-full';

    for (const opt of options) {
      const col = buildFullDetailCol(opt, AVATAR_BASE);
      col.querySelector('.scenario-comp-choose').addEventListener('click', () => {
        selectOption(opt, col, rowEl, parentCardId);
      });
      rowEl.appendChild(col);
    }

    // Ghost write-in column
    const ghost = document.createElement('div');
    ghost.className = 'scenario-comp-ghost';
    ghost.innerHTML = `<div class="scenario-comp-ghost-icon">+</div><div class="scenario-comp-ghost-text">Suggest another</div>`;
    ghost.addEventListener('click', () => {
      handleSendMessage('Can you suggest another option beyond these candidates?');
    });
    rowEl.appendChild(ghost);
    addOptionsToCanvas(rowEl, parentCardId);
  }

  function renderOptionsCompact(opts, pCardId) {
    const AVATAR_BASE = 'https://mattcmorrell.github.io/ee-graph/data/avatars/';

    // Find parent canvas node
    let parentNodeId = null;
    if (pCardId) {
      for (const [nid, node] of canvasNodes) {
        if (node.el?.dataset?.cardId === pCardId) { parentNodeId = nid; break; }
      }
    }
    if (!parentNodeId) {
      let lastCard = null;
      for (const [nid, node] of canvasNodes) {
        if (node.type === 'card') lastCard = nid;
      }
      parentNodeId = lastCard;
    }

    const compactNodeIds = []; // track all compact nodes for dimming on choose
    let detailNodeId = null;   // currently expanded detail node

    for (const opt of opts) {
      const hasAvatar = opt.personId;
      const card = document.createElement('div');
      card.className = 'scenario-comp-compact-card';
      card.dataset.optionId = opt.id;
      const topMetrics = (opt.metrics || []).slice(0, 2);
      card.innerHTML = `
        <div class="scenario-comp-compact-header">
          ${hasAvatar ?
            `<img src="${AVATAR_BASE}${opt.personId}.jpg" class="scenario-comp-compact-avatar" onerror="this.style.display='none'" />` :
            `<div class="scenario-comp-compact-avatar-ph">?</div>`}
          <div class="scenario-comp-compact-name">${S.escapeHtml(opt.name)}</div>
          <div class="scenario-comp-compact-role">${S.escapeHtml(opt.role || '')}</div>
          ${opt.tag ? `<span class="scenario-comp-tag">${S.escapeHtml(opt.tag)}</span>` : ''}
        </div>
        ${topMetrics.length > 0 ? `
          <div class="scenario-comp-compact-stats">
            ${topMetrics.map(m => `<div><span class="scenario-comp-compact-val">${S.escapeHtml(m.value)}</span><span class="scenario-comp-compact-lbl">${S.escapeHtml(m.label)}</span></div>`).join('')}
          </div>
        ` : ''}
      `;

      const nodeId = addCanvasCard('compact-option', parentNodeId, card);
      compactNodeIds.push(nodeId);

      card.addEventListener('click', (e) => {
        if (e.target.closest('.scenario-comp-choose')) return;

        // Remove previous detail if any
        if (detailNodeId) {
          const prev = canvasNodes.get(detailNodeId);
          if (prev && prev.parentId) {
            const parent = canvasNodes.get(prev.parentId);
            if (parent) parent.children = parent.children.filter(c => c !== detailNodeId);
          }
          CanvasEngine.removeBlock(detailNodeId);
          canvasNodes.delete(detailNodeId);
          // Deselect all
          compactNodeIds.forEach(cid => {
            const cn = canvasNodes.get(cid);
            if (cn) cn.el.classList.remove('selected');
          });
          if (detailNodeId === nodeId + '-detail') {
            // Was toggling off the same card
            detailNodeId = null;
            requestAnimationFrame(() => { layoutTree(); drawConnectors(); });
            return;
          }
          detailNodeId = null;
        }

        // Expand detail below this compact card
        card.classList.add('selected');
        const detail = buildFullDetailCol(opt, AVATAR_BASE);
        detail.classList.add('scenario-comp-detail-card');
        const chooseBtn = detail.querySelector('.scenario-comp-choose');
        chooseBtn.addEventListener('click', () => {
          // Dim siblings, mark decided
          compactNodeIds.forEach(cid => {
            const cn = canvasNodes.get(cid);
            if (!cn) return;
            if (cid === nodeId) {
              cn.el.classList.add('scenario-comp-decided');
            } else {
              cn.el.classList.add('scenario-comp-dimmed');
            }
          });
          // Mark the detail card as decided too
          detail.classList.add('scenario-comp-decided');
          chooseBtn.disabled = true;
          chooseBtn.textContent = '✓ Chosen';
          if (pCardId) pendingParentCardId = pCardId;
          handleSendMessage(`I choose: ${opt.id} — ${opt.name}`);
        });

        const dId = addCanvasCard('option-detail', nodeId, detail);
        detailNodeId = dId;
        requestAnimationFrame(() => {
          layoutTree();
          drawConnectors();
          CanvasEngine.focusOn(dId);
        });
      });
    }

    requestAnimationFrame(() => {
      layoutTree();
      CanvasEngine.focusOn(compactNodeIds[0]);
    });
  }

  function addOptionsToCanvas(el, parentCardId) {
    let parentNodeId = null;
    if (parentCardId) {
      for (const [nid, node] of canvasNodes) {
        if (node.el?.dataset?.cardId === parentCardId) {
          parentNodeId = nid;
          break;
        }
      }
    }
    if (!parentNodeId) {
      let lastCard = null;
      for (const [nid, node] of canvasNodes) {
        if (node.type === 'card') lastCard = nid;
      }
      parentNodeId = lastCard;
    }

    const nodeId = addCanvasCard('options', parentNodeId, el);
    requestAnimationFrame(() => {
      layoutTree();
      CanvasEngine.focusOn(nodeId);
    });
  }

  function selectOption(opt, colEl, rowEl, parentCardId) {
    // Visual: highlight chosen, dim others
    rowEl.querySelectorAll('.scenario-comp-col').forEach(c => {
      const btn = c.querySelector('.scenario-comp-choose');
      if (c === colEl) {
        c.classList.add('scenario-comp-decided');
        if (btn) { btn.textContent = '✓ Chosen'; btn.disabled = true; }
      } else {
        c.classList.add('scenario-comp-dimmed');
        if (btn) btn.disabled = true;
      }
    });
    // Hide ghost
    const ghost = rowEl.querySelector('.scenario-comp-ghost');
    if (ghost) ghost.style.display = 'none';

    // Set pending parent to the card that spawned these options
    if (parentCardId) pendingParentCardId = parentCardId;

    // Send choice to AI
    handleSendMessage(`I choose: ${opt.id} — ${opt.name}`);
  }

  // =============================================
  // ALLOCATION CARDS (drag-and-drop team builder)
  // =============================================

  // Per-allocation-card state: allocId → { groups, moveHistory, analysisStale, analysis, title, decided }
  const allocState = new Map();

  // Drag state (only one drag at a time, module-level)
  let allocDrag = null;

  function renderAllocation(alloc, parentCardId) {
    const state = {
      id: alloc.id,
      title: alloc.title,
      groups: JSON.parse(JSON.stringify(alloc.groups)), // deep clone
      moveHistory: [],
      analysisStale: false,
      analysis: alloc.analysis || null,
      decided: false
    };
    allocState.set(alloc.id, state);

    const el = document.createElement('div');
    el.className = 'scenario-alloc-card';
    el.dataset.allocId = alloc.id;
    buildAllocContent(el, state);

    // Find parent node
    let parentNodeId = null;
    if (parentCardId) {
      for (const [nid, node] of canvasNodes) {
        if (node.el?.dataset?.cardId === parentCardId || node.el?.dataset?.allocId === parentCardId) {
          parentNodeId = nid;
          break;
        }
      }
    }
    if (!parentNodeId) {
      for (const [nid, node] of canvasNodes) {
        if (node.type === 'entity') { parentNodeId = nid; break; }
      }
    }

    const nodeId = addCanvasCard('allocation', parentNodeId, el);
    setupCardClickToFocus(el, nodeId);

    // Layout and focus — no camera movement, user controls the view
    requestAnimationFrame(() => {
      layoutTree();
      setFocus(nodeId);
    });
  }

  function buildAllocContent(el, state) {
    el.innerHTML = '';

    // Title bar
    const titleBar = document.createElement('div');
    titleBar.className = 'scenario-alloc-title';
    titleBar.innerHTML = `
      <span>${S.escapeHtml(state.title)}</span>
      ${state.decided ? '<span class="scenario-alloc-decided-badge">Decided</span>' : ''}
    `;
    el.appendChild(titleBar);

    // Group buckets
    const groupsRow = document.createElement('div');
    groupsRow.className = 'scenario-alloc-groups';
    if (state.groups.length <= 4) {
      groupsRow.style.gridTemplateColumns = `repeat(${state.groups.length}, 1fr)`;
    }
    for (const group of state.groups) {
      groupsRow.appendChild(createAllocBucket(group, state));
    }
    el.appendChild(groupsRow);

    // Analysis panel
    if (state.analysis) {
      el.appendChild(createAllocAnalysis(state));
    }

    // Action bar
    if (!state.decided) {
      el.appendChild(createAllocActions(state));
    }

    // AI Pick banner (full-width, below everything)
    if (state.recommended) {
      const banner = document.createElement('div');
      banner.className = 'scenario-alloc-recommend-banner';
      banner.innerHTML = `
        <div class="scenario-alloc-recommend-main">
          <span class="scenario-alloc-recommend-icon">&#9733;</span>
          <span class="scenario-alloc-recommend-label">AI Pick</span>
          <button class="scenario-alloc-recommend-explain">Explain reasoning</button>
        </div>
        <button class="scenario-alloc-recommend-dismiss" title="Dismiss">&times;</button>
      `;
      banner.querySelector('.scenario-alloc-recommend-dismiss').addEventListener('click', (e) => {
        e.stopPropagation();
        state.recommended = false;
        softRebuildAlloc(state);
        const cardEl = document.querySelector(`[data-alloc-id="${state.id}"]`);
        if (cardEl) cardEl.classList.remove('scenario-alloc-recommended');
      });
      banner.querySelector('.scenario-alloc-recommend-explain').addEventListener('click', (e) => {
        e.stopPropagation();
        // Set parent so the explanation card appears below this allocation
        pendingParentCardId = state.id;
        handleSendMessage(`Explain your reasoning for recommending "${state.title}". What makes it better than the other scenarios?`);
      });
      el.appendChild(banner);
    }
  }

  function createAllocBucket(group, state) {
    const bucket = document.createElement('div');
    bucket.className = 'scenario-alloc-bucket';
    bucket.dataset.groupId = group.id;
    bucket.dataset.allocId = state.id;

    const header = document.createElement('div');
    header.className = 'scenario-alloc-bucket-header';
    const name = document.createElement('span');
    name.className = 'scenario-alloc-bucket-name';
    name.textContent = group.title;
    header.appendChild(name);

    const count = document.createElement('span');
    count.className = 'scenario-alloc-bucket-count';
    count.textContent = group.people ? group.people.length : 0;
    header.appendChild(count);
    bucket.appendChild(header);

    const peopleEl = document.createElement('div');
    peopleEl.className = 'scenario-alloc-bucket-people';
    if (group.people) {
      for (const p of group.people) {
        peopleEl.appendChild(createAllocChip(p, group.id, state));
      }
    }
    bucket.appendChild(peopleEl);
    return bucket;
  }

  function createAllocChip(p, groupId, state) {
    const chip = document.createElement('div');
    let cls = 'scenario-alloc-chip';
    if (p.movedBy === 'user') cls += ' scenario-alloc-chip-moved';
    chip.className = cls;
    chip.dataset.personId = p.id;

    if (!state.decided) {
      chip.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || S.isStreaming || allocDrag) return;
        e.preventDefault();
        e.stopPropagation();
        startAllocDrag(e, p, groupId, chip, state);
      });
    }

    const avatar = document.createElement('div');
    avatar.className = 'scenario-alloc-chip-avatar';
    if (p.movedBy === 'user') {
      avatar.style.background = 'rgba(139,92,246,0.15)';
      avatar.style.color = '#a78bfa';
    }
    avatar.textContent = p.initials || '?';
    chip.appendChild(avatar);

    const info = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.className = 'scenario-alloc-chip-name';
    nameEl.textContent = p.name;
    info.appendChild(nameEl);
    if (p.role) {
      const roleEl = document.createElement('div');
      roleEl.className = 'scenario-alloc-chip-role';
      roleEl.textContent = p.movedBy === 'user' ? 'moved by you' : p.role;
      info.appendChild(roleEl);
    }
    chip.appendChild(info);
    return chip;
  }

  function createAllocAnalysis(state) {
    const panel = document.createElement('div');
    panel.className = 'scenario-alloc-analysis' + (state.analysisStale ? ' scenario-alloc-analysis-stale' : '');

    const header = document.createElement('div');
    header.className = 'scenario-alloc-analysis-header';
    const title = document.createElement('div');
    title.className = 'scenario-alloc-analysis-title';
    if (state.analysisStale) title.style.color = 'var(--warning)';
    title.textContent = 'AI Analysis';
    header.appendChild(title);

    if (state.analysisStale) {
      // When stale: show "Analyze changes" button in the header instead of badge
      const analyzeBtn = document.createElement('button');
      analyzeBtn.className = 'scenario-alloc-analyze-inline';
      analyzeBtn.innerHTML = '&#8635; Analyze changes';
      analyzeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleAllocAnalyze(state);
      });
      header.appendChild(analyzeBtn);
    } else {
      const badge = document.createElement('div');
      badge.className = 'scenario-alloc-analysis-badge';
      badge.textContent = 'Auto';
      header.appendChild(badge);
    }
    panel.appendChild(header);

    // When stale, collapse the body — only show header with analyze button
    if (!state.analysisStale) {
      const contentWrapper = document.createElement('div');

      const analysis = state.analysis;
      if (analysis.metrics && analysis.metrics.length > 0) {
        const metrics = document.createElement('div');
        metrics.className = 'scenario-alloc-metrics';
        for (const m of analysis.metrics) {
          const metric = document.createElement('div');
          metric.className = 'scenario-alloc-metric';
          const sv = m.sentiment || 'neu';
          metric.innerHTML = `
            <div class="scenario-alloc-metric-label">${S.escapeHtml(m.label)}</div>
            <div class="scenario-alloc-metric-value scenario-alloc-sv-${sv}">${S.escapeHtml(m.value)}</div>
            <div class="scenario-alloc-metric-note">${S.escapeHtml(m.note || '')}</div>
          `;
          metrics.appendChild(metric);
        }
        contentWrapper.appendChild(metrics);
      }

      if (analysis.insights && analysis.insights.length > 0) {
        const body = document.createElement('div');
        body.className = 'scenario-alloc-insights';
        for (const ins of analysis.insights) {
          const iconMap = { pro: '&#10003;', risk: '!', con: '&#9888;' };
          const item = document.createElement('div');
          item.className = 'scenario-alloc-insight';
          item.innerHTML = `
            <div class="scenario-alloc-insight-icon scenario-alloc-icon-${ins.type || 'pro'}">${iconMap[ins.type] || '&#10003;'}</div>
            <div class="scenario-alloc-insight-text">
              <div class="scenario-alloc-insight-title">${S.escapeHtml(ins.title)}</div>
              <div class="scenario-alloc-insight-desc">${S.escapeHtml(ins.description || '')}</div>
            </div>
          `;
          body.appendChild(item);
        }
        contentWrapper.appendChild(body);
      }

      panel.appendChild(contentWrapper);
    }

    return panel;
  }

  function createAllocActions(state) {
    const actions = document.createElement('div');
    actions.className = 'scenario-alloc-actions';

    if (state.moveHistory.length > 0) {
      const undoBtn = document.createElement('button');
      undoBtn.className = 'scenario-alloc-action-btn scenario-alloc-btn-undo';
      undoBtn.innerHTML = `&#8634; Undo last`;
      undoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleAllocUndo(state);
      });
      actions.appendChild(undoBtn);
    }

    const dupBtn = document.createElement('button');
    dupBtn.className = 'scenario-alloc-action-btn scenario-alloc-btn-dup';
    dupBtn.innerHTML = `&#9112; Duplicate`;
    dupBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleAllocDuplicate(state);
    });
    actions.appendChild(dupBtn);

    const decideBtn = document.createElement('button');
    decideBtn.className = 'scenario-alloc-action-btn scenario-alloc-btn-decide';
    if (state.analysisStale) {
      decideBtn.style.opacity = '0.4';
      decideBtn.style.cursor = 'not-allowed';
    }
    decideBtn.innerHTML = `&#10003; Decide this scenario`;
    if (!state.analysisStale) {
      decideBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleAllocDecide(state);
      });
    }
    actions.appendChild(decideBtn);

    return actions;
  }

  // --- Drag-and-drop ---

  // Collect all target bucket bounding rects for bbox hit testing
  // (more reliable than elementFromPoint with canvas transforms)
  function getDropTargets(state, sourceGroupId) {
    const targets = [];
    document.querySelectorAll(`.scenario-alloc-bucket[data-alloc-id="${state.id}"]`).forEach(b => {
      if (b.dataset.groupId !== sourceGroupId) {
        targets.push({ el: b, groupId: b.dataset.groupId });
      }
    });
    return targets;
  }

  function hitTestBucket(x, y, targets) {
    for (const t of targets) {
      const r = t.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return t;
      }
    }
    return null;
  }

  function startAllocDrag(e, person, groupId, chipEl, state) {
    const rect = chipEl.getBoundingClientRect();

    // Create floating drag clone
    const clone = chipEl.cloneNode(true);
    clone.className = 'scenario-alloc-drag-clone';
    clone.style.cssText = `
      position:fixed; z-index:10000; pointer-events:none;
      left:${rect.left}px; top:${rect.top}px;
      width:${rect.width}px;
    `;
    document.body.appendChild(clone);

    // Ghost the source chip
    chipEl.classList.add('scenario-alloc-chip-dragging');

    // Body cursor + class for global state
    document.body.classList.add('scenario-alloc-dragging');

    // Collect drop targets and add visual indicators
    const targets = getDropTargets(state, groupId);
    for (const t of targets) {
      t.el.classList.add('scenario-alloc-drop-target');
    }

    // Mark the source bucket
    const sourceBucket = chipEl.closest('.scenario-alloc-bucket');
    if (sourceBucket) sourceBucket.classList.add('scenario-alloc-bucket-source');

    allocDrag = {
      personId: person.id,
      personName: person.name,
      sourceGroupId: groupId,
      allocId: state.id,
      clone,
      chip: chipEl,
      chipStartRect: rect,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      targets,
      sourceBucket,
      hoveredTarget: null
    };

    document.addEventListener('pointermove', onAllocDragMove);
    document.addEventListener('pointerup', onAllocDragEnd);
  }

  function onAllocDragMove(e) {
    if (!allocDrag) return;
    allocDrag.clone.style.left = (e.clientX - allocDrag.offsetX) + 'px';
    allocDrag.clone.style.top = (e.clientY - allocDrag.offsetY) + 'px';

    // Bbox hit test against cached targets
    const hit = hitTestBucket(e.clientX, e.clientY, allocDrag.targets);

    if (hit !== allocDrag.hoveredTarget) {
      // Clear previous hover
      if (allocDrag.hoveredTarget) {
        allocDrag.hoveredTarget.el.classList.remove('scenario-alloc-bucket-dragover');
      }
      // Set new hover
      if (hit) {
        hit.el.classList.add('scenario-alloc-bucket-dragover');
      }
      allocDrag.hoveredTarget = hit;
    }
  }

  function onAllocDragEnd(e) {
    if (!allocDrag) return;
    document.removeEventListener('pointermove', onAllocDragMove);
    document.removeEventListener('pointerup', onAllocDragEnd);

    // Hit test for drop
    const hit = hitTestBucket(e.clientX, e.clientY, allocDrag.targets);

    // Clean up all visual states
    document.body.classList.remove('scenario-alloc-dragging');
    document.querySelectorAll('.scenario-alloc-drop-target, .scenario-alloc-bucket-dragover, .scenario-alloc-bucket-source').forEach(b => {
      b.classList.remove('scenario-alloc-drop-target', 'scenario-alloc-bucket-dragover', 'scenario-alloc-bucket-source');
    });
    allocDrag.chip.classList.remove('scenario-alloc-chip-dragging');

    if (hit) {
      // Successful drop — animate clone to target, then execute
      const targetRect = hit.el.getBoundingClientRect();
      allocDrag.clone.style.transition = 'all 0.15s ease-out';
      allocDrag.clone.style.left = (targetRect.left + targetRect.width / 2 - allocDrag.clone.offsetWidth / 2) + 'px';
      allocDrag.clone.style.top = (targetRect.top + 20) + 'px';
      allocDrag.clone.style.opacity = '0';
      allocDrag.clone.style.transform = 'scale(0.8)';

      // Flash the target bucket
      hit.el.classList.add('scenario-alloc-drop-success');
      setTimeout(() => hit.el.classList.remove('scenario-alloc-drop-success'), 400);

      const { allocId, personId, sourceGroupId, clone: cloneEl } = allocDrag;
      const targetGroupId = hit.groupId;
      setTimeout(() => {
        cloneEl.remove();
        executeAllocDrop(allocId, personId, sourceGroupId, targetGroupId);
      }, 150);
    } else {
      // Failed drop — snap clone back to origin
      allocDrag.clone.style.transition = 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)';
      allocDrag.clone.style.left = allocDrag.chipStartRect.left + 'px';
      allocDrag.clone.style.top = allocDrag.chipStartRect.top + 'px';
      const cloneRef = allocDrag.clone;
      setTimeout(() => cloneRef.remove(), 250);
    }

    allocDrag = null;
  }

  function executeAllocDrop(allocId, personId, fromGroupId, toGroupId) {
    const state = allocState.get(allocId);
    if (!state) return;

    const sourceGroup = state.groups.find(g => g.id === fromGroupId);
    const targetGroup = state.groups.find(g => g.id === toGroupId);
    if (!sourceGroup || !targetGroup) return;

    const personIdx = sourceGroup.people.findIndex(p => p.id === personId);
    if (personIdx === -1) return;

    const person = sourceGroup.people.splice(personIdx, 1)[0];
    person.movedBy = 'user';
    person.previousRole = person.role;
    person.role = `moved from ${sourceGroup.title}`;
    targetGroup.people.push(person);

    state.moveHistory.push({ person: { ...person }, fromGroupId, toGroupId });
    state.analysisStale = true;

    softRebuildAlloc(state);
  }

  function softRebuildAlloc(state) {
    const el = document.querySelector(`[data-alloc-id="${state.id}"]`);
    if (!el) return;
    buildAllocContent(el, state);
    // Only redraw connectors — don't re-layout or zoom since
    // the card position hasn't changed, just its internal content
    requestAnimationFrame(() => drawConnectors());
  }

  // --- AI Recommendation Badge ---

  function handleRecommendation(data) {
    if (!data.recommend || !data.recommend.allocId) return;
    applyRecommendBadge(data.recommend.allocId);
  }

  function applyRecommendBadge(allocId) {
    // Clear previous
    for (const [, st] of allocState) {
      if (st.recommended) { st.recommended = false; softRebuildAlloc(st); }
    }
    const state = allocState.get(allocId);
    if (!state) return;
    state.recommended = true;
    softRebuildAlloc(state);

    // Glow on the card element
    document.querySelectorAll('.scenario-alloc-recommended').forEach(el =>
      el.classList.remove('scenario-alloc-recommended'));
    const el = document.querySelector(`[data-alloc-id="${allocId}"]`);
    if (el) el.classList.add('scenario-alloc-recommended');
  }

  // --- Undo ---

  function handleAllocUndo(state) {
    if (state.moveHistory.length === 0) return;
    const last = state.moveHistory.pop();
    const sourceGroup = state.groups.find(g => g.id === last.toGroupId);
    const targetGroup = state.groups.find(g => g.id === last.fromGroupId);
    if (!sourceGroup || !targetGroup) return;

    const personIdx = sourceGroup.people.findIndex(p => p.id === last.person.id);
    if (personIdx === -1) return;

    const person = sourceGroup.people.splice(personIdx, 1)[0];
    person.movedBy = undefined;
    if (person.previousRole) {
      person.role = person.previousRole;
      delete person.previousRole;
    }
    targetGroup.people.push(person);

    if (state.moveHistory.length === 0) state.analysisStale = false;
    softRebuildAlloc(state);
  }

  // --- Analyze changes ---

  function handleAllocAnalyze(state) {
    if (S.isStreaming) return;
    S.isStreaming = true;
    S.$chatInput.disabled = true;
    S.$chatSend.disabled = true;

    const groupSummary = state.groups.map(g => {
      const people = (g.people || []).map(p => `${p.name} (${p.role || 'no role'})`).join(', ');
      return `${g.title} (${g.people?.length || 0}): ${people}`;
    }).join('\n');

    const movesSummary = state.moveHistory.map(m =>
      `Moved ${m.person.name} from ${m.fromGroupId} to ${m.toGroupId}`
    ).join('; ');

    S.renderUserMessage('Analyze my changes');
    const statusEl = S.renderStatus('Re-analyzing allocation...');

    S.callChat(`Analyze this team configuration: ${movesSummary}.\n\nCurrent groups:\n${groupSummary}\n\nProvide fresh analysis with updated metrics and insights. Return an allocation_update with the new analysis.`, (data) => {
      if (statusEl) statusEl.remove();
      S.renderAIConvoMessage(data.message);

      if (data.allocation_update && data.allocation_update.analysis) {
        state.analysis = data.allocation_update.analysis;
      }
      state.analysisStale = false;
      softRebuildAlloc(state);

      if (data.decisions) {
        for (const d of data.decisions) S.addDecision(d);
        updateNavDecisions();
      }
      S.isStreaming = false;
      S.$chatInput.disabled = false;
      S.$chatSend.disabled = false;
      S.$chatInput.focus();
    });
  }

  // --- Duplicate ---

  function handleAllocDuplicate(state) {
    const newAlloc = {
      id: state.id + '-copy-' + Date.now(),
      title: state.title + ' (copy)',
      groups: JSON.parse(JSON.stringify(state.groups)),
      analysis: state.analysis ? JSON.parse(JSON.stringify(state.analysis)) : null
    };

    // Reset moved state on people in the copy
    for (const g of newAlloc.groups) {
      for (const p of g.people) {
        if (p.movedBy === 'user' && p.previousRole) {
          // Keep the moved state so user can see the starting point
        }
      }
    }

    // Find the parent of the original allocation card
    let parentNodeId = null;
    for (const [nid, node] of canvasNodes) {
      if (node.el?.dataset?.allocId === state.id) {
        parentNodeId = node.parentId;
        break;
      }
    }

    renderAllocation(newAlloc, parentNodeId ? canvasNodes.get(parentNodeId)?.el?.dataset?.cardId || canvasNodes.get(parentNodeId)?.el?.dataset?.allocId : null);
  }

  // --- Decide ---

  function handleAllocDecide(state) {
    if (state.analysisStale || S.isStreaming) return;
    state.decided = true;

    // Build decision summary
    const moveSummary = state.moveHistory.length > 0
      ? state.moveHistory.map(m => `${m.person.name} → ${state.groups.find(g => g.id === m.toGroupId)?.title || '?'}`).join(', ')
      : 'No changes from initial configuration';

    const groupSummary = state.groups.map(g => `${g.title}: ${g.people?.length || 0}`).join(', ');

    // Find canvas node for this allocation
    let allocNodeId = null;
    for (const [nid, node] of canvasNodes) {
      if (node.el?.dataset?.allocId === state.id) { allocNodeId = nid; break; }
    }

    // Pure client-side — no LLM call. Just add to cart and lock the card.
    S.addDecision({
      id: `decision-${state.id}`,
      category: 'Team Structure',
      title: `Approve: ${state.title}`,
      description: moveSummary !== 'No changes from initial configuration'
        ? `Moves: ${moveSummary}`
        : groupSummary,
      _canvasNodeId: allocNodeId,
      _domainId: activeDomainId
    });
    updateNavDecisions();
    softRebuildAlloc(state);
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

  // --- Test Shortcut (call from console: Studio.testAlloc()) ---
  window._scenarioTestAlloc = function() {
    // Set up entity
    setEntity({
      id: 'person-008', name: 'Raj Patel', role: 'Engineering Lead',
      avatarUrl: 'https://mattcmorrell.github.io/ee-graph/data/avatars/person-008.jpg'
    });
    S.$scenarioTitle.textContent = 'Raj Patel';
    renderEntityOnCanvas();

    const people = [
      { id: 'p1', name: 'Mike Torres', role: 'Platform Engineer', initials: 'MT' },
      { id: 'p2', name: 'Andrew Wilson', role: 'Platform Engineer', initials: 'AW' },
      { id: 'p3', name: 'Liam Patel', role: 'DevOps Engineer', initials: 'LP' },
      { id: 'p4', name: 'Derek Lin', role: 'Engineer', initials: 'DL' },
      { id: 'p5', name: 'Benjamin Zhao', role: 'Engineer', initials: 'BZ' },
      { id: 'p6', name: 'Sienna Baker', role: 'Engineer', initials: 'SB' },
      { id: 'p7', name: 'Michael Adams', role: 'Engineer', initials: 'MA' },
      { id: 'p8', name: 'Camila Reyes', role: 'Engineer', initials: 'CR' },
      { id: 'p9', name: 'Maxwell Rivera', role: 'Engineer', initials: 'MR' },
      { id: 'p10', name: 'Marco Russo', role: 'DevOps Engineer', initials: 'MR' },
      { id: 'p11', name: 'Wyatt Gibson', role: 'Engineer', initials: 'WG' },
      { id: 'p12', name: 'Clara Fox', role: 'Engineer', initials: 'CF' },
    ];

    // Allocation A: 8/4 split (seniority-heavy)
    renderAllocation({
      id: 'alloc-test-a', title: 'Seniority-Heavy Split',
      groups: [
        { id: 'ga1', title: 'Group A', people: people.slice(0, 8) },
        { id: 'ga2', title: 'Group B', people: people.slice(8) }
      ],
      analysis: { metrics: [{ label: 'Split', value: '8 / 4', sentiment: 'warning', note: 'Uneven' }], insights: [{ type: 'risk', title: 'Lopsided', description: 'Group A has 2x the people.' }] }
    }, null);

    // Allocation B: 6/6 split (balanced)
    renderAllocation({
      id: 'alloc-test-b', title: 'Balanced Split',
      groups: [
        { id: 'gb1', title: 'Group A', people: people.slice(0, 6) },
        { id: 'gb2', title: 'Group B', people: people.slice(6) }
      ],
      analysis: { metrics: [{ label: 'Split', value: '6 / 6', sentiment: 'positive', note: 'Even' }], insights: [{ type: 'pro', title: 'Balanced', description: 'Equal headcount.' }] }
    }, null);

    // Remove welcome message
    const welcome = document.querySelector('.convo-welcome');
    if (welcome) welcome.remove();

    console.log('Test allocations ready. Type "which do you recommend?" in the chat.');
  };

  window._scenarioTestFlow = function() {
    // Set up entity
    setEntity({
      id: 'person-008', name: 'Raj Patel', role: 'Engineering Lead',
      badge: 'Resigned', badgeType: 'critical',
      avatarUrl: 'https://mattcmorrell.github.io/ee-graph/data/avatars/person-008.jpg'
    });
    updateTitleBar();
    renderEntityOnCanvas();

    // Set up domains in the nav
    const testDomains = [
      { id: 'dom-staffing', title: 'Staffing Gap', icon: 'staffing', severity: 'high', meta: '14 direct reports need coverage', status: 'active' },
      { id: 'dom-project', title: 'Project Risk', icon: 'project', severity: 'high', meta: '4 active projects, 2 solo-owned', status: 'active' },
      { id: 'dom-knowledge', title: 'Knowledge Transfer', icon: 'knowledge', severity: 'high', meta: '3 skills with no other holders', status: 'active' },
    ];
    setDomains(testDomains);
    activeDomainId = 'dom-staffing';
    renderNavList();
    updateTitleBar();

    // Remove welcome message
    const welcome = document.querySelector('.convo-welcome');
    if (welcome) welcome.remove();

    // Add a staffing card on canvas so there's something to interact with
    const cardEl = document.createElement('div');
    cardEl.className = 'scenario-canvas-card';
    cardEl.innerHTML = `
      <div class="scenario-cc-header">Staffing Gap</div>
      <div class="scenario-cc-body">
        <div style="display:flex;gap:12px;margin-bottom:14px">
          <div style="padding:12px 16px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Active Reports</div><div style="font-size:24px;font-weight:700">12</div></div>
          <div style="padding:12px 16px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Solo Projects</div><div style="font-size:24px;font-weight:700;color:#f59e0b">2</div></div>
        </div>
        <div style="padding:14px;border-radius:8px;background:#2a2a2a">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">Coverage Snapshot</div>
          <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #333"><span style="font-size:13px">Lisa Huang (current manager)</span><span style="font-size:13px;font-weight:600">2 reports</span></div>
          <div style="display:flex;justify-content:space-between;padding:6px 0"><span style="font-size:13px">If Lisa absorbs all</span><span style="font-size:13px;font-weight:600;color:#ef4444">14 reports</span></div>
        </div>
      </div>
    `;
    cardEl.dataset.cardId = 'card-staffing-test';

    const entityNodeId = findEntityNodeId();
    const nodeId = addCanvasCard('card', entityNodeId, cardEl);
    renderExploreBar(cardEl, [
      { text: 'Compare interim manager candidates', category: 'action' },
      { text: 'Which reports are highest risk?', category: 'knowledge' },
      { text: 'Show a team reallocation scenario', category: 'action' },
    ]);
    setupCardClickToFocus(cardEl, nodeId);
    requestAnimationFrame(() => { layoutTree(); setFocus(nodeId); });
  };

  S.registerMode({
    id: 'scenario',
    label: 'Scenario',

    init() {
      createNavPanel();
      // Hide the default decision log — we use our own in the nav panel
      const dl = document.getElementById('decisionLog');
      if (dl) dl.style.display = 'none';
      // Dismiss new-card pill on any canvas interaction
      const vp = document.getElementById('viewport');
      if (vp) vp.addEventListener('pointerdown', dismissNewCardIndicator);

      // Dev test buttons
      const topbar = document.querySelector('.topbar');
      if (topbar && !document.getElementById('testAllocBtn')) {
        const btnStyle = 'padding:3px 10px;font-size:11px;border-radius:4px;border:1px solid #444;background:#2a2a2a;color:#999;cursor:pointer;';
        const wrap = document.createElement('div');
        wrap.id = 'testAllocBtn';
        wrap.style.cssText = 'margin-left:auto;display:flex;gap:6px;';

        const b1 = document.createElement('button');
        b1.textContent = 'Test Scenario';
        b1.style.cssText = btnStyle;
        b1.addEventListener('click', () => { if (window._scenarioTestFlow) window._scenarioTestFlow(); });
        wrap.appendChild(b1);

        const b2 = document.createElement('button');
        b2.textContent = 'Test Alloc';
        b2.style.cssText = btnStyle;
        b2.addEventListener('click', () => { if (window._scenarioTestAlloc) window._scenarioTestAlloc(); });
        wrap.appendChild(b2);

        const b3 = document.createElement('button');
        b3.textContent = 'Comp: Compact';
        b3.style.cssText = btnStyle;
        b3.addEventListener('click', () => {
          comparisonLayout = comparisonLayout === 'full' ? 'compact' : 'full';
          b3.textContent = `Comp: ${comparisonLayout === 'full' ? 'Full' : 'Compact'}`;
        });
        wrap.appendChild(b3);

        topbar.appendChild(wrap);
      }
    },

    cleanup() {
      destroyNavPanel();
      entity = null;
      entityLocked = false;
      domains = [];
      proposedDomains = [];
      selectedProposals.clear();
      activeDomainId = null;
      focusedNodeId = null;
      canvasNodes.clear();
      domainCanvasStates.clear();
      nodeIdCounter = 0;
      destroySvgOverlay();
      // Clean up allocation state
      allocState.clear();
      allocDrag = null;
      document.removeEventListener('pointermove', onAllocDragMove);
      document.removeEventListener('pointerup', onAllocDragEnd);
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
        { text: 'Split Raj Patel\'s team', query: 'Split Raj Patel\'s direct reports into two groups so I can drag people between them. Show the allocation.' },
        { text: 'What if Raj Patel resigned?', query: 'Raj Patel just resigned. What do we need to handle?' },
        { text: 'Evaluate a team restructuring', query: 'What would happen if we merged the Platform and Infrastructure teams?' },
        { text: 'Explore a skill gap', query: 'We need machine learning capability by Q3 but have no ML engineers. What are our options?' }
      ];
    }
  });

})();
