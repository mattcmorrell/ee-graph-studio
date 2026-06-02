// ai-client.js — Client-side AI engine (no server needed)
// Loads graph data, runs OpenAI tool loop directly from the browser.

const AIClient = (() => {

  let OPENAI_API_KEY = window.__OPENAI_API_KEY || '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';
  const MODEL = 'gpt-5.4-mini';
  const DATA_URL = 'https://mattcmorrell.github.io/ee-graph/data';
  const MAX_TOOL_CALLS = 25;

  // --- Graph State ---
  let nodes = [], edges = [];
  const nodesById = {};
  const edgesBySource = {};
  const edgesByTarget = {};
  const nodesByType = {};
  let graphReady = false;

  async function loadGraphData() {
    if (graphReady) return;
    const [nodesRes, edgesRes] = await Promise.all([
      fetch(`${DATA_URL}/nodes.json`),
      fetch(`${DATA_URL}/edges.json`)
    ]);
    nodes = (await nodesRes.json()).nodes;
    edges = (await edgesRes.json()).edges;
    buildIndexes();
    graphReady = true;
    console.log(`[AIClient] Loaded ${nodes.length} nodes, ${edges.length} edges`);
  }

  function buildIndexes() {
    for (const n of nodes) {
      nodesById[n.id] = n;
      if (!nodesByType[n.type]) nodesByType[n.type] = [];
      nodesByType[n.type].push(n);
    }
    for (const e of edges) {
      if (!edgesBySource[e.source]) edgesBySource[e.source] = [];
      edgesBySource[e.source].push(e);
      if (!edgesByTarget[e.target]) edgesByTarget[e.target] = [];
      edgesByTarget[e.target].push(e);
    }
  }

  // --- Helpers ---
  function nodeSummary(n) {
    if (!n) return null;
    const p = n.properties;
    const base = { id: n.id, type: n.type, name: p.name || p.title || n.id };
    if (n.type === 'person') {
      return { ...base, role: p.role, level: p.level, status: p.status, startDate: p.startDate, location: p.location, avatarUrl: p.avatarUrl };
    }
    if (n.type === 'team') return { ...base, teamType: p.teamType, headcount: p.headcount };
    if (n.type === 'project') return { ...base, status: p.status, priority: p.priority, targetEndDate: p.targetEndDate };
    if (n.type === 'skill') return { ...base, category: p.category };
    return { ...base, ...Object.fromEntries(Object.entries(p).slice(0, 5)) };
  }

  function fuzzyMatch(text, query) {
    if (!text) return false;
    const t = text.toLowerCase();
    const q = query.toLowerCase();
    return t.includes(q) || q.split(/\s+/).every(w => t.includes(w));
  }

  // --- Graph Tool Implementations ---
  function search_people(query) {
    const results = (nodesByType['person'] || [])
      .filter(n => {
        const p = n.properties;
        return fuzzyMatch(p.name, query) || fuzzyMatch(p.role, query) || fuzzyMatch(p.email, query);
      })
      .slice(0, 10)
      .map(nodeSummary);
    return { count: results.length, people: results };
  }

  function get_person_full(person_id) {
    const n = nodesById[person_id];
    if (!n || n.type !== 'person') return { error: `Person ${person_id} not found` };

    const outEdges = edgesBySource[person_id] || [];
    const inEdges = edgesByTarget[person_id] || [];

    const connections = {};
    for (const e of [...outEdges, ...inEdges]) {
      const targetId = e.source === person_id ? e.target : e.source;
      const targetNode = nodesById[targetId];
      if (!targetNode) continue;
      if (targetNode.type === 'survey_response') continue;

      const key = e.type;
      if (!connections[key]) connections[key] = [];
      connections[key].push({
        direction: e.source === person_id ? 'outgoing' : 'incoming',
        node: nodeSummary(targetNode),
        metadata: e.metadata || {}
      });
    }

    return {
      person: { id: n.id, ...n.properties },
      connectionSummary: Object.fromEntries(
        Object.entries(connections).map(([type, conns]) => [type, { count: conns.length, items: conns.slice(0, 15) }])
      ),
      totalConnections: outEdges.length + inEdges.length
    };
  }

  function get_team_full(team_id) {
    const n = nodesById[team_id];
    if (!n || n.type !== 'team') return { error: `Team ${team_id} not found` };

    const memberEdges = (edgesByTarget[team_id] || []).filter(e => e.type === 'member_of');
    const members = memberEdges.map(e => {
      const person = nodesById[e.source];
      return person ? { ...nodeSummary(person), teamRole: (e.metadata || {}).role } : null;
    }).filter(Boolean);

    const manager = members.find(m => m.teamRole === 'manager');

    const projectIds = new Set();
    const projects = [];
    for (const m of memberEdges) {
      for (const e of (edgesBySource[m.source] || [])) {
        if (e.type === 'works_on' && !projectIds.has(e.target)) {
          projectIds.add(e.target);
          const proj = nodesById[e.target];
          if (proj) projects.push(nodeSummary(proj));
        }
      }
    }

    return {
      team: { id: n.id, ...n.properties },
      manager: manager || null,
      members: members.slice(0, 20),
      memberCount: members.length,
      projects: projects.slice(0, 10)
    };
  }

  function get_direct_reports(person_id, recursive = false) {
    const person = nodesById[person_id];
    if (!person) return { error: `Person ${person_id} not found` };

    function getReports(pid, depth) {
      if (depth > 5) return [];
      const reportEdges = (edgesByTarget[pid] || []).filter(e => e.type === 'reports_to');
      const reports = [];
      for (const e of reportEdges) {
        const p = nodesById[e.source];
        if (!p) continue;
        const report = { ...nodeSummary(p), depth };
        if (recursive) {
          const subReports = getReports(e.source, depth + 1);
          if (subReports.length > 0) report.directReports = subReports;
        }
        reports.push(report);
      }
      return reports;
    }

    const allReports = getReports(person_id, 1);
    const activeReports = allReports.filter(r => r.status === 'active');
    return { manager: nodeSummary(person), reports: activeReports, totalCount: activeReports.length };
  }

  function search_nodes(query, node_type = null) {
    const pool = node_type ? (nodesByType[node_type] || []) : nodes;
    const results = pool.filter(n => {
      const p = n.properties;
      return fuzzyMatch(p.name || '', query) || fuzzyMatch(p.title || '', query) ||
             fuzzyMatch(p.role || '', query) || fuzzyMatch(p.description || '', query);
    }).slice(0, 15).map(nodeSummary);
    return { count: results.length, results };
  }

  function get_impact_radius(person_id) {
    const person = nodesById[person_id];
    if (!person || person.type !== 'person') return { error: `Person ${person_id} not found` };

    const p = person.properties;
    const outEdges = edgesBySource[person_id] || [];
    const inEdges = edgesByTarget[person_id] || [];

    const reportEdges = inEdges.filter(e => e.type === 'reports_to');
    const directReports = reportEdges.map(e => nodeSummary(nodesById[e.source])).filter(Boolean);

    const menteeEdges = outEdges.filter(e => e.type === 'mentors');
    const mentees = menteeEdges.map(e => {
      const mentee = nodesById[e.target];
      if (!mentee) return null;
      const otherMentors = (edgesByTarget[e.target] || []).filter(me => me.type === 'mentors' && me.source !== person_id);
      return { ...nodeSummary(mentee), otherMentorCount: otherMentors.length, metadata: e.metadata };
    }).filter(Boolean);

    const projectEdges = outEdges.filter(e => e.type === 'works_on');
    const projects = projectEdges.map(e => {
      const proj = nodesById[e.target];
      if (!proj) return null;
      const contributors = (edgesByTarget[e.target] || [])
        .filter(pe => pe.type === 'works_on' && pe.source !== person_id)
        .map(pe => nodeSummary(nodesById[pe.source]))
        .filter(Boolean);
      return {
        ...nodeSummary(proj),
        personRole: (e.metadata || {}).role,
        personAllocation: (e.metadata || {}).allocation,
        otherContributors: contributors,
        contributorCount: contributors.length
      };
    }).filter(Boolean);

    const skillEdges = outEdges.filter(e => e.type === 'has_skill');
    const skills = skillEdges.map(e => {
      const skill = nodesById[e.target];
      if (!skill) return null;
      const othersWithSkill = (edgesByTarget[e.target] || [])
        .filter(se => se.type === 'has_skill' && se.source !== person_id)
        .map(se => {
          const other = nodesById[se.source];
          return other && other.properties.status === 'active' ? { ...nodeSummary(other), proficiency: (se.metadata || {}).proficiency } : null;
        })
        .filter(Boolean);
      return {
        ...nodeSummary(skill),
        personProficiency: (e.metadata || {}).proficiency,
        othersWithSkill: othersWithSkill.slice(0, 5),
        totalOthersCount: othersWithSkill.length
      };
    }).filter(Boolean);

    const teamEdges = outEdges.filter(e => e.type === 'member_of');
    const teams = teamEdges.map(e => {
      const team = nodesById[e.target];
      if (!team) return null;
      const memberCount = (edgesByTarget[e.target] || []).filter(te => te.type === 'member_of').length;
      return { ...nodeSummary(team), memberCount, personRole: (e.metadata || {}).role };
    }).filter(Boolean);

    const managerEdge = outEdges.find(e => e.type === 'reports_to');
    const manager = managerEdge ? nodeSummary(nodesById[managerEdge.target]) : null;

    return {
      person: { id: person.id, ...person.properties },
      directReports: { count: directReports.length, people: directReports },
      mentees: { count: mentees.length, people: mentees },
      projects: { count: projects.length, items: projects },
      skills: { count: skills.length, items: skills },
      teams: { count: teams.length, items: teams },
      manager,
      summary: {
        totalDirectReports: directReports.length,
        totalProjects: projects.length,
        soloProjects: projects.filter(pr => pr.contributorCount === 0).map(pr => pr.name),
        criticalProjects: projects.filter(pr => pr.priority === 'critical' || pr.priority === 'high').map(pr => pr.name),
        uniqueSkills: skills.filter(s => s.totalOthersCount < 3).map(s => s.name),
        menteesWithNoOtherMentor: mentees.filter(m => m.otherMentorCount === 0).map(m => m.name)
      }
    };
  }

  function query_people(filters = {}, group_by = null) {
    let people = (nodesByType['person'] || []).map(n => ({ id: n.id, ...n.properties }));

    if (filters.location) people = people.filter(p => fuzzyMatch(p.location || '', filters.location));
    if (filters.status) people = people.filter(p => p.status === filters.status);
    if (filters.level) people = people.filter(p => p.level === filters.level);
    if (filters.role) people = people.filter(p => fuzzyMatch(p.role || '', filters.role));
    if (filters.department) people = people.filter(p => fuzzyMatch(p.department || '', filters.department));

    if (!group_by) {
      return { count: people.length, people: people.slice(0, 50).map(p => ({ id: p.id, name: p.name, role: p.role, level: p.level, location: p.location, status: p.status, startDate: p.startDate })) };
    }

    const groups = {};
    for (const p of people) {
      const key = p[group_by] || 'Unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }

    const result = {};
    for (const [key, members] of Object.entries(groups)) {
      const startDates = members.map(m => m.startDate).filter(Boolean).sort();
      result[key] = {
        count: members.length,
        oldestHire: startDates[0] || null,
        newestHire: startDates[startDates.length - 1] || null,
        people: members.slice(0, 10).map(p => ({ id: p.id, name: p.name, role: p.role, startDate: p.startDate }))
      };
    }
    return { totalMatched: people.length, groups: result };
  }

  function analyze_people(metrics) {
    const people = (nodesByType['person'] || []).filter(n => n.properties.status === 'active');
    const results = [];

    for (const person of people) {
      const pid = person.id;
      const out = edgesBySource[pid] || [];
      const inc = edgesByTarget[pid] || [];

      const entry = {
        id: pid,
        name: person.properties.name,
        role: person.properties.role,
        level: person.properties.level,
        location: person.properties.location,
        startDate: person.properties.startDate,
        projectCount: out.filter(e => e.type === 'works_on').length,
        directReportCount: inc.filter(e => e.type === 'reports_to').length,
        menteeCount: out.filter(e => e.type === 'mentors').length,
        skillCount: out.filter(e => e.type === 'has_skill').length,
        teamCount: out.filter(e => e.type === 'member_of').length,
      };

      let include = true;
      if (metrics.min_projects && entry.projectCount < metrics.min_projects) include = false;
      if (metrics.min_direct_reports && entry.directReportCount < metrics.min_direct_reports) include = false;
      if (metrics.min_mentees && entry.menteeCount < metrics.min_mentees) include = false;
      if (metrics.min_skills && entry.skillCount < metrics.min_skills) include = false;

      if (include) {
        entry.projects = out.filter(e => e.type === 'works_on').map(e => {
          const proj = nodesById[e.target];
          return proj ? { name: proj.properties.name || proj.properties.title, priority: proj.properties.priority, role: (e.metadata || {}).role } : null;
        }).filter(Boolean);

        entry.mentees = out.filter(e => e.type === 'mentors').map(e => {
          const m = nodesById[e.target];
          return m ? m.properties.name : null;
        }).filter(Boolean);

        results.push(entry);
      }
    }

    results.sort((a, b) => (b.projectCount + b.directReportCount + b.menteeCount) - (a.projectCount + a.directReportCount + a.menteeCount));
    return { count: results.length, people: results.slice(0, 20) };
  }

  function get_graph_schema() {
    const nodeTypes = {};
    for (const [type, list] of Object.entries(nodesByType)) {
      const sample = list[0];
      const propKeys = sample ? Object.keys(sample.properties) : [];
      nodeTypes[type] = { count: list.length, properties: propKeys };
    }

    const edgeTypeCounts = {};
    const edgeTypeMeta = {};
    for (const e of edges) {
      edgeTypeCounts[e.type] = (edgeTypeCounts[e.type] || 0) + 1;
      if (!edgeTypeMeta[e.type] && e.metadata) {
        edgeTypeMeta[e.type] = Object.keys(e.metadata);
      }
    }
    const edgeTypes = {};
    for (const [type, count] of Object.entries(edgeTypeCounts)) {
      edgeTypes[type] = { count, metadataKeys: edgeTypeMeta[type] || [] };
    }

    return { totalNodes: nodes.length, totalEdges: edges.length, nodeTypes, edgeTypes };
  }

  // --- Tool dispatch ---
  const toolFns = {
    get_graph_schema: () => get_graph_schema(),
    search_people: (args) => search_people(args.query),
    get_person_full: (args) => get_person_full(args.person_id),
    get_team_full: (args) => get_team_full(args.team_id),
    get_direct_reports: (args) => get_direct_reports(args.person_id, args.recursive),
    search_nodes: (args) => search_nodes(args.query, args.node_type),
    analyze_people: (args) => analyze_people(args),
    query_people: (args) => query_people(args.filters, args.group_by),
    get_impact_radius: (args) => get_impact_radius(args.person_id)
  };

  // --- Tool definitions (for OpenAI) ---
  const toolDefs = [
    { type: 'function', function: { name: 'get_graph_schema', description: 'Returns the schema of the employee graph: all node types, edge types, properties, and counts.', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'search_people', description: 'Search for people by name, role, or email. Returns up to 10 matches.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'get_person_full', description: 'Get full profile and all connections for a person.', parameters: { type: 'object', properties: { person_id: { type: 'string', description: 'Person ID, e.g. person-008' } }, required: ['person_id'] } } },
    { type: 'function', function: { name: 'get_team_full', description: 'Get team details: members, manager, projects.', parameters: { type: 'object', properties: { team_id: { type: 'string', description: 'Team ID' } }, required: ['team_id'] } } },
    { type: 'function', function: { name: 'get_direct_reports', description: 'Get direct reports for a manager. Optionally recursive.', parameters: { type: 'object', properties: { person_id: { type: 'string', description: 'Manager person ID' }, recursive: { type: 'boolean', description: 'Recurse down the tree' } }, required: ['person_id'] } } },
    { type: 'function', function: { name: 'search_nodes', description: 'Search any node type by name, title, role, or description.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' }, node_type: { type: 'string', description: 'Optional: filter by node type' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'analyze_people', description: 'Find people matching workload criteria. Computes per-person counts of projects, direct reports, mentees, skills, and teams across all active employees. Filter by minimums to find overloaded, under-connected, or otherwise notable people. Returns up to 20, sorted by total burden.', parameters: { type: 'object', properties: { min_projects: { type: 'number', description: 'Minimum project count' }, min_direct_reports: { type: 'number', description: 'Minimum direct report count' }, min_mentees: { type: 'number', description: 'Minimum mentee count' }, min_skills: { type: 'number', description: 'Minimum skill count' } } } } },
    { type: 'function', function: { name: 'query_people', description: 'Filter and optionally group all people. Use for aggregate/comparison questions (e.g. tenure by location, headcount by level). Returns up to 50 people ungrouped, or grouped aggregates with counts and date ranges.', parameters: { type: 'object', properties: { filters: { type: 'object', description: 'Optional filters: location, status, level, role, department (all fuzzy-matched)', properties: { location: { type: 'string' }, status: { type: 'string' }, level: { type: 'string' }, role: { type: 'string' }, department: { type: 'string' } } }, group_by: { type: 'string', description: 'Property to group results by, e.g. "location", "level", "status", "department"' } } } } },
    { type: 'function', function: { name: 'get_impact_radius', description: 'Multi-hop impact analysis for a person: reports, mentees, projects, skills, teams.', parameters: { type: 'object', properties: { person_id: { type: 'string', description: 'Person ID to analyze' } }, required: ['person_id'] } } }
  ];

  // --- Status messages ---
  function toolStatusMessage(name, args) {
    switch (name) {
      case 'search_people': return `Searching for "${args.query}"...`;
      case 'get_person_full': return 'Looking up full profile...';
      case 'get_team_full': return 'Loading team details...';
      case 'get_direct_reports': return args.recursive ? 'Mapping org tree...' : 'Finding direct reports...';
      case 'get_impact_radius': return 'Analyzing impact radius...';
      case 'search_nodes': return `Searching ${args.node_type || 'graph'}...`;
      case 'analyze_people': return 'Scanning for workload patterns...';
      case 'query_people': return args.group_by ? `Grouping people by ${args.group_by}...` : 'Filtering people...';
      case 'get_graph_schema': return 'Reading graph schema...';
      default: return 'Querying graph...';
    }
  }

  // --- Conversation State ---
  const conversations = new Map();
  let convoCounter = 0;

  function createConversation(mode) {
    const id = 'convo-' + (++convoCounter) + '-' + Date.now();
    const systemPrompt = SYSTEM_PROMPT_BASE + '\n\n' + SYSTEM_PROMPT_SCENARIO;
    const convo = {
      id,
      messages: [{ role: 'system', content: systemPrompt }]
    };
    conversations.set(id, convo);
    return convo;
  }

  function getConversation(id) {
    return conversations.get(id) || null;
  }

  // --- Parse result ---
  function parseResult(content) {
    let result;
    try {
      const cleaned = content.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
      result = JSON.parse(cleaned);
    } catch (e) {
      result = { message: content, cards: [], options: [], decisions: [] };
    }

    result.card = result.card || null;
    result.cards = result.cards || null;
    result.prompts = result.prompts || [];
    if (result.cta && result.cta.label) {
      const hasFeatured = result.prompts.some(p => p.featured);
      if (!hasFeatured) {
        result.prompts.unshift({ text: result.cta.label, action: result.cta.action, featured: true });
      }
      delete result.cta;
    }
    if (result.cards) {
      for (const card of result.cards) {
        card.prompts = card.prompts || [];
        if (card.cta && card.cta.label) {
          const hasFeatured = card.prompts.some(p => p.featured);
          if (!hasFeatured) {
            card.prompts.unshift({ text: card.cta.label, action: card.cta.action, featured: true });
          }
          delete card.cta;
        }
      }
    }
    result.options = result.options || null;
    result.decisions = result.decisions || [];
    result.message = result.message || '';
    result.allocation = result.allocation || null;
    result.allocation_update = result.allocation_update || null;
    result.recommend = result.recommend || null;

    if (!result.entity && !result.topic) {
      if (result.proposedDomains && result.proposedDomains.length > 0) {
        const d = result.proposedDomains[0];
        result.topic = { title: d.title || d.name, subtitle: d.meta || d.description || '' };
      } else if (result.cards && result.cards.length > 0) {
        result.topic = { title: result.cards[0].title, subtitle: '' };
      }
    }

    return result;
  }

  // --- Main chat function ---
  // Matches the same callback interface as the old SSE-based callChat
  async function chat(message, conversationId, mode, onStatus, onEntityPreview, onResult, signal) {
    await loadGraphData();

    let convo;
    if (conversationId) convo = getConversation(conversationId);
    if (!convo) convo = createConversation(mode);

    convo.messages.push({ role: 'user', content: message });

    onStatus?.('conversationId', convo.id);
    onStatus?.('status', 'Thinking...');

    let toolCalls = 0;

    while (toolCalls < MAX_TOOL_CALLS) {
      if (signal?.aborted) return;

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: MODEL,
          messages: convo.messages,
          tools: toolDefs,
          tool_choice: toolCalls < MAX_TOOL_CALLS - 1 ? 'auto' : 'none',
          parallel_tool_calls: true
        }),
        signal
      });

      if (!response.ok) {
        const err = await response.text();
        onResult({ message: `API error: ${err}`, card: null, prompts: [], decisions: [] });
        return;
      }

      const data = await response.json();
      const msg = data.choices[0].message;
      convo.messages.push(msg);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        onStatus?.('status', 'Building card...');

        const result = parseResult(msg.content || '');

        const hasCards = (result.cards && result.cards.length > 0) || result.card || result.allocation || result.options;
        if (!hasCards && !result.proposedDomains && toolCalls < MAX_TOOL_CALLS - 1) {
          convo.messages.push({ role: 'user', content: 'You must include visual cards in your response. Regenerate with at least one card containing stats, data rows, or person lockups. Return valid JSON with a "cards" array.' });
          toolCalls++;
          onStatus?.('status', 'Building visuals...');
          continue;
        }

        if (result.entity) {
          onEntityPreview?.({ type: 'entity_preview', entity: result.entity });
        } else if (result.topic) {
          onEntityPreview?.({ type: 'topic_preview', topic: result.topic });
        }

        onResult(result);
        return;
      }

      // Execute tool calls locally
      for (const tc of msg.tool_calls) {
        const fn = toolFns[tc.function.name];
        const args = JSON.parse(tc.function.arguments);
        onStatus?.('status', toolStatusMessage(tc.function.name, args));

        const result = fn ? fn(args) : { error: `Unknown tool: ${tc.function.name}` };

        convo.messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result)
        });
        toolCalls++;
      }
    }

    onResult({ message: 'Too many tool calls', card: null, prompts: [], decisions: [] });
  }

  // --- Drill endpoints (client-side replacements) ---
  function drill(type, id) {
    if (!graphReady) return { items: [] };

    if (type === 'reports') {
      const reportEdges = (edgesByTarget[id] || []).filter(e => e.type === 'reports_to');
      const items = reportEdges.map(e => {
        const p = nodesById[e.source];
        if (!p || p.type !== 'person') return null;
        return { id: p.id, name: p.properties.name, role: p.properties.role, status: p.properties.status };
      }).filter(Boolean).filter(i => i.status === 'active');
      return { label: 'Direct Reports', items };
    }

    if (type === 'projects') {
      const projectEdges = (edgesBySource[id] || []).filter(e => e.type === 'works_on');
      const items = projectEdges.map(e => {
        const proj = nodesById[e.target];
        if (!proj) return null;
        const contributors = (edgesByTarget[e.target] || []).filter(pe => pe.type === 'works_on' && pe.source !== id).length;
        return { id: proj.id, name: proj.properties.name || proj.properties.title, priority: proj.properties.priority, status: proj.properties.status, role: (e.metadata || {}).role, otherContributors: contributors };
      }).filter(Boolean);
      return { label: 'Projects', items };
    }

    if (type === 'skills') {
      const skillEdges = (edgesBySource[id] || []).filter(e => e.type === 'has_skill');
      const items = skillEdges.map(e => {
        const skill = nodesById[e.target];
        if (!skill) return null;
        const othersCount = (edgesByTarget[e.target] || []).filter(se => se.type === 'has_skill' && se.source !== id).length;
        return { id: skill.id, name: skill.properties.name || skill.properties.title, category: skill.properties.category, proficiency: (e.metadata || {}).proficiency, othersCount };
      }).filter(Boolean);
      return { label: 'Skills', items };
    }

    if (type === 'mentees') {
      const menteeEdges = (edgesBySource[id] || []).filter(e => e.type === 'mentors');
      const items = menteeEdges.map(e => {
        const mentee = nodesById[e.target];
        if (!mentee) return null;
        return { id: mentee.id, name: mentee.properties.name, role: mentee.properties.role, status: mentee.properties.status };
      }).filter(Boolean);
      return { label: 'Mentees', items };
    }

    if (type === 'teams') {
      const teamEdges = (edgesBySource[id] || []).filter(e => e.type === 'member_of');
      const items = teamEdges.map(e => {
        const team = nodesById[e.target];
        if (!team) return null;
        const memberCount = (edgesByTarget[e.target] || []).filter(te => te.type === 'member_of').length;
        return { id: team.id, name: team.properties.name || team.properties.title, memberCount, personRole: (e.metadata || {}).role };
      }).filter(Boolean);
      return { label: 'Teams', items };
    }

    if (type === 'team-members') {
      const team = nodesById[id];
      const memberEdges = (edgesByTarget[id] || []).filter(e => e.type === 'member_of');
      const items = memberEdges.map(e => {
        const p = nodesById[e.source];
        if (!p || p.type !== 'person') return null;
        return { id: p.id, name: p.properties.name, role: p.properties.role, status: p.properties.status, teamRole: (e.metadata || {}).role };
      }).filter(Boolean);
      return { label: team ? (team.properties.name || 'Team Members') : 'Team Members', items };
    }

    return { items: [] };
  }

  return {
    loadGraphData,
    chat,
    drill,
    get graphReady() { return graphReady; },
    setApiKey(key) { OPENAI_API_KEY = key; }
  };

})();
