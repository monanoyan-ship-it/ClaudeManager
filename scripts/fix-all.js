/**
 * Fix script:
 * 1. Normalize all existing project paths in DB
 * 2. Merge duplicates that appear after normalization
 * 3. Reassign tool_uses to correct projects based on file_path
 * 4. Reassign prompts based on content analysis
 */
const { getDb, save } = require('../src/db/init');
const { normalizePath } = require('../src/utils/path-normalizer');

const PROJECT_PATHS = {
  'Turrehberi': 'c:/Users/Ahmet/source/repos/monanoyan-ship-it/Turrehberi',
  'callcenter': 'c:/Users/Ahmet/source/repos/monanoyan-ship-it/callcenter',
  'ClaudeManager': 'c:/Users/Ahmet/source/repos/monanoyan-ship-it/ClaudeManager',
  'ScretCustomer': 'c:/Users/Ahmet/source/repos/monanoyan-ship-it/ScretCustomer',
  'pdr_butce': 'c:/Users/Ahmet/source/repos/Gokhan/pdr_butce',
};

async function fix() {
  const db = await getDb();

  console.log('=== Step 1: Normalize existing project paths ===');
  const projects = db.exec('SELECT id, name, path FROM projects ORDER BY id');
  if (projects.length) {
    for (const row of projects[0].values) {
      const [id, name, path] = row;
      const normalized = normalizePath(path);
      if (path !== normalized) {
        console.log(`  id=${id}: "${path}" -> "${normalized}"`);
        db.run('UPDATE projects SET path = ? WHERE id = ?', [normalized, id]);
      }
    }
  }
  save();

  console.log('\n=== Step 2: Merge duplicates ===');
  const allProjects = db.exec('SELECT id, name, path FROM projects ORDER BY id');
  if (allProjects.length) {
    const groups = {};
    for (const row of allProjects[0].values) {
      const [id, name, path] = row;
      if (!groups[path]) groups[path] = [];
      groups[path].push({ id, name });
    }
    const tables = ['sessions', 'prompts', 'tool_uses', 'patterns'];
    for (const [path, group] of Object.entries(groups)) {
      if (group.length <= 1) continue;
      const canonical = group[0];
      for (const dup of group.slice(1)) {
        console.log(`  Merging id=${dup.id} ("${dup.name}") into id=${canonical.id}`);
        for (const table of tables) {
          db.run(`UPDATE ${table} SET project_id = ? WHERE project_id = ?`, [canonical.id, dup.id]);
        }
        db.run('DELETE FROM projects WHERE id = ?', [dup.id]);
      }
    }
  }
  save();

  console.log('\n=== Step 3: Recreate missing projects ===');
  for (const [name, path] of Object.entries(PROJECT_PATHS)) {
    const exists = db.exec('SELECT id FROM projects WHERE path = ?', [path]);
    if (!exists.length || !exists[0].values.length) {
      db.run('INSERT INTO projects (name, path) VALUES (?, ?)', [name, path]);
      console.log(`  Created: ${name} -> ${path}`);
    } else {
      console.log(`  Exists: ${name} (id=${exists[0].values[0][0]})`);
    }
  }
  save();

  console.log('\n=== Step 4: Reassign tool_uses by file_path ===');
  // Get project IDs
  const projMap = {};
  const projRows = db.exec('SELECT id, name, path FROM projects');
  if (projRows.length) {
    for (const row of projRows[0].values) {
      projMap[row[2]] = row[0]; // path -> id
    }
  }

  const toolUses = db.exec('SELECT id, file_path FROM tool_uses WHERE file_path IS NOT NULL');
  if (toolUses.length) {
    let moved = 0;
    for (const row of toolUses[0].values) {
      const [tuId, filePath] = row;
      const normFile = normalizePath(filePath);
      // Find which project this file belongs to
      for (const [projPath, projId] of Object.entries(projMap)) {
        if (normFile.startsWith(projPath + '/') || normFile.startsWith(projPath.replace(/\//g, '/') + '/')) {
          db.run('UPDATE tool_uses SET project_id = ? WHERE id = ?', [projId, tuId]);
          moved++;
          break;
        }
      }
    }
    console.log(`  Reassigned ${moved} tool_uses`);
  }

  console.log('\n=== Step 5: Reassign prompts ===');
  // prompt id=1 is about "Evaluation listesi" -> ScretCustomer
  const scId = db.exec("SELECT id FROM projects WHERE name = 'ScretCustomer'");
  if (scId.length && scId[0].values.length) {
    const scProjId = scId[0].values[0][0];
    db.run('UPDATE prompts SET project_id = ? WHERE id = 1', [scProjId]);
    console.log(`  prompt id=1 -> ScretCustomer`);
  }
  // Rest of prompts (id >= 3) are about ClaudeManager (docker, merge, etc.)
  const cmId = db.exec("SELECT id FROM projects WHERE name = 'ClaudeManager'");
  if (cmId.length && cmId[0].values.length) {
    const cmProjId = cmId[0].values[0][0];
    db.run('UPDATE prompts SET project_id = ? WHERE id >= 3', [cmProjId]);
    console.log(`  prompts id>=3 -> ClaudeManager`);
  }

  save();

  console.log('\n=== Final state ===');
  const final = db.exec(`
    SELECT p.id, p.name, p.path,
      (SELECT COUNT(*) FROM sessions WHERE project_id = p.id) as sessions,
      (SELECT COUNT(*) FROM prompts WHERE project_id = p.id) as prompts,
      (SELECT COUNT(*) FROM tool_uses WHERE project_id = p.id) as tools,
      (SELECT COUNT(*) FROM patterns WHERE project_id = p.id AND is_active = 1) as patterns
    FROM projects p ORDER BY p.name
  `);
  if (final.length) {
    for (const row of final[0].values) {
      console.log(`  id=${row[0]} ${row[1]}: ${row[3]}s / ${row[4]}p / ${row[5]}t / ${row[6]}pat  (${row[2]})`);
    }
  }
}

fix().catch(err => {
  console.error('Fix failed:', err);
  process.exit(1);
});
