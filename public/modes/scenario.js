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
  const domainCanvasStates = new Map(); // domainId → { nodes, svgEl, focusedId, entityNodeId }

  function genId() { return 'sc-' + (++nodeIdCounter); }

  // =============================================
  // NAV PANEL
  // =============================================

  function createNavPanel() {
    if (navPanelEl) return;

    navPanelEl = document.createElement('div');
    navPanelEl.className = 'scenario-nav scenario-nav-collapsed';
    navPanelEl.innerHTML = `
      <div class="scenario-nav-toggle" id="scenarioNavToggle" title="Impact Areas">
        <span class="scenario-nav-toggle-icon">&#9654;</span>
      </div>
      <div class="scenario-nav-content">
        <div class="scenario-nav-header">
          <div class="scenario-nav-label">Impact Areas</div>
          <button class="scenario-nav-collapse-btn" id="scenarioNavCollapse" title="Collapse">&times;</button>
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
      </div>
    `;

    // Insert before canvas-area
    const layout = document.querySelector('.layout');
    const canvasArea = document.querySelector('.canvas-area');
    layout.insertBefore(navPanelEl, canvasArea);

    // Wire nav toggle (expand)
    document.getElementById('scenarioNavToggle').addEventListener('click', () => {
      navPanelEl.classList.remove('scenario-nav-collapsed');
    });

    // Wire nav collapse
    document.getElementById('scenarioNavCollapse').addEventListener('click', () => {
      navPanelEl.classList.add('scenario-nav-collapsed');
    });

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
    // Auto-expand nav when domains arrive
    if (newDomains.length > 0 && navPanelEl) {
      navPanelEl.classList.remove('scenario-nav-collapsed');
    }
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
    domainCanvasStates.set(domainId, {
      nodes: savedNodes,
      svgEl: svgOverlay,
      focusedId: focusedNodeId,
      allocStates: new Map(allocState) // save allocation states for this domain
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
      CanvasEngine.zoomToFit(80);
    });

    return true;
  }

  function selectDomain(domainId) {
    if (domainId === activeDomainId) return;

    // Save current domain's canvas state
    saveDomainState(activeDomainId);

    activeDomainId = domainId;
    renderNavList();

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
      console.log('Decision object:', JSON.stringify(d));
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
    // Only center on the first layout — not during exploration
    const isFirstLayout = roots.length === 1 && roots[0].children.length === 0;
    requestAnimationFrame(() => {
      drawConnectors();
      if (isFirstLayout) CanvasEngine.focusOn(roots[0].id, 1);
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

    setCanvasLoading(true);
    S.callChat(`Selected domains: ${names}. Start with ${first.title}.`, (data) => {
      if (statusEl) statusEl.remove();
      S.isStreaming = false;
      setCanvasLoading(false);
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

  async function handleSendMessage(text) {
    if (S.isStreaming) return;
    S.isStreaming = true;

    S.renderUserMessage(text);
    const statusEl = S.renderStatus('Thinking...');
    setCanvasLoading(true);

    S.callChat(text, (data) => {
      // Remove status and loading
      if (statusEl) statusEl.remove();
      S.isStreaming = false;
      setCanvasLoading(false);

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

      // Handle allocation card (team restructuring)
      if (data.allocation) {
        S.$canvasEmpty.classList.add('hidden');
        const parentCardId = pendingParentCardId;
        pendingParentCardId = null;
        renderAllocation(data.allocation, parentCardId);
        // Also render prompts as an explore bar on the allocation card
        // (handled separately since allocation cards don't use createCardElement)
      }

      // Handle allocation analysis update
      if (data.allocation_update) {
        // Find the allocation card that was being re-analyzed
        // The most recently edited one is the target
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

      // Handle canvas card + options + decisions
      if (data.card) {
        handleCardResponse(data);
      }

      // Handle options without a card
      if (!data.card && !data.allocation && data.options && data.options.length > 0) {
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

    // Layout and focus — no camera movement, user controls the view
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
    if (!options || options.length === 0) return;

    const AVATAR_BASE = 'https://mattcmorrell.github.io/ee-graph/data/avatars/';

    // Create a single row element containing all comparison columns
    const rowEl = document.createElement('div');
    rowEl.className = 'scenario-comp-row';

    for (const opt of options) {
      const col = document.createElement('div');
      col.className = 'scenario-comp-col';
      col.dataset.optionId = opt.id;

      // Header: avatar + name + role + tag
      const hasAvatar = opt.personId;
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
            <div class="scenario-comp-section-label">Strengths</div>
            ${opt.strengths.map(s => `<div class="scenario-comp-pro">+ ${S.escapeHtml(s)}</div>`).join('')}
          </div>
        ` : ''}
        ${opt.risks && opt.risks.length > 0 ? `
          <div class="scenario-comp-section">
            <div class="scenario-comp-section-label">Risks</div>
            ${opt.risks.map(r => `<div class="scenario-comp-con">&minus; ${S.escapeHtml(r)}</div>`).join('')}
          </div>
        ` : ''}
        ${opt.summary ? `<div class="scenario-comp-summary">${S.escapeHtml(opt.summary)}</div>` : ''}
        <button class="scenario-comp-choose">Choose ${S.escapeHtml(opt.name.split(' ')[0])}</button>
      `;

      // Choose button handler
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

    // Find parent node for the options row
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
      // Use the last card added
      let lastCard = null;
      for (const [nid, node] of canvasNodes) {
        if (node.type === 'card') lastCard = nid;
      }
      parentNodeId = lastCard;
    }

    const nodeId = addCanvasCard('options', parentNodeId, rowEl);
    requestAnimationFrame(() => layoutTree());
  }

  function selectOption(opt, colEl, rowEl, parentCardId) {
    // Visual: highlight chosen, dim others
    rowEl.querySelectorAll('.scenario-comp-col').forEach(c => {
      if (c === colEl) {
        c.classList.add('scenario-comp-decided');
      } else {
        c.classList.add('scenario-comp-dimmed');
      }
      c.querySelector('.scenario-comp-choose').disabled = true;
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

    // Undo strip
    if (state.moveHistory.length > 0 && !state.decided) {
      const last = state.moveHistory[state.moveHistory.length - 1];
      const fromGroup = state.groups.find(g => g.id === last.fromGroupId);
      const toGroup = state.groups.find(g => g.id === last.toGroupId);
      const strip = document.createElement('div');
      strip.className = 'scenario-alloc-undo';
      strip.innerHTML = `
        <div class="scenario-alloc-undo-dot"></div>
        <div class="scenario-alloc-undo-text">You moved <strong>${S.escapeHtml(last.person.name)}</strong> from ${S.escapeHtml(fromGroup?.title || '?')} to ${S.escapeHtml(toGroup?.title || '?')}</div>
      `;
      const undoBtn = document.createElement('button');
      undoBtn.className = 'scenario-alloc-undo-btn';
      undoBtn.textContent = 'Undo';
      undoBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleAllocUndo(state);
      });
      strip.appendChild(undoBtn);
      el.appendChild(strip);
    }

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

    // Pure client-side — no LLM call. Just add to cart and lock the card.
    S.addDecision({
      id: `decision-${state.id}`,
      category: 'Team Structure',
      title: `Approve: ${state.title}`,
      description: moveSummary !== 'No changes from initial configuration'
        ? `Moves: ${moveSummary}`
        : groupSummary
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
