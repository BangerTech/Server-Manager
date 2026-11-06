-- 0001_init.sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  auth_type TEXT NOT NULL,
  secret_encrypted BLOB NOT NULL,
  passphrase_encrypted BLOB,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  credential_id TEXT,
  color TEXT NOT NULL DEFAULT '#6366f1',
  icon TEXT NOT NULL DEFAULT 'server',
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  host_key_sha256 TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (credential_id) REFERENCES credentials(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS server_snapshots (
  server_id TEXT PRIMARY KEY,
  collected_at INTEGER NOT NULL,
  online INTEGER NOT NULL,
  error TEXT,
  os_name TEXT,
  os_version TEXT,
  os_pretty TEXT,
  kernel TEXT,
  hostname TEXT,
  uptime_since TEXT,
  cpu_cores INTEGER,
  load_1 REAL,
  load_5 REAL,
  load_15 REAL,
  mem_total INTEGER,
  mem_used INTEGER,
  disk_total INTEGER,
  disk_used INTEGER,
  reboot_required INTEGER,
  apt_upgradable INTEGER,
  apt_security INTEGER,
  apt_list TEXT,
  docker_version TEXT,
  raw_json TEXT,
  FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS image_checks (
  image_ref TEXT PRIMARY KEY,
  local_digest TEXT,
  remote_digest TEXT,
  update_available INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER NOT NULL,
  error TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  type TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  exit_code INTEGER,
  log TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_jobs_server ON jobs(server_id, started_at DESC);

CREATE TABLE IF NOT EXISTS known_hosts (
  host TEXT PRIMARY KEY,
  key_type TEXT NOT NULL,
  key_sha256 TEXT NOT NULL,
  seen_at INTEGER NOT NULL
);
