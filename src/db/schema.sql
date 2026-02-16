-- Projects
CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  session_id TEXT NOT NULL,
  started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP,
  summary TEXT
);

-- Prompt logs
CREATE TABLE IF NOT EXISTS prompts (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id),
  project_id INTEGER REFERENCES projects(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  category TEXT,
  tags TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tool usage logs
CREATE TABLE IF NOT EXISTS tool_uses (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id),
  project_id INTEGER REFERENCES projects(id),
  tool_name TEXT NOT NULL,
  tool_input TEXT,
  file_path TEXT,
  success INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Learned patterns / rules
CREATE TABLE IF NOT EXISTS patterns (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_prompt_id INTEGER REFERENCES prompts(id),
  confidence DOUBLE PRECISION DEFAULT 1.0,
  times_referenced INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Phases (roadmap top-level groups)
CREATE TABLE IF NOT EXISTS phases (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  phase_no TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'planned',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tasks (work items under phases)
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  phase_id INTEGER REFERENCES phases(id),
  project_id INTEGER REFERENCES projects(id),
  task_no TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  risks TEXT,
  status TEXT DEFAULT 'planned',
  completed_at TIMESTAMP,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Project notes
CREATE TABLE IF NOT EXISTS project_notes (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  title TEXT NOT NULL,
  content TEXT,
  category TEXT,
  is_pinned INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Journal entries
CREATE TABLE IF NOT EXISTS journal (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  entry_date DATE DEFAULT CURRENT_DATE,
  title TEXT NOT NULL,
  content TEXT,
  category TEXT,
  tags TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_prompts_session ON prompts(session_id);
CREATE INDEX IF NOT EXISTS idx_prompts_project ON prompts(project_id);
CREATE INDEX IF NOT EXISTS idx_prompts_created ON prompts(created_at);
CREATE INDEX IF NOT EXISTS idx_tool_uses_session ON tool_uses(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_uses_project ON tool_uses(project_id);
CREATE INDEX IF NOT EXISTS idx_patterns_project ON patterns(project_id);
CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(type);
CREATE INDEX IF NOT EXISTS idx_phases_project ON phases(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_phase ON tasks(phase_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_project_notes_project ON project_notes(project_id);
CREATE INDEX IF NOT EXISTS idx_journal_project ON journal(project_id);
CREATE INDEX IF NOT EXISTS idx_journal_date ON journal(entry_date);
