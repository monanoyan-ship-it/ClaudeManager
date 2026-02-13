const { getDb, save } = require('../db/init');
const { categorizePrompt, extractTags } = require('../utils/analyzer');

class LogService {
  async ensureProject(name, projectPath) {
    const db = await getDb();
    const existing = db.exec(`SELECT id FROM projects WHERE path = ?`, [projectPath]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      return existing[0].values[0][0];
    }
    db.run(`INSERT INTO projects (name, path) VALUES (?, ?)`, [name, projectPath]);
    save();
    const result = db.exec(`SELECT last_insert_rowid()`);
    return result[0].values[0][0];
  }

  async getOrCreateSession(projectId, sessionId) {
    const db = await getDb();
    const existing = db.exec(`SELECT id FROM sessions WHERE session_id = ?`, [sessionId]);
    if (existing.length > 0 && existing[0].values.length > 0) {
      return existing[0].values[0][0];
    }
    db.run(`INSERT INTO sessions (project_id, session_id) VALUES (?, ?)`, [projectId, sessionId]);
    save();
    const result = db.exec(`SELECT last_insert_rowid()`);
    return result[0].values[0][0];
  }

  async logPrompt(projectId, sessionDbId, role, content, category, tags) {
    const db = await getDb();
    const autoCategory = category || categorizePrompt(content);
    const autoTags = tags || JSON.stringify(extractTags(content));

    db.run(
      `INSERT INTO prompts (session_id, project_id, role, content, category, tags) VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionDbId, projectId, role, content, autoCategory, autoTags]
    );

    // Update FTS
    const idResult = db.exec(`SELECT last_insert_rowid()`);
    const promptId = idResult[0].values[0][0];
    try {
      db.run(`INSERT INTO prompts_fts (rowid, content, tags) VALUES (?, ?, ?)`,
        [promptId, content, autoTags]);
    } catch (e) {
      // FTS insert failure is non-critical
    }

    save();
    return promptId;
  }

  async logToolUse(projectId, sessionDbId, toolName, toolInput, filePath, success) {
    const db = await getDb();
    db.run(
      `INSERT INTO tool_uses (session_id, project_id, tool_name, tool_input, file_path, success) VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionDbId, projectId, toolName, JSON.stringify(toolInput), filePath, success ? 1 : 0]
    );
    save();
  }

  async endSession(sessionId, summary) {
    const db = await getDb();
    db.run(
      `UPDATE sessions SET ended_at = CURRENT_TIMESTAMP, summary = ? WHERE session_id = ?`,
      [summary, sessionId]
    );
    save();
  }

  async getRecentPrompts(projectId, limit = 20) {
    const db = await getDb();
    const result = db.exec(
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
    const result = db.exec(
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
    const result = db.exec(`
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
}

module.exports = new LogService();
