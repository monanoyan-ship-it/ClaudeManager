const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const logService = require('./services/log-service');
const patternService = require('./services/pattern-service');
const contextService = require('./services/context-service');
const searchService = require('./services/search-service');
const { getDb, startAutoSave, stopAutoSave } = require('./db/init');

const server = new McpServer({
  name: 'claude-manager',
  version: '2.0.0'
});

// Helper: resolve project ID from name or path
async function resolveProject(project) {
  const db = await getDb();
  // Try by name first
  let result = db.exec(`SELECT id, name, path FROM projects WHERE name = ?`, [project]);
  if (result.length > 0 && result[0].values.length > 0) {
    const row = result[0].values[0];
    return { id: row[0], name: row[1], path: row[2] };
  }
  // Try by path
  result = db.exec(`SELECT id, name, path FROM projects WHERE path = ?`, [project]);
  if (result.length > 0 && result[0].values.length > 0) {
    const row = result[0].values[0];
    return { id: row[0], name: row[1], path: row[2] };
  }
  // Try partial match
  result = db.exec(`SELECT id, name, path FROM projects WHERE name LIKE ? OR path LIKE ? LIMIT 1`, [`%${project}%`, `%${project}%`]);
  if (result.length > 0 && result[0].values.length > 0) {
    const row = result[0].values[0];
    return { id: row[0], name: row[1], path: row[2] };
  }
  return null;
}

// Tool: log_prompt
server.tool(
  'log_prompt',
  'Log a prompt/interaction for a project with optional category and tags',
  {
    project: z.string().describe('Project name or path'),
    message: z.string().describe('The prompt/message content to log'),
    role: z.enum(['user', 'assistant', 'system']).default('user').describe('Who sent this message'),
    category: z.string().optional().describe('Category: feature_request, bug_fix, question, feedback, refactor, general'),
    tags: z.array(z.string()).optional().describe('Tags for the prompt')
  },
  async ({ project, message, role, category, tags }) => {
    const proj = await resolveProject(project);
    if (!proj) {
      // Auto-create project
      const projectId = await logService.ensureProject(project, project);
      await logService.logPrompt(projectId, null, role, message, category, tags ? JSON.stringify(tags) : null);
      return { content: [{ type: 'text', text: `Logged prompt for new project "${project}" (id: ${projectId})` }] };
    }

    await logService.logPrompt(proj.id, null, role, message, category, tags ? JSON.stringify(tags) : null);
    return { content: [{ type: 'text', text: `Logged prompt for project "${proj.name}"` }] };
  }
);

// Tool: get_patterns
server.tool(
  'get_patterns',
  'Get learned patterns and rules for a project. Use detailed=true for full descriptions.',
  {
    project: z.string().describe('Project name or path'),
    type: z.enum(['rule', 'pattern', 'preference', 'mistake']).optional().describe('Filter by pattern type'),
    detailed: z.boolean().default(false).describe('If false, returns compact list (titles + IDs only). If true, includes full descriptions.')
  },
  async ({ project, type, detailed }) => {
    const proj = await resolveProject(project);
    if (!proj) {
      return { content: [{ type: 'text', text: `Project "${project}" not found` }] };
    }

    const patterns = await patternService.getPatterns(proj.id, type);
    if (patterns.length === 0) {
      return { content: [{ type: 'text', text: `No patterns found for "${proj.name}"` }] };
    }

    let formatted;
    if (detailed) {
      formatted = patterns.map(p =>
        `[${p.type}] ${p.title}${p.description ? '\n  ' + p.description : ''} (confidence: ${p.confidence}, refs: ${p.times_referenced})`
      ).join('\n\n');
    } else {
      formatted = patterns.map(p =>
        `[${p.type}] #${p.id}: ${p.title} (c:${p.confidence})`
      ).join('\n');
      formatted += '\n\nUse detailed=true for full descriptions.';
    }

    return { content: [{ type: 'text', text: `Patterns for "${proj.name}" (${patterns.length}):\n\n${formatted}` }] };
  }
);

// Tool: add_pattern
server.tool(
  'add_pattern',
  'Add a new learned pattern, rule, preference, or mistake for a project',
  {
    project: z.string().describe('Project name or path'),
    type: z.enum(['rule', 'pattern', 'preference', 'mistake']).describe('Pattern type'),
    title: z.string().describe('Short title for the pattern'),
    description: z.string().optional().describe('Detailed description'),
    confidence: z.number().min(0).max(1).default(1.0).describe('Confidence score 0-1')
  },
  async ({ project, type, title, description, confidence }) => {
    const proj = await resolveProject(project);
    if (!proj) {
      return { content: [{ type: 'text', text: `Project "${project}" not found. Use log_prompt first to create the project.` }] };
    }

    const id = await patternService.addPattern(proj.id, type, title, description, null, confidence);
    return { content: [{ type: 'text', text: `Added ${type} pattern (id: ${id}): "${title}"` }] };
  }
);

// Tool: check_rules
server.tool(
  'check_rules',
  'Check if a planned action violates any learned rules for the project',
  {
    project: z.string().describe('Project name or path'),
    action_description: z.string().describe('Description of the action you plan to take')
  },
  async ({ project, action_description }) => {
    const proj = await resolveProject(project);
    if (!proj) {
      return { content: [{ type: 'text', text: `Project "${project}" not found` }] };
    }

    const result = await contextService.checkRules(proj.id, action_description);

    if (!result.has_potential_violations) {
      return { content: [{ type: 'text', text: `No rule violations detected for: "${action_description}" (checked ${result.total_rules_checked} rules)` }] };
    }

    const violations = result.violations.map(v =>
      `- RULE: ${v.rule_title}\n  ${v.rule_description || ''}\n  Match: ${(v.match_score * 100).toFixed(0)}%, Confidence: ${v.confidence}`
    ).join('\n');

    return { content: [{ type: 'text', text: `POTENTIAL VIOLATIONS for: "${action_description}"\n\n${violations}` }] };
  }
);

// Tool: get_history
server.tool(
  'get_history',
  'Search interaction history for a project. Use detailed=true for longer content excerpts.',
  {
    project: z.string().describe('Project name or path'),
    query: z.string().describe('Search query'),
    limit: z.number().default(10).describe('Max results to return'),
    detailed: z.boolean().default(false).describe('If false, returns short excerpts (50 chars). If true, returns full content (300 chars).')
  },
  async ({ project, query, limit, detailed }) => {
    const proj = await resolveProject(project);
    if (!proj) {
      return { content: [{ type: 'text', text: `Project "${project}" not found` }] };
    }

    const results = await searchService.searchPrompts(query, proj.id, limit);
    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No history found for query "${query}" in project "${proj.name}"` }] };
    }

    const maxLen = detailed ? 300 : 80;
    const formatted = results.map(r =>
      `[${r.created_at}] ${r.role}: ${r.content.substring(0, maxLen)}${r.content.length > maxLen ? '...' : ''}`
    ).join('\n\n');

    let footer = '';
    if (!detailed) footer = '\n\nUse detailed=true for longer excerpts.';

    return { content: [{ type: 'text', text: `History for "${proj.name}" matching "${query}" (${results.length} results):\n\n${formatted}${footer}` }] };
  }
);

// Tool: search_logs
server.tool(
  'search_logs',
  'Full-text search across all logs, optionally filtered by project and date range. Use detailed=true for longer excerpts.',
  {
    query: z.string().describe('Search query (full-text)'),
    project: z.string().optional().describe('Optional project name to filter'),
    start_date: z.string().optional().describe('Start date (YYYY-MM-DD)'),
    end_date: z.string().optional().describe('End date (YYYY-MM-DD)'),
    limit: z.number().default(20).describe('Max results'),
    detailed: z.boolean().default(false).describe('If false, returns short excerpts. If true, returns longer content.')
  },
  async ({ query, project, start_date, end_date, limit, detailed }) => {
    let projectId = null;
    if (project) {
      const proj = await resolveProject(project);
      if (proj) projectId = proj.id;
    }

    const maxLen = detailed ? 400 : 100;

    if (start_date && end_date && projectId) {
      const results = await searchService.searchByDateRange(projectId, start_date, end_date, limit);
      const filtered = results.filter(r => r.content.toLowerCase().includes(query.toLowerCase()));
      const formatted = filtered.map(r =>
        `[${r.created_at}] ${r.role}: ${r.content.substring(0, maxLen)}${r.content.length > maxLen ? '...' : ''}`
      ).join('\n\n');
      let text = filtered.length > 0 ? formatted : 'No results found.';
      if (!detailed && filtered.length > 0) text += '\n\nUse detailed=true for longer excerpts.';
      return { content: [{ type: 'text', text }] };
    }

    const results = await searchService.searchPrompts(query, projectId, limit);
    if (results.length === 0) {
      return { content: [{ type: 'text', text: `No results found for "${query}"` }] };
    }

    const formatted = results.map(r =>
      `[${r.created_at}] [${r.project_name || 'unknown'}] ${r.role}: ${r.content.substring(0, maxLen)}${r.content.length > maxLen ? '...' : ''}`
    ).join('\n\n');

    let footer = '';
    if (!detailed) footer = '\n\nUse detailed=true for longer excerpts.';

    return { content: [{ type: 'text', text: `Search results for "${query}" (${results.length}):\n\n${formatted}${footer}` }] };
  }
);

// Tool: get_context
server.tool(
  'get_context',
  'Get enriched context for a project including patterns, rules, history, and stats',
  {
    project: z.string().describe('Project name or path')
  },
  async ({ project }) => {
    const proj = await resolveProject(project);
    if (!proj) {
      return { content: [{ type: 'text', text: `Project "${project}" not found` }] };
    }

    const context = await contextService.getProjectContext(proj.name, proj.path);

    const parts = [];
    parts.push(`Project: ${context.project.name}`);
    parts.push(`Stats: ${context.stats.session_count} sessions, ${context.stats.prompt_count} prompts, ${context.stats.tool_count} tool uses`);

    if (context.rules.length > 0) {
      parts.push('\nRules:');
      parts.push(...context.rules);
    }
    if (context.mistakes.length > 0) {
      parts.push('\nPast Mistakes (AVOID):');
      parts.push(...context.mistakes);
    }
    if (context.preferences.length > 0) {
      parts.push('\nUser Preferences:');
      parts.push(...context.preferences);
    }
    if (context.recent_topics.length > 0) {
      parts.push(`\nRecent topics: ${context.recent_topics.join(', ')}`);
    }
    if (context.recent_history.length > 0) {
      parts.push('\nRecent interactions:');
      for (const h of context.recent_history) {
        parts.push(`  [${h.role}] ${h.content}`);
      }
    }

    return { content: [{ type: 'text', text: parts.join('\n') }] };
  }
);

// Start the MCP server
async function main() {
  await getDb(); // Initialize DB
  startAutoSave(10000);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on('SIGINT', () => {
    stopAutoSave();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    stopAutoSave();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('MCP Server failed to start:', err);
  process.exit(1);
});
