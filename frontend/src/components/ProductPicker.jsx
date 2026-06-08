import { useState } from 'react';
import { api } from '../api/client';

/**
 * Searchable product selector with an inline "create new product" panel.
 * On create, the new product is added to the list (onCreated) and selected
 * (onPick). Designed to live inside another <form>, so all buttons are
 * type="button" and Enter inside the create panel is swallowed.
 *
 * Props:
 *   products   – current product list
 *   value      – selected product_id
 *   onPick     – (id, productObj|undefined) => void
 *   onCreated  – (newProduct) => void   (parent should add it to its list)
 */
export default function ProductPicker({ products, value, onPick, onCreated }) {
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({});
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const s = search.trim().toLowerCase();
  const filtered = !s ? products : products.filter(p =>
    (p.name || '').toLowerCase().includes(s) ||
    (p.model || '').toLowerCase().includes(s) ||
    (p.company || '').toLowerCase().includes(s) ||
    (p.category || '').toLowerCase().includes(s)
  );

  const create = async () => {
    if (!form.name) { setErr('Product name is required'); return; }
    setErr(''); setSaving(true);
    try {
      const { data } = await api.post('/products', form);
      onCreated?.(data);
      onPick?.(data.id, data);
      setCreating(false); setForm({}); setSearch('');
    } catch (e) {
      setErr(e?.response?.data?.error || 'Could not create product');
    } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="flex gap-2">
        <input className="input flex-1" placeholder="Search product by name / model…" value={search} onChange={e => setSearch(e.target.value)} />
        <button type="button" onClick={() => { setForm({}); setErr(''); setCreating(c => !c); }} className="btn-secondary whitespace-nowrap">
          {creating ? 'Close' : '+ New'}
        </button>
      </div>

      <select className="input mt-2" value={value || ''} onChange={e => { const p = products.find(x => x.id === e.target.value); onPick?.(e.target.value, p); }}>
        <option value="">— none / custom —</option>
        {filtered.map(p => <option key={p.id} value={p.id}>{p.name}{p.model ? ` · ${p.model}` : ''}{p.company ? ` (${p.company})` : ''}</option>)}
        {s && filtered.length === 0 && <option value="" disabled>No match — use “+ New” to create it</option>}
      </select>

      {creating && (
        <div
          className="mt-2 border border-slate-200 rounded-lg p-3 bg-slate-50 space-y-2"
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
        >
          <div className="text-sm font-medium text-slate-700">Create a new product</div>
          {err && <div className="text-xs text-red-700 bg-red-50 px-2 py-1 rounded">{err}</div>}
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2"><label className="label">Name *</label><input className="input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><label className="label">Model</label><input className="input" value={form.model || ''} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} /></div>
            <div><label className="label">Company</label><input className="input" value={form.company || ''} onChange={e => setForm(f => ({ ...f, company: e.target.value }))} /></div>
            <div><label className="label">Category</label>
              <input className="input" list="product-categories" placeholder="Mobile, LED TV…" value={form.category || ''} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
              <datalist id="product-categories">
                {['Mobile Phone','Laptop','Tablet','LED / TV','Refrigerator','Air Conditioner','Washing Machine','Microwave Oven','Deep Freezer','Generator','UPS','Solar Panel','Fan','Water Dispenser','Sound System','Camera','Smart Watch','Gaming Console','Home Appliance','Accessories','Other'].map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div><label className="label">Base Price (Rs.)</label><input type="number" step="0.01" className="input" value={form.base_price ?? ''} onChange={e => setForm(f => ({ ...f, base_price: e.target.value }))} /></div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setCreating(false)} className="btn-secondary !py-1">Cancel</button>
            <button type="button" onClick={create} disabled={saving} className="btn-primary !py-1">{saving ? 'Creating…' : 'Create & select'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
