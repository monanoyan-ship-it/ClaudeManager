const { getDb } = require('../src/db/init');

(async () => {
  const db = await getDb();

  // Check tool_uses file paths to identify projects
  const tools = db.exec('SELECT DISTINCT file_path FROM tool_uses WHERE file_path IS NOT NULL');
  if (tools.length) {
    const paths = tools[0].values.map(r => r[0]).filter(Boolean);
    const projects = {};
    for (const p of paths) {
      const norm = p.replace(/\\/g, '/');
      // Extract project folder from path
      const match = norm.match(/source\/repos\/([^/]+\/[^/]+)/i);
      if (match) {
        projects[match[1]] = (projects[match[1]] || 0) + 1;
      } else {
        const match2 = norm.match(/repos\/([^/]+\/[^/]+)/i);
        if (match2) projects[match2[1]] = (projects[match2[1]] || 0) + 1;
      }
    }
    console.log('Projects found in tool_uses file_paths:');
    for (const [name, count] of Object.entries(projects)) {
      console.log(`  ${name}: ${count} tool_uses`);
    }
  }

  // Check all data counts
  console.log('\nAll data under project_id=2:');
  const counts = db.exec(`
    SELECT
      (SELECT COUNT(*) FROM prompts WHERE project_id=2),
      (SELECT COUNT(*) FROM tool_uses WHERE project_id=2),
      (SELECT COUNT(*) FROM sessions WHERE project_id=2),
      (SELECT COUNT(*) FROM patterns WHERE project_id=2)
  `);
  if (counts.length) {
    const r = counts[0].values[0];
    console.log(`  prompts: ${r[0]}, tool_uses: ${r[1]}, sessions: ${r[2]}, patterns: ${r[3]}`);
  }

  // Show all tool_uses without file_path
  const noPath = db.exec('SELECT COUNT(*) FROM tool_uses WHERE file_path IS NULL AND project_id=2');
  if (noPath.length) console.log(`  tool_uses without file_path: ${noPath[0].values[0][0]}`);

  // Show prompts content to identify project
  console.log('\nPrompt contents (to identify project):');
  const prompts = db.exec('SELECT id, content, created_at FROM prompts WHERE project_id=2 ORDER BY id');
  if (prompts.length) {
    for (const row of prompts[0].values) {
      console.log(`  id=${row[0]} [${row[2]}]: ${String(row[1]).substring(0, 80)}...`);
    }
  }
})();
