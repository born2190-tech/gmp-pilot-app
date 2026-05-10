import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '../../components/ui/button'
import type { LoginRequest } from '../../types/auth'
import { useI18n } from '../../i18n/I18nProvider'
import { LanguageSwitcher } from '../../components/layout/LanguageSwitcher'

interface LoginPageProps {
  error: string | null
  isLoading: boolean
  onLogin: (payload: LoginRequest) => Promise<void>
}

export function LoginPage({ error, isLoading, onLogin }: LoginPageProps) {
  const { t } = useI18n()
  const schema = z.object({
    username: z.string().min(1, t('auth.usernameRequired')),
    password: z.string().min(1, t('auth.passwordRequired')),
    workstation_id: z.string().min(1, t('auth.workstationRequired')),
  })
  const form = useForm<LoginRequest>({
    resolver: zodResolver(schema),
    defaultValues: {
      username: 'warehouse_substance',
      password: 'whs123',
      workstation_id: 'WS-SUB-01',
    },
  })

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs uppercase text-slate-500">{t('app.name')}</p>
            <LanguageSwitcher />
          </div>
          <h1 className="text-xl font-semibold text-slate-950">{t('auth.signIn')}</h1>
        </div>

        <form className="space-y-4" onSubmit={form.handleSubmit(onLogin)}>
          {(['username', 'password', 'workstation_id'] as const).map((name) => (
            <label className="block text-sm font-medium text-slate-700" key={name}>
              {name === 'workstation_id' ? t('auth.workstationId') : name === 'password' ? t('auth.password') : t('auth.username')}
              <input
                className="mt-1 h-9 w-full rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-blue-700"
                type={name === 'password' ? 'password' : 'text'}
                {...form.register(name)}
              />
              {form.formState.errors[name] && <span className="mt-1 block text-xs text-red-700">{form.formState.errors[name]?.message}</span>}
            </label>
          ))}

          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <Button className="w-full" disabled={isLoading} type="submit">
            {t('auth.signIn')}
          </Button>
        </form>
      </section>
    </main>
  )
}
