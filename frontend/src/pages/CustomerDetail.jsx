import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import CustomerPrintForm from '../components/CustomerPrintForm';

const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

export default function CustomerDetail() {
  const { id } = useParams();
  const [customer, setCustomer] = useState(null);
  const [showPrint, setShowPrint] = useState(false);

  const load = async () => {
    const { data } = await api.get(`/customers/${id}`);
    setCustomer(data);
  };
  useEffect(() => { load(); }, [id]);

  if (!customer) return <div className="p-8 text-slate-500">Loading…</div>;

  if (showPrint) return (
    <div>
      <div className="p-4 flex gap-2 bg-slate-100 no-print">
        <button onClick={() => setShowPrint(false)} className="btn-secondary">← Back</button>
        <button onClick={() => window.print()} className="btn-primary">Print / Save PDF</button>
      </div>
      <CustomerPrintForm customer={customer} />
    </div>
  );

  return (
    <div className="p-6">
      <PageHeader title={customer.customer_name} subtitle={`Account #${customer.account_no} · ${customer.branches?.name || ''}`}
        actions={
          <>
            <button className="btn-secondary" onClick={() => setShowPrint(true)}>Print Account Form</button>
            <Link to="/customers" className="btn-secondary">← Back</Link>
          </>
        } />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card lg:col-span-1">
          <div className="flex items-center gap-3 mb-4">
            {customer.picture_url
              ? <img src={customer.picture_url} alt="" className="w-16 h-16 rounded-full object-cover" />
              : <div className="w-16 h-16 rounded-full bg-slate-200 flex items-center justify-center text-slate-500">{customer.customer_name?.[0]}</div>
            }
            <div>
              <div className="font-semibold">{customer.customer_name}</div>
              <div className="text-sm text-slate-500">{customer.father_husband_name}</div>
            </div>
          </div>
          <dl className="text-sm space-y-2">
            <div className="flex justify-between"><dt className="text-slate-500">CNIC</dt><dd>{customer.cnic || '-'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Phone 1</dt><dd>{customer.phone_1}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Phone 2</dt><dd>{customer.phone_2 || '-'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Occupation</dt><dd>{customer.occupation || '-'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Income</dt><dd>{customer.monthly_income ? fmt(customer.monthly_income) : '-'}</dd></div>
            {customer.crc_remarks && <div><dt className="text-slate-500">CRC Remarks</dt><dd className="mt-1">{customer.crc_remarks}</dd></div>}
          </dl>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="card">
            <h3 className="font-semibold mb-3">Guarantors ({customer.guarantors?.length || 0})</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(customer.guarantors || []).map(g => (
                <div key={g.id} className="border border-slate-200 rounded-lg p-3 text-sm">
                  <div className="font-semibold">#{g.guarantor_number} · {g.name}</div>
                  <div className="text-slate-500">{g.relation || ''} {g.father_name && `· s/o ${g.father_name}`}</div>
                  <div className="mt-1">📞 {g.phone_1} {g.phone_2 && `· ${g.phone_2}`}</div>
                  {g.home_address && <div className="text-xs text-slate-500 mt-1">🏠 {g.home_address}</div>}
                </div>
              ))}
              {(!customer.guarantors || customer.guarantors.length === 0) && <p className="text-sm text-slate-400">No guarantors on file</p>}
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold mb-3">Orders ({customer.orders?.length || 0})</h3>
            {!customer.orders || customer.orders.length === 0 ? (
              <p className="text-sm text-slate-400">No orders</p>
            ) : (
              <table className="table-base">
                <thead><tr><th>Order #</th><th>Date</th><th>Product</th><th>Total</th><th>Inst.</th><th>Status</th></tr></thead>
                <tbody>
                  {customer.orders.map(o => (
                    <tr key={o.id}>
                      <td>
                        <Link to={`/orders/${o.id}`} className="text-brand-600">{o.order_no}</Link>
                      </td>
                      <td>{dayjs(o.order_date).format('DD MMM YYYY')}</td>
                      <td>{o.product_name_snapshot || '-'}</td>
                      <td>{fmt(o.total_price)}</td>
                      <td>{o.total_installments}</td>
                      <td><span className={`badge-${o.status === 'completed' ? 'green' : o.status === 'active' ? 'blue' : 'red'}`}>{o.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
