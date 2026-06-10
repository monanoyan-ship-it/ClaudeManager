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

-- Versions (changelog / release tracking)
CREATE TABLE IF NOT EXISTS versions (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  version TEXT NOT NULL,
  title TEXT NOT NULL,
  changes TEXT,
  released_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI Chat conversations
CREATE TABLE IF NOT EXISTS ai_chats (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  topic TEXT NOT NULL,
  role_a TEXT NOT NULL DEFAULT 'AI-A',
  role_b TEXT NOT NULL DEFAULT 'AI-B',
  system_a TEXT,
  system_b TEXT,
  summary TEXT,
  status TEXT DEFAULT 'active',
  max_turns INTEGER DEFAULT 100,
  turn_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AI Chat messages
CREATE TABLE IF NOT EXISTS ai_messages (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER REFERENCES ai_chats(id),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  reply_to INTEGER DEFAULT NULL,
  read_by_a INTEGER DEFAULT 0,
  read_by_b INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id);
CREATE INDEX IF NOT EXISTS idx_versions_version ON versions(version);
CREATE INDEX IF NOT EXISTS idx_ai_chats_project ON ai_chats(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_chats_status ON ai_chats(status);
CREATE INDEX IF NOT EXISTS idx_ai_messages_chat ON ai_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_ai_messages_turn ON ai_messages(chat_id, turn_number);

-- Migration: add read tracking columns to existing ai_messages tables
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS reply_to INTEGER DEFAULT NULL;
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS read_by_a INTEGER DEFAULT 0;
ALTER TABLE ai_messages ADD COLUMN IF NOT EXISTS read_by_b INTEGER DEFAULT 0;
ALTER TABLE ai_chats ADD COLUMN IF NOT EXISTS archive_vote_a INTEGER DEFAULT 0;
ALTER TABLE ai_chats ADD COLUMN IF NOT EXISTS archive_vote_b INTEGER DEFAULT 0
