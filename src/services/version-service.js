const { getDb, save } = require('../db/init');

class VersionService {
  async getVersions(projectId) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT id, project_id, version, title, changes, released_at, created_at
       FROM versions WHERE project_id = ? ORDER BY created_at DESC`,
      [projectId]
    );
    if (!result.length) return [];
    return result[0].values.map(row => ({
      id: row[0], project_id: row[1], version: row[2], title: row[3],
      changes: row[4], released_at: row[5], created_at: row[6]
    }));
  }

  async getVersionById(versionId) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT id, project_id, version, title, changes, released_at, created_at
       FROM versions WHERE id = ?`, [versionId]
    );
    if (!result.length || !result[0].values.length) return null;
    const row = result[0].values[0];
    return {
      id: row[0], project_id: row[1], version: row[2], title: row[3],
      changes: row[4], released_at: row[5], created_at: row[6]
    };
  }

  async createVersion(projectId, version, title, changes, releasedAt) {
    const db = await getDb();
    await db.run(
      `INSERT INTO versions (project_id, version, title, changes, released_at) VALUES (?, ?, ?, ?, ?)`,
      [projectId, version, title, changes || null, releasedAt || null]
    );
    const result = await db.exec('SELECT last_insert_rowid()');
    return result[0].values[0][0];
  }

  async updateVersion(versionId, updates) {
    const db = await getDb();
    const fields = [];
    const params = [];

    for (const key of ['version', 'title', 'changes', 'released_at']) {
      if (updates[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(updates[key]);
      }
    }

    if (!fields.length) return;

    params.push(versionId);
    await db.run(`UPDATE versions SET ${fields.join(', ')} WHERE id = ?`, params);
  }

  async deleteVersion(versionId) {
    const db = await getDb();
    await db.run('DELETE FROM versions WHERE id = ?', [versionId]);
  }

  async getLatestVersion(projectId) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT id, version, title, changes, released_at, created_at
       FROM versions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`,
      [projectId]
    );
    if (!result.length || !result[0].values.length) return null;
    const row = result[0].values[0];
    return {
      id: row[0], version: row[1], title: row[2],
      changes: row[3], released_at: row[4], created_at: row[5]
    };
  }
}

module.exports = new VersionService();
