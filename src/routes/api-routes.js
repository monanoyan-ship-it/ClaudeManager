const express = require('express');
const { getDb, save } = require('../db/init');
const logService = require('../services/log-service');
const patternService = require('../services/pattern-service');
const analyticsService = require('../services/analytics-service');
const searchService = require('../services/search-service');
const { normalizePath } = require('../utils/path-normalizer');

const router = express.Router();

// GET /api/projects — All projects with stats
router.get('/projects', async (req, res, next) => {
  try {
    const db = await getDb();
    const result = db.exec(`
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

// GET /api/projects/:id — Project detail
router.get('/projects/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const result = db.exec(`SELECT id, name, path, description, created_at FROM projects WHERE id = ?`,
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
router.delete('/projects/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const projectId = parseInt(req.params.id);

    const exists = db.exec('SELECT id, name FROM projects WHERE id = ?', [projectId]);
    if (!exists.length || !exists[0].values.length) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const projectName = exists[0].values[0][1];

    // Delete all related data
    db.run('DELETE FROM tool_uses WHERE project_id = ?', [projectId]);
    db.run('DELETE FROM prompts WHERE project_id = ?', [projectId]);
    db.run('DELETE FROM patterns WHERE project_id = ?', [projectId]);
    db.run('DELETE FROM sessions WHERE project_id = ?', [projectId]);
    db.run('DELETE FROM projects WHERE id = ?', [projectId]);

    save();
    res.json({ success: true, deleted: projectName });
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
    const tables = ['sessions', 'prompts', 'tool_uses', 'patterns'];
    const moved = {};

    for (const sourceId of source_ids) {
      // Verify source project exists
      const exists = db.exec(`SELECT id, name FROM projects WHERE id = ?`, [sourceId]);
      if (!exists.length || !exists[0].values.length) continue;

      const sourceName = exists[0].values[0][1];
      moved[sourceName] = {};

      for (const table of tables) {
        const countResult = db.exec(
          `SELECT COUNT(*) FROM ${table} WHERE project_id = ?`, [sourceId]
        );
        const count = countResult.length ? countResult[0].values[0][0] : 0;
        if (count > 0) {
          db.run(`UPDATE ${table} SET project_id = ? WHERE project_id = ?`,
            [target_id, sourceId]);
        }
        moved[sourceName][table] = count;
      }

      db.run(`DELETE FROM projects WHERE id = ?`, [sourceId]);
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

module.exports = router;
