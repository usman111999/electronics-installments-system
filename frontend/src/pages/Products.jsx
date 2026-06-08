import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import ImageUpload from '../components/ImageUpload';
import { useAuth } from '../context/AuthContext';

export default function Products() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const [list, setList] = useState([]);
  const [stock, setStock] = useState({}); // product_id -> in-stock unit count
  const [branches, setBranches] = useState([]);
  const [search, setSearch] = useState('');

  // Product add/edit modal
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({});
  const [err, setErr] = useState('');

  // Add-stock modal (a product is its own stock — managed right here)
  const [stockOpen, setStockOpen] = useState(false);
  const [stockProduct, setStockProduct] = useState(null);
  const [sform, setSform] = useState({ quantity: 1, status: 'in_stock' });
  const [serr, setSerr] = useState('');

  const load = async () => {
    const params = search ? { search } : {};
    const [p, inv, b] = await Promise.all([
      api.get('/products', { params }),
      api.get('/inventory', { params: { status: 'in_stock' } }),
      api.get('/branches'),
    ]);
    setList(p.data);
    const counts = {};
    for (const i of inv.data) counts[i.product_id] = (counts[i.product_id] || 0) + 1;
    setStock(counts);
    setBranches(b.data);
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [search]);

  const closeModal = () => { setOpen(false); setEdit(null); setForm({}); setErr(''); };

  const submit = async (e) => {
    e.preventDefault(); setErr('');
    try {
      if (edit) await api.patch(`/products/${edit.id}`, form);
      else await api.post('/products', form);
      closeModal(); await load();
    } catch (e) { setErr(e?.response?.data?.error || 'Save failed'); }
  };

  const openStock = (p) => { setStockProduct(p); setSform({ quantity: 1, status: 'in_stock' }); setSerr(''); setStockOpen(true); };

  const submitStock = async (e) => {
    e.preventDefault(); setSerr('');
    try {
      // A serial identifies ONE unit; without a serial you can add several at once.
      const qty = sform.serial ? 1 : Math.max(1, Number(sform.quantity) || 1);
      for (let i = 0; i < qty; i++) {
        await api.post('/inventory', {
          product_id: stockProduct.id,
          serial_no: sform.serial || null,
          cost_price: sform.cost_price || null,
          status: sform.status || 'in_stock',
          branch_id: sform.branch_id,
          notes: sform.notes || null,
        });
      }
      setStockOpen(false); await load();
    } catch (e) { setSerr(e?.response?.data?.error || 'Add stock failed'); }
  };

  return (
    <div className="p-6">
      <PageHeader title="Products & Stock" subtitle="Your catalog — each product shows how many units are in stock"
        actions={
          <>
            <input className="input !w-64" placeholder="Search by name…" value={search} onChange={e => setSearch(e.target.value)} />
            <Link to="/inventory" className="btn-secondary">Full stock list →</Link>
            <button className="btn-primary" onClick={() => { setEdit(null); setForm({}); setOpen(true); setErr(''); }}>+ Add Product</button>
          </>
        } />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {list.map(p => {
          const inStock = stock[p.id] || 0;
          return (
            <div key={p.id} className="card relative">
              {Number(p.discount_percent) > 0 && (
                <span className="absolute top-3 right-3 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded">
                  {Number(p.discount_percent)}% OFF
                </span>
              )}
              <div className="aspect-video bg-slate-100 rounded-lg mb-3 overflow-hidden flex items-center justify-center">
                {p.image_url
                  ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                  : <svg className="w-12 h-12 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                }
              </div>
              <div className="text-xs text-slate-500">{p.company} · {p.category || 'General'}</div>
              <div className="font-semibold text-slate-900">{p.name}</div>
              <div className="text-sm text-slate-500">Model: {p.model || '-'}</div>
              <div className="mt-1 text-sm">
                <span className={`inline-flex items-center gap-1 font-medium ${inStock > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                  ● In stock: {inStock}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="text-brand-700 font-bold">Rs. {Number(p.base_price).toLocaleString()}</div>
                <div className="flex gap-3 text-sm">
                  <button onClick={() => openStock(p)} className="text-emerald-600">+ Stock</button>
                  <button onClick={() => { setEdit(p); setForm(p); setOpen(true); setErr(''); }} className="text-brand-600">Edit</button>
                </div>
              </div>
              {p.discount_label && <div className="text-xs text-red-600 mt-1">{p.discount_label}</div>}
            </div>
          );
        })}
        {list.length === 0 && <div className="col-span-full text-center text-slate-400 py-12">No products yet — click “+ Add Product”.</div>}
      </div>

      {/* Add / edit product */}
      <Modal open={open} onClose={closeModal} title={edit ? 'Edit Product' : 'New Product'} size="lg">
        <form onSubmit={submit} className="space-y-3">
          {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><ImageUpload value={form.image_url || ''} onChange={(url) => setForm(f => ({ ...f, image_url: url }))} bucket="product-images" label="Product Image" /></div>
            <div><label className="label">Name *</label><input required className="input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/></div>
            <div><label className="label">Model</label><input className="input" value={form.model || ''} onChange={e => setForm(f => ({ ...f, model: e.target.value }))}/></div>
            <div><label className="label">Company</label><input className="input" value={form.company || ''} onChange={e => setForm(f => ({ ...f, company: e.target.value }))}/></div>
            <div><label className="label">Category</label>
              <input className="input" list="product-categories" placeholder="Mobile, LED TV, Laptop…" value={form.category || ''} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}/>
              <datalist id="product-categories">
                {['Mobile Phone','Laptop','Tablet','LED / TV','Refrigerator','Air Conditioner','Washing Machine','Microwave Oven','Deep Freezer','Generator','UPS','Solar Panel','Fan','Water Dispenser','Sound System','Camera','Smart Watch','Gaming Console','Home Appliance','Accessories','Other'].map(c => <option key={c} value={c} />)}
              </datalist>
              <p className="text-xs text-slate-500 mt-1">Start typing to pick a suggestion, or type your own.</p>
            </div>
            <div><label className="label">Base Price *</label><input type="number" step="0.01" required className="input" value={form.base_price ?? ''} onChange={e => setForm(f => ({ ...f, base_price: e.target.value }))}/></div>
            <div><label className="label">Default Monthly Installment (Rs.)</label><input type="number" step="0.01" className="input" placeholder="optional suggestion" value={form.default_installment_price ?? ''} onChange={e => setForm(f => ({ ...f, default_installment_price: e.target.value }))}/></div>
            <div><label className="label">Discount %</label><input type="number" step="0.01" min="0" max="100" className="input" value={form.discount_percent ?? ''} onChange={e => setForm(f => ({ ...f, discount_percent: e.target.value }))}/></div>
            <div><label className="label">Discount Label</label><input className="input" placeholder="e.g. Eid sale" value={form.discount_label || ''} onChange={e => setForm(f => ({ ...f, discount_label: e.target.value }))}/></div>
            <div className="col-span-2"><label className="label">Description</label><textarea className="input" value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}/></div>
          </div>
          {!edit && <p className="text-xs text-slate-500">After saving, use “+ Stock” on the product to add units to your inventory.</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeModal} className="btn-secondary">Cancel</button>
            <button className="btn-primary">{edit ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </Modal>

      {/* Add stock for a product */}
      <Modal open={stockOpen} onClose={() => setStockOpen(false)} title={`Add stock — ${stockProduct?.name || ''}`}>
        <form onSubmit={submitStock} className="space-y-3">
          {serr && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{serr}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Quantity</label><input type="number" min="1" className="input" value={sform.quantity} disabled={!!sform.serial} onChange={e => setSform(f => ({ ...f, quantity: e.target.value }))}/></div>
            <div><label className="label">Serial / IMEI <span className="font-normal text-slate-400">(optional)</span></label><input className="input" placeholder="one unit" value={sform.serial || ''} onChange={e => setSform(f => ({ ...f, serial: e.target.value }))}/></div>
            <div><label className="label">Cost Price (Rs.)</label><input type="number" step="0.01" className="input" value={sform.cost_price || ''} onChange={e => setSform(f => ({ ...f, cost_price: e.target.value }))}/></div>
            {isAdmin && (
              <div><label className="label">Branch *</label>
                <select required className="input" value={sform.branch_id || ''} onChange={e => setSform(f => ({ ...f, branch_id: e.target.value }))}>
                  <option value="">— select —</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500">Enter a Serial for a single tracked unit, or just a Quantity to add several units at once.</p>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setStockOpen(false)} className="btn-secondary">Cancel</button>
            <button className="btn-primary">Add stock</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
