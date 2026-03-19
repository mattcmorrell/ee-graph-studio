/* ================================================================
   MOCKUP FEEDBACK PANEL (global template)
   Drop into any mockup HTML: <script src="feedback-panel.js"></script>

   - Collects idea/execution ratings, verdict, and notes per design tab
   - Saves to server (/api/feedback/:file) with localStorage fallback
   - Tab detection via .switcher button.active
   - Version-aware: reads manifest to tag feedback with design version

   Server endpoint required (add to project server.js):
     See ~/.claude/templates/mockup-feedback-endpoint.js
   ================================================================ */
(function() {
  var FILE_NAME = location.pathname.split('/').pop().replace('.html', '');
  var API_URL = '/api/feedback/' + encodeURIComponent(FILE_NAME);
  var MANIFEST_URL = '/api/feedback/' + encodeURIComponent(FILE_NAME) + '/manifest';
  var LS_KEY = 'feedback-' + FILE_NAME;
  var drawerOpen = false;
  var DRAWER_WIDTH = 360;
  var allFeedback = [];
  var manifest = null;

  // ---- Load / Save ----
  function loadData() {
    // Load feedback from server
    fetch(API_URL).then(function(r) { return r.json(); }).then(function(data) {
      if (Array.isArray(data) && data.length > 0) {
        allFeedback = data;
        // Also sync to localStorage
        try { localStorage.setItem(LS_KEY, JSON.stringify(allFeedback)); } catch(e) {}
        updateToggle();
        if (drawerOpen) refreshPanel();
      }
    }).catch(function() {});
    // Load manifest
    fetch(MANIFEST_URL).then(function(r) { return r.json(); }).then(function(data) {
      if (data && data.designs) manifest = data;
    }).catch(function() {});
    // Immediate fallback from localStorage
    try { var d = localStorage.getItem(LS_KEY); if (d) allFeedback = JSON.parse(d); } catch(e) {}
  }

  function saveLs() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(allFeedback)); } catch(e) {}
  }

  function saveToServer(entry) {
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    }).catch(function() {});
  }

  // ---- Tab detection ----
  function getActiveDesign() {
    var btn = document.querySelector('.switcher button.active');
    if (btn) return btn.textContent.trim();
    return 'General';
  }

  function getDesignVersion(name) {
    if (manifest && manifest.designs && manifest.designs[name]) {
      return manifest.designs[name].version || 1;
    }
    return 1;
  }

  function getFeedbackForDesign(name) {
    return allFeedback.filter(function(f) { return f.tab === name; });
  }

  // ---- Styles ----
  function injectStyles() {
    var css = document.createElement('style');
    css.textContent =
      'body{transition:margin-right 0.3s ease;}' +
      'body.fb-drawer-open{margin-right:' + DRAWER_WIDTH + 'px;}' +

      '#fb-toggle{position:fixed;bottom:20px;right:20px;z-index:9999;width:48px;height:48px;border-radius:50%;' +
        'background:linear-gradient(135deg,#8b5cf6,#6d28d9);border:none;color:#fff;font-size:20px;cursor:pointer;' +
        'box-shadow:0 4px 20px rgba(139,92,246,0.4);transition:all 0.3s;display:flex;align-items:center;justify-content:center;}' +
      '#fb-toggle:hover{transform:scale(1.1);box-shadow:0 6px 28px rgba(139,92,246,0.6);}' +
      '#fb-toggle.has-feedback{background:linear-gradient(135deg,#059669,#10b981);box-shadow:0 4px 20px rgba(16,185,129,0.4);}' +
      'body.fb-drawer-open #fb-toggle{right:' + (DRAWER_WIDTH + 20) + 'px;}' +

      '#fb-drawer{position:fixed;top:0;right:-' + DRAWER_WIDTH + 'px;width:' + DRAWER_WIDTH + 'px;height:100vh;z-index:9998;' +
        'background:#0d0d14;border-left:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;' +
        'transition:right 0.3s ease;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden;}' +
      '#fb-drawer.open{right:0;}' +
      '#fb-drawer *{box-sizing:border-box;}' +

      '.fb-header{padding:16px 18px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}' +
      '.fb-header h3{font-size:13px;font-weight:600;color:#e0e0e8;margin:0;}' +
      '.fb-close{background:none;border:none;color:#666;font-size:18px;cursor:pointer;padding:4px 8px;border-radius:4px;transition:all 0.15s;}' +
      '.fb-close:hover{color:#e0e0e8;background:rgba(255,255,255,0.06);}' +
      '.fb-status{font-size:10px;font-weight:600;padding:3px 8px;border-radius:10px;margin-left:8px;background:rgba(76,175,135,0.15);color:#4caf87;}' +

      '.fb-tab-name{padding:10px 18px;font-size:11px;font-weight:600;color:#8b5cf6;text-transform:uppercase;letter-spacing:0.06em;' +
        'border-bottom:1px solid rgba(255,255,255,0.04);background:rgba(139,92,246,0.04);flex-shrink:0;display:flex;align-items:center;justify-content:space-between;}' +
      '.fb-version{font-size:10px;color:#666;font-weight:400;text-transform:none;letter-spacing:0;}' +

      '.fb-body{padding:16px 18px;overflow-y:auto;flex:1;}' +
      '.fb-field{margin-bottom:14px;}' +
      '.fb-label{font-size:11px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;}' +

      '.fb-stars{display:flex;gap:4px;}' +
      '.fb-star{width:28px;height:28px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:transparent;' +
        'color:#555;font-size:16px;cursor:pointer;transition:all 0.15s;display:flex;align-items:center;justify-content:center;font-family:inherit;}' +
      '.fb-star:hover,.fb-star.active{background:rgba(251,191,36,0.15);border-color:rgba(251,191,36,0.3);color:#fbbf24;}' +

      '.fb-select{width:100%;background:#1a1a28;border:1px solid rgba(255,255,255,0.1);color:#e0e0e8;font-family:inherit;' +
        'font-size:13px;padding:8px 12px;border-radius:8px;appearance:none;cursor:pointer;}' +
      '.fb-select:focus{outline:none;border-color:rgba(139,92,246,0.4);}' +

      '.fb-textarea{width:100%;background:#1a1a28;border:1px solid rgba(255,255,255,0.1);color:#e0e0e8;font-family:inherit;' +
        'font-size:13px;padding:10px 12px;border-radius:8px;resize:vertical;min-height:80px;line-height:1.5;}' +
      '.fb-textarea:focus{outline:none;border-color:rgba(139,92,246,0.4);}' +
      '.fb-textarea::placeholder{color:#555;}' +

      '.fb-save-btn{width:100%;padding:10px;background:linear-gradient(135deg,#8b5cf6,#6d28d9);border:none;color:#fff;' +
        'font-family:inherit;font-size:13px;font-weight:600;border-radius:8px;cursor:pointer;transition:all 0.2s;margin-top:4px;}' +
      '.fb-save-btn:hover{opacity:0.9;}' +
      '.fb-save-btn:active{transform:scale(0.98);}' +

      '.fb-saved-msg{text-align:center;font-size:12px;color:#34d399;font-weight:600;margin-top:8px;opacity:0;transition:opacity 0.3s;}' +
      '.fb-saved-msg.show{opacity:1;}' +

      '.fb-history{margin-top:16px;border-top:1px solid rgba(255,255,255,0.06);padding-top:12px;}' +
      '.fb-history-toggle{font-size:11px;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:0.05em;' +
        'margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:6px;background:none;border:none;padding:0;font-family:inherit;}' +
      '.fb-history-toggle:hover{color:#999;}' +
      '.fb-history-toggle .arrow{transition:transform 0.2s;font-size:10px;}' +
      '.fb-history-toggle .arrow.open{transform:rotate(90deg);}' +
      '.fb-history-list{display:none;}' +
      '.fb-history-list.open{display:block;}' +

      '.fb-entry{padding:10px 12px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);' +
        'border-radius:8px;margin-bottom:8px;font-size:12px;color:#999;line-height:1.5;}' +
      '.fb-entry-meta{display:flex;justify-content:space-between;margin-bottom:4px;font-size:11px;color:#666;}' +
      '.fb-entry-stars{color:#fbbf24;font-size:11px;}' +
      '.fb-entry-verdict{font-size:11px;font-weight:600;color:#8b5cf6;}' +
      '.fb-entry-version{font-size:10px;color:#555;margin-left:6px;}' +

      '.fb-export-row{display:flex;gap:6px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06);}' +
      '.fb-export-btn{flex:1;padding:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);color:#999;' +
        'font-family:inherit;font-size:11px;font-weight:600;border-radius:6px;cursor:pointer;transition:all 0.15s;text-align:center;}' +
      '.fb-export-btn:hover{background:rgba(255,255,255,0.08);color:#e0e0e8;}';
    document.head.appendChild(css);
  }

  // ---- Build UI ----
  function buildPanel() {
    // Toggle button
    var toggle = document.createElement('button');
    toggle.id = 'fb-toggle';
    toggle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    toggle.title = 'Feedback';
    toggle.onclick = toggleDrawer;
    document.body.appendChild(toggle);

    // Drawer
    var drawer = document.createElement('div');
    drawer.id = 'fb-drawer';
    drawer.innerHTML =
      '<div class="fb-header">' +
        '<h3>Feedback<span class="fb-status" id="fb-status">server</span></h3>' +
        '<button class="fb-close" onclick="document.getElementById(\'fb-toggle\').click()">&times;</button>' +
      '</div>' +
      '<div class="fb-tab-name"><span id="fb-tab-name"></span><span class="fb-version" id="fb-version"></span></div>' +
      '<div class="fb-body">' +
        '<div class="fb-field">' +
          '<div class="fb-label">Idea</div>' +
          '<div class="fb-stars" id="fb-stars-idea">' +
            '<button class="fb-star" data-v="1">&#9733;</button>' +
            '<button class="fb-star" data-v="2">&#9733;</button>' +
            '<button class="fb-star" data-v="3">&#9733;</button>' +
            '<button class="fb-star" data-v="4">&#9733;</button>' +
            '<button class="fb-star" data-v="5">&#9733;</button>' +
          '</div>' +
        '</div>' +
        '<div class="fb-field">' +
          '<div class="fb-label">Execution</div>' +
          '<div class="fb-stars" id="fb-stars-exec">' +
            '<button class="fb-star" data-v="1">&#9733;</button>' +
            '<button class="fb-star" data-v="2">&#9733;</button>' +
            '<button class="fb-star" data-v="3">&#9733;</button>' +
            '<button class="fb-star" data-v="4">&#9733;</button>' +
            '<button class="fb-star" data-v="5">&#9733;</button>' +
          '</div>' +
        '</div>' +
        '<div class="fb-field">' +
          '<div class="fb-label">Verdict</div>' +
          '<select class="fb-select" id="fb-verdict">' +
            '<option value="">Select...</option>' +
            '<option value="Build Deeper">Build Deeper</option>' +
            '<option value="Fix UX & Keep">Fix UX & Keep</option>' +
            '<option value="Good As-Is">Good As-Is</option>' +
            '<option value="Merge Into Another">Merge Into Another</option>' +
            '<option value="Cut">Cut</option>' +
          '</select>' +
        '</div>' +
        '<div class="fb-field">' +
          '<div class="fb-label">Notes</div>' +
          '<textarea class="fb-textarea" id="fb-notes" placeholder="What works, what doesn\'t, what you\'d change..." rows="4"></textarea>' +
        '</div>' +
        '<button class="fb-save-btn" id="fb-save">Save Feedback</button>' +
        '<div class="fb-saved-msg" id="fb-saved">Saved!</div>' +
        '<div class="fb-history" id="fb-history"></div>' +
        '<div class="fb-export-row">' +
          '<button class="fb-export-btn" id="fb-export-md">Export Markdown</button>' +
          '<button class="fb-export-btn" id="fb-export-copy">Copy to Clipboard</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(drawer);

    // Wire stars
    ['fb-stars-idea', 'fb-stars-exec'].forEach(function(groupId) {
      document.querySelectorAll('#' + groupId + ' .fb-star').forEach(function(star) {
        star.addEventListener('click', function() {
          var val = parseInt(this.dataset.v);
          var currentActive = document.querySelectorAll('#' + groupId + ' .fb-star.active').length;
          var newVal = (currentActive === val) ? 0 : val;
          document.querySelectorAll('#' + groupId + ' .fb-star').forEach(function(s) {
            s.classList.toggle('active', newVal > 0 && parseInt(s.dataset.v) <= newVal);
          });
        });
      });
    });

    // Wire save
    document.getElementById('fb-save').addEventListener('click', saveFeedback);

    // Wire export
    document.getElementById('fb-export-md').addEventListener('click', exportMarkdown);
    document.getElementById('fb-export-copy').addEventListener('click', copyMarkdown);

    // Update when design switches
    document.querySelectorAll('.switcher button').forEach(function(btn) {
      btn.addEventListener('click', function() { setTimeout(refreshPanel, 50); });
    });
  }

  function toggleDrawer() {
    drawerOpen = !drawerOpen;
    document.getElementById('fb-drawer').classList.toggle('open', drawerOpen);
    document.body.classList.toggle('fb-drawer-open', drawerOpen);
    if (drawerOpen) refreshPanel();
  }

  function refreshPanel() {
    var designName = getActiveDesign();
    var tabEl = document.getElementById('fb-tab-name');
    if (tabEl) tabEl.textContent = designName;

    var versionEl = document.getElementById('fb-version');
    if (versionEl) versionEl.textContent = 'v' + getDesignVersion(designName);

    // Reset form
    document.querySelectorAll('#fb-stars-idea .fb-star, #fb-stars-exec .fb-star').forEach(function(s) { s.classList.remove('active'); });
    var verdictEl = document.getElementById('fb-verdict');
    if (verdictEl) verdictEl.value = '';
    var notesEl = document.getElementById('fb-notes');
    if (notesEl) notesEl.value = '';
    var savedEl = document.getElementById('fb-saved');
    if (savedEl) savedEl.classList.remove('show');

    renderHistory(designName);
    updateToggle();
  }

  function updateToggle() {
    var btn = document.getElementById('fb-toggle');
    if (!btn) return;
    btn.classList.toggle('has-feedback', getFeedbackForDesign(getActiveDesign()).length > 0);
  }

  function renderHistory(designName) {
    var container = document.getElementById('fb-history');
    if (!container) return;
    var entries = getFeedbackForDesign(designName);
    if (entries.length === 0) { container.innerHTML = ''; return; }

    var html = '<button class="fb-history-toggle" id="fb-hist-toggle">' +
      '<span class="arrow" id="fb-hist-arrow">&#9654;</span> Previous feedback (' + entries.length + ')' +
    '</button><div class="fb-history-list" id="fb-hist-list">';

    entries.slice().reverse().forEach(function(e) {
      var ideaR = e.ideaRating || 0;
      var execR = e.execRating || 0;
      function starsHtml(n) { var s=''; for(var i=0;i<5;i++) s+=i<n?'&#9733;':'&#9734;'; return s; }
      var date = e.timestamp ? new Date(e.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '?';
      var vStr = e.version ? '<span class="fb-entry-version">v' + e.version + '</span>' : '';
      html += '<div class="fb-entry">' +
        '<div class="fb-entry-meta"><span>' + date + vStr + '</span>' +
        (e.verdict ? '<span class="fb-entry-verdict">' + e.verdict + '</span>' : '') +
        '</div>' +
        '<div class="fb-entry-stars">' +
          (ideaR ? '<span title="Idea">&#128161; ' + starsHtml(ideaR) + '</span>' : '') +
          (execR ? '<span title="Execution" style="margin-left:8px;">&#9881; ' + starsHtml(execR) + '</span>' : '') +
        '</div>' +
        (e.notes ? '<div style="margin-top:4px;">' + e.notes.replace(/</g, '&lt;') + '</div>' : '') +
      '</div>';
    });
    html += '</div>';
    container.innerHTML = html;

    var toggleBtn = document.getElementById('fb-hist-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function() {
        var arrow = document.getElementById('fb-hist-arrow');
        var list = document.getElementById('fb-hist-list');
        if (arrow) arrow.classList.toggle('open');
        if (list) list.classList.toggle('open');
      });
    }
  }

  function saveFeedback() {
    var designName = getActiveDesign();
    var ideaRating = 0;
    document.querySelectorAll('#fb-stars-idea .fb-star.active').forEach(function() { ideaRating++; });
    var execRating = 0;
    document.querySelectorAll('#fb-stars-exec .fb-star.active').forEach(function() { execRating++; });
    var verdict = document.getElementById('fb-verdict').value;
    var notes = document.getElementById('fb-notes').value.trim();
    if (!ideaRating && !execRating && !verdict && !notes) return;

    var entry = {
      timestamp: new Date().toISOString(),
      tab: designName,
      version: getDesignVersion(designName),
      ideaRating: ideaRating || null,
      execRating: execRating || null,
      verdict: verdict || null,
      notes: notes || null
    };
    allFeedback.push(entry);
    saveLs();
    saveToServer(entry);

    var msg = document.getElementById('fb-saved');
    if (msg) { msg.classList.add('show'); setTimeout(function() { msg.classList.remove('show'); }, 2000); }
    refreshPanel();
  }

  // ---- Export ----
  function buildMarkdown() {
    var designs = {};
    allFeedback.forEach(function(f) {
      if (!designs[f.tab]) designs[f.tab] = [];
      designs[f.tab].push(f);
    });

    var md = '# Design Feedback — ' + FILE_NAME + '\n';
    md += '_Exported ' + new Date().toLocaleString() + '_\n\n';

    Object.keys(designs).forEach(function(name) {
      md += '## ' + name + '\n\n';
      designs[name].forEach(function(e, i) {
        var date = e.timestamp ? new Date(e.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '?';
        md += '### Entry ' + (i + 1) + ' — ' + date + (e.version ? ' (v' + e.version + ')' : '') + '\n';
        if (e.ideaRating) md += '- **Idea:** ' + String.fromCodePoint(9733).repeat(e.ideaRating) + String.fromCodePoint(9734).repeat(5 - e.ideaRating) + '\n';
        if (e.execRating) md += '- **Execution:** ' + String.fromCodePoint(9733).repeat(e.execRating) + String.fromCodePoint(9734).repeat(5 - e.execRating) + '\n';
        if (e.verdict) md += '- **Verdict:** ' + e.verdict + '\n';
        if (e.notes) md += '- **Notes:** ' + e.notes + '\n';
        md += '\n';
      });
    });
    return md;
  }

  function exportMarkdown() {
    var md = buildMarkdown();
    var blob = new Blob([md], { type: 'text/markdown' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = FILE_NAME + '-feedback.md';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function copyMarkdown() {
    var md = buildMarkdown();
    navigator.clipboard.writeText(md).then(function() {
      var btn = document.getElementById('fb-export-copy');
      if (btn) { var orig = btn.textContent; btn.textContent = 'Copied!'; setTimeout(function() { btn.textContent = orig; }, 1500); }
    });
  }

  // ---- Init ----
  function init() {
    injectStyles();
    loadData();
    buildPanel();
    updateToggle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 300);
  }
})();
