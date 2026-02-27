const { getDb, save } = require('../db/init');

// --- Phases ---

async function getPhases(projectId) {
  const db = await getDb();
  const result = await db.exec(`
    SELECT p.id, p.phase_no, p.title, p.status, p.sort_order, p.created_at, p.updated_at,
      (SELECT COUNT(*) FROM tasks WHERE phase_id = p.id) as task_count,
      (SELECT COUNT(*) FROM tasks WHERE phase_id = p.id AND status = 'completed') as completed_count
    FROM phases p
    WHERE p.project_id = ?
    ORDER BY p.sort_order, p.phase_no
  `, [projectId]);

  if (!result.length) return [];
  return result[0].values.map(row => ({
    id: row[0], phase_no: row[1], title: row[2], status: row[3],
    sort_order: row[4], created_at: row[5], updated_at: row[6],
    task_count: row[7], completed_count: row[8]
  }));
}

async function getPhaseWithTasks(phaseId) {
  const db = await getDb();
  const phaseResult = await db.exec(
    'SELECT id, project_id, phase_no, title, status, sort_order, created_at, updated_at FROM phases WHERE id = ?',
    [phaseId]
  );
  if (!phaseResult.length || !phaseResult[0].values.length) return null;

  const row = phaseResult[0].values[0];
  const phase = {
    id: row[0], project_id: row[1], phase_no: row[2], title: row[3],
    status: row[4], sort_order: row[5], created_at: row[6], updated_at: row[7],
    tasks: []
  };

  const tasksResult = await db.exec(`
    SELECT id, task_no, title, detail, risks, status, completed_at, sort_order, created_at, updated_at, phase_id
    FROM tasks WHERE phase_id = ? ORDER BY sort_order, task_no
  `, [phaseId]);

  if (tasksResult.length) {
    phase.tasks = tasksResult[0].values.map(r => ({
      id: r[0], task_no: r[1], title: r[2], detail: r[3], risks: r[4],
      status: r[5], completed_at: r[6], sort_order: r[7], created_at: r[8], updated_at: r[9],
      phase_id: r[10]
    }));
  }

  return phase;
}

async function createPhase(projectId, phaseNo, title) {
  const db = await getDb();
  const maxOrder = await db.exec('SELECT COALESCE(MAX(sort_order), -1) FROM phases WHERE project_id = ?', [projectId]);
  const nextOrder = (maxOrder.length ? maxOrder[0].values[0][0] : -1) + 1;

  await db.run(
    'INSERT INTO phases (project_id, phase_no, title, sort_order) VALUES (?, ?, ?, ?)',
    [projectId, phaseNo, title, nextOrder]
  );
  const idResult = await db.exec('SELECT last_insert_rowid()');
  const id = idResult[0].values[0][0];
  return id;
}

async function updatePhase(phaseId, updates) {
  const db = await getDb();
  const fields = [];
  const values = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.phase_no !== undefined) { fields.push('phase_no = ?'); values.push(updates.phase_no); }
  if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(updates.sort_order); }

  if (!fields.length) return;
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(phaseId);

  await db.run(`UPDATE phases SET ${fields.join(', ')} WHERE id = ?`, values);
}

async function deletePhase(phaseId) {
  const db = await getDb();
  await db.run('DELETE FROM tasks WHERE phase_id = ?', [phaseId]);
  await db.run('DELETE FROM phases WHERE id = ?', [phaseId]);
}

// --- Tasks ---

async function getTasks(projectId, phaseId) {
  const db = await getDb();
  let sql = `SELECT id, phase_id, task_no, title, detail, risks, status, completed_at, sort_order, created_at, updated_at
    FROM tasks WHERE project_id = ?`;
  const params = [projectId];

  if (phaseId) {
    sql += ' AND phase_id = ?';
    params.push(phaseId);
  }
  sql += ' ORDER BY sort_order, task_no';

  const result = await db.exec(sql, params);
  if (!result.length) return [];
  return result[0].values.map(r => ({
    id: r[0], phase_id: r[1], task_no: r[2], title: r[3], detail: r[4], risks: r[5],
    status: r[6], completed_at: r[7], sort_order: r[8], created_at: r[9], updated_at: r[10]
  }));
}

async function createTask(phaseId, projectId, taskNo, title, detail, risks) {
  const db = await getDb();
  const maxOrder = await db.exec('SELECT COALESCE(MAX(sort_order), -1) FROM tasks WHERE phase_id = ?', [phaseId]);
  const nextOrder = (maxOrder.length ? maxOrder[0].values[0][0] : -1) + 1;

  await db.run(
    'INSERT INTO tasks (phase_id, project_id, task_no, title, detail, risks, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [phaseId, projectId, taskNo, title, detail || null, risks || null, nextOrder]
  );
  const idResult = await db.exec('SELECT last_insert_rowid()');
  const id = idResult[0].values[0][0];
  return id;
}

async function updateTask(taskId, updates) {
  const db = await getDb();
  const fields = [];
  const values = [];

  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.detail !== undefined) { fields.push('detail = ?'); values.push(updates.detail); }
  if (updates.risks !== undefined) { fields.push('risks = ?'); values.push(updates.risks); }
  if (updates.task_no !== undefined) { fields.push('task_no = ?'); values.push(updates.task_no); }
  if (updates.sort_order !== undefined) { fields.push('sort_order = ?'); values.push(updates.sort_order); }
  if (updates.phase_id !== undefined) { fields.push('phase_id = ?'); values.push(updates.phase_id); }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
    if (updates.status === 'completed') {
      fields.push('completed_at = CURRENT_TIMESTAMP');
    } else {
      fields.push('completed_at = NULL');
    }
  }

  if (!fields.length) return;
  fields.push('updated_at = CURRENT_TIMESTAMP');
  values.push(taskId);

  await db.run(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`, values);
}

async function deleteTask(taskId) {
  const db = await getDb();
  await db.run('DELETE FROM tasks WHERE id = ?', [taskId]);
}

// --- Roadmap ---

async function getRoadmapSummary(projectId) {
  const phases = await getPhases(projectId);
  if (!phases.length) return [];

  const db = await getDb();
  const tasksResult = await db.exec(`
    SELECT id, phase_id, task_no, title, status
    FROM tasks WHERE project_id = ?
    ORDER BY sort_order, task_no
  `, [projectId]);

  const tasksByPhase = {};
  if (tasksResult.length) {
    for (const r of tasksResult[0].values) {
      const phaseId = r[1];
      if (!tasksByPhase[phaseId]) tasksByPhase[phaseId] = [];
      tasksByPhase[phaseId].push({
        id: r[0], task_no: r[2], title: r[3], status: r[4]
      });
    }
  }

  return phases.map(p => ({
    ...p,
    tasks: tasksByPhase[p.id] || []
  }));
}

async function getRoadmap(projectId) {
  const phases = await getPhases(projectId);
  const result = [];
  for (const phase of phases) {
    const full = await getPhaseWithTasks(phase.id);
    result.push(full);
  }
  return result;
}

async function getRoadmapStats(projectId) {
  const db = await getDb();
  const result = await db.exec(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
      SUM(CASE WHEN status = 'planned' THEN 1 ELSE 0 END) as planned,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
    FROM tasks WHERE project_id = ?
  `, [projectId]);

  if (!result.length || !result[0].values.length) {
    return { total: 0, completed: 0, in_progress: 0, planned: 0, cancelled: 0, percent: 0 };
  }
  const row = result[0].values[0];
  const total = parseInt(row[0]) || 0;
  const completed = parseInt(row[1]) || 0;
  return {
    total,
    completed,
    in_progress: parseInt(row[2]) || 0,
    planned: parseInt(row[3]) || 0,
    cancelled: parseInt(row[4]) || 0,
    percent: total > 0 ? Math.round((completed / total) * 100) : 0
  };
}

async function importFromXml(projectId, xmlContent) {
  const phases = [];
  const fazRegex = /<Faz\s+([^>]*)>([\s\S]*?)<\/Faz>/gi;
  let fazMatch;

  while ((fazMatch = fazRegex.exec(xmlContent)) !== null) {
    const attrs = fazMatch[1];
    const body = fazMatch[2];

    const noMatch = /no="([^"]*)"/.exec(attrs);
    const adMatch = /ad="([^"]*)"/.exec(attrs);
    const durumMatch = /durum="([^"]*)"/.exec(attrs);

    const phase = {
      phase_no: noMatch ? noMatch[1] : '',
      title: adMatch ? adMatch[1] : '',
      status: mapStatus(durumMatch ? durumMatch[1] : 'planned'),
      tasks: []
    };

    const gorevRegex = /<Gorev\s+([^>]*)>([\s\S]*?)<\/Gorev>/gi;
    let gorevMatch;

    while ((gorevMatch = gorevRegex.exec(body)) !== null) {
      const gAttrs = gorevMatch[1];
      const gBody = gorevMatch[2];

      const gNoMatch = /no="([^"]*)"/.exec(gAttrs);
      const gDurumMatch = /durum="([^"]*)"/.exec(gAttrs);

      const adEl = /<Ad>([\s\S]*?)<\/Ad>/i.exec(gBody);
      const detayEl = /<Detay>([\s\S]*?)<\/Detay>/i.exec(gBody);
      const riskEl = /<Riskler>([\s\S]*?)<\/Riskler>/i.exec(gBody);

      phase.tasks.push({
        task_no: gNoMatch ? gNoMatch[1] : '',
        title: adEl ? adEl[1].trim() : '',
        detail: detayEl ? detayEl[1].trim() : null,
        risks: riskEl ? riskEl[1].trim() : null,
        status: mapStatus(gDurumMatch ? gDurumMatch[1] : 'planned')
      });
    }

    phases.push(phase);
  }

  let phaseCount = 0;
  let taskCount = 0;

  for (const phase of phases) {
    const phaseId = await createPhase(projectId, phase.phase_no, phase.title);
    if (phase.status !== 'planned') {
      await updatePhase(phaseId, { status: phase.status });
    }
    phaseCount++;

    for (const task of phase.tasks) {
      const taskId = await createTask(phaseId, projectId, task.task_no, task.title, task.detail, task.risks);
      if (task.status !== 'planned') {
        await updateTask(taskId, { status: task.status });
      }
      taskCount++;
    }
  }

  return { phases: phaseCount, tasks: taskCount };
}

function mapStatus(turkishStatus) {
  const map = {
    'tamamlandi': 'completed',
    'devam_ediyor': 'in_progress',
    'devam ediyor': 'in_progress',
    'iptal': 'cancelled',
    'planli': 'planned',
    'planned': 'planned',
    'in_progress': 'in_progress',
    'completed': 'completed',
    'cancelled': 'cancelled'
  };
  return map[turkishStatus.toLowerCase()] || 'planned';
}

module.exports = {
  getPhases,
  getPhaseWithTasks,
  createPhase,
  updatePhase,
  deletePhase,
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  getRoadmapSummary,
  getRoadmap,
  getRoadmapStats,
  importFromXml
};
