const express = require('express');
const logService = require('./services/log-service');
const contextService = require('./services/context-service');
const chatService = require('./services/chat-service');
const { normalizePath } = require('./utils/path-normalizer');

const router = express.Router();

// Chat ID 8 coordination check
async function getChatContext() {
  try {
    const CHAT_ID = 8;
    const parts = [];
    // Check unread for both roles
    for (const role of ['a', 'b']) {
      const msgs = await chatService.getUnreadMessages(CHAT_ID, role);
      if (msgs.length > 0) {
        parts.push(`[ManagerChat] ${msgs.length} okunmamis mesaj (role ${role}):`);
        for (const m of msgs.slice(-3)) {
          const preview = (m.content || '').substring(0, 200);
          parts.push(`  [${m.role}] ${preview}`);
        }
      }
    }
    return parts;
  } catch { return []; }
}

// Helper: extract project info from cwd
function extractProjectInfo(body) {
  const cwd = body.cwd || process.cwd();
  const normalizedCwd = normalizePath(cwd);
  const name = normalizedCwd.split('/').pop();
  return { name, path: normalizedCwd };
}

// POST /api/hooks/prompt - UserPromptSubmit
// stdin: { session_id, cwd, hook_event_name, prompt (string) }
router.post('/prompt', async (req, res) => {
  try {
    const { prompt, session_id, cwd } = req.body;
    const project = extractProjectInfo(req.body);

    if (!prompt) {
      return res.json({});
    }

    const content = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);

    const projectId = await logService.ensureProject(project.name, project.path);
    const sessionDbId = session_id
      ? await logService.getOrCreateSession(projectId, session_id)
      : null;

    // Log the prompt
    await logService.logPrompt(projectId, sessionDbId, 'user', content, null, null);

    // Analyze for context
    const analysis = await contextService.analyzePrompt(projectId, content);

    // Build additional context
    const contextParts = [];

    if (analysis.warnings.length > 0) {
      contextParts.push(...analysis.warnings.map(w => `[ClaudeManager] ${w}`));
    }

    if (analysis.relevant_patterns.length > 0) {
      contextParts.push('[ClaudeManager] Relevant patterns:');
      for (const p of analysis.relevant_patterns) {
        contextParts.push(`  - ${p.title}: ${p.description || ''}`);
      }
    }

    if (analysis.active_tasks && analysis.active_tasks.length > 0) {
      contextParts.push('[ClaudeManager] Active tasks (in_progress):');
      for (const t of analysis.active_tasks) {
        contextParts.push(`  - [${t.task_no}] ${t.title}`);
        if (t.detail) contextParts.push(`    Detail: ${t.detail.substring(0, 300)}`);
        if (t.risks) contextParts.push(`    Risks: ${t.risks.substring(0, 200)}`);
      }
    }

    // Add chat coordination context
    const chatParts = await getChatContext();
    contextParts.push(...chatParts);

    // Return in Claude Code hook output format
    const response = { continue: true };
    if (contextParts.length > 0) {
      response.hookSpecificOutput = {
        hookEventName: 'UserPromptSubmit',
        additionalContext: contextParts.join('\n')
      };
    }

    res.json(response);
  } catch (err) {
    console.error('Hook prompt error:', err);
    res.json({ continue: true }); // Don't block Claude on errors
  }
});

// POST /api/hooks/tool-use - PostToolUse
// stdin: { session_id, cwd, hook_event_name, tool_name, tool_input, tool_response, tool_use_id }
router.post('/tool-use', async (req, res) => {
  try {
    const { tool_name, tool_input, tool_response, session_id } = req.body;
    const project = extractProjectInfo(req.body);

    if (!tool_name) {
      return res.json({ continue: true });
    }

    const projectId = await logService.ensureProject(project.name, project.path);
    const sessionDbId = session_id
      ? await logService.getOrCreateSession(projectId, session_id)
      : null;

    // Extract file path from tool input
    let filePath = null;
    if (tool_input) {
      filePath = tool_input.file_path || tool_input.path || null;
    }

    const success = tool_response ? !tool_response.is_error : true;

    await logService.logToolUse(
      projectId, sessionDbId, tool_name, tool_input, filePath, success
    );

    res.json({ continue: true });
  } catch (err) {
    console.error('Hook tool-use error:', err);
    res.json({ continue: true });
  }
});

// POST /api/hooks/session-start - SessionStart
// stdin: { session_id, cwd, hook_event_name, source, model }
router.post('/session-start', async (req, res) => {
  try {
    const { session_id } = req.body;
    const project = extractProjectInfo(req.body);

    const projectId = await logService.ensureProject(project.name, project.path);

    if (session_id) {
      await logService.getOrCreateSession(projectId, session_id);
    }

    // Get full context for the project
    const context = await contextService.getProjectContext(project.name, project.path);
    const formatted = contextService.formatContextForClaude(context);

    // Add chat coordination context
    const chatParts = await getChatContext();

    const response = { continue: true };
    const allContext = [formatted.trim(), ...chatParts].filter(Boolean).join('\n');
    if (allContext) {
      response.hookSpecificOutput = {
        hookEventName: 'SessionStart',
        additionalContext: allContext
      };
    }

    res.json(response);
  } catch (err) {
    console.error('Hook session-start error:', err);
    res.json({ continue: true });
  }
});

// POST /api/hooks/session-end - SessionEnd
// stdin: { session_id, cwd, hook_event_name, reason }
router.post('/session-end', async (req, res) => {
  try {
    const { session_id, reason } = req.body;

    if (session_id) {
      await logService.endSession(session_id, reason || null);
    }

    res.json({ continue: true });
  } catch (err) {
    console.error('Hook session-end error:', err);
    res.json({ continue: true });
  }
});

module.exports = router;
