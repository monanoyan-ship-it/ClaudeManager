const express = require('express');
const { getDb, startAutoSave, stopAutoSave } = require('./db/init');
const hookHandler = require('./hook-handler');

const PORT = process.env.PORT || 41847;

async function main() {
  // Initialize database
  await getDb();
  startAutoSave(5000);

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'claude-manager', version: '1.0.0' });
  });

  // Hook API routes
  app.use('/api/hooks', hookHandler);

  // Stats endpoint
  app.get('/api/stats', async (req, res) => {
    try {
      const db = await getDb();
      const projects = db.exec(`SELECT id, name, path FROM projects ORDER BY name`);
      const sessions = db.exec(`SELECT COUNT(*) FROM sessions`);
      const prompts = db.exec(`SELECT COUNT(*) FROM prompts`);
      const toolUses = db.exec(`SELECT COUNT(*) FROM tool_uses`);
      const patterns = db.exec(`SELECT COUNT(*) FROM patterns WHERE is_active = 1`);

      res.json({
        projects: projects.length > 0 ? projects[0].values.map(r => ({ id: r[0], name: r[1], path: r[2] })) : [],
        totals: {
          sessions: sessions.length > 0 ? sessions[0].values[0][0] : 0,
          prompts: prompts.length > 0 ? prompts[0].values[0][0] : 0,
          tool_uses: toolUses.length > 0 ? toolUses[0].values[0][0] : 0,
          patterns: patterns.length > 0 ? patterns[0].values[0][0] : 0
        }
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(PORT, () => {
    console.log(`ClaudeManager API running on port ${PORT}`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    stopAutoSave();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    stopAutoSave();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Failed to start ClaudeManager:', err);
  process.exit(1);
});
