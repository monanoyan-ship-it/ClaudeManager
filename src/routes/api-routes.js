const express = require('express');
const { getDb, save } = require('../db/init');
const logService = require('../services/log-service');
const patternService = require('../services/pattern-service');
const analyticsService = require('../services/analytics-service');
const searchService = require('../services/search-service');
const planService = require('../services/plan-service');
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
    db.run('DELETE FROM tasks WHERE project_id = ?', [projectId]);
    db.run('DELETE FROM phases WHERE project_id = ?', [projectId]);
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
    const tables = ['sessions', 'prompts', 'tool_uses', 'patterns', 'phases', 'tasks'];
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

// --- Roadmap / Plan Endpoints ---

// GET /api/projects/:id/roadmap — Full roadmap (phases + tasks)
router.get('/projects/:id/roadmap', async (req, res, next) => {
  try {
    const roadmap = await planService.getRoadmap(parseInt(req.params.id));
    res.json({ data: roadmap });
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
      const result = db.exec('SELECT id, name, path FROM projects WHERE path = ?', [normalizedCwd]);
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
      lines.push('Yol haritasi oku:');
      lines.push(`  curl -s ${base}/api/projects/${projectId}/roadmap`);
      lines.push('');
      lines.push('Gorev ekle:');
      lines.push(`  curl -X POST ${base}/api/phases/FAZ_ID/tasks -H "Content-Type: application/json" -d '{"task_no":"X.Y","title":"BASLIK","detail":"DETAY"}'`);
      lines.push('');
      lines.push('Gorev durumu guncelle:');
      lines.push(`  curl -X PUT ${base}/api/tasks/GOREV_ID -H "Content-Type: application/json" -d '{"status":"completed"}'`);
    } else {
      lines.push('## Proje Bulunamadi');
      lines.push('');
      lines.push('Bu proje henuz ClaudeManager\'da kayitli degil. Ilk session\'da otomatik kaydedilecek.');
      lines.push('');
      lines.push('Tum projeleri gor:');
      lines.push(`  curl -s ${base}/api/projects`);
    }

    lines.push('');
    lines.push('## Onemli Kurallar');
    lines.push('- Kullanici bir hata yaptigini soylerse, hatani "mistake" olarak kaydet');
    lines.push('- Kullanici bir tercih belirtirse, "preference" olarak kaydet');
    lines.push('- Tekrarlanan bir pattern fark edersen, "rule" olarak kaydet');
    lines.push('- Her session basinda pattern\'leri oku ve uygula');
    lines.push('');
    lines.push(`Dashboard: ${base}/`);

    res.type('text/plain').send(lines.join('\n'));
  } catch (err) { next(err); }
});

module.exports = router;
