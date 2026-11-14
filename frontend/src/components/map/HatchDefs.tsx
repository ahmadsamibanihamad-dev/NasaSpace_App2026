import { useEffect } from 'react'
import { useMap } from 'react-leaflet'

/** Injects an SVG hatch pattern into Leaflet's overlay SVG so excluded plots can use fill="url(#hatch)". */
export function HatchDefs() {
  const map = useMap()
  useEffect(() => {
    const ensure = () => {
      const svg = map.getPanes().overlayPane.querySelector('svg')
      if (!svg || svg.querySelector('#hatch')) return
      const ns = 'http://www.w3.org/2000/svg'
      const defs = document.createElementNS(ns, 'defs')
      defs.innerHTML =
        '<pattern id="hatch" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)"><rect width="8" height="8" fill="#F6F6F4"/><line x1="0" y1="0" x2="0" y2="8" stroke="#9A9F9A" stroke-width="2"/></pattern>'
      svg.insertBefore(defs, svg.firstChild)
    }
    ensure()
    map.on('layeradd zoomend', ensure)
    return () => {
      map.off('layeradd zoomend', ensure)
    }
  }, [map])
  return null
}
