# Server-Manager

Modern Windows desktop app (Electron + React + TypeScript) to manage Linux home-lab servers over SSH. Scans the local network, shows OS/uptime/resources, lists Docker/Compose stacks, detects outdated apt packages and container images, and runs updates with live log streaming.

## Tech Stack
- Electron 33 + electron-vite
- React 18 + TypeScript + Vite
- Tailwind CSS v3 + shadcn-style components, lucide-react icons, framer-motion animations
- TanStack Query + Zustand
- `ssh2` for SSH (main process), xterm.js for terminal and live logs
- `better-sqlite3` for persistence (hand-written SQL, no ORM to keep dependency surface small)
- Electron `safeStorage` (Windows DPAPI) for encrypted credentials
- `electron-builder` -> NSIS installer

## Project Structure
```
src/
  main/            # Electron main process: SSH, scanner, collector, jobs, DB, IPC
  preload/         # typed bridge exposed to renderer
  renderer/        # React UI
  shared/          # types shared between main and renderer
```

## Features
1. **Network scan** of configurable subnet (default `192.168.2.0/24`), probing port 22 and common web ports.
2. **Manual server entry** with per-server credentials or a shared default credential.
3. **Collector** pulls OS, uptime, CPU/RAM/disk, `apt list --upgradable`, Docker version, `docker compose ls`, `docker ps`, `docker image inspect`, `docker stats` in a single SSH command returning JSON sections.
4. **Image update check** compares local `RepoDigest` with registry `Docker-Content-Digest` (Docker Hub, GHCR, LSCR, Quay) with caching.
5. **Jobs**: `apt update && apt upgrade -y`, per-stack `docker compose pull && up -d`, `docker image prune`, container start/stop/restart, host reboot - streamed live to xterm.js.
6. **Dashboard**: metrics, color-tagged server cards with resource bars.
7. **Server detail**: Overview, Stacks, Packages, Terminal, History tabs.
8. **Integrated xterm.js SSH terminal** per server.

## Database Schema

Database file: `%APPDATA%/Server Manager/server-manager.db` (SQLite via better-sqlite3).

### settings
| column | type    | notes                   |
|--------|---------|-------------------------|
| key    | TEXT PK | setting key             |
| value  | TEXT    | JSON-serialised value   |

Stores app-level config: `subnet`, `refreshMinutes`, `scanTimeoutMs`, `theme`, etc.

### credentials
| column                | type      | notes                                      |
|-----------------------|-----------|--------------------------------------------|
| id                    | TEXT PK   | crypto.randomUUID                                     |
| name                  | TEXT      | human label, e.g. "Default root"           |
| username              | TEXT      |                                            |
| auth_type             | TEXT      | `password` or `key`                        |
| secret_encrypted      | BLOB      | safeStorage-encrypted password or privkey  |
| passphrase_encrypted  | BLOB NULL | encrypted key passphrase                   |
| is_default            | INTEGER   | 0/1                                        |
| created_at            | INTEGER   | epoch ms                                   |

### servers
| column        | type    | notes                                         |
|---------------|---------|-----------------------------------------------|
| id            | TEXT PK | crypto.randomUUID                                        |
| name          | TEXT    | display name                                  |
| host          | TEXT    | ip or hostname                                |
| port          | INTEGER | default 22                                    |
| credential_id | TEXT FK | nullable - fallback to default                |
| color         | TEXT    | hex                                           |
| icon          | TEXT    | lucide icon name                              |
| tags          | TEXT    | JSON array                                    |
| notes         | TEXT    |                                               |
| sort_order    | INTEGER |                                               |
| host_key_sha256 | TEXT  | pinned SSH host key                           |
| created_at    | INTEGER | epoch ms                                      |

### server_snapshots
Latest collector result per server (upserted on `server_id`).

| column          | type    | notes                                    |
|-----------------|---------|------------------------------------------|
| server_id       | TEXT PK | FK servers.id                            |
| collected_at    | INTEGER |                                          |
| online          | INTEGER |                                          |
| error           | TEXT    | last error if offline                    |
| os_name         | TEXT    |                                          |
| os_version      | TEXT    |                                          |
| os_pretty       | TEXT    |                                          |
| kernel          | TEXT    |                                          |
| hostname        | TEXT    |                                          |
| uptime_since    | TEXT    | ISO ts                                   |
| cpu_cores       | INTEGER |                                          |
| load_1/5/15     | REAL    |                                          |
| mem_total       | INTEGER | bytes                                    |
| mem_used        | INTEGER | bytes                                    |
| disk_total      | INTEGER | bytes                                    |
| disk_used       | INTEGER | bytes                                    |
| reboot_required | INTEGER | 0/1                                      |
| apt_upgradable  | INTEGER | count                                    |
| apt_security    | INTEGER | count                                    |
| apt_list        | TEXT    | JSON array of package names              |
| docker_version  | TEXT    |                                          |
| raw_json        | TEXT    | full collector payload                   |

### compose_projects
| column       | type    | notes                      |
|--------------|---------|----------------------------|
| id           | TEXT PK | server_id + name           |
| server_id    | TEXT FK |                            |
| name         | TEXT    | compose project name       |
| working_dir  | TEXT    |                            |
| config_files | TEXT    | JSON array                 |
| status       | TEXT    |                            |

### containers
| column       | type    | notes                       |
|--------------|---------|-----------------------------|
| id           | TEXT PK | server_id + container_id    |
| server_id    | TEXT FK |                             |
| project_id   | TEXT FK | nullable                    |
| container_id | TEXT    |                             |
| name         | TEXT    |                             |
| image        | TEXT    | e.g. `nginx:latest`         |
| image_digest | TEXT    | local RepoDigest sha256     |
| state        | TEXT    | running/exited/...          |
| status       | TEXT    | human text                  |
| ports        | TEXT    | JSON array                  |
| created_at   | INTEGER |                             |

### image_checks
| column           | type    | notes                                    |
|------------------|---------|------------------------------------------|
| image_ref        | TEXT PK | `repo:tag` normalised                    |
| local_digest     | TEXT    |                                          |
| remote_digest    | TEXT    |                                          |
| update_available | INTEGER |                                          |
| checked_at       | INTEGER |                                          |
| error            | TEXT    |                                          |

### jobs
| column       | type    | notes                                         |
|--------------|---------|-----------------------------------------------|
| id           | TEXT PK | crypto.randomUUID                                        |
| server_id    | TEXT FK |                                               |
| type         | TEXT    | `apt-upgrade`/`compose-pull`/`compose-up`/... |
| target       | TEXT    | stack name / service name / blank             |
| status       | TEXT    | `queued`/`running`/`success`/`error`          |
| started_at   | INTEGER |                                               |
| finished_at  | INTEGER |                                               |
| exit_code    | INTEGER |                                               |
| log          | TEXT    | ANSI-stripped log output                      |

### known_hosts
| column     | type    | notes                            |
|------------|---------|----------------------------------|
| host       | TEXT PK | `ip:port`                        |
| key_type   | TEXT    |                                  |
| key_sha256 | TEXT    |                                  |
| seen_at    | INTEGER |                                  |

## Migrations
Migrations are plain SQL files in `src/main/db/migrations/` applied by `migrate.ts` on startup. Each file is prefixed with a timestamp, e.g. `0001_init.sql`.

- `0001_init.sql` - initial schema (all tables above)

When schemas change, add a new numbered migration here and append to this list.

## Security Notes
- Credentials are encrypted at rest using Electron `safeStorage` (Windows DPAPI). Only decrypted in-memory in the main process.
- Host-key pinning on first connect; subsequent mismatches raise a warning instead of silent connect.
- `contextIsolation: true`, `nodeIntegration: false`; renderer only sees the typed `window.api` bridge from the preload.
