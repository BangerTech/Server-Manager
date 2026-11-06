import { getImageCheck, saveImageCheck, listSnapshots, saveSnapshot } from './db'
import type { ServerSnapshot } from '@shared/types'

interface RegistryTarget {
  registry: string
  repo: string
  tag: string
  authService?: string
  authScope?: string
}

const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

/**
 * Parse a Docker image reference into registry/repo/tag.
 * Examples:
 *   nginx            -> docker.io / library/nginx / latest
 *   nginx:1.25       -> docker.io / library/nginx / 1.25
 *   lscr.io/linuxserver/sonarr -> lscr.io / linuxserver/sonarr / latest
 *   ghcr.io/foo/bar:dev       -> ghcr.io / foo/bar / dev
 */
export function parseImageRef(ref: string): RegistryTarget | null {
  if (!ref || ref.startsWith('sha256:')) return null
  // strip digest suffix
  const atIdx = ref.indexOf('@')
  if (atIdx !== -1) ref = ref.slice(0, atIdx)
  const parts = ref.split('/')
  let registry: string
  let repo: string
  if (parts.length === 1) {
    registry = 'docker.io'
    repo = 'library/' + parts[0]
  } else if (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost') {
    registry = parts[0]
    repo = parts.slice(1).join('/')
  } else {
    registry = 'docker.io'
    repo = parts.join('/')
  }
  let tag = 'latest'
  const colon = repo.lastIndexOf(':')
  if (colon !== -1 && !repo.slice(colon + 1).includes('/')) {
    tag = repo.slice(colon + 1)
    repo = repo.slice(0, colon)
  }
  return { registry, repo, tag }
}

async function getBearerToken(target: RegistryTarget): Promise<string | null> {
  // Hit the manifests endpoint once to discover the auth realm.
  const url = `https://${target.registry}/v2/${target.repo}/manifests/${target.tag}`
  const probe = await fetch(url, { method: 'HEAD' })
  if (probe.status !== 401) return null
  const www = probe.headers.get('www-authenticate') ?? ''
  const realmMatch = www.match(/realm="([^"]+)"/)
  const serviceMatch = www.match(/service="([^"]+)"/)
  const scopeMatch = www.match(/scope="([^"]+)"/)
  if (!realmMatch) return null
  const tokenUrl = new URL(realmMatch[1])
  if (serviceMatch) tokenUrl.searchParams.set('service', serviceMatch[1])
  if (scopeMatch) tokenUrl.searchParams.set('scope', scopeMatch[1])
  else tokenUrl.searchParams.set('scope', `repository:${target.repo}:pull`)
  const res = await fetch(tokenUrl.toString())
  if (!res.ok) return null
  const body = (await res.json()) as { token?: string; access_token?: string }
  return body.token ?? body.access_token ?? null
}

async function fetchRemoteDigest(ref: string): Promise<{ digest: string | null; error?: string }> {
  const target = parseImageRef(ref)
  if (!target) return { digest: null, error: 'unparsable ref' }
  const url = `https://${target.registry}/v2/${target.repo}/manifests/${target.tag}`
  const headers: Record<string, string> = {
    Accept:
      'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.docker.distribution.manifest.v2+json'
  }
  try {
    const token = await getBearerToken(target)
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(url, { method: 'HEAD', headers })
    if (!res.ok) return { digest: null, error: `HTTP ${res.status}` }
    const digest = res.headers.get('docker-content-digest') || res.headers.get('etag')?.replace(/^W\//, '').replace(/"/g, '')
    return { digest: digest ?? null }
  } catch (err) {
    return { digest: null, error: err instanceof Error ? err.message : String(err) }
  }
}

function normaliseLocalDigest(d: string | null): string | null {
  if (!d) return null
  // local form is often "repo@sha256:..." or just the sha
  const i = d.indexOf('@')
  return i === -1 ? d : d.slice(i + 1)
}

export async function checkImage(
  imageRef: string,
  localDigest: string | null
): Promise<{ updateAvailable: boolean; remoteDigest: string | null; error?: string }> {
  const cached = getImageCheck(imageRef)
  const localNorm = normaliseLocalDigest(localDigest)
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS && cached.localDigest === localNorm) {
    return { updateAvailable: cached.updateAvailable, remoteDigest: cached.remoteDigest, error: cached.error ?? undefined }
  }
  const { digest, error } = await fetchRemoteDigest(imageRef)
  const updateAvailable = !!(digest && localNorm && digest !== localNorm)
  saveImageCheck({
    imageRef,
    localDigest: localNorm,
    remoteDigest: digest,
    updateAvailable,
    checkedAt: Date.now(),
    error: error ?? null
  })
  return { updateAvailable, remoteDigest: digest, error }
}

/**
 * Walk every snapshot and annotate every container's `updateAvailable` by consulting the cache / remote.
 * Called after a bulk collect; limits concurrency to avoid Docker Hub pull limits.
 */
export async function annotateSnapshotsWithImageChecks(): Promise<void> {
  const snaps = listSnapshots()
  const refs = new Set<string>()
  for (const snap of snaps) {
    for (const p of snap.composeProjects ?? []) for (const c of p.containers) if (c.image) refs.add(c.image)
    for (const c of snap.standaloneContainers ?? []) if (c.image) refs.add(c.image)
  }
  // We do not fetch digests per snapshot; rather we fetch per unique image reference.
  const uniqueRefs = Array.from(refs)
  const digestByRef = new Map<string, string | null>()
  const limit = 4
  let next = 0
  const workers = Array.from({ length: Math.min(limit, uniqueRefs.length) }, async () => {
    while (next < uniqueRefs.length) {
      const ref = uniqueRefs[next++]
      try {
        const { digest } = await fetchRemoteDigest(ref)
        digestByRef.set(ref, digest)
      } catch {
        digestByRef.set(ref, null)
      }
    }
  })
  await Promise.all(workers)

  for (const snap of snaps) {
    const update = (c: ServerSnapshot['standaloneContainers'] extends (infer T)[] | undefined ? T : never) => {
      const remote = digestByRef.get(c.image)
      const localNorm = normaliseLocalDigest(c.imageDigest)
      c.updateAvailable = !!(remote && localNorm && remote !== localNorm)
    }
    for (const p of snap.composeProjects ?? []) for (const c of p.containers) update(c)
    for (const c of snap.standaloneContainers ?? []) update(c)
    saveSnapshot(snap)
  }
}
