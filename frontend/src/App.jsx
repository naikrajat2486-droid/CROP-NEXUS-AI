import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Route, Routes, useParams } from 'react-router-dom';
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import { Line, LineChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import L from 'leaflet';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Boxes,
  Check, ChevronDown, CircleDot, Clock3, Leaf, MapPin, Navigation, Package,
  Radio, RefreshCw, ShieldCheck, Signal, Square, Truck
} from 'lucide-react';
import 'leaflet/dist/leaflet.css';

const API = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';
const number = value => Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const formatTime = value => value ? new Date(value).toLocaleString() : 'Not recorded';
const money = value => value == null ? '—' : `₹${number(value)}`;
const isSampleSource = source => /demo|sample/i.test(source || '');
const marketDateValue = value => {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  const local = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value || '');
  const dashed = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value || '');
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  if (local) return Date.UTC(Number(local[3]), Number(local[2]) - 1, Number(local[1]));
  if (dashed) return Date.UTC(Number(dashed[3]), Number(dashed[2]) - 1, Number(dashed[1]));
  return Number.NaN;
};

async function request(path, options) {
  const response = await fetch(API + path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    throw new Error(typeof detail === 'string' ? detail : detail?.message || `Request failed (${response.status})`);
  }
  return data;
}

function Shell({ children }) {
  return <div className="workspace">
    <aside className="sidebar">
      <Link to="/" className="brand"><span className="brand-mark"><Leaf size={21}/></span><span>CropNexus <b>AI</b><small>AGRI INTELLIGENCE</small></span></Link>
      <div className="nav-caption">WORKSPACE</div>
      <nav className="side-nav">
        <NavLink end to="/"><BarChart3 size={18}/>Dashboard</NavLink>
        <NavLink to="/gps"><Navigation size={18}/>GPS Traceability</NavLink>
        <NavLink to="/markets"><Activity size={18}/>Market Intelligence</NavLink>
      </nav>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><span className="topbar-kicker">CROPNEXUS / OPERATIONS</span><strong>Supply chain overview</strong></div><div className="topbar-right"><span className="live-tag"><CircleDot size={11}/> DATA FROM YOUR DATABASE</span></div></header>
      <div className="page-content">{children}</div>
      <footer>CropNexus AI · Agri supply-chain intelligence</footer>
    </main>
  </div>;
}

function PageTitle({ eyebrow, title, description, action }) {
  return <div className="page-title"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Metric({ icon: Icon, label, value, note, tone = 'green' }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={19}/></div><div className="metric-label">{label}</div><strong>{value}</strong><small>{note}</small></article>;
}

function CreateBatch() {
  const [crops, setCrops] = useState([]);
  const [form, setForm] = useState({ farmer_name: '', crop_name: '', quantity_kg: 100, origin: '', notes: '' });
  const [created, setCreated] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { request('/api/crops').then(items => { setCrops(items); if (items.length) setForm(current => ({ ...current, crop_name: current.crop_name || items[0].name })); }).catch(e => setError(e.message)); }, []);

  async function submit(event) {
    event.preventDefault();
    setError(''); setCreated(null);
    try {
      const batch = await request('/api/batches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, quantity_kg: Number(form.quantity_kg) }) });
      setCreated(batch);
    } catch (e) { setError(e.message); }
  }

  return <section className="card batch-create">
    <div className="card-heading"><div><div className="eyebrow">EXISTING QR WORKFLOW</div><h2>Create a traceable batch</h2><p>Keep the original batch and QR verification flow.</p></div><Boxes size={21}/></div>
    <form className="batch-form" onSubmit={submit}>
      <label>Farmer / producer<input required minLength="2" value={form.farmer_name} onChange={e => setForm({ ...form, farmer_name: e.target.value })}/></label>
      <label>Crop<select required value={form.crop_name} onChange={e => setForm({ ...form, crop_name: e.target.value })}>{crops.map(crop => <option key={crop.name}>{crop.name}</option>)}</select></label>
      <label>Quantity (kg)<input required type="number" min="0.1" step="0.1" value={form.quantity_kg} onChange={e => setForm({ ...form, quantity_kg: e.target.value })}/></label>
      <label>Origin / village<input required minLength="2" value={form.origin} onChange={e => setForm({ ...form, origin: e.target.value })}/></label>
      <label className="full-width">Notes (optional)<textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}/></label>
      <button className="button primary-button" type="submit">Generate batch QR <ChevronDown size={15}/></button>
    </form>
    {error && <div className="inline-error"><AlertTriangle size={16}/>{error}</div>}
    {created && <div className="batch-created"><img src={API + created.qr_image_url} alt="Batch QR code"/><div><b>{created.batch_id}</b><p>{created.message}</p><a href={API + created.qr_image_url} download>Download QR</a><Link to={`/verify/${created.batch_id}`}>Verify batch</Link><Link to="/gps">Start GPS tracking</Link></div></div>}
  </section>;
}

function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [batches, setBatches] = useState([]);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const [data, batchRows] = await Promise.all([request('/api/dashboard'), request('/api/batches')]);
      setSummary(data); setBatches(batchRows); setError('');
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); const timer = window.setInterval(load, 15000); return () => window.clearInterval(timer); }, [load]);
  const availablePrices = summary?.market_prices || [];

  return <><PageTitle eyebrow="FIELD OPERATIONS / OVERVIEW" title="Crop operations overview" description="Your crop batches, location signals and market records in one place." action={<button className="button outline-button" onClick={load}><RefreshCw size={15}/>Refresh data</button>}/>
    {error && <div className="inline-error"><AlertTriangle size={16}/>{error}</div>}
    <div className="metric-grid">
      <Metric icon={Truck} label="ACTIVE SHIPMENTS" value={summary?.active_shipments ?? '—'} note={summary?.active_shipments ? 'Receiving device GPS updates' : 'No active tracking sessions'} tone="green"/>
      <Metric icon={Package} label="REGISTERED BATCHES" value={summary?.total_batches ?? '—'} note="Registered crop lots" tone="blue"/>
      <Metric icon={Signal} label="GPS STATUS" value={summary?.active_gps_sessions ? 'Tracking' : 'Standby'} note={summary?.gps_status || 'Waiting for backend'} tone="orange"/>
      <Metric icon={ShieldCheck} label="TRACEABILITY COVERAGE" value={summary ? `${summary.traceability_percent}%` : '—'} note={summary ? `${summary.tracked_batches} of ${summary.total_batches} batches have GPS history` : 'Stored GPS checkpoints'} tone="purple"/>
    </div>
    <div className="dashboard-grid">
      <section className="card activity-card"><div className="card-heading"><div><div className="eyebrow">LOCATION HISTORY</div><h2>Recent GPS activity</h2></div><Link to="/gps" className="text-link">Open tracking <span>→</span></Link></div>
        {summary?.recent_activity?.length ? <div className="activity-list">{summary.recent_activity.map((item, index) => <div className="activity-row" key={`${item.batch_id}-${item.recorded_at}-${index}`}><div className="activity-pin"><MapPin size={16}/></div><div className="activity-detail"><b>{item.batch_id} <span>· {item.crop_name}</span></b><small>{number(item.latitude)}, {number(item.longitude)} · ±{number(item.accuracy_m)} m</small></div><time>{formatTime(item.recorded_at)}</time></div>)}</div> : <div className="empty-state"><MapPin size={23}/><b>No GPS checkpoints yet</b><span>Start tracking a registered batch to see real device locations here.</span><Link to="/gps" className="text-link">Go to GPS traceability →</Link></div>}
      </section>
      <section className="card alerts-card"><div className="card-heading"><div><div className="eyebrow">NEEDS ATTENTION</div><h2>Shipment alerts</h2></div><AlertTriangle size={19}/></div>
        {summary?.alerts?.length ? <div className="alert-list">{summary.alerts.map(item => <div className="alert-row" key={item.batch_id}><span><AlertTriangle size={15}/></span><div><b>{item.batch_id}</b><small>{item.message}</small></div><Link to="/gps">Review</Link></div>)}</div> : <div className="empty-state compact"><Check size={22}/><b>No shipment alerts</b><span>There are no batch records requiring GPS follow-up.</span></div>}
      </section>
    </div>
    <div className="dashboard-lower">
      <section className="card"><div className="card-heading"><div><div className="eyebrow">PRICE SNAPSHOT</div><h2>Stored market prices</h2></div><Link to="/markets" className="text-link">Market intelligence →</Link></div>
        {availablePrices.length ? <div className="price-list">{availablePrices.map((item, index) => <div className="price-row" key={`${item.crop_name}-${item.market_name}-${index}`}><div><b>{item.crop_name}</b><small>{item.market_name} · {item.district}</small></div><strong>{money(item.price_per_quintal)}<small>/ quintal</small></strong>{!isSampleSource(item.source) && <span className="source-live">{item.source}</span>}</div>)}</div> : <p className="muted-copy">No market prices are currently stored.</p>}
      </section>
      <CreateBatch/>
    </div>
    <section className="card shipment-table"><div className="card-heading"><div><div className="eyebrow">BATCH REGISTER</div><h2>Crop shipments</h2></div><Link to="/gps" className="button small-button"><Navigation size={14}/>Track a batch</Link></div>
      {batches.length ? <div className="table-scroll"><table><thead><tr><th>Batch ID</th><th>Crop</th><th>Quantity</th><th>Origin</th><th>Created</th><th>QR</th></tr></thead><tbody>{batches.map(batch => <tr key={batch.batch_id}><td><b>{batch.batch_id}</b></td><td>{batch.crop_name}</td><td>{number(batch.quantity_kg)} kg</td><td>{batch.origin}</td><td>{formatTime(batch.created_at)}</td><td><Link to={`/verify/${batch.batch_id}`}>Verify →</Link></td></tr>)}</tbody></table></div> : <div className="empty-state compact"><Package size={22}/><b>No batches registered</b><span>Create your first batch above; its QR verification stays available.</span></div>}
    </section>
  </>;
}

function MapMarker({ kind, label, position }) {
  const icon = useMemo(() => L.divIcon({ className: 'custom-marker', html: `<span class="pin ${kind}"></span>`, iconSize: [19, 19], iconAnchor: [9, 9] }), [kind]);
  return <Marker position={position} icon={icon}><Popup>{label}</Popup></Marker>;
}

function FitMap({ points, destination }) {
  const map = useMap();
  useEffect(() => {
    const bounds = [...points, ...(destination ? [destination] : [])];
    if (bounds.length > 1) map.fitBounds(bounds, { padding: [35, 35] });
    else if (bounds.length === 1) map.setView(bounds[0], 14);
  }, [map, points, destination]);
  return null;
}

function GPSMap({ checkpoints, market, route }) {
  const origin = checkpoints.length ? [checkpoints[0].latitude, checkpoints[0].longitude] : null;
  const latest = checkpoints.length ? checkpoints[checkpoints.length - 1] : null;
  const center = latest ? [latest.latitude, latest.longitude] : null;
  const destination = market && Number.isFinite(Number(market.latitude)) && Number.isFinite(Number(market.longitude))
    ? [Number(market.latitude), Number(market.longitude)] : null;
  const mapCenter = center || destination;
  if (!mapCenter) return <div className="map-empty"><MapPin size={30}/><b>Select a market to show its location</b><span>Your actual farm location appears after a device GPS fix.</span></div>;
  const trails = [];
  for (const point of checkpoints) {
    const key = point.session_id ?? 'current-session';
    let trail = trails.find(item => item.sessionId === key);
    if (!trail) {
      trail = { sessionId: key, positions: [] };
      trails.push(trail);
    }
    trail.positions.push([point.latitude, point.longitude]);
  }
  const actualTrail = checkpoints.map(point => [point.latitude, point.longitude]);
  return <MapContainer center={mapCenter} zoom={center ? 13 : 11} scrollWheelZoom className="gps-map">
    <TileLayer className="dark-map-tiles" attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/>
    <FitMap points={actualTrail} destination={destination}/>
    {origin && <MapMarker position={origin} kind="origin" label="Actual GPS origin"/>}
    {destination && <MapMarker position={destination} kind="destination" label={market.name}/>}
    {center && <MapMarker position={center} kind="current" label="Latest device GPS"/>}
    {route?.length > 1 && <Polyline positions={route} pathOptions={{ color: '#f3b34d', weight: 3, dashArray: '4 9', opacity: .95 }}/>}
    {trails.map(trail => trail.positions.length > 1 && <React.Fragment key={trail.sessionId}>
      <Polyline positions={trail.positions} pathOptions={{ color: '#59f0ad', weight: 12, opacity: .2, lineCap: 'round', lineJoin: 'round' }}/>
      <Polyline positions={trail.positions} pathOptions={{ className: 'actual-trail-glow', color: '#72ffc0', weight: 4, opacity: 1, lineCap: 'round', lineJoin: 'round' }}/>
    </React.Fragment>)}
    {checkpoints.map((point, index) => index > 0 && index < checkpoints.length - 1 &&
      <CircleMarker key={`${point.session_id}-${point.recorded_at}-${index}`} center={[point.latitude, point.longitude]} radius={4} pathOptions={{ color: '#eafff5', weight: 2, fillColor: '#43d994', fillOpacity: 1 }}/>
    )}
  </MapContainer>;
}

function GPSTraceability() {
  const [batches, setBatches] = useState([]);
  const [markets, setMarkets] = useState([]);
  const [batchId, setBatchId] = useState('');
  const [marketId, setMarketId] = useState('');
  const [history, setHistory] = useState({ status: 'not_started', checkpoints: [], latest: null });
  const [session, setSession] = useState(null);
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState('');
  const [route, setRoute] = useState([]);
  const [routeError, setRouteError] = useState('');
  const watchRef = useRef(null);
  const sessionRef = useRef(null);
  const pendingFixesRef = useRef([]);
  const sendingRef = useRef(false);
  const selectedMarket = markets.find(market => String(market.id) === marketId) || null;

  const loadHistory = useCallback(async id => {
    if (!id) { setHistory({ status: 'not_started', checkpoints: [], latest: null }); return; }
    try { setHistory(await request(`/api/batches/${encodeURIComponent(id)}/tracking`)); }
    catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    Promise.all([request('/api/batches'), request('/api/markets')]).then(([batchRows, marketRows]) => {
      setBatches(batchRows); setMarkets(marketRows);
      if (batchRows.length) setBatchId(batchRows[0].batch_id);
      if (marketRows.length) setMarketId(String(marketRows[0].id));
    }).catch(e => setError(e.message));
  }, []);
  useEffect(() => { if (batchId) loadHistory(batchId); }, [batchId, loadHistory]);
  useEffect(() => {
    let active = true;
    async function fetchRoute() {
      const points = history.checkpoints || [];
      if (!points.length || !selectedMarket) { setRoute([]); setRouteError(''); return; }
      setRoute([]);
      setRouteError('');
      const origin = points[0];
      const url = `https://router.project-osrm.org/route/v1/driving/${origin.longitude},${origin.latitude};${selectedMarket.longitude},${selectedMarket.latitude}?overview=full&geometries=geojson`;
      try {
        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok || data.code !== 'Ok' || !data.routes?.[0]?.geometry?.coordinates) throw new Error('OSRM did not return an estimated road route.');
        if (active) setRoute(data.routes[0].geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]));
      } catch (e) { if (active) setRouteError(e.message || 'Estimated road route is unavailable.'); }
    }
    fetchRoute();
    return () => { active = false; };
  }, [history.checkpoints, selectedMarket]);

  const stopDeviceWatch = () => {
    if (watchRef.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchRef.current);
    watchRef.current = null; setWatching(false);
  };
  const stopServerSession = async sessionInfo => {
    if (!sessionInfo) return;
    try {
      await request(`/api/batches/${encodeURIComponent(sessionInfo.batch_id)}/tracking/${sessionInfo.session_id}/stop`, { method: 'POST' });
      setSession(null); sessionRef.current = null;
      if (batchId === sessionInfo.batch_id) await loadHistory(sessionInfo.batch_id);
    } catch (e) { setError(e.message); }
  };
  const stopTracking = async () => {
    stopDeviceWatch();
    await stopServerSession(sessionRef.current || session);
  };

  const recordPosition = async position => {
    const fix = {
      session_id: sessionRef.current?.session_id,
      latitude: position.coords.latitude, longitude: position.coords.longitude,
      accuracy_m: position.coords.accuracy, recorded_at: new Date(position.timestamp).toISOString()
    };
    setHistory(current => ({
      ...current, status: 'tracking',
      latest: { ...fix },
      checkpoints: [...(current.checkpoints || []), fix]
    }));
    setError('');
    pendingFixesRef.current.push(fix);
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      while (pendingFixesRef.current.length) {
        const info = sessionRef.current;
        if (!info) throw new Error('Tracking session is not available.');
        const queuedFix = pendingFixesRef.current.shift();
        const { session_id: _sessionId, ...location } = queuedFix;
        await request(`/api/batches/${encodeURIComponent(info.batch_id)}/tracking/${info.session_id}/locations`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(location)
        });
      }
    } catch (e) {
      pendingFixesRef.current = [];
      setError(`GPS fix received but could not be saved: ${e.message}`);
      stopDeviceWatch();
      if (sessionRef.current) await stopServerSession(sessionRef.current);
    }
    finally { sendingRef.current = false; }
  };
  const locationError = errorObject => {
    const message = errorObject.code === 1 ? 'Location permission was denied. Allow location access in your browser and try again.'
      : errorObject.code === 2 ? 'The device could not determine a location. Check GPS/location services and try again.'
        : errorObject.code === 3 ? 'GPS location request timed out. Check device signal and try again.'
          : 'Device geolocation is unavailable in this browser.';
    setError(message);
    stopDeviceWatch();
    if (sessionRef.current) stopServerSession(sessionRef.current);
  };
  const startTracking = async () => {
    setError('');
    if (!batchId) { setError('Create or select a batch before tracking.'); return; }
    if (!navigator.geolocation) { setError('This browser does not provide Geolocation.'); return; }
    try {
      const created = await request(`/api/batches/${encodeURIComponent(batchId)}/tracking/start`, { method: 'POST' });
      sessionRef.current = created; setSession(created); setWatching(true);
      watchRef.current = navigator.geolocation.watchPosition(recordPosition, locationError, {
        enableHighAccuracy: true, maximumAge: 0, timeout: 20000
      });
    } catch (e) {
      setError(e.message);
      setWatching(false);
      if (sessionRef.current) await stopServerSession(sessionRef.current);
    }
  };
  useEffect(() => () => {
    stopDeviceWatch();
    const info = sessionRef.current;
    if (info) fetch(`${API}/api/batches/${encodeURIComponent(info.batch_id)}/tracking/${info.session_id}/stop`, { method: 'POST' }).catch(() => {});
  }, []);

  const checkpoints = history.checkpoints || [];
  const latest = history.latest || checkpoints[checkpoints.length - 1] || null;
  const origin = checkpoints[0] || null;
  return <><PageTitle eyebrow="LIVE FIELD SIGNALS / BATCH ROUTE" title="GPS traceability" description="Capture real device GPS fixes and review the timestamped location history." action={<span className={`tracking-pill ${watching ? 'is-live' : ''}`}><span/>{watching ? 'DEVICE TRACKING' : history.status === 'tracking' ? 'SAVED SESSION' : 'NOT TRACKING'}</span>}/>
    {error && <div className="inline-error"><AlertTriangle size={16}/>{error}</div>}
    {!batches.length && <div className="inline-notice">No batches exist. <Link to="/">Create a batch with its QR identity first →</Link></div>}
    <section className="card gps-controls">
      <label>Batch<select disabled={!batches.length || watching} value={batchId} onChange={e => { setBatchId(e.target.value); setHistory({ status: 'not_started', checkpoints: [], latest: null }); setSession(null); sessionRef.current = null; }}><option value="">Select a registered batch</option>{batches.map(batch => <option value={batch.batch_id} key={batch.batch_id}>{batch.batch_id} · {batch.crop_name}</option>)}</select></label>
      <label>Destination market<select value={marketId} onChange={e => setMarketId(e.target.value)}><option value="">Select market</option>{markets.map(market => <option value={market.id} key={market.id}>{market.name} · {market.district}</option>)}</select></label>
      <div className="gps-buttons">{watching ? <button className="button stop-button" onClick={stopTracking}><Square size={15} fill="currentColor"/>Stop tracking</button> : <button className="button primary-button" disabled={!batchId} onClick={startTracking}><Radio size={16}/>Start tracking</button>}</div>
    </section>
    <div className="gps-layout">
      <section className="card map-card"><div className="map-heading"><div><div className="eyebrow">GEOGRAPHICAL TRACE</div><h2>{selectedMarket ? `Route to ${selectedMarket.name}` : 'Geographic traceability map'}</h2></div><span className="map-provider">OPENSTREETMAP</span></div>
        <GPSMap checkpoints={checkpoints} market={selectedMarket} route={route}/>
        <div className="map-legend"><span><i className="legend-origin"/>Actual GPS origin</span><span><i className="legend-trail"/>Recorded GPS trail</span><span><i className="legend-route"/>Estimated OSRM road route</span><span><i className="legend-destination"/>Destination</span></div>
        {routeError && <p className="route-notice">Estimated road route unavailable: {routeError}. The recorded GPS trail is unaffected.</p>}
      </section>
      <aside className="gps-side">
        <section className="card position-card"><div className="card-heading"><div><div className="eyebrow">LATEST DEVICE FIX</div><h2>Current position</h2></div><MapPin size={18}/></div>
          {latest ? <><div className="coord-pair"><div><small>LATITUDE</small><b>{Number(latest.latitude).toFixed(6)}</b></div><div><small>LONGITUDE</small><b>{Number(latest.longitude).toFixed(6)}</b></div></div><div className="position-meta"><span><Signal size={14}/>Accuracy ±{number(latest.accuracy_m)} m</span><span><Clock3 size={14}/>{formatTime(latest.recorded_at)}</span></div></> : <div className="position-empty">No actual GPS coordinates recorded for this batch.</div>}
          <div className="tracking-state"><span className={watching ? 'state-live' : 'state-idle'}/><div><b>{watching ? 'Device tracking active' : history.status === 'tracking' ? 'Session marked tracking in database' : 'Tracking stopped'}</b><small>{watching ? 'New device fixes are saved as they arrive.' : `Last position retained · ${formatTime(latest?.recorded_at)}`}</small></div></div>
        </section>
        <section className="card origin-card"><div className="eyebrow">ORIGIN & DESTINATION</div><div className="route-place"><span className="place-dot origin-dot"/><div><b>Farm GPS origin</b><small>{origin ? `${Number(origin.latitude).toFixed(5)}, ${Number(origin.longitude).toFixed(5)} · first actual fix` : 'Set by the first real device fix'}</small></div></div><div className="route-place"><span className="place-dot dest-dot"/><div><b>{selectedMarket?.name || 'No destination selected'}</b><small>{selectedMarket ? `${selectedMarket.district} · catalog market location` : 'Choose a destination market above'}</small></div></div></section>
      </aside>
    </div>
    <section className="card checkpoint-card"><div className="card-heading"><div><div className="eyebrow">PERSISTED GPS HISTORY</div><h2>Recorded checkpoints <span className="count-badge">{checkpoints.length}</span></h2></div><button className="button outline-button" onClick={() => loadHistory(batchId)} disabled={!batchId}><RefreshCw size={14}/>Reload history</button></div>
      {checkpoints.length ? <div className="table-scroll"><table><thead><tr><th>#</th><th>Recorded at</th><th>Latitude</th><th>Longitude</th><th>Accuracy</th><th>Source</th></tr></thead><tbody>{[...checkpoints].reverse().map((point, index) => <tr key={`${point.recorded_at}-${index}`}><td>{checkpoints.length - index}</td><td>{formatTime(point.recorded_at)}</td><td>{Number(point.latitude).toFixed(6)}</td><td>{Number(point.longitude).toFixed(6)}</td><td>±{number(point.accuracy_m)} m</td><td><span className="source-live">DEVICE GPS</span></td></tr>)}</tbody></table></div> : <div className="empty-state compact"><MapPin size={22}/><b>No checkpoints stored</b><span>Only actual browser geolocation fixes will appear here.</span></div>}
    </section>
    <div className="secure-context-note"><ShieldCheck size={16}/><span><b>Mobile access:</b> browser geolocation requires HTTPS on a phone. Localhost is permitted for development on the same computer; a LAN IP over plain HTTP is not a secure context.</span></div>
  </>;
}

const trendColors = ['#16865b', '#e29538', '#536bd1', '#c34b57', '#7b58b6', '#319bb0', '#9c7d41'];
function MarketIntelligence() {
  const [crops, setCrops] = useState([]);
  const [crop, setCrop] = useState('');
  const [rangeDays, setRangeDays] = useState(30);
  const [marketFilter, setMarketFilter] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [farm, setFarm] = useState({ latitude: '', longitude: '', quantity_kg: 1000, vehicle_cost_per_km: 12, selling_cost_percent: 2 });
  const [recommendation, setRecommendation] = useState(null);
  const [recommendationError, setRecommendationError] = useState('');
  const [comparing, setComparing] = useState(false);

  useEffect(() => { request('/api/crops').then(items => { setCrops(items); if (items.length) setCrop(items[0].name); }).catch(e => setError(e.message)); }, []);
  const loadMarketData = useCallback(async (selectedCrop = crop, days = rangeDays) => {
    if (!selectedCrop) return;
    setError('');
    try { setData(await request(`/api/market-intelligence?crop_name=${encodeURIComponent(selectedCrop)}&range_days=${days}`)); }
    catch (e) { setError(e.message); }
  }, [crop, rangeDays]);
  useEffect(() => { if (crop) loadMarketData(crop, rangeDays); }, [crop, rangeDays, loadMarketData]);

  const prices = data?.prices || [];
  const visiblePrices = marketFilter ? prices.filter(row => row.market_name === marketFilter) : prices;
  const hasHistoricalTrend = Boolean(data?.trend?.length);
  const chartData = useMemo(() => {
    if (!data?.trend?.length) {
      return visiblePrices.map(item => ({ market: item.market_name, storedPrice: item.modal_price }));
    }
    const byDate = new Map();
    for (const point of data.trend) {
      if (!byDate.has(point.date)) byDate.set(point.date, { date: point.date });
      byDate.get(point.date)[point.market_name] = point.modal_price;
    }
    return [...byDate.values()].sort((a, b) => marketDateValue(a.date) - marketDateValue(b.date));
  }, [data?.trend, visiblePrices]);
  const marketNames = useMemo(() => [...new Set((data?.trend || []).map(item => item.market_name))], [data?.trend]);
  const changes = useMemo(() => {
    const grouped = new Map();
    for (const point of data?.trend || []) {
      if (!grouped.has(point.market_name)) grouped.set(point.market_name, []);
      grouped.get(point.market_name).push(point);
    }
    return [...grouped.entries()].map(([name, rows]) => {
      rows.sort((a, b) => marketDateValue(a.date) - marketDateValue(b.date));
      const first = rows[0]?.modal_price, last = rows[rows.length - 1]?.modal_price;
      return { name, count: rows.length, change: rows.length > 1 && first ? ((last - first) / first) * 100 : null };
    });
  }, [data?.trend]);

  async function refreshLive() {
    setBusy(true); setNotice(''); setError('');
    try {
      const result = await request('/api/market-intelligence/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ crop_name: crop }) });
      setNotice(`${result.observations_saved} verified observation(s) stored from ${result.source}.`);
      await loadMarketData(crop, rangeDays);
    } catch (e) { setNotice(e.message); }
    finally { setBusy(false); }
  }
  async function compareMarkets(event) {
    event.preventDefault(); setComparing(true); setRecommendation(null); setRecommendationError('');
    try {
      const result = await request('/api/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ crop_name: crop, ...Object.fromEntries(Object.entries(farm).map(([key, value]) => [key, Number(value)])) }) });
      setRecommendation(result);
    } catch (e) { setRecommendationError(e.message); }
    finally { setComparing(false); }
  }
  return <><PageTitle eyebrow="PRICE DISCOVERY / KARNATAKA" title="Market intelligence" description="Compare recorded mandi prices and review trends only when dated observations exist." action={<button className="button outline-button" onClick={refreshLive} disabled={busy || !crop}><RefreshCw size={15} className={busy ? 'spin' : ''}/>{busy ? 'Refreshing…' : 'Fetch AGMARKNET'}</button>}/>
    {error && <div className="inline-error"><AlertTriangle size={16}/>{error}</div>}
    {notice && <div className={notice.startsWith('0 verified') || notice.includes('not configured') ? 'inline-notice' : 'inline-error'}><Activity size={16}/>{notice}</div>}
    <section className="card market-filters"><label>Crop<select value={crop} onChange={e => { setCrop(e.target.value); setMarketFilter(''); }} required>{crops.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label><label>State<select value="Karnataka" disabled><option>Karnataka</option></select></label><label>Market<select value={marketFilter} onChange={e => setMarketFilter(e.target.value)}><option value="">All available markets</option>{prices.map(item => <option key={`${item.market_name}-${item.district}`} value={item.market_name}>{item.market_name} · {item.district}</option>)}</select></label><span className="market-unit">All prices per quintal (₹)</span></section>
    <div className="market-price-grid">{visiblePrices.length ? visiblePrices.map(item => <article className="market-price-card" key={`${item.market_name}-${item.district}`}><div className="market-card-top"><span className="market-icon"><MapPin size={17}/></span>{!isSampleSource(item.source) && <span className="source-live">{item.source}</span>}</div><h3>{item.market_name}</h3><p>{item.district} district · Karnataka</p><div className="modal-price">{money(item.modal_price)}<small>/ quintal modal</small></div><div className="price-range"><span>Min<strong>{money(item.min_price)}</strong></span><span>Max<strong>{money(item.max_price)}</strong></span><span>Modal<strong>{money(item.modal_price)}</strong></span></div><div className="market-date"><Clock3 size={13}/>Arrival date: {item.price_date || 'Not provided'}</div></article>) : <div className="card empty-market">No market prices are currently stored.</div>}</div>
    <section className="card trend-card"><div className="card-heading"><div><div className="eyebrow">MARKET PRICES / MODAL RATE</div><h2>Price graph</h2><p>{hasHistoricalTrend ? 'Historical lines use dated price observations.' : 'Market comparison uses the prices currently stored for each market.'}</p></div><div className="range-switch">{hasHistoricalTrend ? [7, 30, 90].map(days => <button key={days} className={rangeDays === days ? 'selected' : ''} onClick={() => setRangeDays(days)}>{days} days</button>) : <span>Market comparison</span>}</div></div>
      {chartData.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}><CartesianGrid stroke="#edf1eb" vertical={false}/><XAxis dataKey={hasHistoricalTrend ? 'date' : 'market'} tick={{ fill: '#829087', fontSize: 11 }} axisLine={false} tickLine={false}/><YAxis tick={{ fill: '#829087', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={value => `₹${number(value)}`}/><Tooltip formatter={value => [money(value), 'Modal price / quintal']}/><Legend/>{hasHistoricalTrend ? marketNames.map((name, index) => <Line key={name} type="monotone" dataKey={name} stroke={trendColors[index % trendColors.length]} strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false}/>) : <Line type="monotone" name="Price per quintal" dataKey="storedPrice" stroke={trendColors[0]} strokeWidth={3} dot={{ r: 4 }} connectNulls={false}/>}</LineChart></ResponsiveContainer></div> : <div className="trend-empty"><BarChart3 size={28}/><b>No price data available</b><span>Market prices will appear here when they are stored.</span></div>}
    </section>
    <section className="card change-card"><div className="card-heading"><div><div className="eyebrow">OBSERVATION-BASED MOVEMENT</div><h2>Market-wise price change</h2></div><span className="muted-copy">{rangeDays}-day window · based on first and last stored modal rates</span></div>
      {changes.length ? <div className="change-grid">{changes.map(item => <div className="change-item" key={item.name}><div><b>{item.name}</b><small>{item.count} dated observation{item.count === 1 ? '' : 's'}</small></div><strong className={item.change == null ? 'neutral-change' : item.change >= 0 ? 'positive-change' : 'negative-change'}>{item.change == null ? '—' : <>{item.change >= 0 ? <ArrowUpRight size={16}/> : <ArrowDownRight size={16} />}{Math.abs(item.change).toFixed(1)}%</>}</strong></div>)}</div> : <p className="muted-copy">Percentage change is available after at least two genuine dated observations are stored for a market.</p>}
    </section>
    <section className="card recommendation-card"><div className="card-heading"><div><div className="eyebrow">NET-RETURN DECISION SUPPORT</div><h2>Market recommendation</h2><p>Reuses the existing OSRM road distance and net-return calculation.</p></div><Truck size={20}/></div>
      {prices.length ? <><form className="recommend-form" onSubmit={compareMarkets}><label>Farm latitude<input required type="number" min="-90" max="90" step="any" value={farm.latitude} onChange={e => setFarm({ ...farm, latitude: e.target.value })}/></label><label>Farm longitude<input required type="number" min="-180" max="180" step="any" value={farm.longitude} onChange={e => setFarm({ ...farm, longitude: e.target.value })}/></label><label>Quantity (kg)<input required type="number" min="1" value={farm.quantity_kg} onChange={e => setFarm({ ...farm, quantity_kg: e.target.value })}/></label><label>Vehicle cost (₹/km)<input required type="number" min="0" step="0.1" value={farm.vehicle_cost_per_km} onChange={e => setFarm({ ...farm, vehicle_cost_per_km: e.target.value })}/></label><label>Selling costs (%)<input required type="number" min="0" max="100" step="0.1" value={farm.selling_cost_percent} onChange={e => setFarm({ ...farm, selling_cost_percent: e.target.value })}/></label><button className="button primary-button" disabled={comparing}>{comparing ? 'Calculating…' : 'Calculate net return'}<ChevronDown size={15}/></button></form>
        {recommendationError && <div className="inline-error">{recommendationError}</div>}
        {recommendation?.results?.length > 0 && <div className="recommend-result"><div><Check size={17}/><span>Best available route-adjusted option</span><b>{recommendation.results[0].market_name}</b></div><strong>{money(recommendation.results[0].estimated_net_return)}<small> estimated net return</small></strong>{!isSampleSource(recommendation.results[0].price_source) && <small className="recommend-source">{recommendation.results[0].price_source} · {recommendation.results[0].price_date} · This is an estimate, not guaranteed sale proceeds.</small>}</div>}</>
        : <p className="muted-copy">A recommendation will appear when current market prices are available.</p>}
    </section>
  </>;
}

function Verify() {
  const { batchId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { request(`/api/verify/${encodeURIComponent(batchId)}`).then(setData).catch(e => setError(e.message)); }, [batchId]);
  return <div className="verify-page"><div className="eyebrow">CROPNEXUS / BATCH VERIFICATION</div><h1>Batch verification</h1>{data ? <section className="card verify-card"><div className="verified"><Check size={15}/>{data.verification_status}</div><h2>{data.batch_id}</h2><dl>{[['Farmer', data.farmer_name], ['Crop', data.crop_name], ['Quantity', `${data.quantity_kg} kg`], ['Origin', data.origin], ['Created', formatTime(data.created_at)], ['Notes', data.notes || '—']].map(([key, value]) => <React.Fragment key={key}><dt>{key}</dt><dd>{value}</dd></React.Fragment>)}</dl><p className="muted-copy">This confirms that the batch record exists in the CropNexus AI database. It does not independently certify crop quality or origin.</p></section> : error ? <div className="inline-error">{error}</div> : <p>Checking batch record…</p>}<Link className="button primary-button" to="/">← Back to dashboard</Link></div>;
}

export default function App() {
  return <Routes><Route path="/" element={<Shell><Dashboard/></Shell>}/><Route path="/gps" element={<Shell><GPSTraceability/></Shell>}/><Route path="/markets" element={<Shell><MarketIntelligence/></Shell>}/><Route path="/verify/:batchId" element={<Shell><Verify/></Shell>}/></Routes>;
}
