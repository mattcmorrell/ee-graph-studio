// modes/allocation.js — Resource Allocation mode (scenario tabs + group buckets + drag-and-drop)
(function() {
  const S = window.Studio;

  // --- State ---
  let scenarios = [];
  let activeScenarioIdx = 0;
  let blockId = null;
  let moveHistory = [];
  let analysisStale = false;

  // --- Drag state (pointer-based, not HTML5 DnD) ---
  let drag = null; // { personId, sourceGroupId, clone, chip, offsetX, offsetY }

  // =============================================
  // POINTER DRAG SYSTEM
  // =============================================

  function startDrag(e, person, groupId, chipEl) {
    if (S.isStreaming || drag) return;
    e.preventDefault();
    e.stopPropagation();

    const rect = chipEl.getBoundingClientRect();

    // Floating clone that follows cursor
    const clone = chipEl.cloneNode(true);
    clone.className = 'alloc-drag-clone';
    clone.style.cssText = `
      position:fixed; z-index:10000; pointer-events:none;
      left:${rect.left}px; top:${rect.top}px;
      width:${rect.width}px; height:${rect.height}px;
    `;
    document.body.appendChild(clone);

    chipEl.classList.add('alloc-chip-dragging');

    // Show all buckets as drop targets
    document.querySelectorAll('.alloc-bucket').forEach(b => {
      if (b.dataset.groupId !== groupId) {
        b.classList.add('alloc-drop-target');
      }
    });

    drag = {
      personId: person.id,
      sourceGroupId: groupId,
      clone,
      chip: chipEl,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top
    };

    document.addEventListener('pointermove', onDragMove);
    document.addEventListener('pointerup', onDragEnd);
  }

  function onDragMove(e) {
    if (!drag) return;
    drag.clone.style.left = (e.clientX - drag.offsetX) + 'px';
    drag.clone.style.top = (e.clientY - drag.offsetY) + 'px';

    // Hit-test: hide clone, find element under cursor
    drag.clone.style.display = 'none';
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    drag.clone.style.display = '';

    // Highlight the hovered bucket
    document.querySelectorAll('.alloc-bucket-dragover').forEach(b => b.classList.remove('alloc-bucket-dragover'));
    const bucket = hit?.closest('.alloc-bucket');
    if (bucket && bucket.dataset.groupId && bucket.dataset.groupId !== drag.sourceGroupId) {
      bucket.classList.add('alloc-bucket-dragover');
    }
  }

  function onDragEnd(e) {
    if (!drag) return;
    document.removeEventListener('pointermove', onDragMove);
    document.removeEventListener('pointerup', onDragEnd);

    // Hit-test for drop
    drag.clone.style.display = 'none';
    const hit = document.elementFromPoint(e.clientX, e.clientY);

    // Clean up visuals
    document.querySelectorAll('.alloc-drop-target, .alloc-bucket-dragover').forEach(b => {
      b.classList.remove('alloc-drop-target', 'alloc-bucket-dragover');
    });
    drag.chip.classList.remove('alloc-chip-dragging');
    drag.clone.remove();

    // Execute drop if valid
    const bucket = hit?.closest('.alloc-bucket');
    if (bucket && bucket.dataset.groupId && bucket.dataset.groupId !== drag.sourceGroupId) {
      executeDrop(drag.personId, drag.sourceGroupId, bucket.dataset.groupId);
    }

    drag = null;
  }

  function executeDrop(personId, fromGroupId, toGroupId) {
    const scenario = scenarios[activeScenarioIdx];
    const sourceGroup = scenario.groups.find(g => g.id === fromGroupId);
    const targetGroup = scenario.groups.find(g => g.id === toGroupId);
    if (!sourceGroup || !targetGroup) return;

    const personIdx = sourceGroup.people.findIndex(p => p.id === personId);
    if (personIdx === -1) return;

    const person = sourceGroup.people.splice(personIdx, 1)[0];
    person.movedBy = 'user';
    person.state = 'moved';
    person.previousRole = person.role;
    person.role = `moved from ${sourceGroup.name}`;
    targetGroup.people.push(person);

    sourceGroup.count = sourceGroup.people.length;
    targetGroup.count = targetGroup.people.length;

    moveHistory.push({ person: { ...person }, fromGroupId, toGroupId });
    analysisStale = true;
    scenario.badge = 'Edited';

    softRebuild();
  }

  // =============================================
  // SCENARIO RENDERING
  // =============================================

  function renderScenario(scenario) {
    const wrapper = document.createElement('div');
    wrapper.style.width = '100%';

    // Scenario tabs
    if (scenarios.length > 1) {
      const tabs = document.createElement('div');
      tabs.className = 'alloc-tabs';
      for (let i = 0; i < scenarios.length; i++) {
        const sc = scenarios[i];
        const tab = document.createElement('button');
        tab.className = `alloc-tab${i === activeScenarioIdx ? ' alloc-tab-active' : ''}`;
        tab.innerHTML = `${S.escapeHtml(sc.name)} <span class="alloc-tab-badge alloc-badge-${sc.badge === 'Edited' ? 'edited' : sc.badge === 'Live' ? 'current' : 'ai'}">${S.escapeHtml(sc.badge || 'AI')}</span>`;
        tab.addEventListener('click', () => {
          if (i === activeScenarioIdx) return;
          activeScenarioIdx = i;
          moveHistory = [];
          analysisStale = false;
          rebuildCanvas();
        });
        tabs.appendChild(tab);
      }
      const addBtn = document.createElement('button');
      addBtn.className = 'alloc-tab-add';
      addBtn.title = 'New scenario';
      addBtn.textContent = '+';
      addBtn.addEventListener('click', handleNewScenario);
      tabs.appendChild(addBtn);
      wrapper.appendChild(tabs);
    }

    // Undo strip
    if (moveHistory.length > 0) {
      const last = moveHistory[moveHistory.length - 1];
      const fromGroup = scenario.groups.find(g => g.id === last.fromGroupId);
      const toGroup = scenario.groups.find(g => g.id === last.toGroupId);
      const strip = document.createElement('div');
      strip.className = 'alloc-undo-strip';
      strip.innerHTML = `
        <div class="alloc-undo-dot"></div>
        <div class="alloc-undo-text">You moved <strong>${S.escapeHtml(last.person.name)}</strong> from ${S.escapeHtml(fromGroup?.name || '?')} to ${S.escapeHtml(toGroup?.name || '?')}</div>
      `;
      const undoBtn = document.createElement('button');
      undoBtn.className = 'alloc-undo-action';
      undoBtn.textContent = 'Undo';
      undoBtn.addEventListener('click', handleUndo);
      strip.appendChild(undoBtn);
      wrapper.appendChild(strip);
    }

    // Group buckets
    if (scenario.groups && scenario.groups.length > 0) {
      const groups = document.createElement('div');
      groups.className = 'alloc-groups';
      if (scenario.groups.length <= 4) {
        groups.style.gridTemplateColumns = `repeat(${scenario.groups.length}, 1fr)`;
      }
      for (const group of scenario.groups) {
        groups.appendChild(createGroupBucket(group));
      }
      wrapper.appendChild(groups);
    }

    // Analysis panel
    if (scenario.analysis) {
      wrapper.appendChild(createAnalysisPanel(scenario.analysis));
    }

    // Action bar
    wrapper.appendChild(createActionBar(scenario));

    return wrapper;
  }

  function createGroupBucket(group) {
    const bucket = document.createElement('div');
    bucket.className = 'alloc-bucket';
    bucket.dataset.groupId = group.id;

    const header = document.createElement('div');
    header.className = 'alloc-bucket-header';

    const name = document.createElement('span');
    name.className = 'alloc-bucket-name';
    name.textContent = group.name;
    header.appendChild(name);

    const countEl = document.createElement('span');
    countEl.className = 'alloc-bucket-count';
    const count = group.people ? group.people.length : 0;
    let countHtml = String(count);
    if (group.delta && group.delta !== 0) {
      const cls = group.delta > 0 ? 'alloc-delta-up' : 'alloc-delta-down';
      const sign = group.delta > 0 ? '+' : '';
      countHtml += ` <span class="${cls}">(${sign}${group.delta})</span>`;
    }
    countEl.innerHTML = countHtml;
    header.appendChild(countEl);
    bucket.appendChild(header);

    const people = document.createElement('div');
    people.className = 'alloc-bucket-people';

    if (group.people) {
      for (const p of group.people) {
        people.appendChild(createPersonChip(p, group.id));
      }
    }

    bucket.appendChild(people);
    return bucket;
  }

  function createPersonChip(p, groupId) {
    const chip = document.createElement('div');
    let chipClass = 'alloc-chip';
    if (p.state === 'new') chipClass += ' alloc-chip-new';
    if (p.movedBy === 'user') chipClass += ' alloc-chip-user-moved';
    chip.className = chipClass;
    chip.dataset.personId = p.id;

    // Pointer-based drag
    chip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // left click only
      startDrag(e, p, groupId, chip);
    });

    const avatar = document.createElement('div');
    avatar.className = 'alloc-chip-avatar';
    if (p.state === 'new') {
      avatar.style.background = 'var(--success-dim)';
      avatar.style.color = 'var(--success)';
    } else if (p.movedBy === 'user') {
      avatar.style.background = 'var(--purple-dim)';
      avatar.style.color = 'var(--purple)';
    }
    avatar.textContent = p.initials;
    chip.appendChild(avatar);

    const info = document.createElement('div');
    const nameEl = document.createElement('div');
    nameEl.className = 'alloc-chip-name';
    nameEl.textContent = p.name;
    info.appendChild(nameEl);
    if (p.role) {
      const roleEl = document.createElement('div');
      roleEl.className = 'alloc-chip-role';
      roleEl.textContent = p.movedBy === 'user' ? 'moved by you' : p.role;
      info.appendChild(roleEl);
    }
    chip.appendChild(info);

    return chip;
  }

  function createAnalysisPanel(analysis) {
    const panel = document.createElement('div');
    panel.className = 'alloc-analysis' + (analysisStale ? ' alloc-analysis-stale' : '');

    const header = document.createElement('div');
    header.className = 'alloc-analysis-header';
    const title = document.createElement('div');
    title.className = 'alloc-analysis-title';
    if (analysisStale) title.style.color = 'var(--warning)';
    title.textContent = 'AI Analysis';
    header.appendChild(title);
    const badge = document.createElement('div');
    badge.className = 'alloc-analysis-badge';
    if (analysisStale) {
      badge.style.background = 'var(--warning-dim)';
      badge.style.color = 'var(--warning)';
      badge.textContent = 'Stale \u2014 re-analyze';
    } else {
      badge.textContent = 'Auto';
    }
    header.appendChild(badge);
    panel.appendChild(header);

    const contentWrapper = document.createElement('div');
    if (analysisStale) contentWrapper.style.opacity = '0.4';

    if (analysis.metrics && analysis.metrics.length > 0) {
      const metrics = document.createElement('div');
      metrics.className = 'alloc-metrics';
      for (const m of analysis.metrics) {
        const metric = document.createElement('div');
        metric.className = 'alloc-metric';
        metric.innerHTML = `
          <div class="alloc-metric-label">${S.escapeHtml(m.label)}</div>
          <div class="alloc-metric-value alloc-sv-${analysisStale ? 'neu' : (m.sentiment || 'neu')}">${analysisStale ? '?' : S.escapeHtml(m.value)}</div>
          <div class="alloc-metric-note">${analysisStale ? '\u2014' : S.escapeHtml(m.note || '')}</div>
        `;
        metrics.appendChild(metric);
      }
      contentWrapper.appendChild(metrics);
    }

    if (analysis.insights && analysis.insights.length > 0) {
      const body = document.createElement('div');
      body.className = 'alloc-insights';
      const list = document.createElement('div');
      list.className = 'alloc-insight-list';
      for (const ins of analysis.insights) {
        const iconMap = { pro: '&#10003;', risk: '!', con: '&#9888;' };
        const item = document.createElement('div');
        item.className = 'alloc-insight';
        item.innerHTML = `
          <div class="alloc-insight-icon alloc-icon-${ins.type || 'pro'}">${iconMap[ins.type] || '&#10003;'}</div>
          <div class="alloc-insight-text">
            <div class="alloc-insight-title">${S.escapeHtml(ins.title)}</div>
            <div class="alloc-insight-desc">${analysisStale ? 'Previous analysis \u2014 may no longer apply' : S.escapeHtml(ins.description || '')}</div>
          </div>
        `;
        list.appendChild(item);
      }
      body.appendChild(list);
      contentWrapper.appendChild(body);
    }

    panel.appendChild(contentWrapper);
    return panel;
  }

  function createActionBar(scenario) {
    const actions = document.createElement('div');
    actions.className = 'alloc-actions';

    if (moveHistory.length > 0) {
      const undoBtn = document.createElement('button');
      undoBtn.className = 'alloc-action-btn alloc-btn-undo';
      undoBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 7h7a4 4 0 010 8H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M6 4L3 7l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Undo last`;
      undoBtn.addEventListener('click', handleUndo);
      actions.appendChild(undoBtn);
    }

    if (analysisStale) {
      const analyzeBtn = document.createElement('button');
      analyzeBtn.className = 'alloc-action-btn alloc-btn-analyze';
      analyzeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3l2 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Analyze changes`;
      analyzeBtn.addEventListener('click', () => handleAnalyzeChanges(scenario));
      actions.appendChild(analyzeBtn);
    }

    const dupBtn = document.createElement('button');
    dupBtn.className = 'alloc-action-btn alloc-btn-duplicate';
    dupBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M3 11V3a2 2 0 012-2h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Duplicate`;
    dupBtn.addEventListener('click', handleDuplicate);
    actions.appendChild(dupBtn);

    const decideBtn = document.createElement('button');
    decideBtn.className = 'alloc-action-btn alloc-btn-decide';
    if (analysisStale) {
      decideBtn.style.opacity = '0.4';
      decideBtn.style.cursor = 'not-allowed';
    }
    decideBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6.5 11.5L2.5 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Decide this scenario`;
    if (!analysisStale) {
      decideBtn.addEventListener('click', () => handleDecideScenario(scenario));
    }
    actions.appendChild(decideBtn);

    return actions;
  }

  // =============================================
  // CANVAS MANAGEMENT
  // =============================================

  function rebuildCanvas() {
    if (blockId) {
      CanvasEngine.removeBlock(blockId);
      blockId = null;
    }
    const scenario = scenarios[activeScenarioIdx];
    if (!scenario) return;

    const el = renderScenario(scenario);
    el.classList.add('canvas-node');
    el.style.width = '820px';
    el.style.maxWidth = 'none';
    CanvasEngine.addBlock('alloc-main', el, 0, 0);
    blockId = 'alloc-main';

    requestAnimationFrame(() => {
      setTimeout(() => CanvasEngine.focusOn('alloc-main', 0.7), 200);
    });
  }

  function softRebuild() {
    const block = CanvasEngine.getBlock('alloc-main');
    if (!block) { rebuildCanvas(); return; }
    const scenario = scenarios[activeScenarioIdx];
    if (!scenario) return;

    const newContent = renderScenario(scenario);
    block.el.innerHTML = '';
    while (newContent.firstChild) {
      block.el.appendChild(newContent.firstChild);
    }
  }

  // =============================================
  // INTERACTIONS
  // =============================================

  function handleUndo() {
    if (moveHistory.length === 0) return;
    const last = moveHistory.pop();
    const scenario = scenarios[activeScenarioIdx];
    const sourceGroup = scenario.groups.find(g => g.id === last.toGroupId);
    const targetGroup = scenario.groups.find(g => g.id === last.fromGroupId);
    if (!sourceGroup || !targetGroup) return;

    const personIdx = sourceGroup.people.findIndex(p => p.id === last.person.id);
    if (personIdx === -1) return;

    const person = sourceGroup.people.splice(personIdx, 1)[0];
    person.movedBy = undefined;
    person.state = person.previousRole ? undefined : person.state;
    if (person.previousRole) {
      person.role = person.previousRole;
      delete person.previousRole;
    }
    targetGroup.people.push(person);
    sourceGroup.count = sourceGroup.people.length;
    targetGroup.count = targetGroup.people.length;

    if (moveHistory.length === 0) analysisStale = false;
    softRebuild();
  }

  function handleAnalyzeChanges(scenario) {
    if (S.isStreaming) return;
    S.isStreaming = true;
    S.$chatInput.disabled = true;
    S.$chatSend.disabled = true;

    const groupSummary = scenario.groups.map(g => {
      const people = (g.people || []).map(p => `${p.name} (${p.role || 'no role'})`).join(', ');
      return `${g.name} (${g.people?.length || 0}): ${people}`;
    }).join('\n');

    const movesSummary = moveHistory.map(m =>
      `Moved ${m.person.name} from ${m.fromGroupId} to ${m.toGroupId}`
    ).join('; ');

    S.renderUserMessage('Analyze my changes');
    const statusEl = S.renderStatus('Re-analyzing allocation...');

    S.callChat(`The user has manually edited the allocation scenario "${scenario.name}". Changes: ${movesSummary}.\n\nCurrent groups:\n${groupSummary}\n\nProvide fresh analysis with updated metrics and insights.`, (data) => {
      if (statusEl) statusEl.remove();
      S.renderAIConvoMessage(data.message);

      if (data.scenario && data.scenario.analysis) {
        scenario.analysis = data.scenario.analysis;
      }
      analysisStale = false;
      softRebuild();

      if (data.decisions) {
        for (const d of data.decisions) S.addDecision(d);
      }
      S.isStreaming = false;
      S.$chatInput.disabled = false;
      S.$chatSend.disabled = false;
      S.$chatInput.focus();
    });
  }

  function handleNewScenario() {
    if (S.isStreaming) return;
    S.isStreaming = true;
    S.$chatInput.disabled = true;
    S.$chatSend.disabled = true;

    S.renderUserMessage('Create a new scenario');
    const statusEl = S.renderStatus('Generating scenario...');

    S.callChat('Create a new allocation scenario based on a different approach than the existing ones.', (data) => {
      if (statusEl) statusEl.remove();
      S.renderAIConvoMessage(data.message);
      if (data.scenario) {
        scenarios.push(data.scenario);
        activeScenarioIdx = scenarios.length - 1;
        moveHistory = [];
        analysisStale = false;
        rebuildCanvas();
      }
      S.isStreaming = false;
      S.$chatInput.disabled = false;
      S.$chatSend.disabled = false;
    });
  }

  function handleDuplicate() {
    const current = scenarios[activeScenarioIdx];
    if (!current) return;
    const dup = JSON.parse(JSON.stringify(current));
    dup.id = dup.id + '-copy';
    dup.name = dup.name + ' (copy)';
    dup.badge = 'Edited';
    scenarios.push(dup);
    activeScenarioIdx = scenarios.length - 1;
    moveHistory = [];
    analysisStale = false;
    rebuildCanvas();
  }

  function handleDecideScenario(scenario) {
    if (analysisStale) return;
    S.addDecision({
      id: `decision-${scenario.id}`,
      category: 'Resource Allocation',
      title: `Approve: ${scenario.name}`,
      description: scenario.groups ? scenario.groups.map(g => `${g.name}: ${g.people?.length || 0}`).join(', ') : ''
    });
    S.isStreaming = true;
    S.$chatInput.disabled = true;
    S.$chatSend.disabled = true;
    S.renderUserMessage(`I decide: ${scenario.name}`);
    const statusEl = S.renderStatus('Processing decision...');
    S.callChat(`I decide to go with scenario: "${scenario.name}". Record this decision and summarize next steps.`, (data) => {
      if (statusEl) statusEl.remove();
      S.renderAIConvoMessage(data.message);
      if (data.decisions) {
        for (const d of data.decisions) S.addDecision(d);
      }
      S.isStreaming = false;
      S.$chatInput.disabled = false;
      S.$chatSend.disabled = false;
    });
  }

  // =============================================
  // SEND MESSAGE
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
      if (data.scenario) {
        S.$canvasEmpty.classList.add('hidden');
        scenarios.push(data.scenario);
        activeScenarioIdx = scenarios.length - 1;
        moveHistory = [];
        analysisStale = false;
        S.$scenarioTitle.textContent = data.scenario.name || 'Scenario';
        rebuildCanvas();
      }
      if (data.decisions) {
        for (const d of data.decisions) S.addDecision(d);
      }
      S.isStreaming = false;
      S.$chatInput.disabled = false;
      S.$chatSend.disabled = false;
      S.$chatInput.focus();
    });
  }

  // =============================================
  // REGISTER MODE
  // =============================================

  S.registerMode({
    id: 'allocation',
    label: 'Allocation',
    init() {},
    cleanup() {
      scenarios = [];
      activeScenarioIdx = 0;
      moveHistory = [];
      analysisStale = false;
      drag = null;
      blockId = null;
      // Remove any leftover drag listeners
      document.removeEventListener('pointermove', onDragMove);
      document.removeEventListener('pointerup', onDragEnd);
    },
    handleSendMessage(text) { sendMessage(text); },
    getSystemPromptId() { return 'allocation'; },
    getStarters() {
      return [
        { text: 'Rebalance Atlas team', query: 'Project Atlas has 7 engineers but only needs 4 for this phase. How should we redistribute the extra 3 people across understaffed projects?' },
        { text: 'Engineering reorg', query: 'Show me how the engineering teams are currently staffed and suggest a reallocation to unblock Beacon and Nova.' },
        { text: 'Post-departure shuffle', query: 'If Raj Patel leaves, how should we reorganize his team and redistribute his projects?' },
        { text: 'Hiring freeze allocation', query: 'With a hiring freeze, how should we reallocate existing people to cover our most critical projects?' }
      ];
    }
  });

})();
