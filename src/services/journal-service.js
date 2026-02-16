const { getDb } = require('../db/init');

class JournalService {
  async getEntries(projectId, category = null, startDate = null, endDate = null) {
    const db = await getDb();
    let sql = `SELECT id, project_id, entry_date, title, content, category, tags, created_at, updated_at
               FROM journal WHERE project_id = ?`;
    const params = [projectId];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (startDate) {
      sql += ' AND entry_date >= ?';
      params.push(startDate);
    }
    if (endDate) {
      sql += ' AND entry_date <= ?';
      params.push(endDate);
    }

    sql += ' ORDER BY entry_date DESC, created_at DESC';

    const result = await db.exec(sql, params);
    if (!result.length) return [];
    return result[0].values.map(row => ({
      id: row[0], project_id: row[1], entry_date: row[2], title: row[3],
      content: row[4], category: row[5], tags: row[6],
      created_at: row[7], updated_at: row[8]
    }));
  }

  async getEntryById(entryId) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT id, project_id, entry_date, title, content, category, tags, created_at, updated_at
       FROM journal WHERE id = ?`, [entryId]
    );
    if (!result.length || !result[0].values.length) return null;
    const row = result[0].values[0];
    return {
      id: row[0], project_id: row[1], entry_date: row[2], title: row[3],
      content: row[4], category: row[5], tags: row[6],
      created_at: row[7], updated_at: row[8]
    };
  }

  async createEntry(projectId, title, content, category, tags, entryDate = null) {
    const db = await getDb();
    const date = entryDate || new Date().toISOString().split('T')[0];
    await db.run(
      `INSERT INTO journal (project_id, entry_date, title, content, category, tags) VALUES (?, ?, ?, ?, ?, ?)`,
      [projectId, date, title, content || null, category || null, tags || null]
    );
    const result = await db.exec('SELECT last_insert_rowid()');
    return result[0].values[0][0];
  }

  async updateEntry(entryId, updates) {
    const db = await getDb();
    const fields = [];
    const params = [];

    for (const key of ['title', 'content', 'category', 'tags', 'entry_date']) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(updates[key]);
      }
    }

    if (!fields.length) return;

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(entryId);

    await db.run(`UPDATE journal SET ${fields.join(', ')} WHERE id = ?`, params);
  }

  async deleteEntry(entryId) {
    const db = await getDb();
    await db.run('DELETE FROM journal WHERE id = ?', [entryId]);
  }
}

module.exports = new JournalService();
