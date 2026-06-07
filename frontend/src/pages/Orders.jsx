import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';

const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

export default function Orders() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ order_date: dayjs().format('YYYY-MM-DD'), due_day: 5 });
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [branches, setBranches] = useState([]);
  const [err, setErr] = useState('');

  const load = async () => {
    const [o, c, p, b] = await Promise.all([
      api.get('/orders'),
      api.get('/customers'),
      api.get('/products', { params: { active: 'true' } }),
      api.get('/branches'),
    ]);
    setList(o.data); setCustomers(c.data); setProducts(p.data); setBranches(b.data);
  };
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (form.product_id) {
      api.get('/inventory', { params: { product_id: form.product_id, status: 'in_stock' } })
        .then(r => setInventory(r.data));
    } else setInventory([]);
  }, [form.product_id]);

  const onProductChange = (id) => {
    const p = products.find(x => x.id === id);
    setForm(f => ({
      ...f,
      product_id: id,
      // Prefill the editable snapshots from the catalog item; the operator can
      // still override them (e.g. for an item not in the catalog).
      product_name_snapshot: p?.name ?? f.product_name_snapshot,
      product_model_snapshot: p?.model ?? f.product_model_snapshot,
      installment_amount: p?.default_installment_price || f.installment_amount,
      total_price: p?.base_price || f.total_price,
    }));
  };

  const closeModal = () => {
    setOpen(false);
    setForm({ order_date: dayjs().format('YYYY-MM-DD'), due_day: 5 });
    setInventory([]);
    setErr('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.post('/orders', form);
      closeModal();
      await load();
    } catch (e) { setErr(e?.response?.data?.error || 'Save failed'); }
  };

  return (
    <div className="p-6">
      <PageHeader title="Orders" subtitle="Sales with installment plans"
        actions={<button className="btn-primary" onClick={() => { setOpen(true); setErr(''); }}>+ New Order</button>} />

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead><tr><th>Order #</th><th>Date</th><th>Customer</th><th>Product</th><th>Total</th><th>Inst.</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {list.map(o => (
              <tr key={o.id}>
                <td className="font-medium">{o.order_no}</td>
                <td>{dayjs(o.order_date).format('DD MMM YYYY')}</td>
                <td>{o.customers?.customer_name} <span className="text-xs text-slate-400">#{o.customers?.account_no}</span></td>
                <td>{o.product_name_snapshot || '-'}</td>
                <td>{fmt(o.total_price)}</td>
                <td>{o.total_installments} × {fmt(o.installment_amount)}</td>
                <td><span className={`badge-${o.status === 'completed' ? 'green' : o.status === 'active' ? 'blue' : 'red'}`}>{o.status}</span></td>
                <td><Link to={`/orders/${o.id}`} className="text-brand-600 text-sm">View</Link></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="8" className="text-center text-slate-400 py-8">No orders yet</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => closeModal()} title="New Order" size="lg">
        <form onSubmit={submit} className="space-y-3">
          {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="label">Customer *</label>
              <select required className="input" value={form.customer_id || ''} onChange={e => setForm(f => ({ ...f, customer_id: e.target.value }))}>
                <option value="">— select —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.customer_name} (#{c.account_no})</option>)}
              </select>
            </div>
            <div><label className="label">Product (from catalog)</label>
              <select className="input" value={form.product_id || ''} onChange={e => onProductChange(e.target.value)}>
                <option value="">— none / custom —</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} {p.model && `· ${p.model}`}</option>)}
              </select>
            </div>
            <div><label className="label">Inventory item (serial)</label>
              <select className="input" value={form.inventory_id || ''} onChange={e => setForm(f => ({ ...f, inventory_id: e.target.value }))}>
                <option value="">— any —</option>
                {inventory.map(i => <option key={i.id} value={i.id}>{i.serial_no || 'no-serial'}</option>)}
              </select>
            </div>
            <div><label className="label">Item / Product name</label>
              <input className="input" placeholder="e.g. LED TV, Refrigerator, Laptop…" value={form.product_name_snapshot || ''} onChange={e => setForm(f => ({ ...f, product_name_snapshot: e.target.value }))}/>
            </div>
            <div><label className="label">Model</label>
              <input className="input" placeholder="e.g. 43U7K, A2895…" value={form.product_model_snapshot || ''} onChange={e => setForm(f => ({ ...f, product_model_snapshot: e.target.value }))}/>
            </div>
            <div className="col-span-2"><label className="label">Accessories included</label>
              <textarea className="input" rows="2" placeholder="e.g. Charger, earbuds, cover, warranty card, stabiliser…" value={form.accessories || ''} onChange={e => setForm(f => ({ ...f, accessories: e.target.value }))}/>
            </div>
            <div><label className="label">Order Date *</label><input type="date" required className="input" value={form.order_date || ''} onChange={e => setForm(f => ({ ...f, order_date: e.target.value }))}/></div>
            <div><label className="label">Due Day (1–28)</label><input type="number" min="1" max="28" className="input" value={form.due_day || 5} onChange={e => setForm(f => ({ ...f, due_day: Number(e.target.value) }))}/></div>
            <div><label className="label">Total Price (Rs.) *</label><input type="number" step="0.01" required className="input" value={form.total_price || ''} onChange={e => setForm(f => ({ ...f, total_price: e.target.value }))}/></div>
            <div><label className="label">Advance / Down payment (Rs.)</label><input type="number" step="0.01" className="input" value={form.advance_payment || ''} onChange={e => setForm(f => ({ ...f, advance_payment: e.target.value }))}/></div>
            <div><label className="label">Discount (Rs.)</label><input type="number" step="0.01" className="input" value={form.discount || ''} onChange={e => setForm(f => ({ ...f, discount: e.target.value }))}/></div>
            <div><label className="label">Monthly Installment (Rs.) *</label><input type="number" step="0.01" required className="input" placeholder="amount per month" value={form.installment_amount || ''} onChange={e => setForm(f => ({ ...f, installment_amount: e.target.value }))}/></div>
            <div><label className="label">Total Months *</label><input type="number" min="1" required className="input" placeholder="any number — e.g. 4, 6, 12, 18" value={form.total_installments || ''} onChange={e => setForm(f => ({ ...f, total_installments: e.target.value, duration_months: e.target.value }))}/></div>
            <div className="col-span-2 text-xs text-blue-900 bg-blue-50 border border-blue-100 rounded px-3 py-2">
              Only the <b>first month's invoice</b> opens now. When it's marked paid, the next invoice opens automatically — one month at a time.
            </div>
            <div><label className="label">Recovery Officer</label><input className="input" value={form.recovery_officer || ''} onChange={e => setForm(f => ({ ...f, recovery_officer: e.target.value }))}/></div>
            {(user?.role === 'admin' || user?.role === 'super_admin') && (
              <div className="col-span-2"><label className="label">Branch *</label>
                <select required className="input" value={form.branch_id || ''} onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))}>
                  <option value="">— select —</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div className="col-span-2"><label className="label">Notes</label><textarea className="input" value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}/></div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => closeModal()} className="btn-secondary">Cancel</button>
            <button className="btn-primary">Create Order</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
