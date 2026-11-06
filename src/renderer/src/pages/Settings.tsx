import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, Input, Label, Modal, Badge } from '@/components/ui/primitives'
import { Plus, Star, StarOff, Trash2 } from 'lucide-react'
import type { AppSettings } from '@shared/types'

export function Settings(): JSX.Element {
  const qc = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => window.api.settings.get() })
  const { data: credentials } = useQuery({ queryKey: ['credentials'], queryFn: () => window.api.credentials.list() })
  const [form, setForm] = useState<AppSettings | null>(null)
  const [credOpen, setCredOpen] = useState(false)

  useEffect(() => {
    if (settings && !form) setForm(settings)
  }, [settings, form])

  const save = useMutation({
    mutationFn: (patch: Partial<AppSettings>) => window.api.settings.update(patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] })
  })

  if (!form) return <div>Loading…</div>

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card className="space-y-4 p-5">
        <h2 className="font-medium">Network</h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Default subnet</Label>
            <Input value={form.subnet} onChange={(e) => setForm({ ...form, subnet: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Scan timeout (ms)</Label>
            <Input type="number" value={form.scanTimeoutMs} onChange={(e) => setForm({ ...form, scanTimeoutMs: Number(e.target.value) })} />
          </div>
          <div className="space-y-1">
            <Label>Auto refresh (minutes)</Label>
            <Input type="number" value={form.refreshMinutes} onChange={(e) => setForm({ ...form, refreshMinutes: Number(e.target.value) })} />
          </div>
          <div className="flex items-center gap-2 pt-5">
            <input
              id="autoRefresh"
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={form.autoRefresh}
              onChange={(e) => setForm({ ...form, autoRefresh: e.target.checked })}
            />
            <Label htmlFor="autoRefresh">Enable auto-refresh</Label>
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => save.mutate(form)}>Save</Button>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Credentials</h2>
          <Button size="sm" onClick={() => setCredOpen(true)}>
            <Plus size={14} /> New credential
          </Button>
        </div>
        {credentials?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No credentials yet. Add at least one (e.g. user <code>root</code> password <code>root</code>) and mark it as default.
          </p>
        )}
        <div className="divide-y divide-border">
          {credentials?.map((c) => (
            <div key={c.id} className="flex items-center justify-between py-2">
              <div>
                <div className="flex items-center gap-2 font-medium">
                  {c.name} <Badge variant="outline">{c.username}</Badge>
                  {c.isDefault && <Badge variant="success">default</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">{c.authType}</div>
              </div>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  title={c.isDefault ? 'already default' : 'set default'}
                  onClick={() => {
                    void window.api.credentials.setDefault(c.id).then(() => qc.invalidateQueries({ queryKey: ['credentials'] }))
                  }}
                >
                  {c.isDefault ? <Star size={14} className="text-[hsl(var(--warning))]" /> : <StarOff size={14} />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    void window.api.credentials.remove(c.id).then(() => qc.invalidateQueries({ queryKey: ['credentials'] }))
                  }}
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <CredentialDialog open={credOpen} onClose={() => setCredOpen(false)} />
    </div>
  )
}

function CredentialDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: 'Default root', username: 'root', authType: 'password' as 'password' | 'key', secret: '', passphrase: '', isDefault: true })
  useEffect(() => {
    if (open) setForm({ name: 'Default root', username: 'root', authType: 'password', secret: '', passphrase: '', isDefault: true })
  }, [open])
  const save = useMutation({
    mutationFn: () => window.api.credentials.save(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['credentials'] })
      onClose()
    }
  })
  return (
    <Modal open={open} onClose={onClose} title="New credential">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1">
          <Label>Name</Label>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Username</Label>
          <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </div>
        <div className="space-y-1">
          <Label>Type</Label>
          <select
            className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm"
            value={form.authType}
            onChange={(e) => setForm({ ...form, authType: e.target.value as 'password' | 'key' })}
          >
            <option value="password">Password</option>
            <option value="key">Private key</option>
          </select>
        </div>
        <div className="col-span-2 space-y-1">
          <Label>{form.authType === 'password' ? 'Password' : 'Private key (PEM)'}</Label>
          {form.authType === 'password' ? (
            <Input type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
          ) : (
            <textarea
              className="h-32 w-full rounded-md border border-input bg-background/60 p-2 font-mono text-xs"
              value={form.secret}
              onChange={(e) => setForm({ ...form, secret: e.target.value })}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            />
          )}
        </div>
        {form.authType === 'key' && (
          <div className="col-span-2 space-y-1">
            <Label>Passphrase (optional)</Label>
            <Input type="password" value={form.passphrase} onChange={(e) => setForm({ ...form, passphrase: e.target.value })} />
          </div>
        )}
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} className="h-4 w-4 accent-primary" />
          Use as default for servers without explicit credentials
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!form.secret || save.isPending} onClick={() => save.mutate()}>
          Save
        </Button>
      </div>
    </Modal>
  )
}
