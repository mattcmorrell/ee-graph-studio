// modes/branching.js — Decision Branching mode (comparison columns)
(function() {
  const S = window.Studio;

  // --- State ---
  let parentCardId = null;
  let columnsBlockId = null;
  let decidedColumnId = null;

  // =============================================
  // COLUMN RENDERING
  // =============================================

  function createParentCard(card) {
    const el = document.createElement('div');

    const header = document.createElement('div');
    header.className = 'canvas-card-header';
    header.textContent = card.title || 'Decision';
    el.appendChild(header);

    const body = document.createElement('div');
    body.className = 'canvas-card-body';
    body.innerHTML = card.html || '';
    el.appendChild(body);

    return el;
  }

  function createColumnsBlock(columns) {
    const wrapper = document.createElement('div');
    wrapper.style.width = '100%';

    const header = document.createElement('div');
    header.className = 'branch-fork-header';
    header.innerHTML = '<span class="branch-fork-dot"></span> Choose a path';
    wrapper.appendChild(header);

    const gridCount = columns.length + 1; // +1 for ghost
    const grid = document.createElement('div');
    grid.className = 'branch-grid';
    grid.style.gridTemplateColumns = `repeat(${gridCount}, minmax(170px, 1fr))`;
    wrapper.appendChild(grid);

    for (const col of columns) {
      const colEl = createColumn(col);
      grid.appendChild(colEl);
    }

    // Ghost write-in column
    const ghost = createGhostColumn();
    grid.appendChild(ghost);

    return wrapper;
  }

  function createColumn(col) {
    const el = document.createElement('div');
    el.className = 'branch-col';
    el.dataset.colId = col.id;

    // Head
    const head = document.createElement('div');
    head.className = 'branch-col-head';
    const title = document.createElement('span');
    title.className = 'branch-col-title';
    title.textContent = col.title;
    head.appendChild(title);
    if (col.riskLabel) {
      const tag = document.createElement('span');
      tag.className = `branch-col-tag branch-tag-${col.riskLevel || 'med'}`;
      tag.textContent = col.riskLabel;
      head.appendChild(tag);
    }
    el.appendChild(head);

    // Effects
    if (col.effects && col.effects.length > 0) {
      const effects = document.createElement('div');
      effects.className = 'branch-col-effects';
      for (const fx of col.effects) {
        const row = document.createElement('div');
        row.className = 'branch-fx-row';
        row.innerHTML = `
          <span class="branch-fx-label">${S.escapeHtml(fx.label)}</span>
          <span class="branch-fx-val branch-fx-${fx.sentiment || 'neutral'}">${S.escapeHtml(fx.value)}</span>
        `;
        effects.appendChild(row);
      }
      el.appendChild(effects);
    }

    // People dots
    if (col.people && col.people.length > 0) {
      const people = document.createElement('div');
      people.className = 'branch-col-people';
      for (const p of col.people) {
        const dot = document.createElement('div');
        dot.className = `branch-pdot${p.state && p.state !== 'normal' ? ` branch-pdot-${p.state}` : ''}`;
        dot.textContent = p.initials;
        dot.title = p.name || p.initials;
        people.appendChild(dot);
      }
      el.appendChild(people);
    }

    // Prompts
    if (col.prompts && col.prompts.length > 0) {
      const prompts = document.createElement('div');
      prompts.className = 'branch-col-prompts';
      for (const promptText of col.prompts) {
        const btn = document.createElement('button');
        btn.className = 'branch-cprompt';
        btn.textContent = promptText;
        btn.addEventListener('click', () => {
          if (S.isStreaming || btn.classList.contains('branch-cprompt-active')) return;
          handleColumnPrompt(col.id, promptText, btn);
        });
        prompts.appendChild(btn);
      }
      el.appendChild(prompts);
    }

    // Decide button
    const decideBtn = document.createElement('button');
    decideBtn.className = 'branch-decide-btn';
    decideBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6.5 11.5L2.5 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Decide this one
    `;
    decideBtn.addEventListener('click', () => {
      if (S.isStreaming || decidedColumnId) return;
      handleDecide(col, el, decideBtn);
    });
    el.appendChild(decideBtn);

    return el;
  }

  function createGhostColumn() {
    const ghost = document.createElement('div');
    ghost.className = 'branch-col-ghost';

    const icon = document.createElement('div');
    icon.className = 'branch-ghost-icon';
    icon.textContent = '+';
    ghost.appendChild(icon);

    const label = document.createElement('div');
    label.className = 'branch-ghost-label';
    label.innerHTML = 'Propose your<br>own path';
    ghost.appendChild(label);

    ghost.addEventListener('click', () => {
      if (ghost.classList.contains('branch-col-ghost-active') || S.isStreaming || decidedColumnId) return;
      activateGhostColumn(ghost);
    });

    return ghost;
  }

  function activateGhostColumn(ghost) {
    ghost.classList.add('branch-col-ghost-active');
    ghost.innerHTML = '';

    const input = document.createElement('textarea');
    input.className = 'branch-ghost-input';
    input.placeholder = 'Describe your alternative...';
    input.rows = 3;
    ghost.appendChild(input);

    const submit = document.createElement('button');
    submit.className = 'branch-ghost-submit';
    submit.textContent = 'Generate';
    submit.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text || S.isStreaming) return;
      handleGhostSubmit(text);
    });
    ghost.appendChild(submit);

    input.focus();
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit.click();
      }
    });
  }

  // =============================================
  // INTERACTIONS
  // =============================================

  function handleColumnPrompt(colId, promptText, btnEl) {
    if (S.isStreaming) return;
    S.isStreaming = true;

    btnEl.classList.add('branch-cprompt-active');

    S.$chatInput.disabled = true;
    S.$chatSend.disabled = true;

    S.renderUserMessage(promptText);
    const statusEl = S.renderStatus('Thinking...');

    S.callChat(`[Column: ${colId}] ${promptText}`, (data) => {
      if (statusEl) statusEl.remove();
      S.renderAIConvoMessage(data.message);

      // Render inline drill expansion within the column
      if (data.card && data.card.html) {
        const colEl = document.querySelector(`[data-col-id="${colId}"]`);
        if (colEl) {
          const promptsContainer = colEl.querySelector('.branch-col-prompts');
          if (promptsContainer) {
            const expansion = document.createElement('div');
            expansion.className = 'branch-inline-drill';
            expansion.innerHTML = data.card.html;
            btnEl.insertAdjacentElement('afterend', expansion);
          }
        }
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

  function handleDecide(col, colEl, btnEl) {
    decidedColumnId = col.id;

    // Mark chosen column
    colEl.classList.add('branch-col-decided');
    btnEl.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6.5 11.5L2.5 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Decided
    `;

    // Dim other columns and ghost
    const grid = colEl.parentElement;
    if (grid) {
      grid.querySelectorAll('.branch-col, .branch-col-ghost').forEach(el => {
        if (el !== colEl) {
          el.classList.add('branch-col-dimmed');
        }
      });
    }

    // Add to decision log
    S.addDecision({
      id: `decision-${col.id}`,
      category: 'Decisions',
      title: col.title,
      description: col.effects ? col.effects.map(fx => `${fx.label}: ${fx.value}`).join(', ') : ''
    });

    // Notify the AI
    S.isStreaming = true;
    S.$chatInput.disabled = true;
    S.$chatSend.disabled = true;

    S.renderUserMessage(`I decide: ${col.title}`);
    const statusEl = S.renderStatus('Thinking...');

    S.callChat(`I decide: ${col.title} (column ${col.id})`, (data) => {
      if (statusEl) statusEl.remove();
      S.renderAIConvoMessage(data.message);

      if (data.decisions) {
        for (const d of data.decisions) S.addDecision(d);
      }

      S.isStreaming = false;
      S.$chatInput.disabled = false;
      S.$chatSend.disabled = false;
      S.$chatInput.focus();
    });
  }

  function handleGhostSubmit(text) {
    S.isStreaming = true;
    S.$chatInput.disabled = true;
    S.$chatSend.disabled = true;

    S.renderUserMessage(`Custom option: ${text}`);
    const statusEl = S.renderStatus('Generating alternative...');

    S.callChat(`The user proposes a custom alternative: "${text}". Generate a comparison column for this option with the same structure as the other columns (effects, people, prompts).`, (data) => {
      if (statusEl) statusEl.remove();
      S.renderAIConvoMessage(data.message);

      // If the AI returns columns, add them to the grid
      if (data.columns && data.columns.length > 0) {
        const grid = document.querySelector('.branch-grid');
        if (grid) {
          const ghost = grid.querySelector('.branch-col-ghost');
          for (const col of data.columns) {
            const colEl = createColumn(col);
            if (ghost) {
              grid.insertBefore(colEl, ghost);
            } else {
              grid.appendChild(colEl);
            }
          }
          // Update grid columns and container width
          const colCount = grid.children.length;
          grid.style.gridTemplateColumns = `repeat(${colCount}, minmax(170px, 1fr))`;
          const container = grid.closest('.canvas-card');
          if (container) {
            container.style.width = Math.max(560, colCount * 190) + 'px';
            container.style.maxWidth = 'none';
          }
        }
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

      if (data.card) {
        S.$canvasEmpty.classList.add('hidden');

        // Parent card
        const parentEl = createParentCard(data.card);
        parentEl.classList.add('canvas-node');
        CanvasEngine.addBlock('branch-parent', parentEl, 0, 0);
        parentCardId = 'branch-parent';

        S.$scenarioTitle.textContent = data.card.title;
      }

      // Comparison columns
      if (data.columns && data.columns.length > 0) {
        const columnsEl = createColumnsBlock(data.columns);
        columnsEl.classList.add('canvas-node');

        // Break out of canvas-card/canvas-node width constraints
        const colCount = data.columns.length + 1; // +1 for ghost
        const colWidth = 200;
        const gridWidth = colCount * colWidth + (colCount - 1) * 10; // cols + gaps
        columnsEl.style.width = Math.max(560, gridWidth) + 'px';
        columnsEl.style.maxWidth = 'none';

        CanvasEngine.addBlock('branch-columns', columnsEl, 0, 0);
        columnsBlockId = 'branch-columns';

        // Position below parent
        requestAnimationFrame(() => {
          const parentBlock = CanvasEngine.getBlock('branch-parent');
          if (parentBlock) {
            const parentH = parentBlock.el.offsetHeight || 200;
            CanvasEngine.moveBlock('branch-columns', 0, parentH + 16, true);
          }

          setTimeout(() => {
            CanvasEngine.focusOn('branch-columns', 0.75);
          }, 200);
        });
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
    id: 'branching',
    label: 'Branching',

    init() {},

    cleanup() {
      parentCardId = null;
      columnsBlockId = null;
      decidedColumnId = null;
    },

    handleSendMessage(text) {
      sendMessage(text);
    },

    getSystemPromptId() {
      return 'branching';
    },

    getStarters() {
      return [
        { text: 'Raj Patel succession plan', query: 'Raj Patel is leaving. Who should replace him as engineering lead? Show me the options side by side.' },
        { text: 'Team restructuring options', query: 'Project Atlas is overstaffed. What are our options for redistributing the team?' },
        { text: 'Promote vs hire externally', query: 'We need a new VP of Engineering. Should we promote from within or hire externally? Compare the paths.' },
        { text: 'Office consolidation', query: 'If we consolidate to one office, what are the different approaches we could take? Compare them.' }
      ];
    }
  });

})();
