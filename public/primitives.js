// primitives.js — Block renderers for EE Graph Studio
// Each renderer takes (data) and returns a DOM element

const Primitives = (() => {

  const AVATAR_BASE = 'https://mattcmorrell.github.io/ee-graph/data/avatars/';

  // --- Helpers ---
  function el(tag, className, innerHTML) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (innerHTML !== undefined) e.innerHTML = innerHTML;
    return e;
  }

  function initials(name) {
    if (!name) return '?';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  function avatarHtml(personId, name, cssClass, statusClass) {
    const src = personId ? `${AVATAR_BASE}${personId}.jpg` : '';
    if (src) {
      return `<img class="${cssClass} ${statusClass || ''}" src="${src}" alt="${name || ''}" onerror="this.outerHTML='<div class=\\'${cssClass} avatar-fallback ${statusClass || ''}\\'>${initials(name)}</div>'">`;
    }
    return `<div class="${cssClass} avatar-fallback ${statusClass || ''}">${initials(name)}</div>`;
  }

  function parseMarkdown(md) {
    if (!md) return '';
    return md
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function nodeTypeIcon(type) {
    const icons = { person: 'P', project: 'J', team: 'T', skill: 'S', department: 'D' };
    return icons[type] || type?.[0]?.toUpperCase() || '?';
  }

  // --- 1. Narrative ---
  function renderNarrative(data) {
    const content = typeof data === 'string' ? data : (data.content || '');
    const div = el('div', 'prim-narrative');
    div.innerHTML = `<p>${parseMarkdown(content)}</p>`;
    return div;
  }

  // --- 2. Person Card ---
  function renderPersonCard(data) {
    const d = data.data || data;
    const div = el('div', 'prim-person-card');
    const statusClass = d.status === 'terminated' ? 'terminated' : 'active';

    let statsHtml = '';
    if (d.stats && d.stats.length > 0) {
      statsHtml = `<div class="prim-person-stats">${d.stats.map(s =>
        `<div class="prim-person-stat"><span class="prim-stat-value">${escapeHtml(String(s.value))}</span><span class="prim-stat-label">${escapeHtml(s.label)}</span></div>`
      ).join('')}</div>`;
    }

    div.innerHTML = `
      ${avatarHtml(d.personId || d.id, d.name, 'prim-avatar', statusClass)}
      <div class="prim-person-info">
        <div class="prim-person-name">${escapeHtml(d.name || 'Unknown')}</div>
        <div class="prim-person-role">${escapeHtml(d.role || '')}${d.level ? ' · ' + escapeHtml(d.level) : ''}</div>
        <div class="prim-person-meta">
          ${d.teamName ? `<span class="prim-meta-item">◆ ${escapeHtml(d.teamName)}</span>` : ''}
          ${d.managerName ? `<span class="prim-meta-item">↑ ${escapeHtml(d.managerName)}</span>` : ''}
          ${d.location ? `<span class="prim-meta-item">◎ ${escapeHtml(d.location)}</span>` : ''}
          ${d.startDate ? `<span class="prim-meta-item">Since ${escapeHtml(d.startDate)}</span>` : ''}
        </div>
        ${statsHtml}
      </div>
    `;

    return div;
  }

  // --- 3. Impact Card ---
  function renderImpactCard(data) {
    const d = data.data || data;
    const severity = d.severity || 'medium';

    let peopleHtml = '';
    if (d.affectedPeople && d.affectedPeople.length > 0) {
      peopleHtml = `<div class="prim-affected-people">${d.affectedPeople.map(p =>
        `<span class="prim-person-chip"><span class="prim-chip-dot"></span>${escapeHtml(p.name || p)}</span>`
      ).join('')}</div>`;
    }

    const div = el('div', `prim-impact-card prim-severity-${severity}`);
    div.innerHTML = `
      <div class="prim-impact-header">
        <span class="prim-severity-badge prim-severity-${severity}">${severity}</span>
        <span class="prim-impact-title">${escapeHtml(d.title || '')}</span>
      </div>
      <div class="prim-impact-desc">${parseMarkdown(d.description || '')}</div>
      ${peopleHtml}
    `;

    return div;
  }

  // --- 4. Metric Row ---
  function renderMetricRow(data) {
    const d = data.data || data;
    const metrics = d.metrics || [];
    const div = el('div', 'prim-metric-row');

    for (const m of metrics) {
      const card = el('div', 'prim-metric-card');
      card.innerHTML = `
        <div class="prim-metric-value">${escapeHtml(String(m.value))}</div>
        <div class="prim-metric-label">${escapeHtml(m.label)}</div>
        ${m.context ? `<div class="prim-metric-context">${escapeHtml(m.context)}</div>` : ''}
      `;
      div.appendChild(card);
    }

    return div;
  }

  // --- 5. Cascade Path ---
  function renderCascadePath(data) {
    const d = data.data || data;
    const steps = d.steps || [];
    const div = el('div', 'prim-cascade-path');

    if (d.title) {
      div.innerHTML = `<div class="prim-cascade-title">${escapeHtml(d.title)}</div>`;
    }

    const stepsContainer = el('div', 'prim-cascade-steps');
    let stepIndex = 0;

    for (const step of steps) {
      if (step.edge) {
        const edgeEl = el('div', 'prim-cascade-edge');
        edgeEl.style.animationDelay = `${stepIndex * 200}ms`;
        edgeEl.innerHTML = `
          <div class="prim-cascade-edge-line"></div>
          <div class="prim-cascade-edge-label">${escapeHtml(step.label || step.edge)}</div>
        `;
        stepsContainer.appendChild(edgeEl);
      } else {
        const nodeType = step.type || 'default';
        const nodeEl = el('div', 'prim-cascade-node');
        nodeEl.style.animationDelay = `${stepIndex * 200}ms`;
        nodeEl.innerHTML = `
          <div class="prim-cascade-node-dot prim-node-${nodeType}">${nodeTypeIcon(nodeType)}</div>
          <div class="prim-cascade-node-label">${escapeHtml(step.label || '')}</div>
          ${step.detail ? `<div class="prim-cascade-node-detail">${escapeHtml(step.detail)}</div>` : ''}
        `;
        stepsContainer.appendChild(nodeEl);
      }
      stepIndex++;
    }

    div.appendChild(stepsContainer);
    return div;
  }

  // --- 6. Action List ---
  function renderActionList(data) {
    const d = data.data || data;
    const actions = d.actions || [];
    const div = el('div', 'prim-action-list');

    if (d.title) {
      div.innerHTML = `<div class="prim-action-title">${escapeHtml(d.title)}</div>`;
    }

    for (const a of actions) {
      const priority = a.priority || 'medium';
      const item = el('div', 'prim-action-item');
      item.innerHTML = `
        <div class="prim-action-priority prim-priority-${priority}"></div>
        <div class="prim-action-content">
          <div class="prim-action-text">${escapeHtml(a.action)}</div>
          <div class="prim-action-meta">
            ${a.owner ? `<span class="prim-action-owner">${escapeHtml(a.owner)}</span>` : ''}
            ${a.reason ? ` · ${escapeHtml(a.reason)}` : ''}
          </div>
        </div>
      `;
      div.appendChild(item);
    }

    return div;
  }

  // --- 7. Raw HTML fallback ---
  function renderRawHtml(data) {
    const html = typeof data === 'string' ? data : (data.html || data.content || '');
    const div = el('div', 'prim-raw-html');
    div.innerHTML = html;
    return div;
  }

  // --- Dispatch ---
  function render(block) {
    const type = block.type;
    switch (type) {
      case 'narrative': return renderNarrative(block);
      case 'person_card': return renderPersonCard(block);
      case 'impact_card': return renderImpactCard(block);
      case 'metric_row': return renderMetricRow(block);
      case 'cascade_path': return renderCascadePath(block);
      case 'action_list': return renderActionList(block);
      case 'html': return renderRawHtml(block);
      default:
        // Unknown type — try raw html fallback
        if (block.html || block.content) return renderRawHtml(block);
        const div = el('div', 'prim-unknown');
        div.textContent = `Unknown block: ${type}`;
        return div;
    }
  }

  return { render, renderPersonCard, renderImpactCard, renderMetricRow, renderCascadePath, renderActionList, renderNarrative, renderRawHtml };
})();
