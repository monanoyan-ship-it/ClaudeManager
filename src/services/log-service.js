const { getDb, save } = require('../db/init');
const { categorizePrompt, extractTags } = require('../utils/analyzer');
const { normalizePath } = require('../utils/path-normalizer');

class LogService {
  async ensureProject(name, projectPath) {
    const db = await getDb();
    const normalizedPath = normalizePath(projectPath);

    // 1. Exact match
    const existing = await db.exec(`SELECT id FROM projects WHERE path = ?`, [normalizedPath]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      return existing[0].values[0][0];
    }

    // 2. Parent project match — don't create new project for subdirectories
    const parents = await db.exec(
      `SELECT id, path FROM projects WHERE ? LIKE path || '/%' ORDER BY LENGTH(path) DESC`,
      [normalizedPath]
    );
    if (parents.length > 0 && parents[0].values.length > 0) {
      for (const row of parents[0].values) {
        const remaining = normalizedPath.substring(row[1].length);
        const depth = (remaining.match(/\//g) || []).length;
        if (depth <= 3) return row[0]; // max 3 seviye derinlik
      }
    }

    // 3. No match — create new project
    await db.run(`INSERT INTO projects (name, path) VALUES (?, ?)`, [name, normalizedPath]);
    const result = await db.exec(`SELECT last_insert_rowid()`);
    return result[0].values[0][0];
  }

  async getOrCreateSession(projectId, sessionId) {
    const db = await getDb();
    const existing = await db.exec(`SELECT id FROM sessions WHERE session_id = ?`, [sessionId]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      return existing[0].values[0][0];
    }
    await db.run(`INSERT INTO sessions (project_id, session_id) VALUES (?, ?)`, [projectId, sessionId]);
    const result = await db.exec(`SELECT last_insert_rowid()`);
    return result[0].values[0][0];
  }

  async logPrompt(projectId, sessionDbId, role, content, category, tags) {
    const db = await getDb();
    const autoCategory = category || categorizePrompt(content);
    const autoTags = tags || JSON.stringify(extractTags(content));

    await db.run(
      `INSERT INTO prompts (session_id, project_id, role, content, category, tags) VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionDbId, projectId, role, content, autoCategory, autoTags]
    );

    const idResult = await db.exec(`SELECT last_insert_rowid()`);
    const promptId = idResult[0].values[0][0];
    try {
      await db.run(`INSERT INTO prompts_fts (rowid, content, tags) VALUES (?, ?, ?)`,
        [promptId, content, autoTags]);
    } catch (e) {
      // FTS insert failure is non-critical
    }

    return promptId;
  }

  async logToolUse(projectId, sessionDbId, toolName, toolInput, filePath, success) {
    const db = await getDb();
    await db.run(
      `INSERT INTO tool_uses (session_id, project_id, tool_name, tool_input, file_path, success) VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionDbId, projectId, toolName, JSON.stringify(toolInput), filePath, success ? 1 : 0]
    );
  }

  async endSession(sessionId, summary) {
    const db = await getDb();
    await db.run(
      `UPDATE sessions SET ended_at = CURRENT_TIMESTAMP, summary = ? WHERE session_id = ?`,
      [summary, sessionId]
    );
  }

  async getRecentPrompts(projectId, limit = 20) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT role, content, category, tags, created_at FROM prompts WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
      [projectId, limit]
    );
    if (!result.length) return [];
    return result[0].values.map(row => ({
      role: row[0], content: row[1], category: row[2],
      tags: row[3], created_at: row[4]
    }));
  }

  async getRecentToolUses(projectId, limit = 20) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT tool_name, file_path, success, created_at FROM tool_uses WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
      [projectId, limit]
    );
    if (!result.length) return [];
    return result[0].values.map(row => ({
      tool_name: row[0], file_path: row[1],
      success: row[2], created_at: row[3]
    }));
  }

  async getSessionStats(projectId) {
    const db = await getDb();
    const result = await db.exec(`
      SELECT
        COUNT(DISTINCT s.id) as session_count,
        COUNT(p.id) as prompt_count,
        COUNT(DISTINCT t.id) as tool_count
      FROM sessions s
      LEFT JOIN prompts p ON p.session_id = s.id
      LEFT JOIN tool_uses t ON t.session_id = s.id
      WHERE s.project_id = ?
    `, [projectId]);
    if (!result.length) return { session_count: 0, prompt_count: 0, tool_count: 0 };
    const row = result[0].values[0];
    return { session_count: row[0], prompt_count: row[1], tool_count: row[2] };
  }

  async getPromptsWithPagination(projectId, page = 1, limit = 20, filters = {}) {
    const db = await getDb();
    const offset = (page - 1) * limit;
    let whereClauses = ['p.project_id = ?'];
    const params = [projectId];

    if (filters.category) {
      whereClauses.push('p.category = ?');
      params.push(filters.category);
    }
    if (filters.startDate) {
      whereClauses.push('p.created_at >= ?');
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      whereClauses.push('p.created_at <= ?');
      params.push(filters.endDate);
    }
    if (filters.search) {
      whereClauses.push('p.content ILIKE ?');
      params.push(`%${filters.search}%`);
    }

    const where = whereClauses.join(' AND ');

    const countResult = await db.exec(`SELECT COUNT(*) FROM prompts p WHERE ${where}`, params);
    const total = countResult.length > 0 ? countResult[0].values[0][0] : 0;

    const result = await db.exec(
      `SELECT p.id, p.role, p.content, p.category, p.tags, p.created_at, s.session_id
       FROM prompts p
       LEFT JOIN sessions s ON s.id = p.session_id
       WHERE ${where}
       ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const data = result.length > 0 ? result[0].values.map(row => ({
      id: row[0], role: row[1], content: row[2], category: row[3],
      tags: row[4], created_at: row[5], session_id: row[6]
    })) : [];

    return { data, total, page, limit };
  }

  async getSessionsWithPagination(projectId, page = 1, limit = 20) {
    const db = await getDb();
    const offset = (page - 1) * limit;

    const countResult = await db.exec(
      `SELECT COUNT(*) FROM sessions WHERE project_id = ?`, [projectId]
    );
    const total = countResult.length > 0 ? countResult[0].values[0][0] : 0;

    const result = await db.exec(
      `SELECT s.id, s.session_id, s.started_at, s.ended_at, s.summary,
              (SELECT COUNT(*) FROM prompts WHERE session_id = s.id) as prompt_count,
              (SELECT COUNT(*) FROM tool_uses WHERE session_id = s.id) as tool_count
       FROM sessions s
       WHERE s.project_id = ?
       ORDER BY s.started_at DESC LIMIT ? OFFSET ?`,
      [projectId, limit, offset]
    );

    const data = result.length > 0 ? result[0].values.map(row => ({
      id: row[0], session_id: row[1], started_at: row[2], ended_at: row[3],
      summary: row[4], prompt_count: row[5], tool_count: row[6]
    })) : [];

    return { data, total, page, limit };
  }

  async getToolUsesWithPagination(projectId, page = 1, limit = 20) {
    const db = await getDb();
    const offset = (page - 1) * limit;

    const countResult = await db.exec(
      `SELECT COUNT(*) FROM tool_uses WHERE project_id = ?`, [projectId]
    );
    const total = countResult.length > 0 ? countResult[0].values[0][0] : 0;

    const result = await db.exec(
      `SELECT id, tool_name, file_path, success, created_at
       FROM tool_uses
       WHERE project_id = ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [projectId, limit, offset]
    );

    const data = result.length > 0 ? result[0].values.map(row => ({
      id: row[0], tool_name: row[1], file_path: row[2],
      success: row[3], created_at: row[4]
    })) : [];

    return { data, total, page, limit };
  }
}

module.exports = new LogService();
