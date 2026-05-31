import { useMemo } from 'react';
import { Map, Marker, Source, Layer, NavigationControl } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

// Free OpenStreetMap raster tiles — no API key required. (Tile usage policy:
// limited to small-scale apps; for higher traffic switch to a paid provider.)
const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export default function DeviceMap({ points = [], latestPoint, height = 220 }) {
  const allPoints = useMemo(() => {
    const p = [];
    for (const pt of points) {
      if (pt && pt.lat != null && pt.lon != null) p.push({ lat: Number(pt.lat), lon: Number(pt.lon), ts: pt.recorded_at });
    }
    if (latestPoint && latestPoint.lat != null && latestPoint.lon != null) {
      // ensure latest is included even if not in points
      const has = p.find(x => x.lat === Number(latestPoint.lat) && x.lon === Number(latestPoint.lon));
      if (!has) p.push({ lat: Number(latestPoint.lat), lon: Number(latestPoint.lon), ts: latestPoint.recorded_at });
    }
    return p;
  }, [points, latestPoint]);

  if (allPoints.length === 0) {
    return (
      <div className="flex items-center justify-center bg-slate-100 text-slate-400 text-sm" style={{ height }}>
        No location data
      </div>
    );
  }

  // Center on latest known point
  const center = allPoints[allPoints.length - 1];

  const lineGeoJson = allPoints.length >= 2 ? {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: allPoints.map(p => [p.lon, p.lat]),
    },
  } : null;

  return (
    <div style={{ height }}>
      <Map
        initialViewState={{ longitude: center.lon, latitude: center.lat, zoom: 14 }}
        mapStyle={OSM_STYLE}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
      >
        <NavigationControl position="top-right" showCompass={false} />
        {lineGeoJson && (
          <Source id="device-trail" type="geojson" data={lineGeoJson}>
            <Layer id="trail-line" type="line"
              paint={{ 'line-color': '#3b82f6', 'line-width': 3, 'line-opacity': 0.7 }} />
          </Source>
        )}
        {allPoints.map((p, i) => (
          <Marker key={i} longitude={p.lon} latitude={p.lat} anchor="center">
            <div className={`w-3 h-3 rounded-full border-2 border-white shadow-md
              ${i === allPoints.length - 1 ? 'bg-red-500' : 'bg-blue-500'}`} />
          </Marker>
        ))}
      </Map>
    </div>
  );
}
