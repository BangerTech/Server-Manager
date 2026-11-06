import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Modal, Input, Label, Textarea } from './ui/primitives'
import { Button } from './ui/button'
import type { Server } from '@shared/types'

export function ServerDialog({
  open,
  onClose,
  server
}: {
  open: boolean
  onClose: () => void
  server: Server | null
}): JSX.Element {
  const qc = useQueryClient()
  const { data: credentials } = useQuery({
    queryKey: ['credentials'],
    queryFn: () => window.api.credentials.list()
  })
  const [form, setForm] = useState({
    name: '',
    host: '',
    port: 22,
    credentialId: '' as string,
    color: '#6366f1',
    tags: '',
    notes: ''
  })
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (open) {
      setTestResult(null)
      setForm({
        name: server?.name ?? '',
        host: server?.host ?? '',
        port: server?.port ?? 22,
        credentialId: server?.credentialId ?? '',
        color: server?.color ?? '#6366f1',
        tags: (server?.tags ?? []).join(', '),
        notes: server?.notes ?? ''
      })
    }
  }, [open, server])

  const save = useMutation({
    mutationFn: async () => {
      return window.api.servers.save({
        id: server?.id,
        name: form.name || form.host,
        host: form.host.trim(),
        port: Number(form.port) || 22,
        credentialId: form.credentialId || null,
        color: form.color,
        tags: form.tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        notes: form.notes
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      onClose()
    }
  })

  const remove = useMutation({
    mutationFn: () => window.api.servers.remove(server!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['servers'] })
      qc.invalidateQueries({ queryKey: ['snapshots'] })
      onClose()
    }
  })

  const testConn = async (): Promise<void> => {
    if (!server) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = await window.api.servers.testConnection(server.id)
      setTestResult(r.ok ? 'Connection OK' : `Failed: ${r.error}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={server ? 'Edit server' : 'Add server'}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="homelab-01" />
        </Field>
        <Field label="Color">
          <Input type="color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} className="h-9 w-full p-1" />
        </Field>
        <Field label="Host / IP">
          <Input value={form.host} onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))} placeholder="192.168.2.182" />
        </Field>
        <Field label="Port">
          <Input type="number" value={form.port} onChange={(e) => setForm((f) => ({ ...f, port: Number(e.target.value) }))} />
        </Field>
        <Field label="Credential" full>
          <select
            className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
            value={form.credentialId}
            onChange={(e) => setForm((f) => ({ ...f, credentialId: e.target.value }))}
          >
            <option value="">Use default credential</option>
            {credentials?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.username}) {c.isDefault ? '• default' : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tags (comma-separated)" full>
          <Input value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="media, nas" />
        </Field>
        <Field label="Notes" full>
          <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </Field>
      </div>
      {testResult && (
        <div
          className={`mt-3 rounded-md border px-3 py-2 text-xs ${testResult.startsWith('Connection OK') ? 'border-[hsl(var(--success))]/30 text-[hsl(var(--success))]' : 'border-destructive/40 text-destructive'}`}
        >
          {testResult}
        </div>
      )}
      <div className="mt-4 flex items-center justify-between">
        <div>
          {server && (
            <Button variant="destructive" size="sm" onClick={() => remove.mutate()} disabled={remove.isPending}>
              Delete
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          {server && (
            <Button variant="secondary" size="sm" onClick={testConn} disabled={testing}>
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!form.host || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }): JSX.Element {
  return (
    <div className={full ? 'col-span-2 space-y-1' : 'space-y-1'}>
      <Label>{label}</Label>
      {children}
    </div>
  )
}
