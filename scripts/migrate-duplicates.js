/**
 * One-time migration: merge duplicate projects caused by path format differences.
 * Normalizes paths and moves all data to the canonical (oldest) project entry.
 */
const { getDb, save } = require('../src/db/init');
const { normalizePath } = require('../src/utils/path-normalizer');

async function migrate() {
  const db = await getDb();

  // Get all projects
  const result = db.exec(`SELECT id, name, path FROM projects ORDER BY id ASC`);
  if (!result.length) {
    console.log('No projects found.');
    return;
  }

  const projects = result[0].values.map(r => ({ id: r[0], name: r[1], path: r[2] }));
  console.log(`Found ${projects.length} projects total.\n`);

  // Group by normalized path
  const groups = {};
  for (const p of projects) {
    const normalized = normalizePath(p.path);
    if (!groups[normalized]) groups[normalized] = [];
    groups[normalized].push(p);
  }

  const tables = ['sessions', 'prompts', 'tool_uses', 'patterns'];
  let mergeCount = 0;

  for (const [normalizedPath, group] of Object.entries(groups)) {
    if (group.length <= 1) continue;

    // Keep the oldest (lowest id) as canonical
    const canonical = group[0];
    const duplicates = group.slice(1);

    console.log(`\nMerging "${canonical.name}" (${group.length} entries):`);
    console.log(`  Canonical: id=${canonical.id}, path="${canonical.path}"`);

    for (const dup of duplicates) {
      console.log(`  Duplicate: id=${dup.id}, path="${dup.path}"`);

      // Move all related records to canonical project
      for (const table of tables) {
        const countResult = db.exec(
          `SELECT COUNT(*) FROM ${table} WHERE project_id = ?`, [dup.id]
        );
        const count = countResult.length ? countResult[0].values[0][0] : 0;
        if (count > 0) {
          db.run(`UPDATE ${table} SET project_id = ? WHERE project_id = ?`,
            [canonical.id, dup.id]);
          console.log(`    Moved ${count} rows from ${table}`);
        }
      }

      // Delete the duplicate project
      db.run(`DELETE FROM projects WHERE id = ?`, [dup.id]);
      console.log(`    Deleted project id=${dup.id}`);
      mergeCount++;
    }

    // Update canonical project path to normalized form
    db.run(`UPDATE projects SET path = ? WHERE id = ?`,
      [normalizedPath, canonical.id]);
    console.log(`  Updated canonical path to: "${normalizedPath}"`);
  }

  save();
  console.log(`\nDone! Merged ${mergeCount} duplicate(s).`);

  // Show final state
  const final = db.exec(`SELECT id, name, path FROM projects ORDER BY id`);
  if (final.length) {
    console.log('\nFinal projects:');
    for (const row of final[0].values) {
      console.log(`  id=${row[0]}, name="${row[1]}", path="${row[2]}"`);
    }
  }
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
