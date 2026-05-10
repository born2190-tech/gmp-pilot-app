import { useMemo, useState } from 'react'
import { Boxes, FlaskConical, LogOut, ShieldCheck, Warehouse } from 'lucide-react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { listLots, listMovements, login, logout, me } from './lib/api'
import type { LoginRequest } from './lib/types'
import { Card } from './components/ui'
import { LotsTable } from './components/lots-table'

const TOKEN_KEY = 'gmp_web_token'

function formatDate(value: string | null) {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem(TOKEN_KEY))
  const [actionError, setActionError] = useState<string | null>(null)

  const loginSchema = z.object({
    username: z.string().min(1, 'Username is required'),
    password: z.string().min(1, 'Password is required'),
    workstation_id: z.string().optional(),
  })

  const loginForm = useForm<LoginRequest>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: 'warehouse_operator',
      password: 'wh123',
      workstation_id: 'WS-SUB-01',
    },
  })

  const meQuery = useQuery({
    queryKey: ['me', token],
    queryFn: async () => {
      try {
        return await me(token!)
      } catch (err) {
        localStorage.removeItem(TOKEN_KEY)
        setToken(null)
        throw err
      }
    },
    enabled: Boolean(token),
    retry: 1,
  })

  const user = meQuery.data ?? null

  const lotsQuery = useQuery({
    queryKey: ['lots', token, user?.warehouse_scope],
    queryFn: () => listLots(token!, user?.warehouse_scope),
    enabled: Boolean(token && user),
  })

  const movementsQuery = useQuery({
    queryKey: ['movements', token, user?.warehouse_scope],
    queryFn: () => listMovements(token!, user?.warehouse_scope),
    enabled: Boolean(token && user),
  })

  const loginMutation = useMutation({
    mutationFn: (payload: LoginRequest) => login(payload),
    onSuccess: (response) => {
      localStorage.setItem(TOKEN_KEY, response.access_token)
      setToken(response.access_token)
      setActionError(null)
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : 'Login failed')
    },
  })

  const logoutMutation = useMutation({
    mutationFn: (authToken: string) => logout(authToken),
  })

  const lots = useMemo(() => lotsQuery.data?.lots ?? [], [lotsQuery.data?.lots])
  const movements = useMemo(() => movementsQuery.data?.movements ?? [], [movementsQuery.data?.movements])
  const loading = meQuery.isLoading || lotsQuery.isLoading || movementsQuery.isLoading
  const error =
    actionError ??
    (meQuery.error instanceof Error
      ? meQuery.error.message
      : lotsQuery.error instanceof Error
        ? lotsQuery.error.message
        : movementsQuery.error instanceof Error
          ? movementsQuery.error.message
          : null)

  const roleLabel = useMemo(() => {
    if (!user) {
      return ''
    }
    return user.role.replaceAll('_', ' ')
  }, [user])

  const kpis = useMemo(() => {
    const byStatus = lots.reduce<Record<string, number>>((acc, lot) => {
      acc[lot.quality_status] = (acc[lot.quality_status] ?? 0) + 1
      return acc
    }, {})

    return {
      total: lots.length,
      quarantine: byStatus.quarantine ?? 0,
      underTest: byStatus.under_test ?? 0,
      blocked: byStatus.blocked ?? 0,
    }
  }, [lots])

  const handleLogin = loginForm.handleSubmit(async (payload) => {
    setActionError(null)
    await loginMutation.mutateAsync(payload)
  })

  const handleLogout = async () => {
    if (token) {
      try {
        await logoutMutation.mutateAsync(token)
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Logout request failed')
      }
    }
    localStorage.removeItem(TOKEN_KEY)
    setToken(null)
  }

  if (!token || !user) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-[1280px] items-center justify-center px-6 py-10">
        <Card className="w-full max-w-[420px] border-zinc-200 bg-white/95 p-6">
          <div className="mb-6 flex items-center gap-2">
            <div className="rounded-md bg-[var(--accent)] p-2 text-white">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.08em] text-zinc-500">PharmaFlow</p>
              <h1 className="text-lg font-semibold text-zinc-900">GMP Sign In</h1>
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleLogin}>
            <label className="block text-sm text-zinc-700">
              Username
              <input
                className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-[var(--accent)] transition focus:ring-2"
                {...loginForm.register('username')}
              />
            </label>

            <label className="block text-sm text-zinc-700">
              Password
              <input
                type="password"
                className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-[var(--accent)] transition focus:ring-2"
                {...loginForm.register('password')}
              />
            </label>

            <label className="block text-sm text-zinc-700">
              Workstation ID
              <input
                className="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-[var(--accent)] transition focus:ring-2"
                {...loginForm.register('workstation_id')}
              />
            </label>

            {loginForm.formState.errors.username && <p className="text-xs text-red-700">{loginForm.formState.errors.username.message}</p>}
            {loginForm.formState.errors.password && <p className="text-xs text-red-700">{loginForm.formState.errors.password.message}</p>}

            {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            <button
              className="w-full rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-95 disabled:opacity-60"
              disabled={loginMutation.isPending}
              type="submit"
            >
              Sign In
            </button>
          </form>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto grid min-h-screen w-full max-w-[1440px] grid-cols-[260px_1fr]">
      <aside className="border-r border-zinc-800 bg-[var(--nav)] px-4 py-5 text-zinc-100">
        <div className="mb-8 flex items-center gap-2">
          <div className="rounded-md bg-[var(--accent)] p-2 text-white">
            <Boxes className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-zinc-400">PharmaFlow</p>
            <p className="text-sm font-medium">Operations Console</p>
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 rounded-xl bg-zinc-800/70 px-3 py-2">
            <Warehouse className="h-4 w-4" />
            Lots Board
          </div>
          <div className="flex items-center gap-2 rounded-xl px-3 py-2 text-zinc-300">
            <FlaskConical className="h-4 w-4" />
            Movements
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-zinc-700 bg-zinc-900/70 p-3 text-xs text-zinc-300">
          <p className="mb-1 font-medium text-zinc-100">{user.username}</p>
          <p>{roleLabel}</p>
          <p>{user.warehouse_scope || 'ALL'}</p>
          <p>{user.workstation_id || '—'}</p>
        </div>

        <button
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-600 px-3 py-2 text-sm text-zinc-200 transition hover:bg-zinc-800"
          onClick={handleLogout}
          type="button"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </aside>

      <main className="bg-[var(--bg)] px-6 py-5">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.08em] text-zinc-500">Warehouse dashboard</p>
            <h2 className="text-2xl font-semibold text-zinc-900">Material Flow</h2>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">
            scope: <span className="font-medium text-zinc-900">{user.warehouse_scope || 'ALL'}</span>
          </div>
        </div>

        {error && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="mb-5 grid gap-3 md:grid-cols-4">
          <Card>
            <p className="text-xs uppercase tracking-[0.06em] text-zinc-500">Total lots</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-900">{kpis.total}</p>
          </Card>
          <Card>
            <p className="text-xs uppercase tracking-[0.06em] text-zinc-500">Quarantine</p>
            <p className="mt-2 text-2xl font-semibold text-amber-700">{kpis.quarantine}</p>
          </Card>
          <Card>
            <p className="text-xs uppercase tracking-[0.06em] text-zinc-500">Under test</p>
            <p className="mt-2 text-2xl font-semibold text-blue-700">{kpis.underTest}</p>
          </Card>
          <Card>
            <p className="text-xs uppercase tracking-[0.06em] text-zinc-500">Blocked</p>
            <p className="mt-2 text-2xl font-semibold text-slate-700">{kpis.blocked}</p>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-[var(--line)] px-4 py-3">
              <h3 className="text-sm font-semibold text-zinc-900">Lots</h3>
            </div>
            <LotsTable formatDate={formatDate} isLoading={loading} lots={lots} />
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-[var(--line)] px-4 py-3">
              <h3 className="text-sm font-semibold text-zinc-900">Inventory movements</h3>
            </div>
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-zinc-50 text-xs uppercase tracking-[0.06em] text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Time</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Lot</th>
                    <th className="px-3 py-2 text-right">Δ Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {movements.map((item) => (
                    <tr className="border-t border-zinc-100" key={item.id}>
                      <td className="px-3 py-2 font-mono text-xs text-zinc-600">{formatDate(item.timestamp_utc)}</td>
                      <td className="px-3 py-2 text-zinc-800">{item.movement_type}</td>
                      <td className="px-3 py-2 font-mono text-xs text-zinc-700">{item.internal_lot}</td>
                      <td className={`px-3 py-2 text-right font-medium ${item.quantity_delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {item.quantity_delta >= 0 ? '+' : ''}
                        {item.quantity_delta} {item.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!loading && movements.length === 0 && <p className="px-4 py-8 text-center text-sm text-zinc-500">Нет движений по выбранному scope.</p>}
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}

export default App
