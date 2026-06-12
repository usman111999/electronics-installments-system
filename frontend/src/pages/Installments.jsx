import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import Avatar from '../components/Avatar';

dayjs.extend(relativeTime);

const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

const FILTER_CHIPS = [
  { value: 'all',      label: 'All' },
  { value: 'overdue',  label: 'With Overdue' },
  { value: 'pending',  label: 'Pending' },
  { value: 'paid',     label: 'Fully Paid' },
];

// worst-status wins ordering
const STATUS_RANK = { overdue: 4, partial: 3, pending: 2, paid: 1 };
const WORST_PILL = {
  overdue: 'badge-red',
  partial: 'badge-blue',
  pending: 'badge-yellow',
  paid:    'badge-green',
};

function outstandingOf(i) {
  // outstanding = amount_due + fine - discount - amount_paid
  return Number(i.amount_due || 0) + Number(i.fine || 0) - Number(i.discount || 0) - Number(i.amount_paid || 0);
}

/** Reduce flat installments list into per-order summary rows. */
function groupByOrder(installments) {
  const byOrder = new Map();
  for (const i of installments) {
    const order = i?.orders;
    const customer = order?.customers;
    if (!order?.id) continue;
    let row = byOrder.get(order.id);
    if (!row) {
      row = {
        order_id: order.id,
        order_no: order.order_no || '',
        customer_id: customer?.id || null,
        customer_name: customer?.customer_name || '—',
        account_no: customer?.account_no || '',
        phone_1: customer?.phone_1 || '',
        picture_url: customer?.picture_url || '',
        branch_name: order?.branches?.name || customer?.branches?.name || '',
        planned: Number(order.total_installments || 0),
        total: 0,
        paid_count: 0,
        pending_count: 0,
        overdue_count: 0,
        partial_count: 0,
        total_due: 0,
        total_paid: 0,
        total_outstanding: 0,
        next_due_date: null,
        worst_status: 'paid',
      };
      byOrder.set(order.id, row);
    }
    row.total += 1;
    row.total_due  += Number(i.amount_due || 0);
    row.total_paid += Number(i.amount_paid || 0);
    row.total_outstanding += Math.max(0, outstandingOf(i));

    if (i.status === 'paid')    row.paid_count++;
    else if (i.status === 'overdue') row.overdue_count++;
    else if (i.status === 'partial') row.partial_count++;
    else if (i.status === 'pending') row.pending_count++;

    if (i.status !== 'paid' && i.due_date) {
      if (!row.next_due_date || dayjs(i.due_date).isBefore(dayjs(row.next_due_date))) {
        row.next_due_date = i.due_date;
      }
    }
    if ((STATUS_RANK[i.status] || 0) > (STATUS_RANK[row.worst_status] || 0)) {
      row.worst_status = i.status;
    }
  }
  // Full plan length per order; fall back to invoices created so far.
  return Array.from(byOrder.values()).map(r => ({ ...r, planned: r.planned || r.total }));
}

export default function Installments() {
  const navigate = useNavigate();
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterChip, setFilterChip] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api.get('/installments').then(({ data }) => {
      if (!alive) return;
      setRaw(Array.isArray(data) ? data : []);
    }).catch(() => {
      if (alive) setRaw([]);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const rows = useMemo(() => groupByOrder(raw), [raw]);

  // Top-level KPIs
  const stats = useMemo(() => {
    const startOfMonth = dayjs().startOf('month');
    let paid_this_month = 0;
    for (const i of raw) {
      if (i.status === 'paid' && i.last_payment_date && dayjs(i.last_payment_date).isAfter(startOfMonth)) paid_this_month++;
      else if (i.status === 'paid' && i.amount_paid > 0 && i.due_date && dayjs(i.due_date).isAfter(startOfMonth)) paid_this_month++;
    }
    return {
      orders: rows.length,
      overdue:   rows.filter(r => r.overdue_count > 0).length,
      outstanding: rows.reduce((sum, r) => sum + r.total_outstanding, 0),
      paid_this_month,
    };
  }, [rows, raw]);

  const filtered = useMemo(() => {
    let r = rows;
    if (filterChip === 'overdue') r = r.filter(x => x.overdue_count > 0);
    else if (filterChip === 'pending') r = r.filter(x => x.pending_count > 0 || x.partial_count > 0);
    else if (filterChip === 'paid') r = r.filter(x => x.planned > 0 && x.paid_count >= x.planned);
    if (search) {
      r = r.filter(x =>
        (x.customer_name || '').toLowerCase().includes(search) ||
        (x.account_no    || '').toLowerCase().includes(search) ||
        (x.order_no      || '').toLowerCase().includes(search)
      );
    }
    // Sort: overdue first, then by outstanding desc, then by name.
    return [...r].sort((a, b) => {
      if ((b.overdue_count > 0) !== (a.overdue_count > 0)) return b.overdue_count > 0 ? 1 : -1;
      if (b.total_outstanding !== a.total_outstanding) return b.total_outstanding - a.total_outstanding;
      return a.customer_name.localeCompare(b.customer_name);
    });
  }, [rows, filterChip, search]);

  return (
    <div className="p-6">
      <PageHeader title="Installments" subtitle="One row per order — click to open the order and record payments" />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Orders" value={stats.orders} accent="brand"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>} />
        <StatCard label="With Overdue" value={stats.overdue} accent="red"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>} />
        <StatCard label="Outstanding" value={fmt(stats.outstanding)} accent="yellow"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>} />
        <StatCard label="Paid this month" value={stats.paid_this_month} accent="green"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>} />
      </div>

      {/* Toolbar */}
      <div className="card mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[240px]">
          <label className="label">Search (name or account #)</label>
          <input className="input" placeholder="Search…"
            value={searchInput} onChange={e => setSearchInput(e.target.value)} />
        </div>
        <div className="basis-full flex gap-1.5 flex-wrap pt-1">
          {FILTER_CHIPS.map(chip => (
            <button key={chip.value} type="button"
              onClick={() => setFilterChip(chip.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                filterChip === chip.value
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
              <th>Customer</th>
              <th>Order</th>
              <th>Branch</th>
              <th>Installments</th>
              <th>Outstanding</th>
              <th>Next Due</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="8" className="text-center text-slate-400 py-8">Loading…</td></tr>}
            {!loading && filtered.map(r => {
              const overdueDays = r.next_due_date && r.overdue_count > 0
                ? dayjs().diff(dayjs(r.next_due_date), 'day')
                : 0;
              const fullyPaid = r.paid_count >= r.planned && r.planned > 0;
              return (
                <tr key={r.order_id} className="cursor-pointer"
                  onClick={() => navigate(`/orders/${r.order_id}`)}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Avatar src={r.picture_url} name={r.customer_name} size={36} />
                      <div>
                        <div className="font-medium text-slate-900">{r.customer_name}</div>
                        <div className="text-xs text-slate-500">{r.account_no ? `#${r.account_no}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td className="text-sm font-medium text-slate-700">{r.order_no || '—'}</td>
                  <td className="text-sm text-slate-600">{r.branch_name || '—'}</td>
                  <td>
                    <div className="text-sm font-medium text-slate-900">{r.paid_count}/{r.planned} paid</div>
                    <div className="text-xs text-slate-500 flex gap-2 mt-0.5">
                      {r.overdue_count > 0 && <span className="text-red-600">{r.overdue_count} overdue</span>}
                      {r.partial_count > 0 && <span className="text-blue-600">{r.partial_count} partial</span>}
                      {r.pending_count > 0 && <span className="text-amber-600">{r.pending_count} pending</span>}
                    </div>
                  </td>
                  <td className={r.total_outstanding > 0 ? 'font-semibold text-slate-900' : 'text-slate-500'}>
                    {fmt(r.total_outstanding)}
                  </td>
                  <td className="text-sm">
                    {r.next_due_date ? (
                      <>
                        <div className="text-slate-900">{dayjs(r.next_due_date).format('DD MMM YYYY')}</div>
                        {overdueDays > 0 && <div className="text-xs text-red-600">{overdueDays}d overdue</div>}
                        {overdueDays <= 0 && r.next_due_date && <div className="text-xs text-slate-500">{dayjs(r.next_due_date).fromNow()}</div>}
                      </>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td>
                    <span className={fullyPaid ? 'badge-green' : (WORST_PILL[r.worst_status] || 'badge-gray')}>
                      {fullyPaid ? 'Fully Paid' :
                       r.worst_status === 'overdue' ? 'Overdue' :
                       r.worst_status === 'partial' ? 'Partial' :
                       r.worst_status === 'pending' ? 'Pending' : 'In progress'}
                    </span>
                  </td>
                  <td onClick={e => e.stopPropagation()}>
                    {!fullyPaid && (
                      <button onClick={() => navigate(`/orders/${r.order_id}`)} className="btn-primary py-1 px-3 text-sm">
                        Pay
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan="8" className="text-center text-slate-400 py-10">
                {rows.length === 0 ? 'No installments yet. Create an order for a customer to start their plan — invoices then open one month at a time.' : 'No orders match these filters.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
