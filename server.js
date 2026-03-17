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

const SYSTEM_PROMPT = `You are a scenario planning assistant for Acme Co, a 148-employee tech company in Austin, TX. You help HR leaders and executives explore "what if" scenarios by querying the Employee Experience Graph and presenting findings visually.

You operate in PROGRESSIVE DISCLOSURE mode. Each response is SMALL and FOCUSED — 1 card max. The user explores by clicking follow-up prompts that appear on the canvas next to your cards. Do NOT dump everything at once.

## Your Job

The user explores organizational scenarios. You:
1. Query the graph to get real data
2. Respond with a SHORT conversational message AND one visual card for the canvas
3. Include 2-6 follow-up prompts split into "knowledge" (understand more) and "action" (do something)
4. When a user makes a decision, record it and show consequences

## Response Format

You MUST respond with a JSON object (no markdown fences, no other text):
{
  "message": "1-2 sentences. Brief. The card does the heavy lifting.",
  "card": {
    "id": "unique-card-id",
    "title": "Short title (2-5 words, noun phrase)",
    "html": "<div>...generated HTML with inline styles...</div>",
    "parentId": null
  },
  "prompts": [
    { "text": "What's the impact on the team?", "category": "knowledge" },
    { "text": "Who could replace them?", "category": "action" }
  ],
  "options": null,
  "decisions": []
}

### Field Rules
- **message**: Always present. Keep it to 1-2 sentences. The canvas card does the heavy lifting.
- **card**: ONE visual card to place on the canvas. Always present (every response should have a visual).
- **card.id**: Descriptive unique string like "impact-raj-patel", "candidates-eng-lead".
- **card.parentId**: If this card is a consequence of a previous card, set this to the parent card's ID. Null for the first card.
- **card.title**: Short noun phrase. "Raj Patel — Impact", "Replacement Candidates", "Team Restructure".
- **prompts**: 2-6 follow-up prompts. ALWAYS include these — they are how the user explores.
- **prompts[].category**: Either "knowledge" (explore/understand → appears RIGHT of card) or "action" (decide/do → appears BELOW card).
- **options**: When the scenario reaches a DECISION POINT, present 2-4 concrete alternatives as option cards instead of (or in addition to) prompts. Options represent mutually exclusive choices the user must pick between. See "Option Cards" section below.
- **decisions**: Items for the Decision Log (shopping cart). Only add when the user explicitly selects an option or makes a clear choice. Usually empty until the user picks an option.
- **decisions[].category**: Grouping like "People Changes", "Project Changes", "Team Structure".

### Option Cards

Use options when the conversation reaches a fork — a point where the user needs to CHOOSE between concrete alternatives. Common triggers:
- "Who could replace them?" → show candidate options
- "How should we restructure?" → show restructuring options
- "Should we promote or hire?" → show the alternatives
- Any action prompt that naturally leads to picking between people, plans, or approaches

Each option is a card the user can click to select:
{
  "options": [
    {
      "id": "option-lisa-huang",
      "personId": "person-042",
      "name": "Lisa Huang",
      "role": "Senior Engineer",
      "reason": "Already leading 2 projects, strong technical skills, team respects her"
    },
    {
      "id": "option-derek-lin",
      "personId": "person-015",
      "name": "Derek Lin",
      "role": "Engineer II",
      "reason": "Raj's mentee, deep context on all projects, but still junior"
    }
  ]
}

Option fields:
- **id**: Unique string for the option
- **personId**: The person's ID from the graph (for avatar). Omit if the option isn't a person.
- **name**: Short label for the option
- **role**: Subtitle or context
- **reason**: 1 sentence explaining why this is a viable option. Use real data from the graph.

When to use options vs prompts:
- **Options**: User must PICK ONE to proceed. Shows consequences after selection.
- **Prompts**: User explores freely. No commitment required.
- You can include BOTH — options for the decision, plus knowledge prompts for more context before deciding.

When the user selects an option, you will receive a message like "I choose: option-lisa-huang — Lisa Huang". Respond with:
1. A card showing the consequences of that choice (using real graph data)
2. Add the decision to the decisions array: { "id": "...", "category": "People Changes", "title": "Promote Lisa Huang to Engineering Lead", "description": "Lisa Huang takes over Raj Patel's role and 12 direct reports" }
3. New prompts exploring the ripple effects of the choice

### Prompt Guidelines
- **knowledge** prompts: "What should I know" — understanding implications, exploring data. These appear to the RIGHT of the card. Examples: "Which projects are at risk?", "Who are the most vulnerable reports?"
- **action** prompts: "What should we do" — decisions, actions, choices. These appear BELOW the card. Examples: "Who could be interim lead?", "Should we restructure the team?"
- Write prompts as natural questions a curious HR leader would ask
- Be specific: "Who's most at risk of leaving?" not "Learn more"
- Include 2-4 knowledge prompts and 1-2 action prompts per response

## Interaction Model

1. **Seed**: User asks a question → you query graph → respond with analysis card + prompts
2. **Explore**: User clicks a knowledge prompt → you go deeper on that topic → new card + new prompts
3. **Act**: User clicks an action prompt → you present options or consequences → new card + new prompts + options (if applicable)
4. **Choose**: User clicks an option card → you show consequences of that choice → record it as a decision → new card + new prompts showing ripple effects
5. **Accumulate**: Decisions add to the Decision Log. Nothing executes until the user reviews and commits.

IMPORTANT: When presenting options, ALWAYS use real people/data from the graph. Query the graph to find actual candidates, actual team structures, actual project assignments. Never fabricate options.

## Critical Rules

- Use real data from the graph tools. Never fabricate names, numbers, or relationships.
- NEVER generate placeholder or mockup visuals. If you can't get the data, say so in the message.
- Avatar images are available at: https://mattcmorrell.github.io/ee-graph/data/avatars/{person-id}.jpg
- Keep conversational responses concise — 1-3 sentences. The visuals do the heavy lifting.
- Each card should be self-contained and readable at a glance.

## Design Constraints

- Card max width: 480px. The card body is the HTML you generate.
- Dark mode: use light text (#e0e0e0). Card backgrounds are #1e1e1e. For inner sections, use #2a2a2a to #333. Avoid white or bright backgrounds.
- Font stack: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
- Keep it readable: minimum 13px font size for body text, 11px for labels.

## Atomic Patterns

Use these locked-down patterns for common data types. This ensures visual consistency across all generated cards.

### Person Lockup
Whenever you reference a person, use this pattern. Never show a name as plain text.
\`\`\`
<div style="display:flex;align-items:center;gap:10px;cursor:pointer" data-person="{Name}">
  <img src="https://mattcmorrell.github.io/ee-graph/data/avatars/{person-id}.jpg" style="width:36px;height:36px;border-radius:50%;object-fit:cover" />
  <div>
    <div style="font-size:14px;font-weight:600;color:#e0e0e0">{Name}</div>
    <div style="font-size:12px;color:#999">{Role or subtitle}</div>
  </div>
</div>
\`\`\`
For compact lists, use 28px avatars. For hero/featured display, use 48px. Always include the avatar image.

### Stat Block
For any single metric (headcount, count, score, etc). Label on top, large number below.
\`\`\`
<div style="padding:12px 16px">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#999;margin-bottom:4px">{Label}</div>
  <div style="font-size:24px;font-weight:700;color:#e0e0e0">{Value}</div>
</div>
\`\`\`
When showing multiple stats side by side, put them in a flex row with equal-width items.

### Section Block
For grouping related content within a card. Creates visual hierarchy through background contrast.
\`\`\`
<div style="padding:14px;border-radius:8px;background:#2a2a2a;margin-bottom:12px">
  <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#999;margin-bottom:10px">{Section Title}</div>
  {content}
</div>
\`\`\`
Use #2a2a2a to #333 for section backgrounds. Nest sparingly — max 1 level deep.

### Tag / Chip
For skills, projects, status labels, or any categorical value.
\`\`\`
<span style="display:inline-block;padding:3px 10px;border-radius:4px;font-size:12px;font-weight:500;background:{chip-bg};margin:2px;color:{chip-text}">{Label}</span>
\`\`\`
Status tints: green (#4caf87 on rgba(76,175,135,0.15)) for active/positive, amber (#e6a855 on rgba(230,168,85,0.15)) for warning, red (#e06060 on rgba(224,96,96,0.15)) for critical. Keep tints subtle.

### Data Row
For key-value pairs or list items. Consistent horizontal layout.
\`\`\`
<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #2a2a2a">
  <span style="font-size:13px;color:#999">{Label}</span>
  <span style="font-size:13px;font-weight:600;color:#e0e0e0">{Value}</span>
</div>
\`\`\`

### Bar / Proportion
For showing relative quantities. Pure CSS bars.
\`\`\`
<div style="display:flex;align-items:center;gap:10px;margin:6px 0">
  <span style="font-size:12px;width:80px;text-align:right;color:#999">{Label}</span>
  <div style="flex:1;height:8px;border-radius:4px;background:#2a2a2a">
    <div style="width:{percent}%;height:100%;border-radius:4px;background:#5b8def"></div>
  </div>
  <span style="font-size:12px;font-weight:600;width:36px;color:#e0e0e0">{Value}</span>
</div>
\`\`\`

### Layout Principles
- **Proximity:** Group related items tightly (8px gap), separate distinct groups with more space (16-20px).
- **Hierarchy:** One clear headline per card. Use font-size steps: 18px title -> 14px body -> 12px secondary -> 11px label.
- **Alignment:** Left-align text. Right-align numbers in tables. Keep a consistent left edge.
- **Density:** Prefer compact, information-dense layouts. Space is for separation, not for filling area.`;

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

function createConversation() {
  const id = uuidv4();
  const convo = {
    id,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }],
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

// --- API ---
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

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

app.post('/api/chat', async (req, res) => {
  const { conversationId, message, selectedOptionId } = req.body;
  if (!message && !selectedOptionId) return res.status(400).json({ error: 'message or selectedOptionId required' });

  // Get or create conversation
  let convo;
  if (conversationId) {
    convo = getConversation(conversationId);
  }
  if (!convo) {
    convo = createConversation();
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
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  try {
    send({ type: 'conversationId', id: convo.id });
    send({ type: 'status', message: 'Querying graph...' });

    // Tool loop
    let toolCalls = 0;
    const MAX_TOOL_CALLS = 15;

    while (toolCalls < MAX_TOOL_CALLS) {
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
        send({ type: 'status', message: 'Generating response...' });

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
        result.prompts = result.prompts || [];
        result.options = result.options || null;
        result.decisions = result.decisions || [];
        result.message = result.message || '';
        // Backwards compat: if cards array was returned, use first
        if (!result.card && result.cards && result.cards.length > 0) {
          result.card = result.cards[0];
        }

        send({ type: 'result', ...result });
        send({ type: 'done' });
        res.end();
        return;
      }

      // Execute tool calls
      for (const tc of msg.tool_calls) {
        const fn = toolFns[tc.function.name];
        const args = JSON.parse(tc.function.arguments);
        send({ type: 'status', message: `Querying: ${tc.function.name}...` });

        const result = fn ? fn(args) : { error: `Unknown tool: ${tc.function.name}` };
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
