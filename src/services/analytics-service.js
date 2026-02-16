const { getDb } = require('../db/init');
const { detectFrustration } = require('../utils/analyzer');

class AnalyticsService {
  async getFrustrationTrends(projectId, days = 30) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT content, created_at FROM prompts
       WHERE project_id = ? AND role = 'user'
         AND created_at >= datetime('now', '-' || ? || ' days')
       ORDER BY created_at ASC`,
      [projectId, days]
    );
    if (!result.length) return [];

    // Group by date and calculate average frustration
    const dailyScores = {};
    for (const row of result[0].values) {
      const dateVal = row[1];
      const date = (dateVal instanceof Date) ? dateVal.toISOString().split('T')[0] : String(dateVal).split('T')[0].split(' ')[0];
      const score = detectFrustration(row[0]);
      if (!dailyScores[date]) {
        dailyScores[date] = { total: 0, count: 0 };
      }
      dailyScores[date].total += score;
      dailyScores[date].count++;
    }

    return Object.entries(dailyScores).map(([date, data]) => ({
      date,
      avg_frustration: Math.round((data.total / data.count) * 100) / 100,
      prompt_count: data.count
    }));
  }

  async getToolUsageBreakdown(projectId) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT tool_name, COUNT(*) as count, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success_count
       FROM tool_uses WHERE project_id = ?
       GROUP BY tool_name ORDER BY count DESC`,
      [projectId]
    );
    if (!result.length) return [];
    return result[0].values.map(row => ({
      tool_name: row[0],
      count: row[1],
      success_count: row[2],
      failure_count: row[1] - row[2]
    }));
  }

  async getCategoryDistribution(projectId) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT category, COUNT(*) as count FROM prompts
       WHERE project_id = ? AND category IS NOT NULL
       GROUP BY category ORDER BY count DESC`,
      [projectId]
    );
    if (!result.length) return [];
    return result[0].values.map(row => ({
      category: row[0],
      count: row[1]
    }));
  }

  async getPatternStats(projectId) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT type, COUNT(*) as count, AVG(confidence) as avg_confidence
       FROM patterns WHERE project_id = ? AND is_active = 1
       GROUP BY type ORDER BY count DESC`,
      [projectId]
    );
    if (!result.length) return [];
    return result[0].values.map(row => ({
      type: row[0],
      count: row[1],
      avg_confidence: Math.round(row[2] * 100) / 100
    }));
  }

  async getActivityTimeline(projectId, days = 30) {
    const db = await getDb();
    const result = await db.exec(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM prompts WHERE project_id = ?
         AND created_at >= datetime('now', '-' || ? || ' days')
       GROUP BY DATE(created_at) ORDER BY date ASC`,
      [projectId, days]
    );
    if (!result.length) return [];
    return result[0].values.map(row => ({
      date: (row[0] instanceof Date) ? row[0].toISOString().split('T')[0] : row[0],
      count: row[1]
    }));
  }
}

module.exports = new AnalyticsService();
