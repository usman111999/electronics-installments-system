import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import CustomerPrintForm from '../components/CustomerPrintForm';
import Modal from '../components/Modal';
import OrderForm from '../components/OrderForm';

const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

const INST_STATUS_PILL = {
  paid:    'badge-green',
  overdue: 'badge-red',
  partial: 'badge-blue',
  pending: 'badge-yellow',
};

const INST_FILTERS = [
  { value: 'all',     label: 'All' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'pending', label: 'Pending' },
  { value: 'partial', label: 'Partial' },
  { value: 'paid',    label: 'Paid' },
];

const remainingOf = (i) =>
  Math.max(0, Number(i.amount_due || 0) + Number(i.fine || 0) - Number(i.discount || 0) - Number(i.amount_paid || 0));

export default function CustomerDetail() {
  const { id } = useParams();
  const [customer, setCustomer] = useState(null);
  const [showPrint, setShowPrint] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [instFilter, setInstFilter] = useState('all');

  const load = async () => {
    const { data } = await api.get(`/customers/${id}`);
    setCustomer(data);
  };
  useEffect(() => { load(); }, [id]);

  // Flatten every installment across the customer's orders into one list,
  // tagging each with its order so we can link back to where payment happens.
  const allInstallments = useMemo(() => {
    const list = [];
    for (const o of customer?.orders || []) {
      for (const i of o.installments || []) {
        list.push({ ...i, order_id: o.id, order_no: o.order_no });
      }
    }
    return list.sort((a, b) => {
      const d = dayjs(a.due_date).valueOf() - dayjs(b.due_date).valueOf();
      return d !== 0 ? d : (a.installment_no || 0) - (b.installment_no || 0);
    });
  }, [customer]);

  const instCounts = useMemo(() => {
    const m = {};
    for (const i of allInstallments) m[i.status] = (m[i.status] || 0) + 1;
    return m;
  }, [allInstallments]);

  const visibleInstallments = instFilter === 'all'
    ? allInstallments
    : allInstallments.filter(i => i.status === instFilter);

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
            <button className="btn-primary" onClick={() => setOrderOpen(true)}>+ New Order</button>
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
            <div className="pt-2 border-t border-slate-100">
              <dt className="text-slate-500 mb-0.5">🏠 Home Address</dt>
              <dd className="text-slate-900 whitespace-pre-wrap break-words">{customer.home_address || '-'}</dd>
            </div>
            <div>
              <dt className="text-slate-500 mb-0.5">🏢 Official Address</dt>
              <dd className="text-slate-900 whitespace-pre-wrap break-words">{customer.official_address || '-'}</dd>
            </div>
            {customer.crc_remarks && <div className="pt-2 border-t border-slate-100"><dt className="text-slate-500 mb-0.5">CRC Remarks</dt><dd className="whitespace-pre-wrap break-words">{customer.crc_remarks}</dd></div>}
          </dl>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="card">
            <h3 className="font-semibold mb-3">Guarantors ({customer.guarantors?.length || 0})</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(customer.guarantors || []).map(g => (
                <div key={g.id} className="border border-slate-200 rounded-lg p-3 text-sm space-y-0.5">
                  <div className="font-semibold">#{g.guarantor_number} · {g.name}</div>
                  <div className="text-slate-500">{g.relation || ''} {g.father_name && `· s/o ${g.father_name}`}</div>
                  <div className="mt-1">📞 {g.phone_1} {g.phone_2 && `· ${g.phone_2}`}</div>
                  {g.cnic && <div className="text-xs text-slate-500">🪪 {g.cnic}</div>}
                  {g.occupation && <div className="text-xs text-slate-500">💼 {g.occupation}</div>}
                  {g.home_address && <div className="text-xs text-slate-500">🏠 Home: {g.home_address}</div>}
                  {g.official_address && <div className="text-xs text-slate-500">🏢 Office: {g.official_address}</div>}
                </div>
              ))}
              {(!customer.guarantors || customer.guarantors.length === 0) && <p className="text-sm text-slate-400">No guarantors on file</p>}
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold mb-3">Orders ({customer.orders?.length || 0})</h3>
            {!customer.orders || customer.orders.length === 0 ? (
              <button onClick={() => setOrderOpen(true)} className="btn-primary">+ Create first order</button>
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

          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="font-semibold">Installments ({allInstallments.length})</h3>
              <div className="flex flex-wrap gap-1.5">
                {INST_FILTERS.map(f => {
                  const n = f.value === 'all' ? allInstallments.length : (instCounts[f.value] || 0);
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
            </div>
            {allInstallments.length === 0 ? (
              <p className="text-sm text-slate-400">No installments yet. Create an order to start a plan — invoices then open one month at a time.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>Order</th><th>#</th><th>Due</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {visibleInstallments.map(i => (
                      <tr key={i.id}>
                        <td><Link to={`/orders/${i.order_id}`} className="text-brand-600">{i.order_no}</Link></td>
                        <td>{i.installment_no}</td>
                        <td>{dayjs(i.due_date).format('DD MMM YYYY')}</td>
                        <td>{fmt(i.amount_due)}</td>
                        <td>{fmt(i.amount_paid)}</td>
                        <td>{fmt(remainingOf(i))}</td>
                        <td><span className={INST_STATUS_PILL[i.status] || 'badge-gray'}>{i.status}</span></td>
                        <td>{i.status !== 'paid' && <Link to={`/orders/${i.order_id}`} className="text-brand-600 text-sm">Pay →</Link>}</td>
                      </tr>
                    ))}
                    {visibleInstallments.length === 0 && (
                      <tr><td colSpan="8" className="text-center text-slate-400 py-8">No {instFilter !== 'all' ? instFilter : ''} installments</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal open={orderOpen} onClose={() => setOrderOpen(false)} title={`New Order — ${customer.customer_name}`} size="lg">
        <OrderForm
          customerId={customer.id}
          branchId={customer.branch_id}
          onCancel={() => setOrderOpen(false)}
          onCreated={() => { setOrderOpen(false); load(); }}
        />
      </Modal>
    </div>
  );
}
