import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import PageHeader from '../../components/PageHeader';

export default function CustomerProducts() {
  const [list, setList] = useState([]);
  const [search, setSearch] = useState('');

  const load = async () => {
    const { data } = await api.get('/products', { params: { active: 'true', ...(search ? { search } : {}) } });
    setList(data);
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [search]);

  const discounted = (p) => {
    const pct = Number(p.discount_percent || 0);
    if (!pct) return null;
    return Math.round(Number(p.base_price || 0) * (1 - pct / 100));
  };

  return (
    <div className="p-6">
      <PageHeader title="Browse Products" subtitle="Available electronics with installment options"
        actions={<input className="input !w-64" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {list.map(p => {
          const finalPrice = discounted(p);
          return (
            <div key={p.id} className="card relative">
              {finalPrice !== null && (
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
              <div className="text-xs text-slate-500">{p.company} · {p.category || ''}</div>
              <div className="font-semibold">{p.name}</div>
              <div className="text-xs text-slate-500">{p.model}</div>
              <div className="mt-3 flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500">Cash Price</div>
                  {finalPrice !== null
                    ? <>
                        <div className="text-brand-700 font-bold">Rs. {finalPrice.toLocaleString()}</div>
                        <div className="text-xs text-slate-400 line-through">Rs. {Number(p.base_price).toLocaleString()}</div>
                      </>
                    : <div className="text-brand-700 font-bold">Rs. {Number(p.base_price).toLocaleString()}</div>}
                </div>
                {p.default_installment_price && (
                  <div className="text-right">
                    <div className="text-xs text-slate-500">From / Mo.</div>
                    <div className="text-emerald-700 font-bold">Rs. {Number(p.default_installment_price).toLocaleString()}</div>
                  </div>
                )}
              </div>
              {p.discount_label && <div className="text-xs text-red-600 mt-1">{p.discount_label}</div>}
            </div>
          );
        })}
        {list.length === 0 && <div className="col-span-full text-center text-slate-400 py-12">No products available</div>}
      </div>
    </div>
  );
}
