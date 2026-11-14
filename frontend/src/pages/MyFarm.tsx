import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ParcelManager } from '../features/parcels/ParcelManager'
import { useFarmCtx } from '../layout/FarmContext'
import { EmptyState } from '../components/ui/states'

export default function MyFarm() {
  const { t } = useTranslation()
  const { farm } = useFarmCtx()
  const [params] = useSearchParams()
  if (!farm) return <EmptyState title={t('farm.noFarm')} body={t('farm.noFarmBody')} />
  return (
    <div className="h-full min-h-[520px]">
      <ParcelManager key={farm.id} farm={farm} initialPlotId={params.get('plot')} startAdding={params.get('add') === '1'} />
    </div>
  )
}
