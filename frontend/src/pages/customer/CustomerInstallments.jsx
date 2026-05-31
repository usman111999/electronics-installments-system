import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../../api/client';
import PageHeader from '../../components/PageHeader';

const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;
const statusClass = { paid: 'badge-green', pending: 'badge-yellow', overdue: 'badge-red', partial: 'badge-blue' };

export default function CustomerInstallments() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/installments').then(r => { setList(r.data); setLoading(false); });
  }, []);

  const totalDue = list.reduce((s, i) => s + Math.max(0, Number(i.amount_due) - Number(i.amount_paid || 0)), 0);
  const totalPaid = list.reduce((s, i) => s + Number(i.amount_paid || 0), 0);

  return (
    <div className="p-6">
      <PageHeader title="My Installments" subtitle="Scheduled and paid installments" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="card"><div className="text-xs uppercase text-slate-500">Total Paid</div><div className="text-2xl font-bold text-emerald-600">{fmt(totalPaid)}</div></div>
        <div className="card"><div className="text-xs uppercase text-slate-500">Outstanding</div><div className="text-2xl font-bold text-amber-600">{fmt(totalDue)}</div></div>
        <div className="card"><div className="text-xs uppercase text-slate-500">Installments</div><div className="text-2xl font-bold">{list.length}</div></div>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead><tr><th>Order</th><th>Inst #</th><th>Due Date</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th><th>Receipt</th></tr></thead>
          <tbody>
            {list.map(i => (
              <tr key={i.id}>
                <td>{i.orders?.order_no || '-'}</td>
                <td>{i.installment_no}</td>
                <td>{dayjs(i.due_date).format('DD MMM YYYY')}</td>
                <td>{fmt(i.amount_due)}</td>
                <td>{fmt(i.amount_paid)}</td>
                <td>{fmt(i.balance)}</td>
                <td><span className={statusClass[i.status] || 'badge-gray'}>{i.status}</span></td>
                <td className="text-xs">{i.receipt_no || '-'}</td>
              </tr>
            ))}
            {!loading && list.length === 0 && <tr><td colSpan="8" className="text-center text-slate-400 py-8">No installments</td></tr>}
            {loading && <tr><td colSpan="8" className="text-center text-slate-400 py-8">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
