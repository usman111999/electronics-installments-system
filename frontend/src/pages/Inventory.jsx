import { useEffect, useState } from 'react';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import { useAuth } from '../context/AuthContext';

const statusBadge = {
  in_stock: 'badge-green',
  sold: 'badge-gray',
  reserved: 'badge-yellow',
  damaged: 'badge-red',
  returned: 'badge-blue',
};

export default function Inventory() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [products, setProducts] = useState([]);
  const [branches, setBranches] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ status: 'in_stock' });
  const [err, setErr] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = async () => {
    const params = statusFilter ? { status: statusFilter } : {};
    const [a, b, c] = await Promise.all([
      api.get('/inventory', { params }),
      api.get('/products', { params: { active: 'true' } }),
      api.get('/branches'),
    ]);
    setList(a.data); setProducts(b.data); setBranches(c.data);
  };
  useEffect(() => { load(); }, [statusFilter]);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.post('/inventory', form);
      setOpen(false); setForm({ status: 'in_stock' });
      await load();
    } catch (e) { setErr(e?.response?.data?.error || 'Add failed'); }
  };

  return (
    <div className="p-6">
      <PageHeader title="Inventory" subtitle="Stock per branch"
        actions={
          <>
            <select className="input !w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              <option value="in_stock">In Stock</option>
              <option value="sold">Sold</option>
              <option value="reserved">Reserved</option>
              <option value="damaged">Damaged</option>
              <option value="returned">Returned</option>
            </select>
            <button className="btn-primary" onClick={() => { setOpen(true); setErr(''); }}>+ Add Stock</button>
          </>
        } />
      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead><tr><th>Product</th><th>Model</th><th>Serial No.</th><th>Branch</th><th>Cost</th><th>Status</th><th>Received</th></tr></thead>
          <tbody>
            {list.map(i => (
              <tr key={i.id}>
                <td className="font-medium">{i.products?.name}</td>
                <td>{i.products?.model || '-'}</td>
                <td>{i.serial_no || '-'}</td>
                <td>{i.branches?.name || '-'}</td>
                <td>{i.cost_price ? `Rs. ${Number(i.cost_price).toLocaleString()}` : '-'}</td>
                <td><span className={statusBadge[i.status] || 'badge-gray'}>{i.status}</span></td>
                <td className="text-xs text-slate-500">{new Date(i.received_at).toLocaleDateString()}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="7" className="text-center text-slate-400 py-8">No inventory items</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add Stock">
        <form onSubmit={submit} className="space-y-3">
          {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="label">Product *</label>
              <select required className="input" value={form.product_id || ''} onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))}>
                <option value="">— select —</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} {p.model && `· ${p.model}`}</option>)}
              </select>
            </div>
            <div><label className="label">Serial / IMEI No. <span className="font-normal text-slate-400">(optional, recommended)</span></label><input className="input" placeholder="helps track each unit" value={form.serial_no || ''} onChange={e => setForm(f => ({ ...f, serial_no: e.target.value }))}/></div>
            <div><label className="label">Cost Price</label><input type="number" step="0.01" className="input" placeholder="e.g. 72000" value={form.cost_price || ''} onChange={e => setForm(f => ({ ...f, cost_price: e.target.value }))}/></div>
            {user?.role === 'admin' && (
              <div><label className="label">Branch *</label>
                <select required className="input" value={form.branch_id || ''} onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))}>
                  <option value="">— select —</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div><label className="label">Status <span className="font-normal text-slate-400">(when adding)</span></label>
              <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                <option value="in_stock">In Stock</option>
                <option value="reserved">Reserved</option>
                <option value="damaged">Damaged</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">Changes to “Sold” automatically when used in an order.</p>
            </div>
            <div className="col-span-2"><label className="label">Notes</label><textarea className="input" placeholder="e.g. Received in good condition" value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}/></div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
            <button className="btn-primary">Add</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
