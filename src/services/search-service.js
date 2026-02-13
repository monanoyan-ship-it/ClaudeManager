const { getDb } = require('../db/init');

class SearchService {
  async searchPrompts(query, projectId = null, limit = 50) {
    const db = await getDb();

    // Try FTS first
    try {
      let sql = `SELECT p.id, p.role, p.content, p.category, p.tags, p.created_at, pr.name as project_name
                 FROM prompts_fts fts
                 JOIN prompts p ON p.id = fts.rowid
                 LEFT JOIN projects pr ON pr.id = p.project_id
                 WHERE prompts_fts MATCH ?`;
      const params = [query];

      if (projectId) {
        sql += ` AND p.project_id = ?`;
        params.push(projectId);
      }

      sql += ` ORDER BY rank LIMIT ?`;
      params.push(limit);

      const result = db.exec(sql, params);
      if (result.length > 0) {
        return result[0].values.map(row => ({
          id: row[0], role: row[1], content: row[2], category: row[3],
          tags: row[4], created_at: row[5], project_name: row[6]
        }));
      }
    } catch (e) {
      // FTS query failed, fall through to LIKE
    }

    // Fallback to LIKE
    let sql = `SELECT p.id, p.role, p.content, p.category, p.tags, p.created_at, pr.name as project_name
               FROM prompts p
               LEFT JOIN projects pr ON pr.id = p.project_id
               WHERE p.content LIKE ?`;
    const params = [`%${query}%`];

    if (projectId) {
      sql += ` AND p.project_id = ?`;
      params.push(projectId);
    }

    sql += ` ORDER BY p.created_at DESC LIMIT ?`;
    params.push(limit);

    const result = db.exec(sql, params);
    if (!result.length) return [];
    return result[0].values.map(row => ({
      id: row[0], role: row[1], content: row[2], category: row[3],
      tags: row[4], created_at: row[5], project_name: row[6]
    }));
  }

  async searchByDateRange(projectId, startDate, endDate, limit = 100) {
    const db = await getDb();
    const result = db.exec(
      `SELECT p.id, p.role, p.content, p.category, p.tags, p.created_at
       FROM prompts p
       WHERE p.project_id = ? AND p.created_at BETWEEN ? AND ?
       ORDER BY p.created_at DESC LIMIT ?`,
      [projectId, startDate, endDate, limit]
    );
    if (!result.length) return [];
    return result[0].values.map(row => ({
      id: row[0], role: row[1], content: row[2], category: row[3],
      tags: row[4], created_at: row[5]
    }));
  }

  async getFrequentTopics(projectId, limit = 10) {
    const db = await getDb();
    const result = db.exec(
      `SELECT tags, COUNT(*) as cnt FROM prompts WHERE project_id = ? AND tags IS NOT NULL GROUP BY tags ORDER BY cnt DESC LIMIT ?`,
      [projectId, limit]
    );
    if (!result.length) return [];

    // Parse and aggregate tags
    const tagCounts = {};
    for (const row of result[0].values) {
      try {
        const tags = JSON.parse(row[0]);
        for (const tag of tags) {
          tagCounts[tag] = (tagCounts[tag] || 0) + row[1];
        }
      } catch (e) { /* skip unparseable */ }
    }

    return Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([tag, count]) => ({ tag, count }));
  }
}

module.exports = new SearchService();
