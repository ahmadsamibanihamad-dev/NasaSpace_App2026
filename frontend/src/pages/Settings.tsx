import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth/AuthContext'
import { useFarmCtx } from '../layout/FarmContext'
import { useDeleteFarm, useUpdateFarm } from '../hooks/queries'
import { Button, Card, CardTitle, Field, Input, Pill, Select, Tabs, Toggle } from '../components/ui/primitives'
import { ConfirmDialog } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { Icon } from '../components/ui/Icon'
import { updateMe } from '../lib/data/repo'
import { DEFAULT_SETTINGS, TILE_SOURCES, updateSettings, useSettings, type AreaUnit } from '../lib/settings'
import type { Farm } from '../lib/types'
import { loc } from '../i18n'

export default function Settings() {
  const { t, i18n } = useTranslation()
  const nav = useNavigate()
  const toast = useToast()
  const { user, refresh } = useAuth()
  const { farms, farm, setFarmId } = useFarmCtx()
  const s = useSettings()
  const updateFarm = useUpdateFarm()
  const deleteFarm = useDeleteFarm()
  const [name, setName] = useState(user?.full_name ?? '')
  const [dunum, setDunum] = useState(String(s.dunumM2))
  const [tileUrl, setTileUrl] = useState(s.customTileUrl)
  const [tileAttr, setTileAttr] = useState(s.customTileAttribution)
  const [toDelete, setToDelete] = useState<Farm | null>(null)
  const [renaming, setRenaming] = useState<Record<string, string>>({})
  const dunumOk = Number(dunum) >= 100 && Number(dunum) <= 10000
  const urlOk = tileUrl === '' || /^https:\/\/.+\{z\}.+\{x\}.+|^https:\/\/.+\{z\}.+\{y\}.+/.test(tileUrl)

  const saveAccount = async () => {
    try {
      await updateMe({ full_name: name.trim() || user!.full_name })
      await refresh()
      toast(t('settings.saved'))
    } catch {
      toast(t('parcels.saveFailed'), 'error')
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
      <Card>
        <CardTitle action={<Button size="sm" variant="secondary" icon="plus" onClick={() => nav('/setup?new=1')}>{t('farm.addFarm')}</Button>}>{t('settings.farms')}</CardTitle>
        <ul className="flex flex-col gap-2">
          {farms.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-tile border border-border p-3">
              <Icon name="farm" size={18} className="text-green-600 shrink-0" />
              <Input
                aria-label={t('parcels.farmName')}
                className="!h-9 !text-label flex-1 min-w-[55%] sm:min-w-0"
                value={renaming[f.id] ?? f.name}
                onChange={(e) => setRenaming({ ...renaming, [f.id]: e.target.value })}
                onBlur={async () => {
                  const v = renaming[f.id]?.trim()
                  if (v && v !== f.name) {
                    await updateFarm.mutateAsync({ id: f.id, name: v })
                    toast(t('settings.saved'))
                  }
                }}
              />
              {f.governorate && <span className="text-caption text-text-secondary whitespace-nowrap hidden sm:inline">{loc({ ar: f.governorate.name_ar, en: f.governorate.name_en })}</span>}
              {f.is_demo && <Pill tone="warning" icon="info">{t('common.demoData')}</Pill>}
              {f.id === farm?.id ? (
                <Pill tone="green" icon="check">{t('settings.current')}</Pill>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setFarmId(f.id)}>
                  {t('settings.switch')}
                </Button>
              )}
              <Button size="sm" variant="danger" icon="trash" aria-label={t('farm.deleteFarm')} onClick={() => setToDelete(f)} />
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle>{t('settings.account')}</CardTitle>
        <div className="flex flex-col gap-4">
          <Field label={t('auth.fullName')} htmlFor="s-name">
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </Field>
          <Field label={t('auth.email')} htmlFor="s-email">
            <Input id="s-email" value={user?.email ?? ''} disabled dir="ltr" className="!bg-surface-muted" />
          </Field>
          <Button className="self-start" onClick={saveAccount}>
            {t('common.save')}
          </Button>
        </div>
      </Card>

      <Card>
        <CardTitle>{t('settings.language')} · {t('settings.units')}</CardTitle>
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-label">{t('settings.language')}</span>
            <Tabs value={i18n.language as 'ar' | 'en'} onChange={(l) => i18n.changeLanguage(l)} options={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-label">{t('settings.units')}</span>
            <Tabs
              value={s.areaUnit}
              onChange={(u: AreaUnit) => updateSettings({ areaUnit: u })}
              options={[{ value: 'dunum', label: t('units.dunum') }, { value: 'hectare', label: t('units.hectare') }, { value: 'm2', label: t('units.m2') }]}
            />
          </div>
          <Field label={t('settings.dunumSize')} htmlFor="s-dunum" hint={t('settings.dunumHint')} error={dunumOk ? null : t('settings.dunumInvalid')}>
            <div className="flex flex-wrap gap-2">
              <Input id="s-dunum" className="!w-auto flex-1 min-w-32" type="number" dir="ltr" min={100} max={10000} step={1} value={dunum} onChange={(e) => setDunum(e.target.value)} aria-invalid={!dunumOk} />
              <Button
                variant="secondary"
                disabled={!dunumOk}
                onClick={() => {
                  updateSettings({ dunumM2: Number(dunum) })
                  toast(t('settings.saved'))
                }}
              >
                {t('common.apply')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setDunum(String(DEFAULT_SETTINGS.dunumM2))
                  updateSettings({ dunumM2: DEFAULT_SETTINGS.dunumM2 })
                }}
              >
                {t('common.reset')}
              </Button>
            </div>
          </Field>
        </div>
      </Card>

      <Card>
        <CardTitle>{t('settings.basemap')}</CardTitle>
        <div className="flex flex-col gap-4">
          <Field label={t('settings.tileSource')} htmlFor="s-tiles">
            <Select id="s-tiles" value={s.tileSourceId} onChange={(e) => updateSettings({ tileSourceId: e.target.value })}>
              {TILE_SOURCES.map((x) => (
                <option key={x.id} value={x.id}>
                  {loc(x.name)}
                </option>
              ))}
              <option value="custom">{t('settings.customSource')}</option>
            </Select>
          </Field>
          {s.tileSourceId === 'custom' && (
            <>
              <Field label={t('settings.tileUrl')} htmlFor="s-url" hint="https://…/{z}/{x}/{y}.png" error={urlOk ? null : t('settings.tileUrlInvalid')}>
                <Input id="s-url" dir="ltr" value={tileUrl} onChange={(e) => setTileUrl(e.target.value)} aria-invalid={!urlOk} />
              </Field>
              <Field label={t('settings.tileAttribution')} htmlFor="s-attr">
                <Input id="s-attr" dir="ltr" value={tileAttr} onChange={(e) => setTileAttr(e.target.value)} />
              </Field>
              <Button
                className="self-start"
                variant="secondary"
                disabled={!urlOk || !tileUrl}
                onClick={() => {
                  updateSettings({ customTileUrl: tileUrl.trim(), customTileAttribution: tileAttr.replace(/[<>]/g, '') })
                  toast(t('settings.saved'))
                }}
              >
                {t('common.apply')}
              </Button>
            </>
          )}
        </div>
      </Card>

      <Card className="xl:col-span-2">
        <CardTitle>{t('settings.notifications')}</CardTitle>
        <div className="flex flex-col gap-4 max-w-lg">
          <div className="flex items-center justify-between">
            <span className="text-label">{t('settings.notifRisks')}</span>
            <Toggle checked={s.notifyRisks} onChange={(v) => updateSettings({ notifyRisks: v })} label={t('settings.notifRisks')} />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-label">{t('settings.notifAnalyses')}</span>
            <Toggle checked={s.notifyAnalyses} onChange={(v) => updateSettings({ notifyAnalyses: v })} label={t('settings.notifAnalyses')} />
          </div>
        </div>
      </Card>

      {toDelete && (
        <ConfirmDialog
          title={t('farm.deleteFarm')}
          body={t('settings.deleteFarmBody', { name: toDelete.name })}
          confirmLabel={t('common.delete')}
          danger
          busy={deleteFarm.isPending}
          onClose={() => setToDelete(null)}
          onConfirm={async () => {
            try {
              await deleteFarm.mutateAsync(toDelete.id)
              toast(t('settings.farmDeleted'))
            } catch {
              toast(t('parcels.saveFailed'), 'error')
            }
            setToDelete(null)
          }}
        />
      )}
    </div>
  )
}
