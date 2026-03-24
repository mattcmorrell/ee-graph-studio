require('dotenv').config();
const express = require('express');
const { OpenAI } = require('openai');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = 3460;

// --- Graph Loading ---
const DATA_URL = 'https://mattcmorrell.github.io/ee-graph/data';
let nodes, edges;

async function loadGraphData() {
  console.log('Loading graph data from ee-graph...');
  const [nodesRes, edgesRes] = await Promise.all([
    fetch(`${DATA_URL}/nodes.json`),
    fetch(`${DATA_URL}/edges.json`)
  ]);
  nodes = (await nodesRes.json()).nodes;
  edges = (await edgesRes.json()).edges;
  console.log(`Loaded ${nodes.length} nodes, ${edges.length} edges`);
  buildIndexes();
}

// Build indexes
const nodesById = {};
const edgesBySource = {};
const edgesByTarget = {};
const nodesByType = {};

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
  console.log(`Node types: ${Object.keys(nodesByType).length}, indexed by source: ${Object.keys(edgesBySource).length}, by target: ${Object.keys(edgesByTarget).length}`);
}

// --- Helper functions ---
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

  const reports = getReports(person_id, 1);
  return { manager: nodeSummary(person), reports, totalCount: countTree(reports) };
}

function countTree(reports) {
  let count = reports.length;
  for (const r of reports) {
    if (r.directReports) count += countTree(r.directReports);
  }
  return count;
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

  // Apply filters
  if (filters.location) people = people.filter(p => fuzzyMatch(p.location || '', filters.location));
  if (filters.status) people = people.filter(p => p.status === filters.status);
  if (filters.level) people = people.filter(p => p.level === filters.level);
  if (filters.role) people = people.filter(p => fuzzyMatch(p.role || '', filters.role));
  if (filters.department) people = people.filter(p => fuzzyMatch(p.department || '', filters.department));

  if (!group_by) {
    return { count: people.length, people: people.slice(0, 50).map(p => ({ id: p.id, name: p.name, role: p.role, level: p.level, location: p.location, status: p.status, startDate: p.startDate })) };
  }

  // Group and aggregate
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

    // Apply filters from metrics
    let include = true;
    if (metrics.min_projects && entry.projectCount < metrics.min_projects) include = false;
    if (metrics.min_direct_reports && entry.directReportCount < metrics.min_direct_reports) include = false;
    if (metrics.min_mentees && entry.menteeCount < metrics.min_mentees) include = false;
    if (metrics.min_skills && entry.skillCount < metrics.min_skills) include = false;

    if (include) {
      // Add project details
      entry.projects = out.filter(e => e.type === 'works_on').map(e => {
        const proj = nodesById[e.target];
        return proj ? { name: proj.properties.name || proj.properties.title, priority: proj.properties.priority, role: (e.metadata || {}).role } : null;
      }).filter(Boolean);

      // Add mentee names
      entry.mentees = out.filter(e => e.type === 'mentors').map(e => {
        const m = nodesById[e.target];
        return m ? m.properties.name : null;
      }).filter(Boolean);

      results.push(entry);
    }
  }

  // Sort by total burden (projects + reports + mentees)
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

// Tool definitions for OpenAI
const toolDefs = [
  {
    type: 'function',
    function: {
      name: 'get_graph_schema',
      description: 'Returns the schema of the employee graph: all node types, edge types, properties, and counts.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_people',
      description: 'Search for people by name, role, or email. Returns up to 10 matches.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search query' } },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_person_full',
      description: 'Get full profile and all connections for a person.',
      parameters: {
        type: 'object',
        properties: { person_id: { type: 'string', description: 'Person ID, e.g. person-008' } },
        required: ['person_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_team_full',
      description: 'Get team details: members, manager, projects.',
      parameters: {
        type: 'object',
        properties: { team_id: { type: 'string', description: 'Team ID' } },
        required: ['team_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_direct_reports',
      description: 'Get direct reports for a manager. Optionally recursive.',
      parameters: {
        type: 'object',
        properties: {
          person_id: { type: 'string', description: 'Manager person ID' },
          recursive: { type: 'boolean', description: 'Recurse down the tree' }
        },
        required: ['person_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_nodes',
      description: 'Search any node type by name, title, role, or description.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          node_type: { type: 'string', description: 'Optional: filter by node type' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'analyze_people',
      description: 'Find people matching workload criteria. Computes per-person counts of projects, direct reports, mentees, skills, and teams across all active employees. Filter by minimums to find overloaded, under-connected, or otherwise notable people. Returns up to 20, sorted by total burden.',
      parameters: {
        type: 'object',
        properties: {
          min_projects: { type: 'number', description: 'Minimum project count' },
          min_direct_reports: { type: 'number', description: 'Minimum direct report count' },
          min_mentees: { type: 'number', description: 'Minimum mentee count' },
          min_skills: { type: 'number', description: 'Minimum skill count' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_people',
      description: 'Filter and optionally group all people. Use for aggregate/comparison questions (e.g. tenure by location, headcount by level). Returns up to 50 people ungrouped, or grouped aggregates with counts and date ranges.',
      parameters: {
        type: 'object',
        properties: {
          filters: {
            type: 'object',
            description: 'Optional filters: location, status, level, role, department (all fuzzy-matched)',
            properties: {
              location: { type: 'string' },
              status: { type: 'string' },
              level: { type: 'string' },
              role: { type: 'string' },
              department: { type: 'string' }
            }
          },
          group_by: {
            type: 'string',
            description: 'Property to group results by, e.g. "location", "level", "status", "department"'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_impact_radius',
      description: 'Multi-hop impact analysis for a person: reports, mentees, projects, skills, teams.',
      parameters: {
        type: 'object',
        properties: { person_id: { type: 'string', description: 'Person ID to analyze' } },
        required: ['person_id']
      }
    }
  }
];

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

// --- OpenAI ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// --- System Prompt: Base (shared across all modes) ---
const SYSTEM_PROMPT_BASE = `You are a scenario planning assistant for Acme Co, a 148-employee tech company in Austin, TX. You help HR leaders and executives explore "what if" scenarios by querying the Employee Experience Graph and presenting findings visually.

## Critical Rules

- Use real data from the graph tools. Never fabricate names, numbers, or relationships.
- NEVER generate placeholder or mockup visuals. If you can't get the data, say so in the message.
- Avatar images are available at: https://mattcmorrell.github.io/ee-graph/data/avatars/{person-id}.jpg
- Keep conversational responses concise — 1-3 sentences. The visuals do the heavy lifting.
- Each card should be self-contained and readable at a glance.

## Design Constraints

- Dark mode. Card background is #1e1e1e. Inner sections use #2a2a2a to #333. Never below #2a2a2a — it blends into the card.
- Font stack: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
- Minimum 13px body text, 11px for labels.
- Card body is max 560px wide.
- You choose all colors. Make good design choices for dark mode readability.
- NEVER use colored left borders (border-left) on blocks.
- NEVER use colored background gradients on blocks.

## Atomic Patterns

You generate every layout from scratch, but use these structural patterns for common data types. You choose all colors — these patterns only lock down structure and sizing.

### Person Lockup
Whenever you reference a person, use this layout. Never show a name as plain text.
\`\`\`
<div style="display:flex;align-items:center;gap:10px" data-person="{Name}">
  <img src="https://mattcmorrell.github.io/ee-graph/data/avatars/{person-id}.jpg" style="width:36px;height:36px;border-radius:50%;object-fit:cover" onerror="this.style.display='none'" />
  <div>
    <div style="font-size:14px;font-weight:600">{Name}</div>
    <div style="font-size:12px">{Role or subtitle}</div>
  </div>
</div>
\`\`\`
For compact lists, use 28px avatars. For hero/featured display, use 48px. Always include the avatar image.

### Stat Block
For any single metric (headcount, count, score, etc). Label on top, large number below.
\`\`\`
<div style="padding:12px 16px">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">{Label}</div>
  <div style="font-size:24px;font-weight:700">{Value}</div>
</div>
\`\`\`
When showing multiple stats side by side, put them in a flex row with equal-width items.

### Section Block
For grouping related content within a card. Creates visual hierarchy through background contrast.
\`\`\`
<div style="padding:14px;border-radius:8px;background:#2a2a2a;margin-bottom:12px">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:10px">{Section Title}</div>
  {content}
</div>
\`\`\`
Nest sparingly — max 1 level deep.

### Tag / Chip
For skills, projects, status labels, or any categorical value.
\`\`\`
<span style="display:inline-block;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:500;margin:2px">{Label}</span>
\`\`\`
Use subtle tinted backgrounds for status indicators. Keep tints subtle — never garish.

### Data Row
For key-value pairs or list items. Consistent horizontal layout.
\`\`\`
<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #2a2a2a">
  <span style="font-size:13px">{Label}</span>
  <span style="font-size:13px;font-weight:600">{Value}</span>
</div>
\`\`\`

### Bar / Proportion
For showing relative quantities. Pure CSS bars.
\`\`\`
<div style="display:flex;align-items:center;gap:10px;margin:6px 0">
  <span style="font-size:12px;width:80px;text-align:right">{Label}</span>
  <div style="flex:1;height:8px;border-radius:4px;background:#2a2a2a">
    <div style="width:{percent}%;height:100%;border-radius:4px"></div>
  </div>
  <span style="font-size:12px;font-weight:600;width:36px">{Value}</span>
</div>
\`\`\`

### Severity Block
For risks, consequences, or warnings. Flat section background — color only in the badge pill.
\`\`\`
<div style="padding:14px;border-radius:8px;background:#2a2a2a">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
    <span style="padding:2px 9px;border-radius:10px;font-size:11px;font-weight:600;text-transform:uppercase">{SEVERITY}</span>
    <span style="font-weight:600;font-size:13px">{Title}</span>
  </div>
  <div style="font-size:13px;line-height:1.5">{Description}</div>
</div>
\`\`\`

## Drillable Stats

When you show a stat that summarizes a list (e.g. "12 direct reports", "4 projects", "3 skills"), make the VALUE clickable by wrapping it in a span with data-drill attributes. The client will handle the inline expansion — no AI round-trip needed.

Put \`data-drill\` and \`data-id\` attributes on the ENTIRE stat block container (not just the value). The whole box becomes clickable. The client adds hover states and an expand indicator automatically.

Drill types:
- \`data-drill="reports"\` + \`data-id="{person-id}"\` — expands to show direct reports
- \`data-drill="projects"\` + \`data-id="{person-id}"\` — expands to show projects
- \`data-drill="skills"\` + \`data-id="{person-id}"\` — expands to show skills
- \`data-drill="mentees"\` + \`data-id="{person-id}"\` — expands to show mentees
- \`data-drill="teams"\` + \`data-id="{person-id}"\` — expands to show teams
- \`data-drill="team-members"\` + \`data-id="{team-id}"\` — expands to show team members

Example stat block with drill:
\`\`\`
<div data-drill="reports" data-id="person-008" style="padding:12px 16px">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Direct Reports</div>
  <div style="font-size:24px;font-weight:700">12</div>
</div>
\`\`\`

To show a drill already expanded when the card renders, add \`data-drill-open\`:
\`\`\`
<div data-drill="reports" data-drill-open data-id="person-008" style="padding:12px 16px">
  ...
</div>
\`\`\`
Use \`data-drill-open\` when the user explicitly asked to see the people/items (e.g. "show me the team members", "who reports to them?").

Use drillable stats whenever you know the person/entity ID. This lets users peek at the data behind any number without leaving the card.

**NEVER generate inline lists of people in card HTML.** Always use drillable stats for people lists — the client renders them consistently. Use \`data-drill-open\` if the list should be visible immediately.

## Layout Principles
- **Proximity:** Group related items tightly (8px gap), separate distinct groups with more space (16-20px).
- **Hierarchy:** One clear headline per card. Use font-size steps: 18px title → 14px body → 12px secondary → 11px label.
- **Alignment:** Left-align text. Right-align numbers in tables. Keep a consistent left edge.
- **Density:** Prefer compact, information-dense layouts. Space is for separation, not for filling area.
- **Composition:** Compose freely from these patterns. A card might have a person lockup + stat row + severity block + data rows — whatever best answers the question.`;

// --- System Prompt: Mode-specific additions ---
const MODE_PROMPTS = {};

function buildSystemPrompt(mode) {
  return SYSTEM_PROMPT_BASE + '\n\n' + (MODE_PROMPTS[mode] || MODE_PROMPTS['scenario']);
}

// --- Conversation State ---
const conversations = new Map();
const CONVERSATION_TTL = 30 * 60 * 1000; // 30 minutes

function getConversation(id) {
  const convo = conversations.get(id);
  if (convo) {
    convo.lastAccess = Date.now();
    return convo;
  }
  return null;
}

function createConversation(mode) {
  const id = uuidv4();
  const convo = {
    id,
    messages: [{ role: 'system', content: buildSystemPrompt(mode || 'scenario') }],
    lastAccess: Date.now()
  };
  conversations.set(id, convo);
  return convo;
}

// Cleanup stale conversations every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, convo] of conversations) {
    if (now - convo.lastAccess > CONVERSATION_TTL) {
      conversations.delete(id);
    }
  }
}, 5 * 60 * 1000);

// --- Status Messages ---
function toolStatusMessage(name, args) {
  switch (name) {
    case 'search_people': return `Searching for "${args.query}"...`;
    case 'get_person_full': return `Looking up full profile...`;
    case 'get_team_full': return `Loading team details...`;
    case 'get_direct_reports': return args.recursive ? `Mapping org tree...` : `Finding direct reports...`;
    case 'get_impact_radius': return `Analyzing impact radius...`;
    case 'search_nodes': return `Searching ${args.node_type || 'graph'}...`;
    case 'analyze_people': return `Scanning for workload patterns...`;
    case 'query_people': return args.group_by ? `Grouping people by ${args.group_by}...` : `Filtering people...`;
    case 'get_graph_schema': return `Reading graph schema...`;
    default: return `Querying graph...`;
  }
}

MODE_PROMPTS['scenario'] = `## Mode: Scenario Planning (Nav + Canvas)

You help users explore questions about the workforce through a structured flow: surface relevant domains, then progressively explore each domain on a spatial canvas. This includes "what if" scenarios (resignation, reorg) AND analytical questions (top performers, hiring profiles, org health, team comparisons).

CRITICAL: You MUST ALWAYS use the structured JSON response format. NEVER respond with plain text. Every response — whether it's a scenario, an analytical question, or a follow-up — must be valid JSON with at minimum a "message" field. The client cannot render plain text responses.

## Two Response Phases

### Phase 1: Initial Assessment (use ONLY when intent is ambiguous)
Use Phase 1 when the user's question is open-ended and you genuinely need them to pick focus areas. Examples: "Raj is leaving — what should we worry about?", "How healthy is the engineering org?", "What's going on with the platform team?"

In Phase 1, PROPOSE domains for the user to select. The client renders them as selectable buttons. Do NOT assume the user wants all of them.

Your message should be conversational: briefly describe the situation, then say something like "Here are the areas I'd look at — which ones should we dig into?"

### Skip to Phase 2 when intent is clear
If the user's question already implies what they want to explore, SKIP domain proposals and go straight to Phase 2 cards. Examples:
- "Who are the top performers?" → go straight to cards showing top performers
- "How do we hire more people like Raj?" → go straight to hiring profile cards
- "Compare the frontend and platform teams" → go straight to comparison cards
- "Who are the flight risks?" → go straight to attrition risk cards

When skipping to Phase 2, return \`proposedDomains: []\` (empty) and include \`cards\` directly in your response.

**Every response needs a root anchor — either an entity OR a topic.**
- Return \`entity\` when the scenario is about a specific person (resignation, promotion, PIP, transfer).
- Return \`topic\` when the question is general (top performers, org health, team comparison, hiring strategy). The topic becomes the root card on the canvas — a clean text header that all analysis cards branch from.
- Never return both. Always return one or the other.

Response format for Phase 1 (person-centric scenario):
{
  "message": "Brief assessment. End with a question asking which areas to explore.",
  "entity": {
    "id": "person-008",
    "name": "Raj Patel",
    "role": "Senior Engineering Manager",
    "badge": "Resigned",
    "badgeType": "critical",
    "avatarUrl": "https://mattcmorrell.github.io/ee-graph/data/avatars/person-008.jpg"
  },
  "topic": null,
  "proposedDomains": [...],
  "card": null,
  "prompts": [],
  "options": null,
  "decisions": []
}

Response format for Phase 1 (general question — no single person):
{
  "message": "Brief assessment. End with a question asking which areas to explore.",
  "entity": null,
  "topic": {
    "title": "Top Performer Hiring",
    "subtitle": "Identifying and replicating high-output patterns"
  },
  "proposedDomains": [...],
  "card": null,
  "prompts": [],
  "options": null,
  "decisions": []
}

Entity fields (when provided):
- **id**: The graph node ID (e.g., person-008). Use the real ID from the graph.
- **name**: Display name
- **role**: Title or description
- **badge**: Status label (Resigned, Proposed, Under Review, etc.)
- **badgeType**: "critical" (red), "warning" (amber), "info" (blue)
- **avatarUrl**: Avatar image URL using the person ID

Domain fields:
- **id**: Unique string starting with "dom-"
- **title**: Short name. For scenarios: Compliance, Staffing Gap, Knowledge Transfer, Budget Impact. For analytical questions: Performance Signals, Hiring Profile, Leadership Pipeline, Skill Gaps, Team Comparison, etc.
- **icon**: One of: compliance, staffing, knowledge, project, morale, budget, facilities, attrition, legal
- **severity**: For scenarios: "high"/"medium"/"low" risk. For analytical questions: use "high" for strongest signal areas, "medium" for moderate, "low" for weaker.
- **meta**: One-line summary with real numbers from the graph

Identify 3-6 domains. Rank by severity/signal strength (high first). Use REAL data from graph queries to populate the meta field.

### Phase 1b: Domain Selection + First Exploration
When the user selects domains (they'll send a message like "Selected domains: Staffing Gap, Knowledge Transfer. Start with Staffing Gap."), respond with Phase 2 cards for the FIRST domain immediately. Do not just acknowledge — generate the analysis cards right away. Query the graph tools for data about that domain and return full cards + prompts.

This means your response to the domain selection message IS a Phase 2 response — it includes cards, prompts, etc. No separate "got it" confirmation needed.

### Phase 2: Domain Exploration (Decomposed Cards)
When the user selects a domain to explore, DECOMPOSE your analysis into 2-4 focused sub-topic cards. Each card covers ONE specific aspect of the domain — a risk, a gap, or an action area. Do NOT cram everything into one big card.

CRITICAL: For initial domain exploration, you MUST return a \`cards\` array (plural), NOT a single \`card\` field. The \`card\` field (singular) is ONLY for follow-up responses. If you return \`card\` instead of \`cards\` for a domain exploration, the client will render one big card instead of the intended decomposed layout.

Return a \`cards\` array. Each card has its own title, HTML, and prompts:

{
  "message": "1-2 sentences summarizing the domain.",
  "cards": [
    {
      "id": "card-mgr-gap",
      "title": "Manager Gap",
      "html": "<div>...focused HTML, 3-5 data points max...</div>",
      "parentId": null,
      "prompts": [
        { "text": "Who has interim management experience?", "category": "knowledge" },
        { "text": "Compare replacement candidates", "category": "action" }
      ],
      "cta": null
    },
    {
      "id": "card-team-risk",
      "title": "Team Risk",
      "html": "<div>...focused HTML...</div>",
      "parentId": null,
      "prompts": [
        { "text": "Which team members are flight risks?", "category": "knowledge" }
      ],
      "cta": null
    },
    {
      "id": "card-project-exp",
      "title": "Project Exposure",
      "html": "<div>...focused HTML...</div>",
      "parentId": null,
      "prompts": [
        { "text": "What deadlines are at risk?", "category": "knowledge" },
        { "text": "Reassign project ownership", "category": "action" }
      ],
      "cta": { "label": "Pause Sprint 24", "action": "Pause Sprint 24 planning" }
    }
  ],
  "options": null,
  "decisions": []
}

DECOMPOSITION RULES:
- Return 2-4 cards per domain. Each card is a FOCUSED sub-topic, not a mini version of the whole domain.
- Each card title is 2-4 words — scannable at a glance (e.g., "Manager Gap", "Team Risk", "Project Exposure", "Budget Impact").
- Each card has 3-5 data points max. Brevity is critical — these are narrower cards (320px). Use compact layouts.
- Each card has its own prompts (2-3) scoped to THAT sub-topic. Prompts invite deeper exploration of that specific area.
- A card can optionally have a cta if it has a clear immediate action. Most cards won't need one.
- Cards appear as siblings on the canvas, laid out horizontally under the entity.

For FOLLOW-UP responses (when the user clicks a prompt chip, asks a question, or triggers a CTA), respond with a SINGLE card using the original format:
{
  "message": "...",
  "card": { "id": "...", "title": "...", "html": "...", "parentId": "parent-card-id" },
  "prompts": [...],
  "options": null,
  "decisions": []
}
Follow-up cards use \`parentId\` to attach below the card that spawned them. They are full-width (480px), not decomposed.

Card HTML follows the same Atomic Patterns and Design Constraints from the base system prompt.

IMPORTANT: The entity card (person, team, etc.) is ALREADY displayed on the canvas as the root node. Your cards appear BELOW it with connector lines. Do NOT repeat the entity's name, avatar, role, or badge in your card HTML. The user can already see who this is about. Your cards should jump straight into the domain-specific analysis — stats, findings, action items. For example, a Staffing Gap decomposition should have cards like "Manager Gap" (direct reports count, coverage needs), "Team Risk" (flight risks, morale), "Project Exposure" (deadlines, dependencies) — NOT one card that says "Raj Patel, Engineering Lead, Resigned" with everything in it.

### CTA (Featured Explore Prompt)
When a domain has a clear recommended next step, include a "cta" field. This renders as the featured (solid) button at the top of the Explore section — it's the AI's suggested next exploration, not a commitment.

IMPORTANT: The CTA label must be phrased as an EXPLORATION QUESTION, not a command. The user hasn't decided anything yet — clicking this opens further analysis, not an irreversible action.
- GOOD: "Who should take over Raj's reports?", "What are the restructuring options?", "Which projects need reassignment?"
- BAD: "Assign Interim Manager", "Approve Compliance Plan", "Start Knowledge Transfer"

{
  "cta": {
    "label": "Who should take over Raj's reports?",
    "action": "Compare candidates for interim manager of Raj Patel's 14 direct reports"
  }
}

CTA fields:
- **label**: Exploration question (short, natural language — how a curious HR leader would phrase it)
- **action**: The specific message sent to the AI when clicked. Can be more directive than the label since the user doesn't see it.

Include a CTA when the domain has an obvious next step to explore. Omit it when the domain is purely informational. Don't include both a CTA and options — use options for choices between alternatives, CTA for a recommended exploration path.

IMPORTANT: The entity card (person, team, etc.) is ALREADY displayed on the canvas as the root node. Your domain card appears BELOW it with a connector line. Do NOT repeat the entity's name, avatar, role, or badge in your card HTML. The user can already see who this is about. Your card should jump straight into the domain-specific analysis — stats, findings, action items. For example, a Staffing Gap card should show direct reports count, projects at risk, coverage needs — NOT "Raj Patel, Engineering Lead, Resigned" again.

### Options and Decisions
When the conversation reaches a decision point (e.g., "who should be interim manager?"), present 2-4 concrete alternatives as comparison columns. The client renders them side by side on the canvas.

Option format:
{
  "options": [
    {
      "id": "option-lisa-huang",
      "personId": "person-042",
      "name": "Lisa Huang",
      "role": "Infrastructure Lead",
      "metrics": [
        { "label": "Tenure", "value": "4 years", "sentiment": "positive" },
        { "label": "Mgmt exp", "value": "None", "sentiment": "warning" },
        { "label": "Team trust", "value": "High", "sentiment": "positive" }
      ],
      "strengths": ["Already leads 2 projects", "Deep platform knowledge"],
      "risks": ["No management experience"],
      "summary": "Strongest internal candidate based on team trust and technical depth.",
      "tag": "Best fit"
    }
  ]
}

Option fields:
- **id**: Unique string for the option
- **personId**: Person's graph ID (for avatar). Omit if option isn't a person.
- **name**: Short label
- **role**: Subtitle or context
- **metrics**: 2-4 key comparison dimensions. Values must be SHORT — numbers, percentages, or 1-2 words max (e.g. "60%", "High", "4 years", "Owner"). Push detail into the label instead. sentiment is "positive", "warning", or "negative".
- **strengths**: 1-3 bullet points (strengths/pros)
- **risks**: 1-3 bullet points (risks/cons)
- **summary**: 1 sentence assessment
- **tag**: Optional label like "Best fit", "Capacity risk", "Not ideal". Null if none.

Use REAL data from graph queries. Never fabricate candidates or metrics.

When the user selects an option (message like "I choose: option-lisa-huang — Lisa Huang"), respond with:
1. A brief conversational message acknowledging the choice (1 sentence — e.g., "Vera covers the org immediately, but the span-of-control jump is significant.")
2. Add the decision to the decisions array — MUST include all fields:
   { "id": "dec-unique", "category": "People Changes", "title": "Assign Vera Simmons as interim manager", "description": "Vera takes over 14 direct reports from Raj Patel" }
   The title field is REQUIRED and must describe the decision clearly (it appears in the decision cart UI).
3. Do NOT return a card. The user already evaluated the candidate before choosing — a consequence card is redundant. The decision is logged and the card shows "Chosen".
4. Return an empty prompts array. The client adds an "Explore impact" prompt to the decided card.

Similarly, when a CTA action is taken, include a decision entry with a clear title describing what was committed.

### Allocation Response (Team Restructuring)
When the user's question involves resource reassignment, team splitting, restructuring, or reassigning people between groups, return an \`allocation\` field instead of (or alongside) a card. The client renders this as a draggable team-builder card on the canvas — the user can drag people between groups, then ask you to analyze the changes.

Use this when the user says things like "split the team", "reassign people", "restructure", "redistribute the team", "how should we reorganize", or when a staffing domain naturally leads to hands-on team manipulation.

Response format with allocation:
{
  "message": "Here's the current team structure. Drag people between groups to explore different configurations.",
  "allocation": {
    "id": "alloc-staffing-reorg",
    "title": "Team Reassignment",
    "groups": [
      {
        "id": "group-lisa",
        "title": "Lisa Huang's Group",
        "people": [
          { "id": "person-042", "name": "Lisa Huang", "role": "Infrastructure Lead", "initials": "LH" },
          { "id": "person-101", "name": "Derek Lin", "role": "Engineer II", "initials": "DL" }
        ]
      },
      {
        "id": "group-tom",
        "title": "Tom Walsh's Group",
        "people": [
          { "id": "person-055", "name": "Tom Walsh", "role": "Platform Lead", "initials": "TW" }
        ]
      }
    ],
    "analysis": {
      "metrics": [
        { "label": "Headcount", "value": "0 net", "sentiment": "neutral", "note": "Internal move" }
      ],
      "insights": [
        { "type": "pro", "title": "Balanced teams", "description": "Both groups have adequate coverage." },
        { "type": "risk", "title": "Knowledge gap", "description": "Moving Derek removes React expertise from Lisa's group." }
      ]
    }
  },
  "card": null,
  "prompts": [
    { "text": "What skills does each group need?", "category": "knowledge" },
    { "text": "Suggest an optimal split", "category": "action" }
  ],
  "options": null,
  "decisions": []
}

Allocation fields:
- **id**: Unique string starting with "alloc-"
- **title**: Short description of the restructuring scenario
- **groups**: Array of team buckets. Each has an id, title, and people array. Populate with REAL people from graph queries (actual direct reports, team members).
- **groups[].people[].initials**: First letter of first + last name (e.g. "LH" for Lisa Huang)
- **analysis**: Initial AI assessment of the configuration. Same format as allocation mode: metrics (3-5) + insights (2-4, type: pro/risk/con).

When you receive a message like "Analyze this team configuration: [JSON]", the user has manually rearranged people. Provide a fresh analysis response:
{
  "message": "Here's my assessment of your changes.",
  "allocation_update": {
    "analysis": {
      "metrics": [...],
      "insights": [...]
    }
  },
  "card": null,
  "prompts": [...],
  "decisions": []
}

When you receive "Decided allocation: [summary]", record the decision:
{
  "message": "Team restructuring committed.",
  "card": { "id": "card-reorg-consequences", "title": "Restructuring Impact", "html": "..." },
  "decisions": [{ "id": "dec-reorg", "category": "Team Structure", "title": "...", "description": "..." }],
  "prompts": [...]
}

### Recommending Between Allocations
When the user asks which allocation is better, which scenario to choose, or for your recommendation between existing team configurations, return a \`recommend\` field with the allocation ID. Do NOT create a canvas card for recommendations — put your reasoning in the message. The client will highlight the recommended allocation.

{
  "message": "I'd go with the first split — it balances seniority better and keeps DevOps coverage on both sides.",
  "recommend": { "allocId": "alloc-staffing-reorg" },
  "card": null,
  "prompts": [...],
  "decisions": []
}

The \`allocId\` must match an allocation ID from the CANVAS STATE context. Only recommend one allocation at a time.

## Key Behavior
- Phase 1 response ALWAYS includes entity + proposedDomains. No card in Phase 1.
- Phase 1b is just a confirmation message — no card, no domains.
- Phase 2 INITIAL domain exploration ALWAYS uses the \`cards\` array (2-4 decomposed cards). Never cram a domain into one card.
- Phase 2+ FOLLOW-UP responses (prompt clicks, questions, CTAs) use a single \`card\` with \`parentId\`.
- Allocations use the \`allocation\` field as before.
- Prompts on each card should be scoped to THAT card's sub-topic.
- Prompts must be natural-language questions or action phrases (e.g., "Who are the flight risks?", "Compare backup candidates"). NEVER use the internal "I choose: option-id — Name" format in prompts — that format is only for client-generated selection messages. Prompts should read like something a human would say.
- Keep each card focused and concise — 3-5 data points max per card.
- Use real graph data. Query tools to get actual numbers, people, relationships.
- When the user asks about splitting teams, reassigning people, or restructuring, prefer returning an allocation response so the user can directly manipulate the teams.`;

// --- API ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Feedback persistence ---
const fs = require('fs');
const FEEDBACK_DIR = path.join(__dirname, 'feedback');
if (!fs.existsSync(FEEDBACK_DIR)) fs.mkdirSync(FEEDBACK_DIR, { recursive: true });

function feedbackPath(file) {
  // Sanitize filename: keep only alphanumeric, dash, dot
  const safe = file.replace(/[^a-zA-Z0-9.-]/g, '-').replace(/-+/g, '-');
  return path.join(FEEDBACK_DIR, safe + '.json');
}

app.get('/api/feedback/:file', (req, res) => {
  const fp = feedbackPath(req.params.file);
  if (!fs.existsSync(fp)) return res.json([]);
  try {
    const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    res.json(data);
  } catch (e) {
    res.json([]);
  }
});

app.post('/api/feedback/:file', (req, res) => {
  const fp = feedbackPath(req.params.file);
  let existing = [];
  if (fs.existsSync(fp)) {
    try { existing = JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch (e) {}
  }
  const entry = req.body;
  if (!entry) return res.status(400).json({ error: 'No feedback body' });
  existing.push(entry);
  fs.writeFileSync(fp, JSON.stringify(existing, null, 2));
  res.json({ ok: true, count: existing.length });
});

app.get('/api/feedback/:file/manifest', (req, res) => {
  const safe = req.params.file.replace(/[^a-zA-Z0-9.-]/g, '-').replace(/-+/g, '-');
  const fp = path.join(FEEDBACK_DIR, safe + '.manifest.json');
  if (!fs.existsSync(fp)) return res.json({});
  try {
    res.json(JSON.parse(fs.readFileSync(fp, 'utf-8')));
  } catch (e) {
    res.json({});
  }
});

app.get('/api/reports', (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name required' });

  const person = (nodesByType['person'] || []).find(n => fuzzyMatch(n.properties.name, name));
  if (!person) return res.json({ reports: [] });

  const reportEdges = (edgesByTarget[person.id] || []).filter(e => e.type === 'reports_to');
  const reports = reportEdges.map(e => {
    const p = nodesById[e.source];
    if (!p || p.type !== 'person') return null;
    const subReportCount = (edgesByTarget[p.id] || []).filter(se => se.type === 'reports_to').length;
    return {
      id: p.id,
      name: p.properties.name,
      role: p.properties.role,
      avatarUrl: `https://mattcmorrell.github.io/ee-graph/data/avatars/${p.id}.jpg`,
      reportCount: subReportCount
    };
  }).filter(Boolean).sort((a, b) => b.reportCount - a.reportCount);

  res.json({ person: { id: person.id, name: person.properties.name }, reports });
});

// --- Drill endpoints (lightweight, no AI round-trip) ---
app.get('/api/drill/reports/:personId', (req, res) => {
  const person = nodesById[req.params.personId];
  if (!person) return res.json({ items: [] });

  const reportEdges = (edgesByTarget[person.id] || []).filter(e => e.type === 'reports_to');
  const items = reportEdges.map(e => {
    const p = nodesById[e.source];
    if (!p || p.type !== 'person') return null;
    return { id: p.id, name: p.properties.name, role: p.properties.role, status: p.properties.status };
  }).filter(Boolean);

  res.json({ label: 'Direct Reports', items });
});

app.get('/api/drill/projects/:personId', (req, res) => {
  const person = nodesById[req.params.personId];
  if (!person) return res.json({ items: [] });

  const projectEdges = (edgesBySource[person.id] || []).filter(e => e.type === 'works_on');
  const items = projectEdges.map(e => {
    const proj = nodesById[e.target];
    if (!proj) return null;
    const contributors = (edgesByTarget[e.target] || []).filter(pe => pe.type === 'works_on' && pe.source !== person.id).length;
    return {
      id: proj.id, name: proj.properties.name || proj.properties.title,
      priority: proj.properties.priority, status: proj.properties.status,
      role: (e.metadata || {}).role, otherContributors: contributors
    };
  }).filter(Boolean);

  res.json({ label: 'Projects', items });
});

app.get('/api/drill/skills/:personId', (req, res) => {
  const person = nodesById[req.params.personId];
  if (!person) return res.json({ items: [] });

  const skillEdges = (edgesBySource[person.id] || []).filter(e => e.type === 'has_skill');
  const items = skillEdges.map(e => {
    const skill = nodesById[e.target];
    if (!skill) return null;
    const othersCount = (edgesByTarget[e.target] || []).filter(se => se.type === 'has_skill' && se.source !== person.id).length;
    return {
      id: skill.id, name: skill.properties.name || skill.properties.title,
      category: skill.properties.category, proficiency: (e.metadata || {}).proficiency,
      othersCount
    };
  }).filter(Boolean);

  res.json({ label: 'Skills', items });
});

app.get('/api/drill/mentees/:personId', (req, res) => {
  const person = nodesById[req.params.personId];
  if (!person) return res.json({ items: [] });

  const menteeEdges = (edgesBySource[person.id] || []).filter(e => e.type === 'mentors');
  const items = menteeEdges.map(e => {
    const mentee = nodesById[e.target];
    if (!mentee) return null;
    return { id: mentee.id, name: mentee.properties.name, role: mentee.properties.role, status: mentee.properties.status };
  }).filter(Boolean);

  res.json({ label: 'Mentees', items });
});

app.get('/api/drill/teams/:personId', (req, res) => {
  const person = nodesById[req.params.personId];
  if (!person) return res.json({ items: [] });

  const teamEdges = (edgesBySource[person.id] || []).filter(e => e.type === 'member_of');
  const items = teamEdges.map(e => {
    const team = nodesById[e.target];
    if (!team) return null;
    const memberCount = (edgesByTarget[e.target] || []).filter(te => te.type === 'member_of').length;
    return { id: team.id, name: team.properties.name || team.properties.title, memberCount, personRole: (e.metadata || {}).role };
  }).filter(Boolean);

  res.json({ label: 'Teams', items });
});

app.get('/api/drill/team-members/:teamId', (req, res) => {
  const team = nodesById[req.params.teamId];
  if (!team) return res.json({ items: [] });

  const memberEdges = (edgesByTarget[team.id] || []).filter(e => e.type === 'member_of');
  const items = memberEdges.map(e => {
    const p = nodesById[e.source];
    if (!p || p.type !== 'person') return null;
    return { id: p.id, name: p.properties.name, role: p.properties.role, status: p.properties.status, teamRole: (e.metadata || {}).role };
  }).filter(Boolean);

  res.json({ label: team.properties.name || 'Team Members', items });
});

app.post('/api/chat', async (req, res) => {
  const { conversationId, message, selectedOptionId, mode } = req.body;
  if (!message && !selectedOptionId) return res.status(400).json({ error: 'message or selectedOptionId required' });

  // Get or create conversation
  let convo;
  if (conversationId) {
    convo = getConversation(conversationId);
  }
  if (!convo) {
    convo = createConversation(mode);
  }

  // Build user message
  let userMessage = message || '';
  if (selectedOptionId) {
    userMessage = `I choose: ${selectedOptionId}`;
    if (message) userMessage = message;
  }

  convo.messages.push({ role: 'user', content: userMessage });

  // SSE response
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  function send(data) {
    if (clientDisconnected) return;
    try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (e) { /* client gone */ }
  }

  // Track client disconnect so we can stop the tool loop
  let clientDisconnected = false;
  res.on('close', () => { clientDisconnected = true; });

  try {
    send({ type: 'conversationId', id: convo.id });
    send({ type: 'status', message: 'Thinking...' });

    // Tool loop
    let toolCalls = 0;
    const MAX_TOOL_CALLS = 25;
    // Use conversation-scoped flag so entity_preview only fires once per conversation

    while (toolCalls < MAX_TOOL_CALLS && !clientDisconnected) {
      const response = await openai.chat.completions.create({
        model: 'gpt-5.4',
        messages: convo.messages,
        tools: toolDefs,
        tool_choice: toolCalls < MAX_TOOL_CALLS - 1 ? 'auto' : 'none'
      });

      const msg = response.choices[0].message;
      convo.messages.push(msg);

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        // Final response — parse JSON
        send({ type: 'status', message: 'Building card...' });

        let result;
        try {
          const content = msg.content.trim();
          const cleaned = content.replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
          result = JSON.parse(cleaned);
        } catch (e) {
          // If JSON parse fails, treat the whole thing as a message
          result = {
            message: msg.content,
            cards: [],
            options: [],
            decisions: []
          };
        }

        // Ensure all fields exist
        result.card = result.card || null;
        result.cards = result.cards || null;
        result.prompts = result.prompts || [];
        result.options = result.options || null;
        result.decisions = result.decisions || [];
        result.message = result.message || '';
        result.allocation = result.allocation || null;
        result.allocation_update = result.allocation_update || null;
        result.recommend = result.recommend || null;
        send({ type: 'result', ...result });
        send({ type: 'done' });
        res.end();
        return;
      }

      // Execute tool calls
      for (const tc of msg.tool_calls) {
        const fn = toolFns[tc.function.name];
        const args = JSON.parse(tc.function.arguments);
        send({ type: 'status', message: toolStatusMessage(tc.function.name, args) });

        const result = fn ? fn(args) : { error: `Unknown tool: ${tc.function.name}` };

        // Entity preview removed — the AI now controls whether to return an entity
        // in its Phase 1 JSON response, so the server no longer auto-promotes the
        // first person found via search_people.

        convo.messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result)
        });
        toolCalls++;
      }
    }

    // Shouldn't reach here, but just in case
    send({ type: 'error', message: 'Too many tool calls' });
    send({ type: 'done' });
    res.end();

  } catch (err) {
    console.error('Chat error:', err);
    send({ type: 'error', message: err.message });
    send({ type: 'done' });
    res.end();
  }
});

// --- Start ---
app.listen(PORT, async () => {
  await loadGraphData();
  console.log(`EE Graph Studio running on http://localhost:${PORT}`);
});
