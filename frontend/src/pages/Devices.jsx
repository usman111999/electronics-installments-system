import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import DeviceMap from '../components/DeviceMap';
import { useAuth } from '../context/AuthContext';

dayjs.extend(relativeTime);

const ONLINE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

function StatusDot({ device }) {
  let color = 'bg-slate-300';
  let label = 'unknown';
  if (device.last_seen_at) {
    const age = Date.now() - new Date(device.last_seen_at).getTime();
    if (age < ONLINE_THRESHOLD_MS) { color = 'bg-emerald-500'; label = 'online'; }
    else if (age < 7 * 24 * 60 * 60 * 1000) { color = 'bg-amber-500'; label = 'stale'; }
    else { color = 'bg-red-500'; label = 'offline'; }
  } else if (device.status === 'pending') {
    color = 'bg-slate-300'; label = 'pending';
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

export default function Devices() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [branches, setBranches] = useState([]);
  const [filter, setFilter] = useState({ branch_id: '', status: '' });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState({ events: [], commands: [] });
  const [historyPoints, setHistoryPoints] = useState([]);

  const load = async () => {
    const params = {};
    if (filter.branch_id) params.branch_id = filter.branch_id;
    if (filter.status) params.status = filter.status;
    const { data } = await api.get('/devices', { params });
    setList(data || []);
  };

  useEffect(() => {
    (async () => {
      const { data } = await api.get('/branches');
      setBranches(data || []);
    })();
  }, []);

  useEffect(() => { load(); }, [filter.branch_id, filter.status]);

  const openDetail = async (d) => {
    setSelected(d);
    setOpen(true);
    setHistory({ events: [], commands: [] });
    setHistoryPoints([]);
    if (!d.imei) return;
    try {
      const [hist, locs] = await Promise.all([
        api.get(`/devices/${d.imei}/events`),
        api.get(`/devices/${d.imei}/locations`, { params: { from: dayjs().subtract(30, 'day').toISOString() } }),
      ]);
      setHistory(hist.data || { events: [], commands: [] });
      setHistoryPoints(locs.data || []);
    } catch {/* ignore */}
  };

  const counts = useMemo(() => {
    const out = { total: list.length, active: 0, pending: 0, offline: 0, locked: 0 };
    for (const d of list) {
      if (d.status === 'active') out.active++;
      else if (d.status === 'pending') out.pending++;
      else if (d.status === 'offline') out.offline++;
      if (d.orders?.device_locked) out.locked++;
    }
    return out;
  }, [list]);

  return (
    <div className="p-6">
      <PageHeader title="Devices" subtitle="All enrolled customer devices across branches" />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className="card !p-3"><div className="text-xs text-slate-500">Total</div><div className="text-2xl font-bold">{counts.total}</div></div>
        <div className="card !p-3"><div className="text-xs text-slate-500">Active</div><div className="text-2xl font-bold text-emerald-600">{counts.active}</div></div>
        <div className="card !p-3"><div className="text-xs text-slate-500">Pending</div><div className="text-2xl font-bold text-slate-600">{counts.pending}</div></div>
        <div className="card !p-3"><div className="text-xs text-slate-500">Offline</div><div className="text-2xl font-bold text-amber-600">{counts.offline}</div></div>
        <div className="card !p-3"><div className="text-xs text-slate-500">Locked</div><div className="text-2xl font-bold text-red-600">{counts.locked}</div></div>
      </div>

      <div className="card mb-4 flex flex-wrap gap-3 items-end">
        {user?.role === 'admin' && (
          <div>
            <label className="label">Branch</label>
            <select className="input" value={filter.branch_id}
              onChange={e => setFilter(f => ({ ...f, branch_id: e.target.value }))}>
              <option value="">All branches</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="label">Status</label>
          <select className="input" value={filter.status}
            onChange={e => setFilter(f => ({ ...f, status: e.target.value }))}>
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="offline">Offline</option>
            <option value="lost">Lost</option>
          </select>
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead><tr>
            <th>Customer</th><th>Order</th><th>Branch</th><th>IMEI</th>
            <th>Last Seen</th><th>Status</th><th>Lock</th><th>Battery</th><th></th>
          </tr></thead>
          <tbody>
            {list.map(d => (
              <tr key={d.id} className="cursor-pointer" onClick={() => openDetail(d)}>
                <td className="font-medium">{d.orders?.customers?.customer_name || '—'}</td>
                <td className="text-xs">{d.orders?.order_no || '—'}</td>
                <td>{d.branches?.name || '—'}</td>
                <td className="font-mono text-xs">{d.imei || <span className="text-slate-400">pending</span>}</td>
                <td className="text-xs">{d.last_seen_at ? dayjs(d.last_seen_at).fromNow() : '—'}</td>
                <td><StatusDot device={d} /></td>
                <td>
                  {d.orders?.device_locked
                    ? <span className="badge-red">Locked</span>
                    : <span className="badge-green">Unlocked</span>}
                </td>
                <td className="text-xs">{d.last_battery != null ? `${d.last_battery}%` : '—'}</td>
                <td><button className="text-brand-600 text-sm">View</button></td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan="9" className="text-center text-slate-400 py-8">No devices enrolled yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)}
        title={selected ? `Device — ${selected.orders?.customers?.customer_name || selected.imei}` : 'Device'} size="xl">
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div><div className="text-xs text-slate-500">IMEI</div><div className="font-mono">{selected.imei || '—'}</div></div>
              <div><div className="text-xs text-slate-500">Model</div><div>{selected.device_model || '—'}</div></div>
              <div><div className="text-xs text-slate-500">Android</div><div>{selected.android_version || '—'}</div></div>
              <div><div className="text-xs text-slate-500">SIM</div><div className="font-mono text-xs">{selected.current_sim_serial || '—'}</div></div>
              <div><div className="text-xs text-slate-500">Battery</div><div>{selected.last_battery != null ? `${selected.last_battery}%` : '—'}</div></div>
              <div><div className="text-xs text-slate-500">Network</div><div className="capitalize">{selected.last_network || '—'}</div></div>
              <div><div className="text-xs text-slate-500">Last Seen</div><div>{selected.last_seen_at ? dayjs(selected.last_seen_at).fromNow() : '—'}</div></div>
              <div><div className="text-xs text-slate-500">Status</div><div><StatusDot device={selected} /></div></div>
            </div>

            <div className="rounded-lg overflow-hidden border border-slate-200">
              <DeviceMap height={300} points={historyPoints}
                latestPoint={historyPoints.length ? historyPoints[historyPoints.length - 1] : null} />
            </div>
            <div className="text-xs text-slate-500">{historyPoints.length} location points in last 30 days</div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Lock event history</h4>
              <div className="overflow-x-auto rounded border">
                <table className="table-base">
                  <thead><tr><th>When</th><th>Action</th><th>By</th><th>Reason</th><th>Result</th></tr></thead>
                  <tbody>
                    {(history.events || []).map(ev => (
                      <tr key={ev.id}>
                        <td className="text-xs">{dayjs(ev.created_at).format('DD MMM YYYY HH:mm')}</td>
                        <td><span className={ev.action === 'lock' ? 'badge-red' : 'badge-green'}>{ev.action}</span></td>
                        <td className="text-xs">{ev.profiles?.full_name || 'system'}</td>
                        <td className="text-xs">{ev.reason || '—'}</td>
                        <td className="text-xs">{ev.success ? 'ok' : (ev.error_message || 'failed')}</td>
                      </tr>
                    ))}
                    {(history.events || []).length === 0 && (
                      <tr><td colSpan="5" className="text-center text-slate-400 py-4">No lock events yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Recent commands</h4>
              <div className="overflow-x-auto rounded border">
                <table className="table-base">
                  <thead><tr><th>Issued</th><th>Action</th><th>Status</th><th>Acked</th><th>Reason</th></tr></thead>
                  <tbody>
                    {(history.commands || []).map(c => (
                      <tr key={c.id}>
                        <td className="text-xs">{dayjs(c.issued_at).format('DD MMM HH:mm')}</td>
                        <td><span className="badge-gray">{c.action}</span></td>
                        <td className="text-xs">{c.status}</td>
                        <td className="text-xs">{c.acked_at ? dayjs(c.acked_at).fromNow() : '—'}</td>
                        <td className="text-xs">{c.reason || '—'}</td>
                      </tr>
                    ))}
                    {(history.commands || []).length === 0 && (
                      <tr><td colSpan="5" className="text-center text-slate-400 py-4">No commands issued.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
