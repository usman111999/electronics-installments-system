import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import DeviceCard from '../components/DeviceCard';

const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;
const statusClass = {
  paid: 'badge-green',
  pending: 'badge-yellow',
  overdue: 'badge-red',
  partial: 'badge-blue',
};

export default function OrderDetail() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [selected, setSelected] = useState(null);
  const [pay, setPay] = useState({});
  const [err, setErr] = useState('');
  const [instFilter, setInstFilter] = useState('all');
  const [genErr, setGenErr] = useState('');
  const [generating, setGenerating] = useState(false);

  const generateNext = async () => {
    setGenerating(true); setGenErr('');
    try {
      await api.post('/installments/next', { order_id: id });
      await load();
    } catch (e) { setGenErr(e?.response?.data?.error || 'Could not generate the next invoice'); }
    finally { setGenerating(false); }
  };

  const load = async () => {
    const { data } = await api.get(`/orders/${id}`);
    setOrder(data);
  };
  useEffect(() => { load(); }, [id]);

  const remainingOf = (inst) =>
    Math.max(0, Number(inst.amount_due || 0) + Number(inst.fine || 0) - Number(inst.discount || 0) - Number(inst.amount_paid || 0));

  const openPay = (inst) => {
    setSelected(inst);
    // Default to clearing the full remaining balance; the operator can switch
    // to a partial amount.
    setPay({ amount_paid: remainingOf(inst), payment_date: dayjs().format('YYYY-MM-DD') });
    setPayOpen(true);
    setErr('');
  };

  const submitPay = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.post(`/installments/${selected.id}/pay`, pay);
      setPayOpen(false); await load();
    } catch (e) { setErr(e?.response?.data?.error || 'Payment failed'); }
  };

  if (!order) return <div className="p-8 text-slate-500">Loading…</div>;

  const allInstallments = order.installments || [];
  // True money picture, independent of how many invoices are created yet:
  const advance = Number(order.advance_payment || 0);
  const discount = Number(order.discount || 0);
  const financed = Math.max(0, Number(order.total_price) - advance - discount); // amount to collect via installments
  const instCollected = allInstallments.reduce((s, i) => s + Number(i.amount_paid || 0), 0);
  const totalReceived = advance + instCollected;            // everything received so far (advance counts!)
  const remaining = Math.max(0, financed - instCollected);  // real balance left over the whole plan
  const paidCount = allInstallments.filter(i => i.status === 'paid').length;
  const monthsLeft = Math.max(0, Number(order.total_installments || 0) - paidCount);
  // Next invoice is generated on demand — only when nothing is unpaid, more
  // months remain, and there's still a balance to bill.
  const hasUnpaid = allInstallments.some(i => i.status !== 'paid');
  const canGenerateNext = !hasUnpaid && allInstallments.length < Number(order.total_installments || 0) && remaining > 0;

  // Invoice filter — paid / pending / overdue / partial.
  const INST_FILTERS = [
    { value: 'all', label: 'All' },
    { value: 'paid', label: 'Paid' },
    { value: 'pending', label: 'Pending' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'partial', label: 'Partial' },
  ];
  const counts = allInstallments.reduce((m, i) => { m[i.status] = (m[i.status] || 0) + 1; return m; }, {});
  const visibleInstallments = instFilter === 'all'
    ? allInstallments
    : allInstallments.filter(i => i.status === instFilter);

  return (
    <div className="p-6">
      <PageHeader title={`Order ${order.order_no}`} subtitle={`${order.customers?.customer_name} · ${order.product_name_snapshot || ''}`}
        actions={<Link to="/orders" className="btn-secondary">← Back</Link>} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-3">
        <div className="card"><div className="text-xs uppercase text-slate-500">Total Price</div><div className="text-2xl font-bold">{fmt(order.total_price)}</div>{discount > 0 && <div className="text-xs text-slate-400">less discount {fmt(discount)}</div>}</div>
        <div className="card"><div className="text-xs uppercase text-slate-500">Advance Paid</div><div className="text-2xl font-bold text-emerald-600">{fmt(advance)}</div><div className="text-xs text-slate-400">received upfront</div></div>
        <div className="card"><div className="text-xs uppercase text-slate-500">Collected</div><div className="text-2xl font-bold text-emerald-600">{fmt(totalReceived)}</div><div className="text-xs text-slate-400">advance + {paidCount} installment{paidCount === 1 ? '' : 's'}</div></div>
        <div className="card"><div className="text-xs uppercase text-slate-500">Remaining</div><div className="text-2xl font-bold text-amber-600">{fmt(remaining)}</div><div className="text-xs text-slate-400">{monthsLeft} of {order.total_installments} months left</div></div>
      </div>

      <div className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2 mb-6">
        Advance <b>{fmt(advance)}</b> received{discount > 0 ? <> · discount <b>{fmt(discount)}</b></> : null} · <b>{fmt(financed)}</b> financed over <b>{order.total_installments}</b> months · <b>{fmt(remaining)}</b> still to collect.
      </div>

      <DeviceCard order={order} onChanged={load} />

      <div className="flex flex-wrap items-center justify-between gap-2 mt-2 mb-2">
        <div>
          <h3 className="font-semibold text-slate-900">Installment invoices</h3>
          <span className="text-xs text-slate-500">{paidCount} of {order.total_installments} paid · generate each invoice when you collect it</span>
        </div>
        {canGenerateNext && (
          <button onClick={generateNext} disabled={generating} className="btn-primary">
            {generating ? 'Generating…' : '+ Generate next invoice'}
          </button>
        )}
      </div>
      {genErr && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded mb-2">{genErr}</div>}

      <div className="flex flex-wrap gap-1.5 mb-3">
        {INST_FILTERS.map(f => {
          const n = f.value === 'all' ? allInstallments.length : (counts[f.value] || 0);
          return (
            <button key={f.value} type="button" onClick={() => setInstFilter(f.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                instFilter === f.value
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}>
              {f.label} <span className={instFilter === f.value ? 'text-white/80' : 'text-slate-400'}>({n})</span>
            </button>
          );
        })}
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead><tr><th>#</th><th>Due</th><th>Pre-Bal</th><th>Amount</th><th>Paid</th><th>Disc</th><th>Fine</th><th>Balance</th><th>Receipt</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {visibleInstallments.map(i => (
              <tr key={i.id}>
                <td>{i.installment_no}</td>
                <td>{dayjs(i.due_date).format('DD MMM YYYY')}</td>
                <td>{fmt(i.pre_balance)}</td>
                <td>{fmt(i.amount_due)}</td>
                <td>{fmt(i.amount_paid)}</td>
                <td>{fmt(i.discount)}</td>
                <td>{fmt(i.fine)}</td>
                <td>{fmt(i.balance)}</td>
                <td className="text-xs">{i.receipt_no || '-'}</td>
                <td><span className={statusClass[i.status] || 'badge-gray'}>{i.status}</span></td>
                <td>{i.status !== 'paid' && <button onClick={() => openPay(i)} className="text-brand-600 text-sm">Pay</button>}</td>
              </tr>
            ))}
            {visibleInstallments.length === 0 && (
              <tr><td colSpan="11" className="text-center text-slate-400 py-8">No {instFilter !== 'all' ? instFilter : ''} installments</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={`Record Payment — Invoice #${selected?.installment_no}`}>
        <form onSubmit={submitPay} className="space-y-3">
          {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{err}</div>}
          {selected && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm flex items-center justify-between">
              <div>
                <div className="text-slate-500">Remaining on this invoice</div>
                <div className="text-xl font-bold text-slate-900">{fmt(remainingOf(selected))}</div>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPay(p => ({ ...p, amount_paid: remainingOf(selected) }))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${Number(pay.amount_paid) === remainingOf(selected) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white border-slate-200'}`}>
                  Pay in full
                </button>
                <button type="button" onClick={() => setPay(p => ({ ...p, amount_paid: '' }))}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${pay.amount_paid !== '' && Number(pay.amount_paid) !== remainingOf(selected) ? 'bg-amber-500 text-white border-amber-500' : 'bg-white border-slate-200'}`}>
                  Partial
                </button>
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Amount to pay now *</label><input type="number" step="0.01" required autoFocus className="input" value={pay.amount_paid ?? ''} onChange={e => setPay(p => ({ ...p, amount_paid: e.target.value }))}/></div>
            <div><label className="label">Payment Date</label><input type="date" className="input" value={pay.payment_date || ''} onChange={e => setPay(p => ({ ...p, payment_date: e.target.value }))}/></div>
            <div><label className="label">Discount</label><input type="number" step="0.01" className="input" value={pay.discount || ''} onChange={e => setPay(p => ({ ...p, discount: e.target.value }))}/></div>
            <div><label className="label">Fine</label><input type="number" step="0.01" className="input" value={pay.fine || ''} onChange={e => setPay(p => ({ ...p, fine: e.target.value }))}/></div>
            <div className="col-span-2"><label className="label">Receipt # (auto if blank)</label><input className="input" value={pay.receipt_no || ''} onChange={e => setPay(p => ({ ...p, receipt_no: e.target.value }))}/></div>
            <div className="col-span-2"><label className="label">Remarks</label><input className="input" value={pay.remarks || ''} onChange={e => setPay(p => ({ ...p, remarks: e.target.value }))}/></div>
          </div>
          {selected && Number(pay.amount_paid) >= remainingOf(selected) && remainingOf(selected) > 0 && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded px-3 py-2">
              ✓ This clears the invoice. After saving, click “+ Generate next invoice” when you’re ready to bill the next month.
            </div>
          )}
          {selected && pay.amount_paid !== '' && Number(pay.amount_paid) > 0 && Number(pay.amount_paid) < remainingOf(selected) && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-3 py-2">
              Partial payment — this invoice stays open with the balance carried until it is fully paid.
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setPayOpen(false)} className="btn-secondary">Cancel</button>
            <button className="btn-primary">Record Payment</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
