const { getDb, save } = require('../db/init');

class NoteService {
  async getNotes(projectId, category = null) {
    const db = await getDb();
    let sql = `SELECT id, project_id, title, content, category, is_pinned, created_at, updated_at
               FROM project_notes WHERE project_id = ?`;
    const params = [projectId];

    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }

    sql += ' ORDER BY is_pinned DESC, updated_at DESC';

    const result = await db.exec(sql, params);
    if (!result.length) return [];
    return result[0].values.map(row => ({
      id: row[0], project_id: row[1], title: row[2], content: row[3],
      category: row[4], is_pinned: row[5], created_at: row[6], updated_at: row[7]
    }));
  }

  async getNoteById(noteId) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT id, project_id, title, content, category, is_pinned, created_at, updated_at
       FROM project_notes WHERE id = ?`, [noteId]
    );
    if (!result.length || !result[0].values.length) return null;
    const row = result[0].values[0];
    return {
      id: row[0], project_id: row[1], title: row[2], content: row[3],
      category: row[4], is_pinned: row[5], created_at: row[6], updated_at: row[7]
    };
  }

  async createNote(projectId, title, content, category) {
    const db = await getDb();
    await db.run(
      `INSERT INTO project_notes (project_id, title, content, category) VALUES (?, ?, ?, ?)`,
      [projectId, title, content || null, category || null]
    );
    const result = await db.exec('SELECT last_insert_rowid()');
    const id = result[0].values[0][0];
    return id;
  }

  async updateNote(noteId, updates) {
    const db = await getDb();
    const fields = [];
    const params = [];

    for (const key of ['title', 'content', 'category', 'is_pinned']) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(updates[key]);
      }
    }

    if (!fields.length) return;

    fields.push("updated_at = CURRENT_TIMESTAMP");
    params.push(noteId);

    await db.run(`UPDATE project_notes SET ${fields.join(', ')} WHERE id = ?`, params);
  }

  async deleteNote(noteId) {
    const db = await getDb();
    await db.run('DELETE FROM project_notes WHERE id = ?', [noteId]);
  }

  async getPinnedNotes(projectId) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT id, title, content, category FROM project_notes
       WHERE project_id = ? AND is_pinned = 1 ORDER BY updated_at DESC`,
      [projectId]
    );
    if (!result.length) return [];
    return result[0].values.map(row => ({
      id: row[0], title: row[1], content: row[2], category: row[3]
    }));
  }
}

module.exports = new NoteService();
