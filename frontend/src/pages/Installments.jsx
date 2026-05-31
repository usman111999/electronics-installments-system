import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';

const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;
const statusClass = { paid: 'badge-green', pending: 'badge-yellow', overdue: 'badge-red', partial: 'badge-blue' };

export default function Installments() {
  const [list, setList] = useState([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const params = status ? { status } : {};
    const { data } = await api.get('/installments', { params });
    setList(data);
    setLoading(false);
  };
  useEffect(() => { load(); }, [status]);

  return (
    <div className="p-6">
      <PageHeader title="Installments" subtitle="All scheduled payments"
        actions={
          <select className="input !w-auto" value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="overdue">Overdue</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
          </select>
        } />

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead><tr><th>Due</th><th>Order</th><th>Customer</th><th>Inst #</th><th>Amount</th><th>Paid</th><th>Status</th></tr></thead>
          <tbody>
            {list.map(i => (
              <tr key={i.id}>
                <td>{dayjs(i.due_date).format('DD MMM YYYY')}</td>
                <td>{i.orders?.id ? <Link to={`/orders/${i.orders.id}`} className="text-brand-600">{i.orders.order_no}</Link> : '-'}</td>
                <td>
                  {i.orders?.customers?.customer_name || '-'}
                  {i.orders?.customers?.account_no && <span className="text-xs text-slate-400"> #{i.orders.customers.account_no}</span>}
                </td>
                <td>{i.installment_no}</td>
                <td>{fmt(i.amount_due)}</td>
                <td>{fmt(i.amount_paid)}</td>
                <td><span className={statusClass[i.status] || 'badge-gray'}>{i.status}</span></td>
              </tr>
            ))}
            {!loading && list.length === 0 && <tr><td colSpan="7" className="text-center text-slate-400 py-8">No installments</td></tr>}
            {loading && <tr><td colSpan="7" className="text-center text-slate-400 py-8">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
