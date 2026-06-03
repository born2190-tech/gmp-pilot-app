import { FillView } from './BmrFillPage'
import { useI18n } from '../../i18n/I18nProvider'
import type { CurrentUser } from '../../types/auth'

interface Props {
  token: string
  user: CurrentUser | null
  instanceId: string
  onClose: () => void
  onChanged?: () => void
}

/**
 * Полноэкранный ПРОСМОТР BMR из страницы «Производство» (надзор: начальник цеха).
 * Read-only: открывается «Обзор серии» (все стадии, прогресс, кто подписал
 * ДП/ДОК) + кнопка PDF. Тот же структурный экран, что у оператора, но без
 * редактирования/подписей — заполнение и подписи делаются на планшетах операторов
 * по комнатам. Один код — один вид.
 */
export function BmrFillModal({ token, user, instanceId, onClose, onChanged }: Props) {
  const { t } = useI18n()
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#eef1f5]">
      <FillView
        token={token}
        user={user}
        instanceId={instanceId}
        readOnly
        backLabel={t('common.close')}
        onBack={() => { onChanged?.(); onClose() }}
      />
    </div>
  )
}
