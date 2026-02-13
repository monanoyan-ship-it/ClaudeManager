# ClaudeManager

AI Assistant Memory & Guidance System for Claude Code.

## What is this?

ClaudeManager logs all interactions with Claude Code (prompts, tool uses, sessions) and provides enriched context through hooks and MCP tools.

## Architecture

- **Express API** (port 3847) - HTTP endpoints for hooks
- **MCP Server** (stdio) - Tools for Claude to query history/patterns
- **SQLite** (sql.js) - Persistent storage in `data/claude_manager.db`

## Running

```bash
# Start HTTP API (for hooks)
npm start

# MCP Server is registered separately via claude mcp add
```

## Key Files

- `src/index.js` - Express API entry point
- `src/mcp-server.js` - MCP Server with 7 tools
- `src/hook-handler.js` - Hook HTTP endpoints
- `src/services/` - Business logic (log, pattern, context, search)
- `hooks/` - Node.js hook scripts (stdin→API→stdout)

## MCP Tools

- `log_prompt` - Log a prompt/interaction
- `get_patterns` - Get learned patterns for a project
- `add_pattern` - Add a new pattern/rule/preference/mistake
- `check_rules` - Check action against rules
- `get_history` - Search interaction history
- `search_logs` - Full-text search across logs
- `get_context` - Get enriched project context
