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

  const load = async () => {
    const { data } = await api.get(`/orders/${id}`);
    setOrder(data);
  };
  useEffect(() => { load(); }, [id]);

  const openPay = (inst) => {
    setSelected(inst);
    setPay({ amount_paid: inst.amount_due - (inst.amount_paid || 0), payment_date: dayjs().format('YYYY-MM-DD') });
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

  const totalPaid = (order.installments || []).reduce((s, i) => s + Number(i.amount_paid || 0), 0);
  const totalRemaining = (order.installments || []).reduce((s, i) => s + Math.max(0, Number(i.amount_due) - Number(i.amount_paid || 0)), 0);

  return (
    <div className="p-6">
      <PageHeader title={`Order ${order.order_no}`} subtitle={`${order.customers?.customer_name} · ${order.product_name_snapshot || ''}`}
        actions={<Link to="/orders" className="btn-secondary">← Back</Link>} />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6">
        <div className="card"><div className="text-xs uppercase text-slate-500">Total</div><div className="text-2xl font-bold">{fmt(order.total_price)}</div></div>
        <div className="card"><div className="text-xs uppercase text-slate-500">Advance</div><div className="text-2xl font-bold">{fmt(order.advance_payment)}</div></div>
        <div className="card"><div className="text-xs uppercase text-slate-500">Collected</div><div className="text-2xl font-bold text-emerald-600">{fmt(totalPaid)}</div></div>
        <div className="card"><div className="text-xs uppercase text-slate-500">Outstanding</div><div className="text-2xl font-bold text-amber-600">{fmt(totalRemaining)}</div></div>
      </div>

      <DeviceCard order={order} onChanged={load} />

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead><tr><th>#</th><th>Due</th><th>Pre-Bal</th><th>Amount</th><th>Paid</th><th>Disc</th><th>Fine</th><th>Balance</th><th>Receipt</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {(order.installments || []).map(i => (
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
          </tbody>
        </table>
      </div>

      <Modal open={payOpen} onClose={() => setPayOpen(false)} title={`Record Payment — Inst #${selected?.installment_no}`}>
        <form onSubmit={submitPay} className="space-y-3">
          {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Amount Paid *</label><input type="number" step="0.01" required className="input" value={pay.amount_paid || ''} onChange={e => setPay(p => ({ ...p, amount_paid: e.target.value }))}/></div>
            <div><label className="label">Payment Date</label><input type="date" className="input" value={pay.payment_date || ''} onChange={e => setPay(p => ({ ...p, payment_date: e.target.value }))}/></div>
            <div><label className="label">Discount</label><input type="number" step="0.01" className="input" value={pay.discount || ''} onChange={e => setPay(p => ({ ...p, discount: e.target.value }))}/></div>
            <div><label className="label">Fine</label><input type="number" step="0.01" className="input" value={pay.fine || ''} onChange={e => setPay(p => ({ ...p, fine: e.target.value }))}/></div>
            <div className="col-span-2"><label className="label">Receipt # (auto if blank)</label><input className="input" value={pay.receipt_no || ''} onChange={e => setPay(p => ({ ...p, receipt_no: e.target.value }))}/></div>
            <div className="col-span-2"><label className="label">Remarks</label><input className="input" value={pay.remarks || ''} onChange={e => setPay(p => ({ ...p, remarks: e.target.value }))}/></div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setPayOpen(false)} className="btn-secondary">Cancel</button>
            <button className="btn-primary">Record</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
