const { getDb, save } = require('../db/init');

class PatternService {
  async addPattern(projectId, type, title, description, sourcePromptId = null, confidence = 1.0) {
    const db = await getDb();

    // Check for duplicate
    const existing = db.exec(
      `SELECT id FROM patterns WHERE project_id = ? AND title = ? AND is_active = 1`,
      [projectId, title]
    );
    if (existing.length > 0 && existing[0].values.length > 0) {
      // Update existing
      const id = existing[0].values[0][0];
      db.run(
        `UPDATE patterns SET times_referenced = times_referenced + 1, updated_at = CURRENT_TIMESTAMP, confidence = MIN(confidence + 0.1, 1.0) WHERE id = ?`,
        [id]
      );
      save();
      return id;
    }

    db.run(
      `INSERT INTO patterns (project_id, type, title, description, source_prompt_id, confidence) VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, type, title, description, sourcePromptId, confidence]
    );

    const idResult = db.exec(`SELECT last_insert_rowid()`);
    const patternId = idResult[0].values[0][0];

    try {
      db.run(`INSERT INTO patterns_fts (rowid, title, description) VALUES (?, ?, ?)`,
        [patternId, title, description || '']);
    } catch (e) { /* non-critical */ }

    save();
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

    const result = db.exec(sql, params);
    if (!result.length) return [];
    return result[0].values.map(row => ({
      id: row[0], type: row[1], title: row[2], description: row[3],
      confidence: row[4], times_referenced: row[5],
      created_at: row[6], updated_at: row[7]
    }));
  }

  async searchPatterns(query) {
    const db = await getDb();
    const result = db.exec(
      `SELECT p.id, p.project_id, p.type, p.title, p.description, p.confidence
       FROM patterns_fts fts
       JOIN patterns p ON p.id = fts.rowid
       WHERE patterns_fts MATCH ? AND p.is_active = 1
       ORDER BY rank`,
      [query]
    );
    if (!result.length) return [];
    return result[0].values.map(row => ({
      id: row[0], project_id: row[1], type: row[2],
      title: row[3], description: row[4], confidence: row[5]
    }));
  }

  async deactivatePattern(patternId) {
    const db = await getDb();
    db.run(`UPDATE patterns SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [patternId]);
    save();
  }

  async referencePattern(patternId) {
    const db = await getDb();
    db.run(
      `UPDATE patterns SET times_referenced = times_referenced + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [patternId]
    );
    save();
  }
}

module.exports = new PatternService();
