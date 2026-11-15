// Saved crop rotation plans of the current farm: open, compare two, print, delete.
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { useFarmCtx } from '../layout/FarmContext'
import { useDeleteSavedPlan, useSavedPlans } from '../hooks/queries'
import { Button, Card, CardTitle, IconButton, PageHeader, Skeleton } from '../components/ui/primitives'
import { EmptyState, ErrorState } from '../components/ui/states'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { CropIcon } from '../components/crops/CropIcon'
import { PlanView } from '../features/rotation/RotationPlanner'
import { getSavedPlan, type SavedPlan } from '../lib/data/repo'
import { cropName, date, num } from '../lib/format'

const seqText = (p: SavedPlan) => p.summary.crops.map((c) => cropName(c)).join(' ← ')

export default function SavedPlans() {
  const { t } = useTranslation()
  const nav = useNavigate()
  const toast = useToast()
  const { farm } = useFarmCtx()
  const [params, setParams] = useSearchParams()
  const list = useSavedPlans(farm?.id)
  const del = useDeleteSavedPlan()
  const [picked, setPicked] = useState<string[]>([])
  const [toDelete, setToDelete] = useState<SavedPlan | null>(null)
  const openId = params.get('plan')
  const open = useQuery({ queryKey: ['rotation-plan-saved', openId], queryFn: () => getSavedPlan(openId!), enabled: !!openId })

  if (list.isLoading) return <Skeleton className="h-96 !rounded-card" />
  if (list.error) return <ErrorState error={list.error} onRetry={() => list.refetch()} />
  const plans = list.data ?? []
  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((i) => i !== id) : [...x, id].slice(-2)))
  const pair = picked.map((id) => plans.find((p) => p.id === id)).filter(Boolean) as SavedPlan[]
  const rows: [string, (p: SavedPlan) => string][] = [
    [t('reports.date'), (p) => date(p.created_at)],
    [t('reports.plots'), (p) => p.plot_label || '—'],
    [t('outlook.plantingDate'), (p) => date(p.summary.planting_date)],
    [t('plans.sequence'), (p) => seqText(p) || '—'],
    [t('planner.rotationScore'), (p) => (p.summary.rotation_score === null ? '—' : num(p.summary.rotation_score, 0))],
    [t('reports.status'), (p) => t(`plans.planStatus.${p.summary.status}`)],
  ]

  return (
    <>
      <PageHeader
        title={t('plans.title')}
        subtitle={t('plans.subtitle')}
        actions={
          <Button icon="rotate" onClick={() => nav('/app/rotation')}>
            {t('plans.new')}
          </Button>
        }
      />

      {plans.length === 0 ? (
        <Card>
          <EmptyState icon="file" title={t('plans.empty')} body={t('plans.emptyBody')} />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          <Card>
            <CardTitle>{t('plans.saved')}</CardTitle>
            <p className="text-label text-text-secondary -mt-2 mb-3">{t('plans.pick2')}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-label">
                <thead>
                  <tr className="text-caption text-text-secondary">
                    <th className="py-2 w-8" />
                    <th className="text-start font-normal py-2">{t('reports.date')}</th>
                    <th className="text-start font-normal py-2">{t('reports.plots')}</th>
                    <th className="text-start font-normal py-2">{t('outlook.plantingDate')}</th>
                    <th className="text-start font-normal py-2">{t('plans.sequence')}</th>
                    <th className="text-start font-normal py-2">{t('planner.rotationScore')}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id} className={`border-t border-border ${openId === p.id ? 'bg-green-50' : ''}`}>
                      <td className="py-3">
                        <input type="checkbox" className="size-4 accent-green-600" checked={picked.includes(p.id)} onChange={() => toggle(p.id)} aria-label={`${t('common.compare')} ${seqText(p)}`} />
                      </td>
                      <td className="py-3 whitespace-nowrap">{date(p.created_at, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td className="py-3">{p.plot_label || '—'}</td>
                      <td className="py-3 whitespace-nowrap">{date(p.summary.planting_date, { day: 'numeric', month: 'short', year: 'numeric' })}</td>
                      <td className="py-3">
                        <span className="flex items-center gap-2">
                          {p.summary.crops.map((c) => (
                            <CropIcon key={c} crop={c} size={28} />
                          ))}
                          <span className="truncate max-w-56">{seqText(p) || t(`plans.planStatus.${p.summary.status}`)}</span>
                        </span>
                      </td>
                      <td className="py-3 font-semibold tabular-nums">{p.summary.rotation_score === null ? '—' : num(p.summary.rotation_score, 0)}</td>
                      <td className="py-3">
                        <span className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="secondary" onClick={() => setParams(openId === p.id ? {} : { plan: p.id })}>
                            {openId === p.id ? t('common.close') : t('common.view')}
                          </Button>
                          <IconButton icon="trash" label={t('common.delete')} onClick={() => setToDelete(p)} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {pair.length === 2 && (
            <Card>
              <CardTitle>{t('reports.comparison')}</CardTitle>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-label">
                  <tbody>
                    {rows.map(([label, get]) => (
                      <tr key={label} className="border-t border-border first:border-0">
                        <th className="text-start font-normal text-text-secondary py-3 w-1/4">{label}</th>
                        {pair.map((p) => (
                          <td key={p.id} className="py-3 font-semibold">
                            {get(p)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {openId &&
            (open.isLoading ? (
              <Skeleton className="h-96 !rounded-card" />
            ) : open.error ? (
              <Card>
                <ErrorState error={open.error} onRetry={() => open.refetch()} />
              </Card>
            ) : open.data?.plan ? (
              <PlanView
                key={open.data.id}
                plan={open.data.plan}
                header={
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-h1 font-semibold">
                      {t('plans.planOf', { date: date(open.data.plan.planting_date) })}
                      {open.data.plot_label && ` · ${t('common.plot')} ${open.data.plot_label}`}
                    </h2>
                    <Button variant="secondary" icon="printer" onClick={() => window.print()} className="print:hidden">
                      {t('plans.print')}
                    </Button>
                  </div>
                }
              />
            ) : null)}
        </div>
      )}

      {toDelete && (
      <Modal
        onClose={() => setToDelete(null)}
        title={t('common.delete')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setToDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={del.isPending}
              onClick={async () => {
                if (!toDelete) return
                try {
                  await del.mutateAsync(toDelete.id)
                  setPicked((x) => x.filter((i) => i !== toDelete.id))
                  if (openId === toDelete.id) setParams({})
                  toast(t('plans.deleted'))
                } catch {
                  toast(t('states.errorBody'), 'error')
                }
                setToDelete(null)
              }}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-body">{t('plans.deleteBody')}</p>
      </Modal>
      )}
    </>
  )
}
