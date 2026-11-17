import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { COMPANY_NAME, LOGO_URL } from '../branding';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import Avatar from '../components/Avatar';
import OutstandingReportPrint from '../components/OutstandingReportPrint';
import { summarizeOrders, rs } from '../utils/installmentSummary';


// "Due this month" is the default: from the 1st of every month it lists every
// customer with an unpaid installment (this month's plus any arrears). A
// customer whose installment was already paid in advance is not shown.
const FILTER_CHIPS = [
  { value: 'due',     label: 'Due this month' },
  { value: 'overdue', label: 'With Overdue' },
  { value: 'all',     label: 'All' },
  { value: 'paid',    label: 'Fully Paid' },
];

const UNASSIGNED = '__unassigned__';
const digits = (s) => String(s || '').replace(/\D/g, '');
const fmtDate = (v) => (v ? dayjs(v).format('DD MMM YYYY') : '—');

// Just Paid / Unpaid: "Unpaid" when anything is still owed up to the end of
// this month (this month's installment or older arrears), otherwise "Paid".
function statusLabel(r) {
  if (r.order_status === 'cancelled') return ['Cancelled', 'badge-gray'];
  return r.is_due ? ['Unpaid', 'badge-red'] : ['Paid', 'badge-green'];
}

export default function Installments() {
  const navigate = useNavigate();
  const { user, company } = useAuth();
  const [raw, setRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterChip, setFilterChip] = useState('due');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [showPrint, setShowPrint] = useState(false);
  const [printBranch, setPrintBranch] = useState('');
  const [printOfficer, setPrintOfficer] = useState('');
  const [printCategory, setPrintCategory] = useState('');

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

  const rows = useMemo(() => summarizeOrders(raw), [raw]);

  // Top-level KPIs
  const stats = useMemo(() => {
    const startOfMonth = dayjs().startOf('month');
    const due = rows.filter(r => r.is_due);
    return {
      dueAmount: due.reduce((s, r) => s + r.due_now, 0),
      dueCustomers: due.length,
      overdue: rows.filter(r => r.overdue_count > 0).length,
      remaining: rows.filter(r => r.order_status !== 'cancelled').reduce((s, r) => s + r.remaining, 0),
      paidThisMonth: raw.filter(i => Number(i.amount_paid || 0) > 0 && i.payment_date && !dayjs(i.payment_date).isBefore(startOfMonth, 'day')).length,
    };
  }, [rows, raw]);

  const filtered = useMemo(() => {
    let r = rows;
    if (filterChip === 'due') r = r.filter(x => x.is_due);
    else if (filterChip === 'overdue') r = r.filter(x => x.overdue_count > 0);
    else if (filterChip === 'paid') r = r.filter(x => x.fully_paid);
    if (search) {
      const q = digits(search);
      r = r.filter(x =>
        (x.customer_name || '').toLowerCase().includes(search) ||
        (x.account_no    || '').toLowerCase().includes(search) ||
        (x.order_no      || '').toLowerCase().includes(search) ||
        (q.length >= 4 && digits(x.phone_1).includes(q))
      );
    }
    // Sort: overdue first, then most due now, then biggest balance, then name.
    return [...r].sort((a, b) => {
      if ((b.overdue_count > 0) !== (a.overdue_count > 0)) return b.overdue_count > 0 ? 1 : -1;
      if (b.due_now !== a.due_now) return b.due_now - a.due_now;
      if (b.remaining !== a.remaining) return b.remaining - a.remaining;
      return a.customer_name.localeCompare(b.customer_name);
    });
  }, [rows, filterChip, search]);

  // ---- Print view (Outstanding Report, recovery-officer wise) ----
  const dueRows = useMemo(() => rows.filter(r => r.is_due), [rows]);
  const printOptions = useMemo(() => ({
    branches: [...new Set(dueRows.map(r => r.branch_name).filter(Boolean))].sort(),
    officers: [...new Set(dueRows.map(r => r.recovery_officer).filter(Boolean))].sort(),
    categories: [...new Set(dueRows.map(r => r.category).filter(Boolean))].sort(),
    hasUnassigned: dueRows.some(r => !r.recovery_officer),
  }), [dueRows]);
  const printRows = useMemo(() => dueRows.filter(r =>
    (!printBranch || r.branch_name === printBranch) &&
    (!printOfficer || (printOfficer === UNASSIGNED ? !r.recovery_officer : r.recovery_officer === printOfficer)) &&
    (!printCategory || r.category === printCategory)
  ), [dueRows, printBranch, printOfficer, printCategory]);

  // Wait for the logo to decode so it's never missing from the PDF.
  const doPrint = async () => {
    const imgs = Array.from(document.querySelectorAll('.print-form img'));
    await Promise.all(imgs.map(img => {
      if (img.complete && img.naturalWidth) return img.decode().catch(() => {});
      return new Promise(res => { img.onload = res; img.onerror = res; });
    }));
    window.print();
  };

  if (showPrint) return (
    <div>
      <div className="p-4 flex flex-wrap items-end gap-3 bg-slate-100 no-print">
        <button onClick={() => setShowPrint(false)} className="btn-secondary">← Back</button>
        <div>
          <label className="label">Branch</label>
          <select className="input" value={printBranch} onChange={e => setPrintBranch(e.target.value)}>
            <option value="">All branches</option>
            {printOptions.branches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Recovery Officer</label>
          <select className="input" value={printOfficer} onChange={e => setPrintOfficer(e.target.value)}>
            <option value="">All officers</option>
            {printOptions.officers.map(o => <option key={o} value={o}>{o}</option>)}
            {printOptions.hasUnassigned && <option value={UNASSIGNED}>Unassigned</option>}
          </select>
        </div>
        <div>
          <label className="label">Category</label>
          <select className="input" value={printCategory} onChange={e => setPrintCategory(e.target.value)}>
            <option value="">All</option>
            {printOptions.categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <button onClick={doPrint} className="btn-primary">Print / Save PDF</button>
      </div>
      <OutstandingReportPrint
        rows={printRows}
        month={dayjs()}
        branchLabel={printBranch || 'All Branches'}
        categoryLabel={printCategory || 'All'}
        printedBy={user?.full_name || user?.email}
        companyName={company?.name || COMPANY_NAME}
        logoUrl={company?.logo_url || LOGO_URL}
      />
    </div>
  );

  return (
    <div className="p-6">
      <PageHeader title="Installments" subtitle="One row per order — click to open the order and record payments"
        actions={<button className="btn-secondary" onClick={() => setShowPrint(true)} disabled={loading}>Print Outstanding Report</button>} />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="Due this month" value={rs(stats.dueAmount)} accent="yellow"
          sublabel={`${stats.dueCustomers} customer${stats.dueCustomers === 1 ? '' : 's'} · ${dayjs().format('MMM YYYY')}`}
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>} />
        <StatCard label="With Overdue" value={stats.overdue} accent="red"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12" y2="16"/></svg>} />
        <StatCard label="Remaining balance" value={rs(stats.remaining)} accent="brand" sublabel="all plans"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>} />
        <StatCard label="Paid this month" value={stats.paidThisMonth} accent="green" sublabel="installments"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>} />
      </div>

      {/* Toolbar */}
      <div className="card mb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[240px]">
          <label className="label">Search (name, account #, order # or phone)</label>
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
              <th className="!text-center">Total</th>
              <th className="!text-center">Paid</th>
              <th className="!text-center">Unpaid</th>
              <th>Monthly</th>
              <th>Remaining</th>
              <th>Due now</th>
              <th>Last Paid</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="11" className="text-center text-slate-400 py-8">Loading…</td></tr>}
            {!loading && filtered.map(r => {
              const [label, pill] = statusLabel(r);
              return (
                <tr key={r.order_id} className="cursor-pointer"
                  onClick={() => navigate(`/orders/${r.order_id}`)}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Avatar src={r.picture_url} name={r.customer_name} size={36} />
                      <div>
                        <div className="font-medium text-slate-900">{r.customer_name}</div>
                        <div className="text-xs text-slate-500">
                          {r.account_no ? `#${r.account_no}` : ''}{r.account_no && r.phone_1 ? ' · ' : ''}{r.phone_1}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className="text-sm font-medium text-slate-700">{r.order_no || '—'}</div>
                    <div className="text-xs text-slate-500">{r.branch_name}</div>
                  </td>
                  <td className="!text-center text-sm font-medium text-slate-900">{r.planned}</td>
                  <td className="!text-center text-sm font-medium text-emerald-700">{r.paid_count}</td>
                  <td className="!text-center text-sm font-medium text-amber-700">{r.unpaid_count}</td>
                  <td className="text-sm whitespace-nowrap">{rs(r.monthly)}</td>
                  <td className="text-sm whitespace-nowrap">{rs(r.remaining)}</td>
                  <td className={`whitespace-nowrap ${r.due_now > 0 ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>
                    {r.due_now > 0 ? rs(r.due_now) : '—'}
                  </td>
                  <td className="text-sm whitespace-nowrap">{fmtDate(r.last_paid_date)}</td>
                  <td><span className={pill}>{label}</span></td>
                  <td onClick={e => e.stopPropagation()}>
                    {!r.fully_paid && (
                      <button onClick={() => navigate(`/orders/${r.order_id}`)} className="btn-primary py-1 px-3 text-sm">
                        Pay
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan="11" className="text-center text-slate-400 py-10">
                {rows.length === 0
                  ? 'No installments yet. Create an order for a customer to start their plan — invoices then open one month at a time.'
                  : filterChip === 'due' && !search
                    ? `Nothing due for ${dayjs().format('MMMM YYYY')} — every customer has paid this month's installment.`
                    : 'No orders match these filters.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
