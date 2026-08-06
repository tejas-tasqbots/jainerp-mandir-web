import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPin, Crosshair, Loader2 } from 'lucide-react'

/**
 * Interactive location picker built on Leaflet + OpenStreetMap (no API key).
 * - Click anywhere on the map to drop/move the pin.
 * - Drag the pin to fine-tune.
 * - "Use my current location" reads the browser's geolocation.
 * The raw lat/lng are hidden — the caller just gets coordinates back.
 *
 * A CSS pin marker (divIcon) is used so no image assets are needed.
 */
const PIN = L.divIcon({
  html: `<div style="font-size:28px;line-height:1;transform:translate(-50%,-90%)">📍</div>`,
  className: '',
  iconSize: [0, 0],
})

export function LocationPicker({
  lat, lng, onChange, height = 220,
}: {
  lat: number | null | undefined
  lng: number | null | undefined
  onChange: (lat: number, lng: number) => void
  height?: number
}) {
  const { t } = useTranslation()
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const onChangeRef = useRef(onChange)
  // Assigned in an effect, not during render: writing a ref while rendering is
  // impure, and under concurrent rendering React may render twice and throw one
  // pass away, so the ref could end up pointing at a discarded closure.
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  const [locating, setLocating] = useState(false)
  const [geoErr, setGeoErr] = useState('')

  const hasCoords = lat != null && lng != null && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng))

  // Init map once.
  useEffect(() => {
    if (!elRef.current || mapRef.current) return
    const start: [number, number] = hasCoords ? [Number(lat), Number(lng)] : [22.9734, 78.6569] // India centroid
    const map = L.map(elRef.current, { attributionControl: false }).setView(start, hasCoords ? 14 : 4)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
    map.on('click', (e: L.LeafletMouseEvent) => setPin(e.latlng.lat, e.latlng.lng))
    mapRef.current = map
    if (hasCoords) placeMarker(Number(lat), Number(lng))
    // Fix tiles not rendering when the container was hidden at mount (modals/tabs).
    setTimeout(() => map.invalidateSize(), 0)
    return () => { map.remove(); mapRef.current = null; markerRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reflect external coord changes onto the map.
  useEffect(() => {
    if (!mapRef.current) return
    if (hasCoords) {
      placeMarker(Number(lat), Number(lng))
      mapRef.current.setView([Number(lat), Number(lng)], Math.max(mapRef.current.getZoom(), 13))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng])

  function placeMarker(la: number, ln: number) {
    const map = mapRef.current!
    if (markerRef.current) markerRef.current.setLatLng([la, ln])
    else {
      const m = L.marker([la, ln], { icon: PIN, draggable: true }).addTo(map)
      m.on('dragend', () => { const p = m.getLatLng(); onChangeRef.current(round(p.lat), round(p.lng)) })
      markerRef.current = m
    }
  }

  function setPin(la: number, ln: number) {
    placeMarker(la, ln)
    onChangeRef.current(round(la), round(ln))
  }

  function useMyLocation() {
    if (!window.isSecureContext) {
      setGeoErr('Live location needs a secure (HTTPS) connection. Tap the map or drag the pin to set the location instead.')
      return
    }
    if (!navigator.geolocation) { setGeoErr('Geolocation not supported by this browser'); return }
    setLocating(true); setGeoErr('')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false)
        const la = pos.coords.latitude, ln = pos.coords.longitude
        mapRef.current?.setView([la, ln], 15)
        setPin(la, ln)
      },
      (err) => { setLocating(false); setGeoErr(err.code === 1 ? 'Location permission denied' : 'Could not get your location') },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="form-label flex items-center gap-1 mb-0"><MapPin size={13} />{t('ui.locationOnMap')}</label>
        <button type="button" onClick={useMyLocation} disabled={locating} className="text-xs text-brand-red inline-flex items-center gap-1 hover:underline disabled:opacity-50">
          {locating ? <Loader2 size={12} className="animate-spin" /> : <Crosshair size={12} />} Use my current location
        </button>
      </div>
      <div ref={elRef} style={{ height }} className="rounded-lg overflow-hidden border border-slate-200 z-0" />
      <p className="text-[11px] text-slate-400 mt-1">
        {hasCoords ? `Pinned at ${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)} · tap the map or drag the pin to adjust` : 'Tap on the map to drop a pin, or use your current location'}
      </p>
      {geoErr && <p className="text-[11px] text-amber-600 mt-0.5">{geoErr}</p>}
    </div>
  )
}

function round(n: number) { return Math.round(n * 1e6) / 1e6 }
