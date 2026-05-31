import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';

dayjs.extend(relativeTime);

// -- helpers --------------------------------------------------------------

function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

const ROLE_BADGE = {
  super_admin: 'badge-red',
  admin: 'badge-blue',
  operator: 'badge-yellow',
  customer: 'badge-gray',
};

function dayLabel(dateStr) {
  const d = dayjs(dateStr).startOf('day');
  const today = dayjs().startOf('day');
  const diff = today.diff(d, 'day');
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.format('DD MMM YYYY');
}

// SVG icons keyed by action keywords. We choose by substring match so unknown
// actions still get a sensible default.
const ICONS = {
  lock: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
  ),
  unlock: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
  ),
  payment: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
  ),
  user: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></svg>
  ),
  order: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11H1l8-8 8 8h-8v8H1"/></svg>
  ),
  device: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/></svg>
  ),
  locate: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 6 8 12 8 12s8-6 8-12a8 8 0 0 0-8-8z"/></svg>
  ),
  enroll: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h.01M17 7h.01M7 17h.01M17 17h.01"/></svg>
  ),
  default: (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>
  ),
};

function iconFor(action) {
  const a = (action || '').toLowerCase();
  if (a.includes('lock') && !a.includes('unlock')) return { node: ICONS.lock, tint: 'bg-red-50 text-red-600' };
  if (a.includes('unlock'))                        return { node: ICONS.unlock, tint: 'bg-emerald-50 text-emerald-600' };
  if (a.includes('payment') || a.includes('paid')) return { node: ICONS.payment, tint: 'bg-blue-50 text-blue-600' };
  if (a.includes('locate'))                        return { node: ICONS.locate, tint: 'bg-violet-50 text-violet-600' };
  if (a.includes('enroll') || a.includes('token')) return { node: ICONS.enroll, tint: 'bg-amber-50 text-amber-700' };
  if (a.includes('user'))                          return { node: ICONS.user, tint: 'bg-slate-100 text-slate-700' };
  if (a.includes('order'))                         return { node: ICONS.order, tint: 'bg-brand-50 text-brand-700' };
  if (a.includes('device'))                        return { node: ICONS.device, tint: 'bg-slate-100 text-slate-700' };
  return { node: ICONS.default, tint: 'bg-slate-100 text-slate-600' };
}

const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

/** Build a friendly summary line for known action shapes; null = use a generic one. */
function summarize(log) {
  const d = log.details || {};
  switch (log.action) {
    case 'create_user': {
      const role = d.role || d.new_role || 'user';
      return `Created ${role} ${d.email || d.full_name || ''}`.trim();
    }
    case 'update_user': {
      const changed = d.fields || (d.changes ? Object.keys(d.changes) : null);
      return `Updated user ${d.email || d.user_id || ''}${changed ? ` — changed ${Array.isArray(changed) ? changed.join(', ') : changed}` : ''}`;
    }
    case 'delete_user':
      return `Deleted user ${d.email || d.user_id || ''}`;
    case 'record_payment':
      return `Recorded payment ${fmt(d.amount)}${d.receipt_no ? ` (receipt ${d.receipt_no})` : ''}`;
    case 'device_lock':
      return `Locked device for order ${d.order_id || log.entity_id || ''}${d.reason ? ` — reason: ${d.reason}` : ''}`;
    case 'device_unlock':
      return `Unlocked device for order ${d.order_id || log.entity_id || ''}${d.reason ? ` — reason: ${d.reason}` : ''}`;
    case 'device_enrollment_token_issued':
      return `Issued enrollment QR for order ${d.order_id || log.entity_id || ''}`;
    case 'device_locate':
      return `Requested location ping${d.imei ? ` for IMEI ${d.imei}` : ''}`;
    case 'create_order':
      return `Created order ${d.order_no || log.entity_id || ''}${d.customer_name ? ` for ${d.customer_name}` : ''}`;
    case 'update_order':
      return `Updated order ${d.order_no || log.entity_id || ''}`;
    case 'create_customer':
      return `Created customer ${d.customer_name || d.account_no || ''}`;
    case 'update_customer':
      return `Updated customer ${d.customer_name || d.account_no || log.entity_id || ''}`;
    case 'login':
      return 'Signed in';
    case 'logout':
      return 'Signed out';
    default:
      return null;
  }
}

// -- timeline entry --------------------------------------------------------

function TimelineEntry({ log }) {
  const [open, setOpen] = useState(false);
  const { node, tint } = iconFor(log.action);
  const friendly = summarize(log);
  const hasDetails = log.details && Object.keys(log.details).length > 0;
  return (
    <div className="flex gap-3 py-3 border-b border-slate-100 last:border-0">
      <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${tint}`}>{node}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-3">
          <div className="font-medium text-sm text-slate-900 truncate">
            {friendly || <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">{log.action}</code>}
          </div>
          <div className="text-xs text-slate-400 whitespace-nowrap" title={dayjs(log.created_at).format('DD MMM YYYY HH:mm:ss')}>
            {dayjs(log.created_at).format('HH:mm')}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
          {log.entity_type && <span>{log.entity_type}{log.entity_id ? ` · ${String(log.entity_id).slice(0, 8)}` : ''}</span>}
          {log.branches?.name && <span>· {log.branches.name}</span>}
          {hasDetails && (
            <button onClick={() => setOpen(o => !o)} className="text-brand-600 hover:underline">
              {open ? 'Hide details' : 'Show details'}
            </button>
          )}
        </div>
        {open && hasDetails && (
          <pre className="mt-2 text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
{JSON.stringify(log.details, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// -- user list item --------------------------------------------------------

function UserRow({ u, selected, onSelect }) {
  const roleClass = ROLE_BADGE[u.role] || 'badge-gray';
  return (
    <button type="button" onClick={() => onSelect(u.user_id)}
      className={`w-full text-left px-3 py-3 rounded-lg flex items-center gap-3 transition-colors border ${
        selected ? 'bg-brand-50 border-brand-200' : 'bg-white border-transparent hover:bg-slate-50 hover:border-slate-200'
      }`}>
      <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${
        selected ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-700'
      }`}>
        {initials(u.full_name || u.email)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium text-sm text-slate-900 truncate">{u.full_name || u.email || 'Unknown'}</div>
          <span className="text-xs text-slate-400 whitespace-nowrap">{dayjs(u.last_active).fromNow(true)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <span className={roleClass}>{(u.role || 'unknown').replace('_', ' ')}</span>
          <span className="text-xs text-slate-500">{u.count} action{u.count === 1 ? '' : 's'}</span>
        </div>
      </div>
    </button>
  );
}

// -- main page -------------------------------------------------------------

export default function ActivityLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState(''); // empty = all

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get('/activity-logs', { params: { limit: 1000 } })
      .then(({ data }) => { if (alive) setLogs(Array.isArray(data) ? data : []); })
      .catch(() => { if (alive) setLogs([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  // Group by user_id and build sidebar entries.
  const users = useMemo(() => {
    const byUser = new Map();
    for (const l of logs) {
      const id = l.user_id || (l.profiles && l.profiles.id) || '__system__';
      if (!byUser.has(id)) {
        byUser.set(id, {
          user_id: id,
          full_name: l.profiles?.full_name || (id === '__system__' ? 'System' : 'Unknown user'),
          email: l.profiles?.email || '',
          role: l.profiles?.role || (id === '__system__' ? 'system' : 'unknown'),
          branch: l.branches?.name || '',
          count: 0,
          last_active: l.created_at,
        });
      }
      const u = byUser.get(id);
      u.count += 1;
      if (!u.last_active || dayjs(l.created_at).isAfter(dayjs(u.last_active))) u.last_active = l.created_at;
    }
    return Array.from(byUser.values()).sort((a, b) => b.count - a.count);
  }, [logs]);

  const filteredUsers = useMemo(() => {
    if (!search) return users;
    return users.filter(u =>
      (u.full_name || '').toLowerCase().includes(search) ||
      (u.email || '').toLowerCase().includes(search) ||
      (u.role || '').toLowerCase().includes(search)
    );
  }, [users, search]);

  // Auto-pick the first user once data lands.
  useEffect(() => {
    if (!selectedId && filteredUsers.length > 0) setSelectedId(filteredUsers[0].user_id);
  }, [filteredUsers, selectedId]);

  const selectedUser = useMemo(
    () => users.find(u => u.user_id === selectedId) || null,
    [users, selectedId]
  );

  const userLogs = useMemo(() => {
    if (!selectedId) return [];
    return logs.filter(l => (l.user_id || (l.profiles && l.profiles.id) || '__system__') === selectedId);
  }, [logs, selectedId]);

  // Build action chips from this user's logs only.
  const actionChips = useMemo(() => {
    const counts = new Map();
    for (const l of userLogs) counts.set(l.action, (counts.get(l.action) || 0) + 1);
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([action, count]) => ({ action, count }));
  }, [userLogs]);

  // Reset action filter when switching users.
  useEffect(() => { setActionFilter(''); }, [selectedId]);

  const visibleLogs = useMemo(() => {
    if (!actionFilter) return userLogs;
    return userLogs.filter(l => l.action === actionFilter);
  }, [userLogs, actionFilter]);

  // Group visible logs by day for the timeline.
  const grouped = useMemo(() => {
    const map = new Map();
    for (const l of visibleLogs) {
      const key = dayjs(l.created_at).format('YYYY-MM-DD');
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(l);
    }
    // Ensure descending day order (logs come desc already, but be defensive).
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [visibleLogs]);

  return (
    <div className="p-6">
      <PageHeader title="Activity Logs" subtitle="Pick a user on the left to see their full audit timeline" />

      <div className="flex flex-col md:flex-row gap-4">
        {/* LEFT — users list */}
        <aside className="md:w-[340px] md:shrink-0">
          <div className="card !p-3 md:sticky md:top-4">
            <input className="input mb-3" placeholder="Search users…"
              value={searchInput} onChange={e => setSearchInput(e.target.value)} />
            <div className="max-h-[70vh] overflow-y-auto pr-1 space-y-1">
              {loading && <div className="text-sm text-slate-400 py-6 text-center">Loading…</div>}
              {!loading && filteredUsers.length === 0 && (
                <div className="text-sm text-slate-400 py-6 text-center">No users found.</div>
              )}
              {!loading && filteredUsers.map(u => (
                <UserRow key={u.user_id} u={u} selected={selectedId === u.user_id}
                  onSelect={setSelectedId} />
              ))}
            </div>
          </div>
        </aside>

        {/* RIGHT — timeline */}
        <section className="flex-1 min-w-0">
          {!selectedUser && (
            <div className="card flex flex-col items-center justify-center text-center py-16">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                <svg className="w-6 h-6 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              </div>
              <div className="font-semibold text-slate-700">Pick a user to see their actions</div>
              <div className="text-sm text-slate-500 mt-1">All recorded events for the selected user will appear here.</div>
            </div>
          )}

          {selectedUser && (
            <>
              {/* User header */}
              <div className="card mb-4 flex items-start gap-4">
                <div className="shrink-0 w-12 h-12 rounded-full bg-brand-600 text-white flex items-center justify-center font-semibold">
                  {initials(selectedUser.full_name || selectedUser.email)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-semibold text-slate-900">{selectedUser.full_name || selectedUser.email}</h2>
                    <span className={ROLE_BADGE[selectedUser.role] || 'badge-gray'}>{(selectedUser.role || 'unknown').replace('_', ' ')}</span>
                  </div>
                  <div className="text-sm text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {selectedUser.email && <span>{selectedUser.email}</span>}
                    {selectedUser.branch && <span>· {selectedUser.branch}</span>}
                    <span>· {selectedUser.count} action{selectedUser.count === 1 ? '' : 's'}</span>
                    <span>· last active {dayjs(selectedUser.last_active).fromNow()}</span>
                  </div>
                </div>
              </div>

              {/* Action filter chips */}
              {actionChips.length > 1 && (
                <div className="card mb-4 !py-3 flex gap-1.5 flex-wrap">
                  <button onClick={() => setActionFilter('')}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      actionFilter === '' ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}>
                    All ({userLogs.length})
                  </button>
                  {actionChips.map(c => (
                    <button key={c.action} onClick={() => setActionFilter(c.action)}
                      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                        actionFilter === c.action ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                      }`}>
                      {c.action} ({c.count})
                    </button>
                  ))}
                </div>
              )}

              {/* Timeline */}
              <div className="card">
                {visibleLogs.length === 0 && (
                  <div className="text-center text-slate-400 py-10 text-sm">
                    No activity for this user yet.
                  </div>
                )}
                {grouped.map(([day, entries]) => (
                  <div key={day} className="mb-2 last:mb-0">
                    <div className="sticky top-0 bg-white py-2 mb-1 text-xs uppercase tracking-wider font-semibold text-slate-500 border-b border-slate-100">
                      {dayLabel(day)}
                      <span className="ml-2 text-slate-400 normal-case font-normal">{entries.length} event{entries.length === 1 ? '' : 's'}</span>
                    </div>
                    {entries.map(l => <TimelineEntry key={l.id} log={l} />)}
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
