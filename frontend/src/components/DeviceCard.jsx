import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { api } from '../api/client';
import Modal from './Modal';
import DeviceMap from './DeviceMap';
import EnrollDeviceModal from './EnrollDeviceModal';

dayjs.extend(relativeTime);

const ONLINE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

function StatusDot({ device }) {
  if (!device) return null;
  let color = 'bg-slate-300';
  let label = 'Unknown';
  if (device.last_seen_at) {
    const ageMs = Date.now() - new Date(device.last_seen_at).getTime();
    if (ageMs < ONLINE_THRESHOLD_MS) { color = 'bg-emerald-500'; label = 'Online'; }
    else if (ageMs < 7 * 24 * 60 * 60 * 1000) { color = 'bg-amber-500'; label = 'Stale'; }
    else { color = 'bg-red-500'; label = 'Offline'; }
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

export default function DeviceCard({ order, onChanged }) {
  const [device, setDevice] = useState(null);
  const [lastCommand, setLastCommand] = useState(null);
  const [latestLocation, setLatestLocation] = useState(null);
  const [recentPoints, setRecentPoints] = useState([]);
  const [busy, setBusy] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyPoints, setHistoryPoints] = useState([]);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [lockForm, setLockForm] = useState({ reason: '', lock_message: '' });
  const [error, setError] = useState('');

  const load = async () => {
    if (!order.device_imei) { setDevice(null); return; }
    try {
      const { data } = await api.get(`/devices/${order.device_imei}/status`);
      setDevice(data.device || null);
      setLastCommand(data.last_command || null);
      setLatestLocation(data.latest_location || null);
      // Pull last 5 points (~last 24h max) for the polyline
      const since = dayjs().subtract(24, 'hour').toISOString();
      const { data: locs } = await api.get(`/devices/${order.device_imei}/locations`, {
        params: { from: since },
      });
      setRecentPoints((locs || []).slice(-5));
    } catch (e) {
      // 404 means not enrolled yet — fall through
      setDevice(null);
    }
  };

  useEffect(() => { load(); }, [order.device_imei]);

  const openLock = () => {
    setLockForm({ reason: '', lock_message: '' });
    setError('');
    setLockOpen(true);
  };

  const submitLock = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(`/orders/${order.id}/lock`, lockForm);
      setLockOpen(false);
      await load();
      onChanged && onChanged();
    } catch (e2) {
      setError(e2?.response?.data?.error || 'Lock failed');
    } finally {
      setBusy(false);
    }
  };

  const doUnlock = async () => {
    if (!window.confirm('Unlock this device?')) return;
    setBusy(true);
    try {
      await api.post(`/orders/${order.id}/unlock`, { reason: 'Operator initiated' });
      await load();
      onChanged && onChanged();
    } catch (e) {
      alert(e?.response?.data?.error || 'Unlock failed');
    } finally {
      setBusy(false);
    }
  };

  const doLocate = async () => {
    if (!device) return;
    setBusy(true);
    try {
      await api.post(`/devices/${device.imei}/locate`);
      alert('Locate request sent. The device will report its position on its next heartbeat (usually within ~1 minute on Wi-Fi).');
      await load();
    } catch (e) {
      alert(e?.response?.data?.error || 'Locate failed');
    } finally {
      setBusy(false);
    }
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    const from = dayjs().subtract(30, 'day').toISOString();
    try {
      const { data } = await api.get(`/devices/${order.device_imei}/locations`, { params: { from } });
      setHistoryPoints(data || []);
    } catch (e) {
      setHistoryPoints([]);
    }
  };

  // Not enrolled yet
  if (!order.device_imei) {
    return (
      <div className="card mb-6 border-dashed border-2 border-slate-300 bg-slate-50">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-slate-700">Device not enrolled</div>
            <div className="text-sm text-slate-500 mt-1">
              Enroll the customer's phone to enable remote lock, location tracking, and SIM-swap alerts.
            </div>
          </div>
          <button className="btn-primary" onClick={() => setEnrollOpen(true)}>+ Enroll Device</button>
        </div>
        <EnrollDeviceModal
          open={enrollOpen}
          onClose={() => setEnrollOpen(false)}
          orderId={order.id}
          onEnrolled={async () => { setEnrollOpen(false); await load(); onChanged && onChanged(); }}
        />
      </div>
    );
  }

  const locked = order.device_locked;
  const lockBadge = locked
    ? <span className="badge-red">Locked</span>
    : <span className="badge-green">Unlocked</span>;

  return (
    <div className="card mb-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h3 className="font-semibold text-slate-900">Device</h3>
            {lockBadge}
            <StatusDot device={device} />
            {lastCommand?.status === 'queued' || lastCommand?.status === 'sent'
              ? <span className="badge-yellow">Cmd {lastCommand.action} {lastCommand.status}</span>
              : null}
          </div>
          <div className="text-xs text-slate-500 font-mono">
            IMEI: {order.device_imei}
            <button onClick={() => navigator.clipboard.writeText(order.device_imei)}
              className="ml-2 text-brand-600 hover:underline">copy</button>
          </div>
        </div>
        <div className="flex gap-2">
          {!locked && (
            <button onClick={openLock} disabled={busy} className="btn-danger">Lock</button>
          )}
          {locked && (
            <button onClick={doUnlock} disabled={busy} className="btn-primary">Unlock</button>
          )}
          <button onClick={doLocate} disabled={busy} className="btn-secondary">Locate now</button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
        <div>
          <div className="text-xs text-slate-500">Last Seen</div>
          <div className="font-medium">{device?.last_seen_at ? dayjs(device.last_seen_at).fromNow() : '—'}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Battery</div>
          <div className="font-medium">{device?.last_battery != null ? `${device.last_battery}%` : '—'}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Network</div>
          <div className="font-medium capitalize">{device?.last_network || '—'}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Current SIM</div>
          <div className="font-medium font-mono text-xs truncate" title={device?.current_sim_serial || ''}>
            {device?.current_sim_serial || '—'}
          </div>
        </div>
      </div>

      <div className="rounded-lg overflow-hidden border border-slate-200 mb-3">
        <DeviceMap
          height={220}
          latestPoint={latestLocation}
          points={recentPoints}
        />
      </div>

      <div className="flex justify-between text-xs">
        <div className="text-slate-500">
          {latestLocation
            ? `Last fix: ${latestLocation.lat.toFixed(5)}, ${latestLocation.lon.toFixed(5)} ` +
              `(±${latestLocation.accuracy_m || '?'}m) · ${dayjs(latestLocation.recorded_at).fromNow()}`
            : 'No location data yet'}
        </div>
        <button onClick={openHistory} className="text-brand-600 hover:underline">View full history →</button>
      </div>

      {/* Lock modal */}
      <Modal open={lockOpen} onClose={() => setLockOpen(false)} title="Lock Device">
        <form onSubmit={submitLock} className="space-y-3">
          {error && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{error}</div>}
          <div>
            <label className="label">Reason (internal)</label>
            <input className="input" value={lockForm.reason} onChange={e => setLockForm(f => ({ ...f, reason: e.target.value }))}
              placeholder="e.g. Installment 3 overdue 7 days" required />
          </div>
          <div>
            <label className="label">Lock-screen message (shown to customer)</label>
            <textarea className="input" rows={3} value={lockForm.lock_message}
              onChange={e => setLockForm(f => ({ ...f, lock_message: e.target.value }))}
              placeholder="e.g. Apna installment pay karein. Contact: 0300-XXXXXXX" />
          </div>
          <div className="text-xs text-amber-700 bg-amber-50 rounded px-3 py-2">
            This will lock the customer's device immediately. A WhatsApp notice will be sent to {order.customers?.phone_1 || 'the customer'}.
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setLockOpen(false)} className="btn-secondary">Cancel</button>
            <button disabled={busy} className="btn-danger">{busy ? 'Locking…' : 'Lock Device'}</button>
          </div>
        </form>
      </Modal>

      {/* Full history modal */}
      <Modal open={historyOpen} onClose={() => setHistoryOpen(false)} title="Location History — last 30 days" size="lg">
        {historyPoints.length === 0
          ? <div className="text-sm text-slate-500 py-8 text-center">No location points recorded in this window.</div>
          : (
            <div>
              <div className="rounded-lg overflow-hidden border border-slate-200 mb-3">
                <DeviceMap height={420} points={historyPoints} latestPoint={historyPoints[historyPoints.length - 1]} />
              </div>
              <div className="text-xs text-slate-500">{historyPoints.length} points · {dayjs(historyPoints[0].recorded_at).format('DD MMM HH:mm')} → {dayjs(historyPoints[historyPoints.length-1].recorded_at).format('DD MMM HH:mm')}</div>
            </div>
          )}
      </Modal>
    </div>
  );
}
