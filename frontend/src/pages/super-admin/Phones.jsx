import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { api } from '../../api/client';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';

dayjs.extend(relativeTime);

const STATUS_CHIPS = [
  { value: '',         label: 'All' },
  { value: 'active',   label: 'Active' },
  { value: 'locked',   label: 'Locked' },
  { value: 'offline',  label: 'Offline' },
  { value: 'pending',  label: 'Pending' },
];

function StatusBadge({ device }) {
  // Treat locked as a derived status independent of `status`.
  if (device.orders?.device_locked) return <span className="badge-red">Locked</span>;
  if (device.status === 'active')  return <span className="badge-green">Active</span>;
  if (device.status === 'pending') return <span className="badge-gray">Pending</span>;
  if (device.status === 'offline') return <span className="badge-yellow">Offline</span>;
  return <span className="badge-gray">{device.status || 'unknown'}</span>;
}

export default function SuperPhones() {
  const [list, setList] = useState([]);
  const [branches, setBranches] = useState([]);
  const [stats, setStats] = useState({ total: 0, active: 0, locked: 0, offline: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ branch_id: '', status: '', search: '' });
  const [searchInput, setSearchInput] = useState('');

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => setFilter(f => ({ ...f, search: searchInput.trim() })), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    api.get('/branches').then(({ data }) => setBranches(data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      const params = {};
      if (filter.branch_id) params.branch_id = filter.branch_id;
      if (filter.status) params.status = filter.status;
      if (filter.search) params.search = filter.search;
      try {
        const [phones, statsRes] = await Promise.all([
          api.get('/super-admin/phones', { params }),
          api.get('/super-admin/phones/stats').catch(() => ({ data: null })),
        ]);
        if (!alive) return;
        setList(Array.isArray(phones.data) ? phones.data : (phones.data?.phones || []));
        if (statsRes.data) setStats({
          total:   statsRes.data.total   ?? 0,
          active:  statsRes.data.active  ?? 0,
          locked:  statsRes.data.locked  ?? 0,
          offline: statsRes.data.offline ?? 0,
          pending: statsRes.data.pending ?? 0,
        });
      } catch {
        if (alive) setList([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [filter.branch_id, filter.status, filter.search]);

  const onLock = async (d) => {
    if (!d.orders?.id) return alert('This device has no order — cannot lock.');
    if (!confirm(`Lock device for ${d.orders?.customers?.customer_name || d.imei}?`)) return;
    try {
      const { data } = await api.post(`/orders/${d.orders.id}/lock`, { reason: 'super_admin manual lock' });
      // /lock returns 202 with { command, fcm }. fcm.noop or fcm.ok means dispatched.
      if (data?.fcm?.ok || data?.fcm?.noop) alert('Lock command dispatched.');
      else alert(`Lock recorded but FCM dispatch failed: ${data?.fcm?.error || 'unknown error'}. Customer phone may not have received it.`);
    } catch (e) {
      alert(`Lock failed: ${e?.response?.data?.error || e.message}`);
    }
    refresh();
  };
  const onUnlock = async (d) => {
    if (!d.orders?.id) return alert('This device has no order — cannot unlock.');
    if (!confirm(`Unlock device for ${d.orders?.customers?.customer_name || d.imei}?`)) return;
    try {
      const { data } = await api.post(`/orders/${d.orders.id}/unlock`);
      if (data?.fcm?.ok || data?.fcm?.noop) alert('Unlock command dispatched.');
      else alert(`Unlock recorded but FCM dispatch failed: ${data?.fcm?.error || 'unknown error'}.`);
    } catch (e) {
      alert(`Unlock failed: ${e?.response?.data?.error || e.message}`);
    }
    refresh();
  };
  const onLocate = async (d) => {
    if (!d.imei) return alert('Device has no IMEI yet — finish enrollment first.');
    try {
      await api.post(`/devices/${d.imei}/locate`);
      alert('Locate command issued. Phone will reply on next heartbeat.');
    } catch (e) {
      alert(`Locate failed: ${e?.response?.data?.error || e.message}`);
    }
  };

  const refresh = () => {
    // Re-trigger effect by nudging a filter object — set the same value to force re-fetch.
    setFilter(f => ({ ...f }));
  };

  // Stat fallback: if backend didn't return /stats, compute from list.
  const derivedStats = useMemo(() => {
    if (stats.total) return stats;
    const out = { total: list.length, active: 0, locked: 0, offline: 0, pending: 0 };
    for (const d of list) {
      if (d.orders?.device_locked) out.locked++;
      if (d.status === 'active') out.active++;
      else if (d.status === 'pending') out.pending++;
      else if (d.status === 'offline') out.offline++;
    }
    return out;
  }, [stats, list]);

  return (
    <div className="p-6">
      <PageHeader title="Phones Registry" subtitle="All enrolled devices across every branch" />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <StatCard label="Total" value={derivedStats.total} accent="brand"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/></svg>} />
        <StatCard label="Active" value={derivedStats.active} accent="green"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>} />
        <StatCard label="Locked" value={derivedStats.locked} accent="red"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>} />
        <StatCard label="Offline" value={derivedStats.offline} accent="yellow"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M10.71 5.05A16 16 0 0 1 22.58 9M1.42 9a15.91 15.91 0 0 1 4.7-2.88M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/></svg>} />
        <StatCard label="Pending" value={derivedStats.pending} accent="blue"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>} />
      </div>

      <div className="card mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">Branch</label>
          <select className="input" value={filter.branch_id}
            onChange={e => setFilter(f => ({ ...f, branch_id: e.target.value }))}>
            <option value="">All branches</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[240px]">
          <label className="label">Search (IMEI, customer, order #)</label>
          <input className="input" placeholder="Search…" value={searchInput}
            onChange={e => setSearchInput(e.target.value)} />
        </div>
        <div className="basis-full flex gap-1.5 flex-wrap pt-1">
          {STATUS_CHIPS.map(chip => (
            <button key={chip.value || 'all'} type="button"
              onClick={() => setFilter(f => ({ ...f, status: chip.value }))}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                filter.status === chip.value
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}>
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>IMEI</th>
              <th>Model</th>
              <th>Customer / Order</th>
              <th>Branch</th>
              <th>Status</th>
              <th>Last Seen</th>
              <th>Battery</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="8" className="text-center text-slate-400 py-8">Loading…</td></tr>}
            {!loading && list.map(d => (
              <tr key={d.id}>
                <td className="font-mono text-xs">{d.imei || <span className="text-slate-400">pending</span>}</td>
                <td>{d.device_model || '—'}</td>
                <td>
                  <div className="font-medium">{d.orders?.customers?.customer_name || '—'}</div>
                  <div className="text-xs text-slate-500">{d.orders?.order_no || ''}</div>
                </td>
                <td>{d.branches?.name || '—'}</td>
                <td><StatusBadge device={d} /></td>
                <td className="text-xs">{d.last_seen_at ? dayjs(d.last_seen_at).fromNow() : '—'}</td>
                <td className="text-xs">{d.last_battery != null ? `${d.last_battery}%` : '—'}</td>
                <td className="space-x-3 whitespace-nowrap">
                  {d.imei && <Link to={`/devices?imei=${encodeURIComponent(d.imei)}`} className="text-brand-600 text-sm">View</Link>}
                  {d.orders?.device_locked
                    ? <button onClick={() => onUnlock(d)} className="text-emerald-600 text-sm">Unlock</button>
                    : <button onClick={() => onLock(d)} className="text-red-600 text-sm">Lock</button>}
                  {d.imei && <button onClick={() => onLocate(d)} className="text-slate-600 text-sm">Locate</button>}
                </td>
              </tr>
            ))}
            {!loading && list.length === 0 && (
              <tr><td colSpan="8" className="text-center text-slate-400 py-8">No devices match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
