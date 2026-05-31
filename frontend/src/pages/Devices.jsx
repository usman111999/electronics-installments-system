import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import Modal from '../components/Modal';
import DeviceCard from '../components/DeviceCard';
import EnrollDeviceModal from '../components/EnrollDeviceModal';
import { useAuth } from '../context/AuthContext';

dayjs.extend(relativeTime);

const ONLINE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2h

const STATUS_CHIPS = [
  { value: '',        label: 'All' },
  { value: 'active',  label: 'Active' },
  { value: 'locked',  label: 'Locked' },
  { value: 'offline', label: 'Offline' },
  { value: 'pending', label: 'Pending' },
];

/** Derive a single display status — locked is treated as its own status, then we
 *  fall back to the device's own status field. Used for chip filtering. */
function deriveStatus(d) {
  if (d?.orders?.device_locked) return 'locked';
  if (d?.status) return d.status;
  return 'unknown';
}

function StatusPill({ device }) {
  const s = deriveStatus(device);
  if (s === 'locked')  return <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /><span className="badge-red">Locked</span></span>;
  if (s === 'active')  return <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /><span className="badge-green">Active</span></span>;
  if (s === 'pending') return <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-400" /><span className="badge-gray">Pending</span></span>;
  if (s === 'offline') return <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /><span className="badge-yellow">Offline</span></span>;
  return <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-300" /><span className="badge-gray">{s}</span></span>;
}

export default function Devices() {
  const { user, hasPermission } = useAuth();
  const [list, setList] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ branch_id: '', status: '', search: '' });
  const [searchInput, setSearchInput] = useState('');

  // detail modal
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState(null);

  // enroll flow
  const [enrollPickerOpen, setEnrollPickerOpen] = useState(false);
  const [enrollOrders, setEnrollOrders] = useState([]);
  const [pickedOrderId, setPickedOrderId] = useState('');
  const [enrollModalOpen, setEnrollModalOpen] = useState(false);

  // debounced search
  useEffect(() => {
    const t = setTimeout(() => setFilter(f => ({ ...f, search: searchInput.trim() })), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Branches — only fetched when user can pick (admin/super_admin); operators
  // are auto-scoped server-side and don't see this dropdown.
  useEffect(() => {
    if (hasPermission('branches.view')) {
      api.get('/branches').then(({ data }) => setBranches(data || [])).catch(() => {});
    }
  }, [hasPermission]);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter.branch_id) params.branch_id = filter.branch_id;
      // Only forward simple statuses to the API; 'locked' is derived client-side.
      if (filter.status && filter.status !== 'locked') params.status = filter.status;
      const { data } = await api.get('/devices', { params });
      setList(Array.isArray(data) ? data : []);
    } catch (e) {
      console.warn('devices load failed', e);
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filter.branch_id, filter.status]);

  // Client-side search & locked filter
  const filtered = useMemo(() => {
    const q = (filter.search || '').toLowerCase();
    return (list || []).filter(d => {
      if (filter.status === 'locked' && !d?.orders?.device_locked) return false;
      if (!q) return true;
      const haystack = [
        d.imei,
        d.orders?.order_no,
        d.orders?.customers?.customer_name,
        d.orders?.customers?.account_no,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [list, filter.status, filter.search]);

  const counts = useMemo(() => {
    const out = { total: list.length, active: 0, locked: 0, offline: 0, pending: 0 };
    for (const d of list) {
      if (d.orders?.device_locked) out.locked++;
      const age = d.last_seen_at ? (Date.now() - new Date(d.last_seen_at).getTime()) : Infinity;
      if (d.status === 'active' && age < ONLINE_THRESHOLD_MS && !d.orders?.device_locked) out.active++;
      else if (d.status === 'pending') out.pending++;
      else if (d.status === 'offline' || (d.status === 'active' && age >= ONLINE_THRESHOLD_MS)) out.offline++;
    }
    return out;
  }, [list]);

  // ---- actions ----------------------------------------------------------
  const refresh = () => setFilter(f => ({ ...f })); // nudge re-fetch via effect

  const onLock = async (d, e) => {
    e?.stopPropagation();
    if (!d.orders?.id) return alert('This device has no order — cannot lock.');
    const reason = window.prompt(`Lock device for ${d.orders?.customers?.customer_name || d.imei}?\n\nReason (visible internally):`, '');
    if (reason === null) return;
    try {
      const { data } = await api.post(`/orders/${d.orders.id}/lock`, { reason: reason || 'Operator initiated' });
      if (data?.fcm?.ok || data?.fcm?.noop) alert('Lock command dispatched.');
      else alert(`Lock recorded but FCM dispatch failed: ${data?.fcm?.error || 'unknown error'}. Customer phone may not have received it.`);
    } catch (err) {
      alert(`Lock failed: ${err?.response?.data?.error || err.message}`);
    }
    refresh();
  };

  const onUnlock = async (d, e) => {
    e?.stopPropagation();
    if (!d.orders?.id) return alert('This device has no order — cannot unlock.');
    if (!window.confirm(`Unlock device for ${d.orders?.customers?.customer_name || d.imei}?`)) return;
    try {
      const { data } = await api.post(`/orders/${d.orders.id}/unlock`, { reason: 'Operator initiated' });
      if (data?.fcm?.ok || data?.fcm?.noop) alert('Unlock command dispatched.');
      else alert(`Unlock recorded but FCM dispatch failed: ${data?.fcm?.error || 'unknown error'}.`);
    } catch (err) {
      alert(`Unlock failed: ${err?.response?.data?.error || err.message}`);
    }
    refresh();
  };

  const onLocate = async (d, e) => {
    e?.stopPropagation();
    if (!d.imei) return alert('Device has no IMEI yet — finish enrollment first.');
    try {
      await api.post(`/devices/${d.imei}/locate`);
      alert('Locate request sent. Phone will reply on next heartbeat (~1 min on Wi-Fi).');
    } catch (err) {
      alert(`Locate failed: ${err?.response?.data?.error || err.message}`);
    }
  };

  const openDetail = (d) => {
    if (!d.orders) return;
    setDetailOrder(d.orders);
    setDetailOpen(true);
  };

  // ---- enroll flow ------------------------------------------------------
  const openEnrollPicker = async () => {
    setPickedOrderId('');
    setEnrollPickerOpen(true);
    try {
      const { data } = await api.get('/orders');
      const unenrolled = (data || []).filter(o => !o.device_imei);
      setEnrollOrders(unenrolled);
    } catch (e) {
      setEnrollOrders([]);
    }
  };

  const confirmEnrollPick = () => {
    if (!pickedOrderId) return alert('Pick an order first.');
    setEnrollPickerOpen(false);
    setEnrollModalOpen(true);
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Devices"
        subtitle="All enrolled customer devices — lock, unlock, locate"
        actions={
          hasPermission('devices.enroll') ? (
            <button className="btn-primary" onClick={openEnrollPicker}>+ Enroll device</button>
          ) : null
        }
      />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <StatCard label="Total" value={counts.total} accent="brand"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/></svg>} />
        <StatCard label="Active" value={counts.active} accent="green"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>} />
        <StatCard label="Locked" value={counts.locked} accent="red"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>} />
        <StatCard label="Offline" value={counts.offline} accent="yellow"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55M5 12.55a10.94 10.94 0 0 1 5.17-2.39M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/></svg>} />
        <StatCard label="Pending" value={counts.pending} accent="blue"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>} />
      </div>

      {/* Toolbar */}
      <div className="card mb-4 flex flex-wrap gap-3 items-end">
        {hasPermission('branches.view') && (
          <div>
            <label className="label">Branch</label>
            <select className="input" value={filter.branch_id}
              onChange={e => setFilter(f => ({ ...f, branch_id: e.target.value }))}>
              <option value="">All branches</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex-1 min-w-[240px]">
          <label className="label">Search (IMEI, customer, order #)</label>
          <input className="input" placeholder="Search…"
            value={searchInput} onChange={e => setSearchInput(e.target.value)} />
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

      {/* Table */}
      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>IMEI</th>
              <th>Customer / Order</th>
              <th>Branch</th>
              <th>Status</th>
              <th>Last Seen</th>
              <th>Battery</th>
              <th className="text-right pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="7" className="text-center text-slate-400 py-8">Loading…</td></tr>}
            {!loading && filtered.map(d => {
              const locked = !!d.orders?.device_locked;
              const isPending = d.status === 'pending';
              return (
                <tr key={d.id} className="cursor-pointer" onClick={() => openDetail(d)}>
                  <td className="font-mono text-xs">{d.imei || <span className="text-slate-400">pending</span>}</td>
                  <td>
                    <div className="font-medium text-slate-900">{d.orders?.customers?.customer_name || '—'}</div>
                    <div className="text-xs text-slate-500">{d.orders?.order_no || ''}{d.orders?.customers?.account_no ? ` · #${d.orders.customers.account_no}` : ''}</div>
                  </td>
                  <td>{d.branches?.name || '—'}</td>
                  <td><StatusPill device={d} /></td>
                  <td className="text-xs text-slate-600">{d.last_seen_at ? dayjs(d.last_seen_at).fromNow() : '—'}</td>
                  <td className="text-xs">{d.last_battery != null ? `${d.last_battery}%` : '—'}</td>
                  <td className="whitespace-nowrap text-right pr-4">
                    <div className="inline-flex gap-3" onClick={e => e.stopPropagation()}>
                      {hasPermission('devices.lock') && !locked && !isPending && (
                        <button onClick={(e) => onLock(d, e)} className="text-red-600 text-sm hover:underline">Lock</button>
                      )}
                      {hasPermission('devices.unlock') && locked && (
                        <button onClick={(e) => onUnlock(d, e)} className="text-emerald-600 text-sm hover:underline">Unlock</button>
                      )}
                      {hasPermission('devices.locate') && d.imei && (
                        <button onClick={(e) => onLocate(d, e)} className="text-slate-600 text-sm hover:underline">Locate</button>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); openDetail(d); }} className="text-brand-600 text-sm hover:underline">View</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan="7" className="text-center text-slate-400 py-10">
                {list.length === 0 ? 'No devices enrolled yet.' : 'No devices match these filters.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail modal — reuses the existing DeviceCard so we get the full
          lock / unlock / locate flow + map + history in one place. */}
      <Modal
        open={detailOpen}
        onClose={() => { setDetailOpen(false); refresh(); }}
        size="xl"
        title={detailOrder ? `Device — ${detailOrder.customers?.customer_name || detailOrder.device_imei}` : 'Device'}
      >
        {detailOrder && <DeviceCard order={detailOrder} onChanged={refresh} />}
      </Modal>

      {/* Enroll picker — small modal to choose an order, then opens the full QR modal. */}
      <Modal open={enrollPickerOpen} onClose={() => setEnrollPickerOpen(false)} title="Enroll a device" size="md">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Pick the order whose device you want to enroll. Only orders that don't already have a phone attached are listed.
          </p>
          {enrollOrders.length === 0 ? (
            <div className="text-sm text-slate-500 bg-slate-50 rounded-lg px-4 py-6 text-center">
              No orders are awaiting enrollment. Create an order first, then come back here.
            </div>
          ) : (
            <div>
              <label className="label">Order</label>
              <select className="input" value={pickedOrderId} onChange={e => setPickedOrderId(e.target.value)}>
                <option value="">Choose an order…</option>
                {enrollOrders.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.order_no} — {o.customers?.customer_name || 'Customer'}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button className="btn-secondary" onClick={() => setEnrollPickerOpen(false)}>Cancel</button>
            <button className="btn-primary" disabled={!pickedOrderId} onClick={confirmEnrollPick}>
              Continue
            </button>
          </div>
        </div>
      </Modal>

      <EnrollDeviceModal
        open={enrollModalOpen}
        onClose={() => setEnrollModalOpen(false)}
        orderId={pickedOrderId}
        onEnrolled={() => { setEnrollModalOpen(false); refresh(); }}
      />
    </div>
  );
}
