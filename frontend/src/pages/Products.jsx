import { useEffect, useState } from 'react';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import ImageUpload from '../components/ImageUpload';

export default function Products() {
  const [list, setList] = useState([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({});
  const [err, setErr] = useState('');

  const load = async () => {
    const params = search ? { search } : {};
    const { data } = await api.get('/products', { params });
    setList(data);
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [search]);

  const closeModal = () => { setOpen(false); setEdit(null); setForm({}); setErr(''); };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      if (edit) await api.patch(`/products/${edit.id}`, form);
      else await api.post('/products', form);
      closeModal(); await load();
    } catch (e) { setErr(e?.response?.data?.error || 'Save failed'); }
  };

  return (
    <div className="p-6">
      <PageHeader title="Products" subtitle="Electronics catalog"
        actions={
          <>
            <input className="input !w-64" placeholder="Search by name…" value={search} onChange={e => setSearch(e.target.value)} />
            <button className="btn-primary" onClick={() => { setEdit(null); setForm({}); setOpen(true); setErr(''); }}>+ Add Product</button>
          </>
        } />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {list.map(p => (
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
            <div className="mt-2 flex items-center justify-between">
              <div className="text-brand-700 font-bold">Rs. {Number(p.base_price).toLocaleString()}</div>
              <button onClick={() => { setEdit(p); setForm(p); setOpen(true); setErr(''); }} className="text-brand-600 text-sm">Edit</button>
            </div>
            {p.discount_label && <div className="text-xs text-red-600 mt-1">{p.discount_label}</div>}
          </div>
        ))}
        {list.length === 0 && <div className="col-span-full text-center text-slate-400 py-12">No products yet</div>}
      </div>

      <Modal open={open} onClose={closeModal} title={edit ? 'Edit Product' : 'New Product'} size="lg">
        <form onSubmit={submit} className="space-y-3">
          {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><ImageUpload value={form.image_url || ''} onChange={(url) => setForm(f => ({ ...f, image_url: url }))} bucket="product-images" label="Product Image" /></div>
            <div><label className="label">Name *</label><input required className="input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/></div>
            <div><label className="label">Model</label><input className="input" value={form.model || ''} onChange={e => setForm(f => ({ ...f, model: e.target.value }))}/></div>
            <div><label className="label">Company</label><input className="input" value={form.company || ''} onChange={e => setForm(f => ({ ...f, company: e.target.value }))}/></div>
            <div><label className="label">Category</label><input className="input" value={form.category || ''} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}/></div>
            <div><label className="label">Base Price *</label><input type="number" step="0.01" required className="input" value={form.base_price ?? ''} onChange={e => setForm(f => ({ ...f, base_price: e.target.value }))}/></div>
            <div><label className="label">Default Installment</label><input type="number" step="0.01" className="input" value={form.default_installment_price ?? ''} onChange={e => setForm(f => ({ ...f, default_installment_price: e.target.value }))}/></div>
            <div><label className="label">Discount %</label><input type="number" step="0.01" min="0" max="100" className="input" value={form.discount_percent ?? ''} onChange={e => setForm(f => ({ ...f, discount_percent: e.target.value }))}/></div>
            <div><label className="label">Discount Label</label><input className="input" placeholder="e.g. Eid sale" value={form.discount_label || ''} onChange={e => setForm(f => ({ ...f, discount_label: e.target.value }))}/></div>
            <div className="col-span-2"><label className="label">Description</label><textarea className="input" value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}/></div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeModal} className="btn-secondary">Cancel</button>
            <button className="btn-primary">{edit ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
