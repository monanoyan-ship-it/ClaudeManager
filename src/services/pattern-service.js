const { getDb, save } = require('../db/init');

const ALLOWED_PATTERN_TYPES = ['rule', 'mistake', 'preference'];

class PatternService {
  async addPattern(projectId, type, title, description, sourcePromptId = null, confidence = 1.0) {
    if (!ALLOWED_PATTERN_TYPES.includes(type)) {
      throw new Error(`Invalid pattern type "${type}". Allowed: ${ALLOWED_PATTERN_TYPES.join(', ')}`);
    }
    const db = await getDb();

    // Check for duplicate
    const existing = await db.exec(
      `SELECT id FROM patterns WHERE project_id = ? AND title = ? AND is_active = 1`,
      [projectId, title]
    );
    if (existing.length > 0 && existing[0].values.length > 0) {
      // Update existing
      const id = existing[0].values[0][0];
      await db.run(
        `UPDATE patterns SET times_referenced = times_referenced + 1, updated_at = CURRENT_TIMESTAMP, confidence = MIN(confidence + 0.1, 1.0) WHERE id = ?`,
        [id]
      );
      return id;
    }

    await db.run(
      `INSERT INTO patterns (project_id, type, title, description, source_prompt_id, confidence) VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, type, title, description, sourcePromptId, confidence]
    );

    const idResult = await db.exec(`SELECT last_insert_rowid()`);
    const patternId = idResult[0].values[0][0];

    try {
      await db.run(`INSERT INTO patterns_fts (rowid, title, description) VALUES (?, ?, ?)`,
        [patternId, title, description || '']);
    } catch (e) { /* non-critical */ }

    return patternId;
  }

  async getPatterns(projectId, type = null) {
    const db = await getDb();
    let sql = `SELECT id, type, title, description, confidence, times_referenced, created_at, updated_at
               FROM patterns WHERE project_id = ? AND is_active = 1`;
    const params = [projectId];

    if (type) {
      sql += ` AND type = ?`;
      params.push(type);
    }

    sql += ` ORDER BY confidence DESC, times_referenced DESC`;

    const result = await db.exec(sql, params);
    if (!result.length) return [];
    return result[0].values.map(row => ({
      id: row[0], type: row[1], title: row[2], description: row[3],
      confidence: row[4], times_referenced: row[5],
      created_at: row[6], updated_at: row[7]
    }));
  }

  async searchPatterns(query) {
    const db = await getDb();
    // Use ILIKE for PostgreSQL instead of FTS5 MATCH
    const result = await db.exec(
      `SELECT id, project_id, type, title, description, confidence
       FROM patterns
       WHERE is_active = 1 AND (title ILIKE ? OR description ILIKE ?)
       ORDER BY confidence DESC LIMIT 20`,
      [`%${query}%`, `%${query}%`]
    );
    if (!result.length) return [];
    return result[0].values.map(row => ({
      id: row[0], project_id: row[1], type: row[2],
      title: row[3], description: row[4], confidence: row[5]
    }));
  }

  async getPatternById(patternId) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT id, project_id, type, title, description, confidence, times_referenced, is_active, created_at, updated_at
       FROM patterns WHERE id = ?`,
      [patternId]
    );
    if (!result.length || !result[0].values.length) return null;
    const row = result[0].values[0];
    return {
      id: row[0], project_id: row[1], type: row[2], title: row[3],
      description: row[4], confidence: row[5], times_referenced: row[6],
      is_active: row[7], created_at: row[8], updated_at: row[9]
    };
  }

  async updatePattern(patternId, updates) {
    if (updates.type !== undefined && !ALLOWED_PATTERN_TYPES.includes(updates.type)) {
      throw new Error(`Invalid pattern type "${updates.type}". Allowed: ${ALLOWED_PATTERN_TYPES.join(', ')}`);
    }
    const db = await getDb();
    const fields = [];
    const params = [];

    if (updates.type !== undefined) { fields.push('type = ?'); params.push(updates.type); }
    if (updates.title !== undefined) { fields.push('title = ?'); params.push(updates.title); }
    if (updates.description !== undefined) { fields.push('description = ?'); params.push(updates.description); }
    if (updates.confidence !== undefined) { fields.push('confidence = ?'); params.push(updates.confidence); }

    if (fields.length === 0) return;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(patternId);

    await db.run(`UPDATE patterns SET ${fields.join(', ')} WHERE id = ?`, params);
  }

  async deactivatePattern(patternId) {
    const db = await getDb();
    await db.run(`UPDATE patterns SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [patternId]);
  }

  async referencePattern(patternId) {
    const db = await getDb();
    await db.run(
      `UPDATE patterns SET times_referenced = times_referenced + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [patternId]
    );
  }
}

module.exports = new PatternService();
