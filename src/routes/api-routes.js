const express = require('express');
const { getDb, save } = require('../db/init');
const logService = require('../services/log-service');
const patternService = require('../services/pattern-service');
const analyticsService = require('../services/analytics-service');
const searchService = require('../services/search-service');
const planService = require('../services/plan-service');
const noteService = require('../services/note-service');
const journalService = require('../services/journal-service');
const versionService = require('../services/version-service');
const chatService = require('../services/chat-service');
const { normalizePath } = require('../utils/path-normalizer');

const router = express.Router();

// GET /api/projects — All projects with stats
router.get('/projects', async (req, res, next) => {
  try {
    const db = await getDb();
    const result = await db.exec(`
      SELECT p.id, p.name, p.path, p.created_at,
        (SELECT COUNT(*) FROM sessions WHERE project_id = p.id) as session_count,
        (SELECT COUNT(*) FROM prompts WHERE project_id = p.id) as prompt_count,
        (SELECT COUNT(*) FROM patterns WHERE project_id = p.id AND is_active = 1) as pattern_count,
        (SELECT COUNT(*) FROM tool_uses WHERE project_id = p.id) as tool_count
      FROM projects p ORDER BY p.name
    `);
    if (!result.length) return res.json({ data: [] });
    const data = result[0].values.map(row => ({
      id: row[0], name: row[1], path: row[2], created_at: row[3],
      session_count: row[4], prompt_count: row[5],
      pattern_count: row[6], tool_count: row[7]
    }));
    res.json({ data });
  } catch (err) { next(err); }
});

// POST /api/projects — Explicit project registration (bypasses parent matching)
router.post('/projects', async (req, res, next) => {
  try {
    const { name, path: projectPath, description } = req.body;
    if (!projectPath) return res.status(400).json({ error: 'path required' });
    const db = await getDb();
    const normalized = normalizePath(projectPath);
    const projectName = name || normalized.split('/').pop();

    // Check exact match first
    const existing = await db.exec('SELECT id, name, path FROM projects WHERE path = ?', [normalized]);
    if (existing.length && existing[0].values.length) {
      const row = existing[0].values[0];
      return res.json({ id: row[0], name: row[1], path: row[2], existing: true });
    }

    // Force create — even if parent exists
    await db.run('INSERT INTO projects (name, path, description) VALUES (?, ?, ?)',
      [projectName, normalized, description || null]);
    const idResult = await db.exec('SELECT last_insert_rowid()');
    const id = idResult[0].values[0][0];
    res.status(201).json({ id, name: projectName, path: normalized, created: true });
  } catch (err) { next(err); }
});

// GET /api/projects/:id — Project detail
router.get('/projects/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const result = await db.exec(`SELECT id, name, path, description, created_at FROM projects WHERE id = ?`,
      [req.params.id]);
    if (!result.length || !result[0].values.length) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const row = result[0].values[0];
    const stats = await logService.getSessionStats(row[0]);
    res.json({
      id: row[0], name: row[1], path: row[2], description: row[3],
      created_at: row[4], stats
    });
  } catch (err) { next(err); }
});

// GET /api/projects/:id/sessions — Sessions with pagination
router.get('/projects/:id/sessions', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const result = await logService.getSessionsWithPagination(req.params.id, page, limit);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/projects/:id/prompts — Prompts with pagination and filters
router.get('/projects/:id/prompts', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const filters = {};
    if (req.query.category) filters.category = req.query.category;
    if (req.query.startDate) filters.startDate = req.query.startDate;
    if (req.query.endDate) filters.endDate = req.query.endDate;
    if (req.query.search) filters.search = req.query.search;
    const result = await logService.getPromptsWithPagination(req.params.id, page, limit, filters);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/projects/:id/patterns — Patterns for project
router.get('/projects/:id/patterns', async (req, res, next) => {
  try {
    const type = req.query.type || null;
    const patterns = await patternService.getPatterns(parseInt(req.params.id), type);
    res.json({ data: patterns });
  } catch (err) { next(err); }
});

// GET /api/projects/:id/tool-uses — Tool uses with pagination
router.get('/projects/:id/tool-uses', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const result = await logService.getToolUsesWithPagination(req.params.id, page, limit);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/projects/:id/analytics — Analytics data
router.get('/projects/:id/analytics', async (req, res, next) => {
  try {
    const projectId = parseInt(req.params.id);
    const days = parseInt(req.query.days) || 30;
    const [frustration, tools, categories, patternStats, activity] = await Promise.all([
      analyticsService.getFrustrationTrends(projectId, days),
      analyticsService.getToolUsageBreakdown(projectId),
      analyticsService.getCategoryDistribution(projectId),
      analyticsService.getPatternStats(projectId),
      analyticsService.getActivityTimeline(projectId, days)
    ]);
    res.json({ frustration, tools, categories, patternStats, activity });
  } catch (err) { next(err); }
});

// DELETE /api/projects/:id — Delete a project and all its data
// Patterns are preserved by default. Use ?delete_patterns=true to also delete patterns.
router.delete('/projects/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const projectId = parseInt(req.params.id);
    const deletePatterns = req.query.delete_patterns === 'true';

    const exists = await db.exec('SELECT id, name FROM projects WHERE id = ?', [projectId]);
    if (!exists.length || !exists[0].values.length) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const projectName = exists[0].values[0][1];

    // Count what will be deleted (for confirmation)
    const patternCount = await db.exec('SELECT COUNT(*) FROM patterns WHERE project_id = ?', [projectId]);
    const pCount = patternCount.length ? patternCount[0].values[0][0] : 0;

    // Delete related data
    await db.run('DELETE FROM ai_messages WHERE chat_id IN (SELECT id FROM ai_chats WHERE project_id = ?)', [projectId]);
    await db.run('DELETE FROM ai_chats WHERE project_id = ?', [projectId]);
    await db.run('DELETE FROM versions WHERE project_id = ?', [projectId]);
    await db.run('DELETE FROM journal WHERE project_id = ?', [projectId]);
    await db.run('DELETE FROM project_notes WHERE project_id = ?', [projectId]);
    await db.run('DELETE FROM tasks WHERE project_id = ?', [projectId]);
    await db.run('DELETE FROM phases WHERE project_id = ?', [projectId]);
    await db.run('DELETE FROM tool_uses WHERE project_id = ?', [projectId]);
    await db.run('DELETE FROM prompts WHERE project_id = ?', [projectId]);
    // Detach cross-project references: other projects' data referencing this project's sessions
    await db.run('UPDATE tool_uses SET session_id = NULL WHERE project_id != ? AND session_id IN (SELECT id FROM sessions WHERE project_id = ?)', [projectId, projectId]);
    await db.run('UPDATE prompts SET session_id = NULL WHERE project_id != ? AND session_id IN (SELECT id FROM sessions WHERE project_id = ?)', [projectId, projectId]);
    await db.run('DELETE FROM sessions WHERE project_id = ?', [projectId]);

    if (deletePatterns) {
      await db.run('DELETE FROM patterns WHERE project_id = ?', [projectId]);
    }

    await db.run('DELETE FROM projects WHERE id = ?', [projectId]);

    save();
    res.json({
      success: true,
      deleted: projectName,
      patterns_kept: !deletePatterns ? pCount : 0,
      patterns_deleted: deletePatterns ? pCount : 0
    });
  } catch (err) { next(err); }
});

// POST /api/projects/merge — Merge multiple projects into one
router.post('/projects/merge', async (req, res, next) => {
  try {
    const { target_id, source_ids } = req.body;
    if (!target_id || !source_ids || !source_ids.length) {
      return res.status(400).json({ error: 'target_id and source_ids are required' });
    }
    if (source_ids.includes(target_id)) {
      return res.status(400).json({ error: 'target_id cannot be in source_ids' });
    }

    const db = await getDb();
    const tables = ['sessions', 'prompts', 'tool_uses', 'patterns', 'phases', 'tasks', 'project_notes', 'journal', 'versions'];
    const moved = {};

    for (const sourceId of source_ids) {
      // Verify source project exists
      const exists = await db.exec(`SELECT id, name FROM projects WHERE id = ?`, [sourceId]);
      if (!exists.length || !exists[0].values.length) continue;

      const sourceName = exists[0].values[0][1];
      moved[sourceName] = {};

      for (const table of tables) {
        const countResult = await db.exec(
          `SELECT COUNT(*) FROM ${table} WHERE project_id = ?`, [sourceId]
        );
        const count = countResult.length ? countResult[0].values[0][0] : 0;
        if (count > 0) {
          await db.run(`UPDATE ${table} SET project_id = ? WHERE project_id = ?`,
            [target_id, sourceId]);
        }
        moved[sourceName][table] = count;
      }

      await db.run(`DELETE FROM projects WHERE id = ?`, [sourceId]);
    }

    save();

    res.json({ success: true, merged: moved });
  } catch (err) { next(err); }
});

// POST /api/patterns — Create new pattern
router.post('/patterns', async (req, res, next) => {
  try {
    const { project_id, type, title, description, confidence } = req.body;
    if (!project_id || !type || !title) {
      return res.status(400).json({ error: 'project_id, type, and title are required' });
    }
    const allowedTypes = ['rule', 'mistake', 'preference'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type "${type}". Allowed: ${allowedTypes.join(', ')}` });
    }
    const id = await patternService.addPattern(
      project_id, type, title, description || null, null, confidence || 1.0
    );
    const pattern = await patternService.getPatternById(id);
    res.status(201).json(pattern);
  } catch (err) { next(err); }
});

// PUT /api/patterns/:id — Update pattern
router.put('/patterns/:id', async (req, res, next) => {
  try {
    const { type, title, description, confidence } = req.body;
    if (type !== undefined) {
      const allowedTypes = ['rule', 'mistake', 'preference'];
      if (!allowedTypes.includes(type)) {
        return res.status(400).json({ error: `Invalid type "${type}". Allowed: ${allowedTypes.join(', ')}` });
      }
    }
    await patternService.updatePattern(parseInt(req.params.id), { type, title, description, confidence });
    const pattern = await patternService.getPatternById(parseInt(req.params.id));
    res.json(pattern);
  } catch (err) { next(err); }
});

// DELETE /api/patterns/:id — Deactivate pattern
router.delete('/patterns/:id', async (req, res, next) => {
  try {
    await patternService.deactivatePattern(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/search — Full-text search
router.get('/search', async (req, res, next) => {
  try {
    const { q, project } = req.query;
    if (!q) return res.status(400).json({ error: 'Query parameter "q" is required' });
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const projectId = project ? parseInt(project) : null;
    const prompts = await searchService.searchPrompts(q, projectId, limit);

    let patterns = [];
    try {
      patterns = await patternService.searchPatterns(q);
    } catch (e) { /* FTS may fail on short queries */ }

    res.json({ prompts, patterns });
  } catch (err) { next(err); }
});

// GET /api/projects/:id/export — Export project context as markdown
router.get('/projects/:id/export', async (req, res, next) => {
  try {
    const db = await getDb();
    const projectId = parseInt(req.params.id);
    const result = await db.exec('SELECT id, name, path FROM projects WHERE id = ?', [projectId]);
    if (!result.length || !result[0].values.length) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const project = { id: result[0].values[0][0], name: result[0].values[0][1], path: result[0].values[0][2] };

    const lines = [];
    lines.push(`# ${project.name} - Proje Rehberi`);
    lines.push('');
    lines.push(`> Bu dosya ClaudeManager tarafindan olusturuldu.`);
    lines.push(`> Proje yolu: ${project.path}`);
    lines.push('');

    // Patterns
    const patterns = await patternService.getPatterns(projectId);
    const rules = patterns.filter(p => p.type === 'rule');
    const mistakes = patterns.filter(p => p.type === 'mistake');
    const preferences = patterns.filter(p => p.type === 'preference');
    const otherPatterns = patterns.filter(p => !['rule', 'mistake', 'preference'].includes(p.type));

    if (rules.length) {
      lines.push('## Kurallar (MUTLAKA UYGULA)');
      rules.forEach(r => lines.push(`- **${r.title}**${r.description ? ': ' + r.description : ''}`));
      lines.push('');
    }
    if (mistakes.length) {
      lines.push('## Gecmis Hatalar (TEKRARLAMA)');
      mistakes.forEach(m => lines.push(`- **${m.title}**${m.description ? ': ' + m.description : ''}`));
      lines.push('');
    }
    if (preferences.length) {
      lines.push('## Kullanici Tercihleri');
      preferences.forEach(p => lines.push(`- **${p.title}**${p.description ? ': ' + p.description : ''}`));
      lines.push('');
    }
    if (otherPatterns.length) {
      lines.push('## Ogrenilen Pattern\'ler');
      otherPatterns.forEach(p => lines.push(`- **${p.title}**${p.description ? ': ' + p.description : ''}`));
      lines.push('');
    }

    // Roadmap
    const roadmapStats = await planService.getRoadmapStats(projectId);
    if (roadmapStats.total > 0) {
      lines.push('## Yol Haritasi');
      lines.push(`Ilerleme: ${roadmapStats.completed}/${roadmapStats.total} gorev (%${roadmapStats.percent})`);
      lines.push('');

      const roadmap = await planService.getRoadmap(projectId);
      for (const phase of roadmap) {
        const statusEmoji = { completed: '[x]', in_progress: '[-]', planned: '[ ]' };
        lines.push(`### Faz ${phase.phase_no} - ${phase.title} (${phase.status})`);
        for (const task of phase.tasks) {
          const mark = statusEmoji[task.status] || '[ ]';
          lines.push(`- ${mark} **${task.task_no}:** ${task.title}`);
          if (task.detail) {
            task.detail.split('\n').forEach(line => lines.push(`  ${line}`));
          }
          if (task.risks) {
            lines.push(`  - Risk: ${task.risks.split('\n')[0]}`);
          }
        }
        lines.push('');
      }
    }

    if (!patterns.length && roadmapStats.total === 0) {
      lines.push('Henuz kayitli pattern veya yol haritasi yok.');
      lines.push('');
    }

    const content = lines.join('\n');
    const filename = `${project.name.replace(/[^a-zA-Z0-9_-]/g, '_')}_rehber.md`;

    if (req.query.format === 'json') {
      res.json({ filename, content });
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.type('text/markdown').send(content);
    }
  } catch (err) { next(err); }
});

// --- Notes Endpoints ---

// GET /api/projects/:id/notes — Notes for project
router.get('/projects/:id/notes', async (req, res, next) => {
  try {
    const category = req.query.category || null;
    const notes = await noteService.getNotes(parseInt(req.params.id), category);
    res.json({ data: notes });
  } catch (err) { next(err); }
});

// POST /api/projects/:id/notes — Create new note
router.post('/projects/:id/notes', async (req, res, next) => {
  try {
    const { title, content, category } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }
    const id = await noteService.createNote(parseInt(req.params.id), title, content, category);
    const note = await noteService.getNoteById(id);
    res.status(201).json(note);
  } catch (err) { next(err); }
});

// PUT /api/notes/:id — Update note
router.put('/notes/:id', async (req, res, next) => {
  try {
    await noteService.updateNote(parseInt(req.params.id), req.body);
    const note = await noteService.getNoteById(parseInt(req.params.id));
    res.json(note);
  } catch (err) { next(err); }
});

// DELETE /api/notes/:id — Delete note
router.delete('/notes/:id', async (req, res, next) => {
  try {
    await noteService.deleteNote(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// --- Journal Endpoints ---

// GET /api/projects/:id/journal — Journal entries for project
router.get('/projects/:id/journal', async (req, res, next) => {
  try {
    const category = req.query.category || null;
    const startDate = req.query.start || null;
    const endDate = req.query.end || null;
    const entries = await journalService.getEntries(parseInt(req.params.id), category, startDate, endDate);
    res.json({ data: entries });
  } catch (err) { next(err); }
});

// POST /api/projects/:id/journal — Create new journal entry
router.post('/projects/:id/journal', async (req, res, next) => {
  try {
    const { title, content, category, tags, entry_date } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'title is required' });
    }
    const id = await journalService.createEntry(parseInt(req.params.id), title, content, category, tags, entry_date);
    const entry = await journalService.getEntryById(id);
    res.status(201).json(entry);
  } catch (err) { next(err); }
});

// PUT /api/journal/:id — Update journal entry
router.put('/journal/:id', async (req, res, next) => {
  try {
    await journalService.updateEntry(parseInt(req.params.id), req.body);
    const entry = await journalService.getEntryById(parseInt(req.params.id));
    res.json(entry);
  } catch (err) { next(err); }
});

// DELETE /api/journal/:id — Delete journal entry
router.delete('/journal/:id', async (req, res, next) => {
  try {
    await journalService.deleteEntry(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// --- Roadmap / Plan Endpoints ---

// GET /api/projects/:id/roadmap — Full roadmap (phases + tasks)
router.get('/projects/:id/roadmap', async (req, res, next) => {
  try {
    const roadmap = await planService.getRoadmap(parseInt(req.params.id));
    res.json({ data: roadmap });
  } catch (err) { next(err); }
});

// GET /api/projects/:id/roadmap/summary — Phase headers + task summaries (no detail/risks)
router.get('/projects/:id/roadmap/summary', async (req, res, next) => {
  try {
    const summary = await planService.getRoadmapSummary(parseInt(req.params.id));
    res.json({ data: summary });
  } catch (err) { next(err); }
});

// GET /api/projects/:id/roadmap/stats — Roadmap statistics
router.get('/projects/:id/roadmap/stats', async (req, res, next) => {
  try {
    const stats = await planService.getRoadmapStats(parseInt(req.params.id));
    res.json(stats);
  } catch (err) { next(err); }
});

// POST /api/projects/:id/phases — Create new phase
router.post('/projects/:id/phases', async (req, res, next) => {
  try {
    const { phase_no, title } = req.body;
    if (!phase_no || !title) {
      return res.status(400).json({ error: 'phase_no and title are required' });
    }
    const id = await planService.createPhase(parseInt(req.params.id), phase_no, title);
    const phase = await planService.getPhaseWithTasks(id);
    res.status(201).json(phase);
  } catch (err) { next(err); }
});

// PUT /api/phases/:id — Update phase
router.put('/phases/:id', async (req, res, next) => {
  try {
    await planService.updatePhase(parseInt(req.params.id), req.body);
    const phase = await planService.getPhaseWithTasks(parseInt(req.params.id));
    res.json(phase);
  } catch (err) { next(err); }
});

// DELETE /api/phases/:id — Delete phase and its tasks
router.delete('/phases/:id', async (req, res, next) => {
  try {
    await planService.deletePhase(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/phases/:id/tasks — Create new task
router.post('/phases/:id/tasks', async (req, res, next) => {
  try {
    const { task_no, title, detail, risks, project_id } = req.body;
    if (!task_no || !title) {
      return res.status(400).json({ error: 'task_no and title are required' });
    }
    // Get project_id from phase if not provided
    let pId = project_id;
    if (!pId) {
      const phase = await planService.getPhaseWithTasks(parseInt(req.params.id));
      if (!phase) return res.status(404).json({ error: 'Phase not found' });
      pId = phase.project_id;
    }
    const id = await planService.createTask(parseInt(req.params.id), pId, task_no, title, detail, risks);
    res.status(201).json({ id, task_no, title, status: 'planned' });
  } catch (err) { next(err); }
});

// PUT /api/tasks/:id — Update task
router.put('/tasks/:id', async (req, res, next) => {
  try {
    await planService.updateTask(parseInt(req.params.id), req.body);
    res.json({ success: true, id: parseInt(req.params.id) });
  } catch (err) { next(err); }
});

// DELETE /api/tasks/:id — Delete task
router.delete('/tasks/:id', async (req, res, next) => {
  try {
    await planService.deleteTask(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /api/projects/:id/roadmap/import — Import from XML
router.post('/projects/:id/roadmap/import', async (req, res, next) => {
  try {
    const { xml } = req.body;
    if (!xml) {
      return res.status(400).json({ error: 'xml field is required' });
    }
    const result = await planService.importFromXml(parseInt(req.params.id), xml);
    res.json({ success: true, imported: result });
  } catch (err) { next(err); }
});

// --- Version Endpoints ---

// GET /api/projects/:id/versions — Versions for project
router.get('/projects/:id/versions', async (req, res, next) => {
  try {
    const versions = await versionService.getVersions(parseInt(req.params.id));
    res.json({ data: versions });
  } catch (err) { next(err); }
});

// GET /api/projects/:id/versions/latest — Latest version
router.get('/projects/:id/versions/latest', async (req, res, next) => {
  try {
    const version = await versionService.getLatestVersion(parseInt(req.params.id));
    if (!version) return res.status(404).json({ error: 'No versions found' });
    res.json(version);
  } catch (err) { next(err); }
});

// POST /api/projects/:id/versions — Create new version
router.post('/projects/:id/versions', async (req, res, next) => {
  try {
    const { version, title, changes, released_at } = req.body;
    if (!version || !title) {
      return res.status(400).json({ error: 'version and title are required' });
    }
    const id = await versionService.createVersion(
      parseInt(req.params.id), version, title, changes, released_at
    );
    const created = await versionService.getVersionById(id);
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// PUT /api/versions/:id — Update version
router.put('/versions/:id', async (req, res, next) => {
  try {
    await versionService.updateVersion(parseInt(req.params.id), req.body);
    const version = await versionService.getVersionById(parseInt(req.params.id));
    res.json(version);
  } catch (err) { next(err); }
});

// DELETE /api/versions/:id — Delete version
router.delete('/versions/:id', async (req, res, next) => {
  try {
    await versionService.deleteVersion(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// --- AI Chat Endpoints ---

// POST /api/ai-chat — Create a new AI conversation
router.post('/ai-chat', async (req, res, next) => {
  try {
    const { project_id, topic, role_a, role_b, system_a, system_b, max_turns } = req.body;
    if (!topic) {
      return res.status(400).json({ error: 'topic is required' });
    }
    const id = await chatService.createChat(project_id, topic, role_a, role_b, system_a, system_b, max_turns);
    const chat = await chatService.getChatById(id);
    res.status(201).json(chat);
  } catch (err) { next(err); }
});

// GET /api/ai-chats — List all AI conversations (optionally filter by status)
router.get('/ai-chats', async (req, res, next) => {
  try {
    const status = req.query.status || null;
    const chats = await chatService.getChats(null, status);
    res.json({ data: chats });
  } catch (err) { next(err); }
});

// GET /api/projects/:id/ai-chats — List AI conversations for a project
router.get('/projects/:id/ai-chats', async (req, res, next) => {
  try {
    const status = req.query.status || null;
    const chats = await chatService.getChats(parseInt(req.params.id), status);
    res.json({ data: chats });
  } catch (err) { next(err); }
});

// GET /api/ai-chat/:id — Get chat with messages
router.get('/ai-chat/:id', async (req, res, next) => {
  try {
    const chat = await chatService.getChatById(parseInt(req.params.id));
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const messages = await chatService.getMessages(chat.id, limit, offset);
    res.json({ ...chat, messages });
  } catch (err) { next(err); }
});

// POST /api/ai-chat/:id/message — Post a message (from one AI)
// Body: { role: "a"|"b", content: "mesaj", summary?: "guncel ozet" }
// No strict turn order — either role can post anytime
router.post('/ai-chat/:id/message', async (req, res, next) => {
  try {
    const { role, content, summary, reply_to } = req.body;
    if (!role || !content) {
      return res.status(400).json({ error: 'role (a/b) and content are required' });
    }
    if (!['a', 'b'].includes(role)) {
      return res.status(400).json({ error: 'role must be "a" or "b"' });
    }
    const result = await chatService.postMessage(parseInt(req.params.id), role, content, summary || null, reply_to || null);
    res.json(result);
  } catch (err) {
    if (err.message.includes('Max turns') || err.message.includes('Chat is')) {
      return res.status(409).json({ error: err.message });
    }
    next(err);
  }
});

// POST /api/ai-chat/:id/read/:role — Mark all messages from other role as read
router.post('/ai-chat/:id/read/:role', async (req, res, next) => {
  try {
    const role = req.params.role;
    if (!['a', 'b'].includes(role)) {
      return res.status(400).json({ error: 'role must be "a" or "b"' });
    }
    await chatService.markAsRead(parseInt(req.params.id), role);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/ai-chat/:id/unread/:role — Get unread messages for this role
router.get('/ai-chat/:id/unread/:role', async (req, res, next) => {
  try {
    const role = req.params.role;
    if (!['a', 'b'].includes(role)) {
      return res.status(400).json({ error: 'role must be "a" or "b"' });
    }
    const messages = await chatService.getUnreadMessages(parseInt(req.params.id), role);
    res.json({ unread_count: messages.length, messages });
  } catch (err) { next(err); }
});

// PUT /api/ai-chat/:id/summary — Update chat summary
router.put('/ai-chat/:id/summary', async (req, res, next) => {
  try {
    const { summary } = req.body;
    if (!summary) {
      return res.status(400).json({ error: 'summary is required' });
    }
    await chatService.updateSummary(parseInt(req.params.id), summary);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/ai-chat/:id/next/:role — Check if it's this role's turn (instant)
router.get('/ai-chat/:id/next/:role', async (req, res, next) => {
  try {
    const role = req.params.role;
    if (!['a', 'b'].includes(role)) {
      return res.status(400).json({ error: 'role must be "a" or "b"' });
    }
    const result = await chatService.getNextTurn(parseInt(req.params.id), role);
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/ai-chat/:id/wait/:role — Long-poll: wait until it's this role's turn
router.get('/ai-chat/:id/wait/:role', async (req, res, next) => {
  try {
    const role = req.params.role;
    if (!['a', 'b'].includes(role)) {
      return res.status(400).json({ error: 'role must be "a" or "b"' });
    }
    const timeout = Math.min(parseInt(req.query.timeout) || 30000, 60000);
    const result = await chatService.waitForTurn(parseInt(req.params.id), role, timeout);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/ai-chat/:id/stop — Stop the conversation
router.post('/ai-chat/:id/stop', async (req, res, next) => {
  try {
    await chatService.updateStatus(parseInt(req.params.id), 'stopped');
    const chat = await chatService.getChatById(parseInt(req.params.id));
    res.json(chat);
  } catch (err) { next(err); }
});

// POST /api/ai-chat/:id/resume — Resume a stopped conversation
router.post('/ai-chat/:id/resume', async (req, res, next) => {
  try {
    await chatService.updateStatus(parseInt(req.params.id), 'active');
    const chat = await chatService.getChatById(parseInt(req.params.id));
    res.json(chat);
  } catch (err) { next(err); }
});

// POST /api/ai-chat/:id/archive/:role — Propose archive (both must agree)
router.post('/ai-chat/:id/archive/:role', async (req, res, next) => {
  try {
    const role = req.params.role;
    if (!['a', 'b'].includes(role)) {
      return res.status(400).json({ error: 'role must be "a" or "b"' });
    }
    const { summary } = req.body || {};
    const result = await chatService.proposeArchive(parseInt(req.params.id), role, summary || null);
    res.json(result);
  } catch (err) { next(err); }
});

// POST /api/ai-chat/:id/continue — Continue an archived chat
router.post('/ai-chat/:id/continue', async (req, res, next) => {
  try {
    const result = await chatService.continueChat(parseInt(req.params.id));
    res.json(result);
  } catch (err) { next(err); }
});

// GET /api/ai-chat/feed — Live feed of all recent messages across all chats
router.get('/ai-chat-feed', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const messages = await chatService.getLiveFeed(limit);
    res.json({ messages });
  } catch (err) { next(err); }
});

// DELETE /api/ai-chat/:id — Delete chat and messages
router.delete('/ai-chat/:id', async (req, res, next) => {
  try {
    await chatService.deleteChat(parseInt(req.params.id));
    res.json({ success: true });
  } catch (err) { next(err); }
});

// GET /api/guide — Self-contained guide for Claude Code
// Claude can curl this to learn how to use the API for the current project
router.get('/guide', async (req, res, next) => {
  try {
    const cwd = req.query.cwd || null;
    const db = await getDb();
    let project = null;
    let projectId = null;

    if (cwd) {
      const normalizedCwd = normalizePath(cwd);
      // 1. Exact match
      let result = await db.exec('SELECT id, name, path FROM projects WHERE path = ?', [normalizedCwd]);
      // 2. Parent project match — subdirectory of a registered project (max 3 levels)
      if (!result.length || !result[0].values.length) {
        const parents = await db.exec(
          `SELECT id, name, path FROM projects WHERE ? LIKE path || '/%' ORDER BY LENGTH(path) DESC`,
          [normalizedCwd]
        );
        if (parents.length && parents[0].values.length) {
          for (const row of parents[0].values) {
            const remaining = normalizedCwd.substring(row[2].length);
            const depth = (remaining.match(/\//g) || []).length;
            if (depth <= 3) { result = { 0: { values: [row] }, length: 1 }; break; }
          }
        }
      }
      // 3. Auto-register — new project from cwd
      if (!result.length || !result[0].values.length) {
        const projectName = normalizedCwd.split('/').pop();
        const newId = await logService.ensureProject(projectName, normalizedCwd);
        result = await db.exec('SELECT id, name, path FROM projects WHERE id = ?', [newId]);
      }
      if (result.length && result[0].values.length) {
        const row = result[0].values[0];
        project = { id: row[0], name: row[1], path: row[2] };
        projectId = row[0];
      }
    }

    const base = 'http://127.0.0.1:41847';
    const lines = [];
    lines.push('# ClaudeManager - AI Asistan Hafiza Sistemi');
    lines.push('');
    lines.push('Bu proje ClaudeManager ile entegredir. Asagidaki API\'yi kullanarak gecmis deneyimlerden ogren ve yeni ogrendiklerini kaydet.');
    lines.push('');

    if (project) {
      lines.push(`## Mevcut Proje: ${project.name} (id: ${project.id})`);
      lines.push('');

      // Load patterns
      const patterns = await patternService.getPatterns(projectId);
      const rules = patterns.filter(p => p.type === 'rule');
      const mistakes = patterns.filter(p => p.type === 'mistake');
      const preferences = patterns.filter(p => p.type === 'preference');

      if (rules.length) {
        lines.push('### Kurallar (MUTLAKA UYGULA):');
        rules.forEach(r => lines.push(`- ${r.title}${r.description ? ': ' + r.description : ''}`));
        lines.push('');
      }
      if (mistakes.length) {
        lines.push('### Gecmis Hatalar (TEKRARLAMA):');
        mistakes.forEach(m => lines.push(`- ${m.title}${m.description ? ': ' + m.description : ''}`));
        lines.push('');
      }
      if (preferences.length) {
        lines.push('### Kullanici Tercihleri:');
        preferences.forEach(p => lines.push(`- ${p.title}${p.description ? ': ' + p.description : ''}`));
        lines.push('');
      }

      // Load roadmap
      const roadmapStats = await planService.getRoadmapStats(projectId);
      if (roadmapStats.total > 0) {
        lines.push('## Yol Haritasi');
        const phases = await planService.getPhases(projectId);
        const activePhase = phases.find(p => p.status === 'in_progress');
        if (activePhase) {
          lines.push(`Mevcut faz: Faz ${activePhase.phase_no} - ${activePhase.title} (devam ediyor)`);
        }
        lines.push(`Tamamlanan: ${roadmapStats.completed}/${roadmapStats.total} gorev (%${roadmapStats.percent})`);

        const openTasks = await planService.getTasks(projectId);
        const pending = openTasks.filter(t => t.status === 'planned' || t.status === 'in_progress');
        if (pending.length) {
          lines.push('Acik gorevler:');
          pending.slice(0, 10).forEach(t => lines.push(`- ${t.task_no}: ${t.title}`));
          if (pending.length > 10) lines.push(`  ... ve ${pending.length - 10} gorev daha`);
        }
        lines.push('');
      }

      lines.push('## API Kullanimi');
      lines.push('');
      lines.push('Pattern\'leri oku:');
      lines.push(`  curl -s ${base}/api/projects/${projectId}/patterns`);
      lines.push('');
      lines.push('Yeni kural/hata/tercih kaydet:');
      lines.push(`  curl -X POST ${base}/api/patterns -H "Content-Type: application/json" -d '{"project_id":${projectId},"type":"rule|mistake|preference","title":"BASLIK","description":"ACIKLAMA"}'`);
      lines.push('');
      lines.push('Pattern guncelle:');
      lines.push(`  curl -X PUT ${base}/api/patterns/PATTERN_ID -H "Content-Type: application/json" -d '{"title":"YENI_BASLIK","description":"YENI_ACIKLAMA"}'`);
      lines.push('');
      lines.push('Pattern sil:');
      lines.push(`  curl -X DELETE ${base}/api/patterns/PATTERN_ID`);
      lines.push('');
      lines.push('Gecmis prompt\'lari ara:');
      lines.push(`  curl -s "${base}/api/search?q=ARAMA_TERIMI&project=${projectId}"`);
      lines.push('');
      lines.push('Analitik veriler:');
      lines.push(`  curl -s ${base}/api/projects/${projectId}/analytics`);
      lines.push('');
      lines.push('Yol haritasi ozet (faz basliklari + gorev listesi, detaysiz — ONCE BUNU KULLAN):');
      lines.push(`  curl -s ${base}/api/projects/${projectId}/roadmap/summary`);
      lines.push('');
      lines.push('Yol haritasi tam detay (detail + risks dahil, sadece gerektiginde):');
      lines.push(`  curl -s ${base}/api/projects/${projectId}/roadmap`);
      lines.push('');
      lines.push('Gorev ekle:');
      lines.push(`  curl -X POST ${base}/api/phases/FAZ_ID/tasks -H "Content-Type: application/json" -d '{"task_no":"X.Y","title":"BASLIK","detail":"DETAY"}'`);
      lines.push('');
      lines.push('Gorev durumu guncelle:');
      lines.push(`  curl -X PUT ${base}/api/tasks/GOREV_ID -H "Content-Type: application/json" -d '{"status":"completed"}'`);
      lines.push('');
      lines.push('Gunluk girislerini oku:');
      lines.push(`  curl -s ${base}/api/projects/${projectId}/journal`);
      lines.push('');
      lines.push('Yeni gunluk girisi:');
      lines.push(`  curl -X POST ${base}/api/projects/${projectId}/journal -H "Content-Type: application/json" -d '{"title":"BASLIK","content":"ICERIK","category":"genel|teknik|karar|arastirma"}'`);
      lines.push('');
      lines.push('Notlari oku (hesap bilgileri, API key\'ler, sifreler, konfigurasyonlar burada):');
      lines.push(`  curl -s ${base}/api/projects/${projectId}/notes`);
      lines.push('');
      lines.push('Yeni not olustur:');
      lines.push(`  curl -X POST ${base}/api/projects/${projectId}/notes -H "Content-Type: application/json" -d '{"title":"BASLIK","content":"ICERIK","category":"teknik"}'`);
      lines.push('');
      lines.push('Versiyonlari oku (changelog):');
      lines.push(`  curl -s ${base}/api/projects/${projectId}/versions`);
      lines.push('');
      lines.push('Son versiyon:');
      lines.push(`  curl -s ${base}/api/projects/${projectId}/versions/latest`);
      lines.push('');
      lines.push('Yeni versiyon kaydet:');
      lines.push(`  curl -X POST ${base}/api/projects/${projectId}/versions -H "Content-Type: application/json" -d '{"version":"1.0.0","title":"BASLIK","changes":"- degisiklik1\\n- degisiklik2","released_at":"2025-01-01T00:00:00Z"}'`);
      lines.push('');
      lines.push('## AI Chat (2 AI arasi sohbet)');
      lines.push('Iki AI in karsilikli konusabilecegi relay sistemi. Read/unread bazli, summary destekli.');
      lines.push('Sira sistemi YOK - her iki rol de istediginde mesaj atabilir.');
      lines.push('Okunmamis mesaj varsa your_turn=true doner.');
      lines.push('');
      lines.push('Yeni sohbet baslat:');
      lines.push(`  curl -X POST ${base}/api/ai-chat -H "Content-Type: application/json" -d '{"project_id":${projectId},"topic":"KONU","role_a":"ROL_A","role_b":"ROL_B","system_a":"SYSTEM_PROMPT_A","system_b":"SYSTEM_PROMPT_B","max_turns":50}'`);
      lines.push('');
      lines.push('Bu projenin sohbetlerini listele:');
      lines.push(`  curl -s ${base}/api/projects/${projectId}/ai-chats`);
      lines.push('');
      lines.push('Okunmamis mesajlari kontrol et (a veya b):');
      lines.push(`  curl -s ${base}/api/ai-chat/CHAT_ID/next/a`);
      lines.push('  Doner: {your_turn, unread_count, respond_to, summary, system_prompt, turns_remaining}');
      lines.push('');
      lines.push('Okunmamis mesajlari getir:');
      lines.push(`  curl -s ${base}/api/ai-chat/CHAT_ID/unread/a`);
      lines.push('  Doner: {unread_count, messages: [...]}');
      lines.push('');
      lines.push('Mesajlari okundu olarak isaretle:');
      lines.push(`  curl -X POST ${base}/api/ai-chat/CHAT_ID/read/a`);
      lines.push('');
      lines.push('Okunmamis mesaj gelene kadar bekle (long-poll, max 30sn):');
      lines.push(`  curl -s ${base}/api/ai-chat/CHAT_ID/wait/a`);
      lines.push('');
      lines.push('Mesaj at (sira beklemeden, istediginde):');
      lines.push(`  curl -X POST ${base}/api/ai-chat/CHAT_ID/message -H "Content-Type: application/json" -d '{"role":"a","content":"MESAJ","summary":"GUNCEL_OZET"}'`);
      lines.push('');
      lines.push('Ozet guncelle (ayri):');
      lines.push(`  curl -X PUT ${base}/api/ai-chat/CHAT_ID/summary -H "Content-Type: application/json" -d '{"summary":"GUNCEL_OZET"}'`);
      lines.push('');
      lines.push('Sohbet detay + tum mesajlar:');
      lines.push(`  curl -s ${base}/api/ai-chat/CHAT_ID`);
      lines.push('');
      lines.push('Durdur / devam ettir / sil:');
      lines.push(`  curl -X POST ${base}/api/ai-chat/CHAT_ID/stop`);
      lines.push(`  curl -X POST ${base}/api/ai-chat/CHAT_ID/resume`);
      lines.push(`  curl -X DELETE ${base}/api/ai-chat/CHAT_ID`);
      lines.push('');
      lines.push('Read/Unread sistemi: Mesaj attiginizda karsi tarafin unread sayisi artar. /next endpoint i unread mesaj varsa your_turn=true doner.');
      lines.push('Summary: Her mesajda summary gonderirsen, diger AI mesajlari kontrol ettiginde sadece summary + okunmamis mesajlari gorur.');
    } else {
      lines.push('## Proje Tanimlanmadi');
      lines.push('');
      lines.push('cwd parametresi verilmedi. Kullanim:');
      lines.push(`  curl -s "${base}/api/guide?cwd=$(pwd)"`);
      lines.push('');
      lines.push('Tum projeleri gor:');
      lines.push(`  curl -s ${base}/api/projects`);
    }

    lines.push('');
    lines.push('## Onemli Kurallar');
    lines.push('- Pattern tipleri: sadece "rule", "mistake", "preference" kabul edilir ("pattern" tipi kaldirildi)');
    lines.push('- Kullanici bir hata yaptigini soylerse, hatani "mistake" olarak kaydet');
    lines.push('- Kullanici bir tercih belirtirse, "preference" olarak kaydet');
    lines.push('- Tekrarlanan bir pattern fark edersen, "rule" olarak kaydet');
    lines.push('- Gunluk nitelikli bilgiler (kredi durumu, domain, vize vs.) icin journal endpoint\'ini kullan');
    lines.push('- Hesap bilgileri, API key\'ler, sifreler, krediler gibi kritik bilgileri Notes\'a kaydet (category: teknik)');
    lines.push('- Yeni bir hesap/servis olusturulursa bilgileri hemen Notes\'a yaz - sonra unutulur');
    lines.push('- Her session basinda pattern\'leri oku ve uygula');
    lines.push('');
    lines.push(`Dashboard: ${base}/`);

    res.type('text/plain').send(lines.join('\n'));
  } catch (err) { next(err); }
});

module.exports = router;
