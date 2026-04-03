-- pack_tasks: task queue
CREATE TABLE IF NOT EXISTS pack_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  status TEXT DEFAULT 'pending',   -- pending | assigned | complete | failed | escalated
  domain TEXT NOT NULL,            -- prowl | research | lucid | general
  input JSONB NOT NULL,
  assigned_to TEXT,                -- agent name: lumen | vex | mira | coda | sable
  output JSONB,
  score JSONB,                     -- {correctness, efficiency, handoff, composite}
  escalated BOOLEAN DEFAULT false
);

-- pack_agent_profiles: running performance per agent
CREATE TABLE IF NOT EXISTS pack_agent_profiles (
  agent_id TEXT PRIMARY KEY,       -- lumen | vex | mira | coda | sable
  model TEXT NOT NULL,
  scores_by_domain JSONB DEFAULT '{}',
  total_tasks INTEGER DEFAULT 0,
  avg_composite_score FLOAT DEFAULT 0,
  last_active TIMESTAMPTZ
);

-- pack_scores: full score history for trend analysis
CREATE TABLE IF NOT EXISTS pack_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES pack_tasks(id),
  agent_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  correctness FLOAT NOT NULL,
  efficiency FLOAT NOT NULL,
  handoff FLOAT NOT NULL,
  composite FLOAT NOT NULL,
  scored_at TIMESTAMPTZ DEFAULT now()
);
