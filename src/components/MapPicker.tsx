import { MapPin, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Lightweight lat/lng picker + preview with no external map SDK (CSP-safe,
 * works offline). Shows an embedded OpenStreetMap tile when coords are set and
 * a "pick on Google Maps" helper that opens a new tab; the user pastes the
 * coordinates back. Good enough for a temple / vihar pin.
 */
export function MapPicker({
  lat, lng, onChange, label = 'Location pin',
}: {
  lat: number | null | undefined
  lng: number | null | undefined
  onChange: (lat: number | null, lng: number | null) => void
  label?: string
}) {
  const { t } = useTranslation()
  const hasCoords = lat != null && lng != null && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng))
  const num = (v: string) => (v.trim() === '' ? null : Number(v))

  return (
    <div>
      <label className="form-label flex items-center gap-1"><MapPin size={13} /> {label}</label>
      <div className="grid grid-cols-2 gap-2">
        <input
          className="form-input" placeholder={t('ui.latitudePh')} inputMode="decimal"
          value={lat ?? ''} onChange={e => onChange(num(e.target.value), lng ?? null)}
        />
        <input
          className="form-input" placeholder={t('ui.longitudePh')} inputMode="decimal"
          value={lng ?? ''} onChange={e => onChange(lat ?? null, num(e.target.value))}
        />
      </div>
      <div className="flex items-center gap-3 mt-1.5">
        <a
          href="https://www.google.com/maps" target="_blank" rel="noreferrer"
          className="text-xs text-brand-red inline-flex items-center gap-1 hover:underline"
        >
          <ExternalLink size={11} />{t('ui.findOnGoogleMaps')}</a>
        {hasCoords && (
          <button type="button" onClick={() => onChange(null, null)} className="text-xs text-slate-400 hover:text-slate-600">{t('ui.clear')}</button>
        )}
      </div>
      {hasCoords && (
        <div className="mt-2 rounded-lg overflow-hidden border border-slate-200">
          <iframe
            title="map preview"
            className="w-full h-40"
            loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(lng) - 0.02}%2C${Number(lat) - 0.02}%2C${Number(lng) + 0.02}%2C${Number(lat) + 0.02}&layer=mapnik&marker=${lat}%2C${lng}`}
          />
        </div>
      )}
    </div>
  )
}
