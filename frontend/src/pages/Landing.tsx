import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Icon, type IconName } from '../components/ui/Icon'
import { Card } from '../components/ui/primitives'
import { CropIcon } from '../components/crops/CropIcon'

const CROPS = ['wheat', 'barley', 'lentil', 'chickpea', 'vetch', 'tomato', 'cucumber', 'potato', 'onion', 'eggplant', 'olive', 'date_palm', 'citrus']

export default function Landing() {
  const { t, i18n } = useTranslation()
  const steps: { icon: IconName; title: string; body: string }[] = [
    { icon: 'pin', title: t('landing.step1'), body: t('landing.step1Body') },
    { icon: 'grid', title: t('landing.step2'), body: t('landing.step2Body') },
    { icon: 'sprout', title: t('landing.step3'), body: t('landing.step3Body') },
  ]
  const sources: { icon: IconName; title: string; body: string }[] = [
    { icon: 'sun', title: t('landing.power'), body: t('landing.powerBody') },
    { icon: 'drop', title: t('landing.smap'), body: t('landing.smapBody') },
    { icon: 'cloudRain', title: t('landing.gpm'), body: t('landing.gpmBody') },
  ]
  return (
    <div className="min-h-full bg-bg">
      <div className="max-w-[1376px] mx-auto px-4 sm:px-8">
        <header className="flex items-center justify-between gap-2 h-16 sm:h-20">
          <span className="flex items-center gap-2 text-h2 font-semibold text-green-700">
            <img src="/logo.png" alt="" className="size-9" /> {t('app.name')}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => i18n.changeLanguage(i18n.language === 'ar' ? 'en' : 'ar')} className="h-10 px-4 rounded-pill border border-border bg-surface text-label flex items-center gap-2 hover:bg-surface-muted">
              <Icon name="globe" size={18} /> {t('common.language')}
            </button>
            <Link to="/signin" className="h-10 px-5 rounded-pill text-label flex items-center hover:bg-surface">
              {t('landing.signIn')}
            </Link>
          </div>
        </header>

        {/* Hero */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch mt-2 sm:mt-4">
          <div className="lg:col-span-5 flex flex-col justify-center py-6 lg:py-12">
            <h1 className="text-[34px] leading-[44px] sm:text-[44px] sm:leading-[54px] xl:text-[56px] xl:leading-[64px] font-light tracking-tight">{t('landing.heroTitle')}</h1>
            <p className="text-body text-text-secondary mt-6 max-w-lg">{t('landing.heroBody')}</p>
            <div className="mt-6 sm:mt-10 flex flex-wrap gap-3">
              <Link to="/register" className="inline-flex items-center gap-2 h-12 px-8 rounded-pill bg-green-600 text-white text-body hover:bg-green-700">
                {t('landing.start')}
                <Icon name="arrowRight" size={18} className="rtl:-scale-x-100" />
              </Link>
              <Link to="/guest" className="inline-flex items-center gap-2 h-12 px-6 rounded-pill bg-surface border border-border text-body hover:bg-surface-muted">
                <Icon name="pin" size={18} className="text-green-600" /> {t('guest.try')}
              </Link>
            </div>
            <p className="text-caption text-text-tertiary mt-6 flex items-center gap-2">
              <Icon name="satellite" size={16} /> {t('landing.builtWith')}
            </p>
          </div>
          <div className="lg:col-span-7">
            <img src="/images/hero-farm.webp" alt="" className="w-full h-[240px] sm:h-[380px] lg:h-[560px] object-cover rounded-card" />
          </div>
        </section>

        {/* How it works */}
        <section className="mt-14 sm:mt-24" aria-labelledby="how">
          <h2 id="how" className="text-display font-light mb-6 sm:mb-8">{t('landing.howTitle')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
            {steps.map((s, i) => (
              <Card key={i} className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className="size-12 rounded-pill border border-border flex items-center justify-center text-green-600">
                    <Icon name={s.icon} size={24} />
                  </span>
                  <span className="text-metric font-light text-green-200">{i + 1}</span>
                </div>
                <h3 className="text-h2 font-semibold">{s.title}</h3>
                <p className="text-body text-text-secondary">{s.body}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* NASA sources */}
        <section className="mt-14 sm:mt-24" aria-labelledby="sources">
          <h2 id="sources" className="text-display font-light mb-6 sm:mb-8">{t('landing.sourcesTitle')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
            {sources.map((s) => (
              <Card key={s.title} className="flex flex-col gap-3">
                <span className="size-12 rounded-pill bg-green-50 text-green-700 flex items-center justify-center">
                  <Icon name={s.icon} size={24} />
                </span>
                <h3 className="text-h2 font-semibold" dir="ltr" style={{ textAlign: 'start' }}>{s.title}</h3>
                <p className="text-body text-text-secondary">{s.body}</p>
              </Card>
            ))}
          </div>
        </section>

        {/* Jordan */}
        <section className="mt-14 sm:mt-24" aria-labelledby="jordan">
          <Card className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:!p-10">
            <div className="lg:col-span-5">
              <h2 id="jordan" className="text-display font-light">{t('landing.jordanTitle')}</h2>
              <p className="text-body text-text-secondary mt-4">{t('landing.jordanBody')}</p>
            </div>
            <div className="lg:col-span-7 flex flex-wrap gap-2 sm:gap-3 content-center">
              {CROPS.map((c) => (
                <span key={c} className="inline-flex items-center gap-2 h-12 ps-1 pe-4 rounded-pill border border-border">
                  <CropIcon crop={c} size={40} />
                  <span className="text-label">{t(`crops.${c}`)}</span>
                </span>
              ))}
            </div>
          </Card>
        </section>

        <footer className="mt-14 sm:mt-24 py-8 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-caption text-text-secondary">
          <span>{t('landing.footer')}</span>
          <span>© {new Date().getFullYear()} {t('app.name')}</span>
        </footer>
      </div>
    </div>
  )
}
