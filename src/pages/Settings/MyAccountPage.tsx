import { useTranslation } from 'react-i18next'
import { MyAccountTab } from './tabs/MyAccountTab'

/**
 * The signed-in person's own account, for every role.
 *
 * Settings is temple_admin-only, and My Account used to exist only as a tab
 * inside it — so a cashier on JainERP Offline could not change their own sign-in
 * PIN, though the app told them to do exactly that under "Settings → My
 * Account". Everything on it is the person's own (their language, their PIN),
 * so it is reachable by all staff from their name in the top bar.
 */
export function MyAccountPage() {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-navy-900">{t('settings.myAccount')}</h1>
      <MyAccountTab />
    </div>
  )
}
