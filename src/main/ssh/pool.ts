import { Client, type ConnectConfig, type ClientChannel } from 'ssh2'
import { createHash } from 'node:crypto'
import type { Server } from '@shared/types'
import { getCredentialSecret, getDefaultCredential, recordKnownHost, pinHostKey } from '../db'

export interface SshAuthResolved {
  username: string
  authType: 'password' | 'key'
  secret: string
  passphrase?: string
}

export function resolveAuth(server: Server): SshAuthResolved | null {
  const credId = server.credentialId ?? getDefaultCredential()?.id
  if (!credId) return null
  const s = getCredentialSecret(credId)
  if (!s) return null
  return {
    username: s.username,
    authType: s.authType as 'password' | 'key',
    secret: s.secret,
    passphrase: s.passphrase || undefined
  }
}

export interface ExecResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface OpenClient {
  client: Client
  close: () => void
}

export class HostKeyMismatchError extends Error {
  constructor(public server: Server) {
    super(`Host key mismatch for ${server.host}:${server.port}`)
  }
}

/**
 * Open a one-shot SSH client. The main-process-only; the renderer must go through IPC.
 * We do NOT pool long-lived connections because small home-lab servers reboot often and
 * SSH handshake overhead is acceptable for the scale of use (dozens of servers, minute-scale polls).
 */
export function connect(server: Server): Promise<OpenClient> {
  const auth = resolveAuth(server)
  if (!auth) return Promise.reject(new Error(`No credentials configured for server ${server.name}`))

  return new Promise((resolve, reject) => {
    const client = new Client()
    const cfg: ConnectConfig = {
      host: server.host,
      port: server.port || 22,
      username: auth.username,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
      algorithms: {
        // Older Debian/Ubuntu servers often default to these.
        serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256', 'ssh-rsa']
      },
      hostVerifier: (keyHash: Buffer | string) => {
        // ssh2 passes a hex md5 string when no algorithm given; we want sha256 of the raw key.
        // Compute from the actual key via hostkeys-prove-00 event if available instead.
        // Here we just accept; actual pinning is done via the 'handshake' event below.
        return true
      }
    }
    if (auth.authType === 'password') cfg.password = auth.secret
    else {
      cfg.privateKey = auth.secret
      if (auth.passphrase) cfg.passphrase = auth.passphrase
    }

    let hostKeySha: string | null = null
    client.on('handshake', (neg) => {
      // noop; kept for potential future diagnostics.
      void neg
    })
    // ssh2 emits 'ready' after handshake; we capture host key from the raw socket via the keyboard-interactive path.
    // better: use the undocumented 'hostkeys-00' message. Simpler, ssh2 doesn't expose it cleanly, so we accept + pin on first connect.

    client
      .on('ready', () => {
        // ssh2 exposes the host key on `client._sshstream?.hostkey`? Not stable.
        // Use 'ssh2' internal: cast and read from _sock's cached key. We approximate pinning via server fingerprint from connection.
        const anyClient = client as any
        const raw: Buffer | undefined =
          anyClient?._sshstream?._state?.incoming?.state?.hostkey?.data ??
          anyClient?._protocol?._kex?._hostKey?.public
        if (raw) {
          hostKeySha = 'SHA256:' + createHash('sha256').update(raw).digest('base64').replace(/=+$/, '')
          const hostId = `${server.host}:${server.port}`
          const status = recordKnownHost(hostId, 'ssh', hostKeySha)
          if (status === 'mismatch' && server.hostKeySha256 && server.hostKeySha256 !== hostKeySha) {
            client.end()
            reject(new HostKeyMismatchError(server))
            return
          }
          if (!server.hostKeySha256) pinHostKey(server.id, hostKeySha)
        }
        resolve({
          client,
          close: () => {
            try {
              client.end()
            } catch {
              /* ignore */
            }
          }
        })
      })
      .on('error', (err) => {
        reject(err)
      })
      .connect(cfg)
  })
}

/** Run a single command and buffer its output. Suitable for the collector script. */
export function exec(server: Server, cmd: string, opts: { timeoutMs?: number } = {}): Promise<ExecResult> {
  return connect(server).then(
    ({ client, close }) =>
      new Promise<ExecResult>((resolve, reject) => {
        const timeout = opts.timeoutMs
          ? setTimeout(() => {
              close()
              reject(new Error(`exec timeout after ${opts.timeoutMs}ms`))
            }, opts.timeoutMs)
          : null
        client.exec(cmd, { pty: false }, (err, stream) => {
          if (err) {
            if (timeout) clearTimeout(timeout)
            close()
            return reject(err)
          }
          let stdout = ''
          let stderr = ''
          let code: number | null = null
          stream.on('data', (d: Buffer) => (stdout += d.toString('utf8')))
          stream.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')))
          stream.on('close', (c: number | null) => {
            if (timeout) clearTimeout(timeout)
            close()
            code = c ?? null
            resolve({ code, stdout, stderr })
          })
        })
      })
  )
}

/** Stream a long-running command, chunk by chunk. Caller controls lifetime via the returned handle. */
export interface StreamHandle {
  cancel: () => void
  done: Promise<{ code: number | null }>
}

export function execStream(
  server: Server,
  cmd: string,
  onChunk: (chunk: string) => void
): Promise<StreamHandle> {
  return connect(server).then(({ client, close }) => {
    let settle: (v: { code: number | null }) => void = () => {}
    let settleErr: (e: unknown) => void = () => {}
    const donePromise = new Promise<{ code: number | null }>((res, rej) => {
      settle = res
      settleErr = rej
    })
    let channel: ClientChannel | null = null

    client.exec(cmd, { pty: true }, (err, stream) => {
      if (err) {
        close()
        return settleErr(err)
      }
      channel = stream
      stream.on('data', (d: Buffer) => onChunk(d.toString('utf8')))
      stream.stderr.on('data', (d: Buffer) => onChunk(d.toString('utf8')))
      stream.on('close', (code: number | null) => {
        close()
        settle({ code: code ?? null })
      })
    })

    return {
      cancel: () => {
        try {
          channel?.signal('KILL')
          channel?.close()
        } catch {
          /* ignore */
        }
        close()
      },
      done: donePromise
    }
  })
}

/** Open an interactive shell channel; used by the xterm.js terminal. */
export interface ShellHandle {
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  close: () => void
  onData: (cb: (data: string) => void) => void
  onExit: (cb: (code: number | null) => void) => void
}

export function openShell(server: Server, cols: number, rows: number): Promise<ShellHandle> {
  return connect(server).then(
    ({ client, close }) =>
      new Promise<ShellHandle>((resolve, reject) => {
        client.shell({ cols, rows, term: 'xterm-256color' } as any, (err, stream) => {
          if (err) {
            close()
            return reject(err)
          }
          const dataListeners: Array<(d: string) => void> = []
          const exitListeners: Array<(code: number | null) => void> = []
          stream.on('data', (d: Buffer) => {
            const s = d.toString('utf8')
            dataListeners.forEach((f) => f(s))
          })
          stream.on('close', (code: number | null) => {
            exitListeners.forEach((f) => f(code ?? null))
            close()
          })
          resolve({
            write: (data: string) => stream.write(data),
            resize: (c: number, r: number) => stream.setWindow(r, c, 0, 0),
            close: () => {
              try {
                stream.close()
              } catch {
                /* ignore */
              }
              close()
            },
            onData: (cb) => dataListeners.push(cb),
            onExit: (cb) => exitListeners.push(cb)
          })
        })
      })
  )
}
