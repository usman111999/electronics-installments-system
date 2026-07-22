import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../../api/client';
import PageHeader from '../../components/PageHeader';
import Modal from '../../components/Modal';

// Show/copy a plaintext password inline (super-admin convenience — same pattern
// as the Admins screen so the owner can be told their login).
function Secret({ value }) {
  const [shown, setShown] = useState(false);
  if (!value) return <span className="text-slate-400 text-xs">—</span>;
  return (
    <button type="button" onClick={() => setShown(s => !s)}
      className="text-xs bg-slate-100 px-2 py-0.5 rounded font-mono hover:bg-slate-200">
      {shown ? value : '•'.repeat(Math.min(value.length, 10))}
    </button>
  );
}

const EMPTY = {
  name: '', code: '', phone: '', address: '',
  owner_name: '', owner_email: '', owner_password: '',
};

export default function Companies() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null); // { company, owner } to show credentials after create
  const [detail, setDetail] = useState(null);   // company detail modal

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/companies');
      setList(Array.isArray(data) ? data : []);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(EMPTY); setErr(''); setCreated(null); setOpen(true); };
  const close = () => { setOpen(false); setForm(EMPTY); setErr(''); setSaving(false); setCreated(null); };

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      const { data } = await api.post('/companies', {
        name: form.name.trim(),
        code: form.code.trim() || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        owner_name: form.owner_name.trim() || null,
        owner_email: form.owner_email.trim() || null,
        owner_password: form.owner_password || null,
      });
      setCreated(data);        // reveal the owner login for the super admin to hand over
      await load();
    } catch (e) {
      setErr(e?.response?.data?.error || 'Could not create company');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (c) => {
    try { await api.post(`/companies/${c.id}/active`, { is_active: !c.is_active }); await load(); }
    catch (e) { alert(e?.response?.data?.error || 'Failed'); }
  };

  const remove = async (c) => {
    // First call without force → backend returns a 409 describing the blast radius.
    try {
      await api.delete(`/companies/${c.id}`);
      await load();
    } catch (e) {
      const d = e?.response?.data;
      if (d?.code === 'COMPANY_HAS_DATA') {
        if (window.confirm(`${d.error}\n\nType OK to permanently delete "${c.name}" and everything in it.`)) {
          try { await api.delete(`/companies/${c.id}?force=true`); await load(); }
          catch (e2) { alert(e2?.response?.data?.error || 'Delete failed'); }
        }
      } else {
        alert(d?.error || 'Delete failed');
      }
    }
  };

  const openDetail = async (c) => {
    setDetail({ loading: true, company: c });
    try { const { data } = await api.get(`/companies/${c.id}`); setDetail(data); }
    catch { setDetail({ error: 'Could not load company', company: c }); }
  };

  return (
    <div className="p-6">
      <PageHeader title="Companies" subtitle="Each company is a separate business — its own branches, products, staff and customers. Only you can see across all of them."
        actions={<button className="btn-primary" onClick={openNew}>+ New Company</button>} />

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr><th>Company</th><th>Code</th><th>Branches</th><th>Staff</th><th>Customers</th><th>Created</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="8" className="text-center text-slate-400 py-8">Loading…</td></tr>}
            {!loading && list.map(c => (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td>
                <td className="text-slate-500">{c.code || '—'}</td>
                <td>{c.stats?.branches ?? 0}</td>
                <td>{c.stats?.staff ?? 0}</td>
                <td>{c.stats?.customers ?? 0}</td>
                <td className="text-xs text-slate-500">{c.created_at ? dayjs(c.created_at).format('DD MMM YYYY') : '—'}</td>
                <td>{c.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Disabled</span>}</td>
                <td className="space-x-3 whitespace-nowrap">
                  <button onClick={() => openDetail(c)} className="text-brand-600 text-sm">View</button>
                  <button onClick={() => toggleActive(c)} className="text-slate-600 text-sm">{c.is_active ? 'Disable' : 'Enable'}</button>
                  <button onClick={() => remove(c)} className="text-red-600 text-sm">Delete</button>
                </td>
              </tr>
            ))}
            {!loading && list.length === 0 && (
              <tr><td colSpan="8" className="text-center text-slate-400 py-8">No companies yet. Create one to onboard a new business.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Create company + first owner */}
      <Modal open={open} onClose={close} title="New Company" size="lg">
        {created ? (
          <div className="space-y-4">
            <div className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 px-3 py-2 rounded">
              Company <b>{created.company?.name}</b> created.
            </div>
            {created.owner ? (
              <div className="border border-slate-200 rounded-lg p-4 space-y-2">
                <div className="font-semibold text-slate-800">Owner login — hand these to the company</div>
                <div className="text-sm flex justify-between"><span className="text-slate-500">Email</span><code className="font-mono">{created.owner.email}</code></div>
                <div className="text-sm flex justify-between"><span className="text-slate-500">Password</span><code className="font-mono">{created.owner.password_plain || form.owner_password}</code></div>
                <p className="text-xs text-slate-500">The owner signs in at the normal login page and manages only this company.</p>
              </div>
            ) : (
              <div className="text-sm text-amber-700 bg-amber-50 px-3 py-2 rounded">
                No owner login was created. You can add one later from the company's View screen.
              </div>
            )}
            <div className="flex justify-end"><button className="btn-primary" onClick={close}>Done</button></div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{err}</div>}
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Company Name *</label>
                <input className="input" required placeholder="e.g. Bilal Mobiles" value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
              <div><label className="label">Short Code</label>
                <input className="input" placeholder="e.g. BILAL" value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value }))} /></div>
              <div><label className="label">Phone</label>
                <input className="input" placeholder="03xx-xxxxxxx" value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
              <div><label className="label">Address</label>
                <input className="input" placeholder="City / area" value={form.address}
                  onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
            </div>

            <div className="border-t border-slate-100 pt-3">
              <div className="font-semibold text-slate-800 mb-1">Company Owner login</div>
              <p className="text-xs text-slate-500 mb-3">This person manages the whole company — its branches, products, staff and customers. Leave blank to add an owner later.</p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Owner Name</label>
                  <input className="input" placeholder="e.g. Bilal Ahmed" value={form.owner_name}
                    onChange={e => setForm(f => ({ ...f, owner_name: e.target.value }))} /></div>
                <div><label className="label">Owner Email</label>
                  <input type="email" className="input" placeholder="owner@company.com" value={form.owner_email}
                    onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))} /></div>
                <div className="col-span-2"><label className="label">Owner Password</label>
                  <input type="text" className="input font-mono" placeholder="Set a password" value={form.owner_password}
                    onChange={e => setForm(f => ({ ...f, owner_password: e.target.value }))} /></div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={close} className="btn-secondary">Cancel</button>
              <button className="btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create Company'}</button>
            </div>
          </form>
        )}
      </Modal>

      {/* Company detail */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.company?.name || 'Company'} size="lg">
        {detail?.loading && <div className="text-slate-400 py-6 text-center">Loading…</div>}
        {detail?.error && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{detail.error}</div>}
        {detail && !detail.loading && !detail.error && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {[['Branches', detail.stats?.branches], ['Staff', detail.stats?.staff], ['Customers', detail.stats?.customers], ['Orders', detail.stats?.orders], ['Products', detail.stats?.products]].map(([k, v]) => (
                <div key={k} className="border border-slate-200 rounded-lg p-3 text-center">
                  <div className="text-lg font-semibold">{v ?? 0}</div>
                  <div className="text-xs text-slate-500">{k}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="font-semibold mb-2">Staff &amp; owners</div>
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>Name</th><th>Email</th><th>Password</th><th>Role</th><th>Branch</th><th>Status</th></tr></thead>
                  <tbody>
                    {(detail.staff || []).map(u => (
                      <tr key={u.id}>
                        <td>{u.full_name || '—'}</td>
                        <td>{u.email}</td>
                        <td><Secret value={u.password_plain} /></td>
                        <td className="capitalize">{u.role === 'admin' ? 'Owner' : u.role}</td>
                        <td>{u.branches?.name || '—'}</td>
                        <td>{u.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Off</span>}</td>
                      </tr>
                    ))}
                    {(detail.staff || []).length === 0 && <tr><td colSpan="6" className="text-center text-slate-400 py-6">No staff yet</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="font-semibold mb-2">Branches</div>
              <div className="flex flex-wrap gap-2">
                {(detail.branches || []).map(b => (
                  <span key={b.id} className="badge-gray">{b.name}{b.city ? ` · ${b.city}` : ''}</span>
                ))}
                {(detail.branches || []).length === 0 && <span className="text-sm text-slate-400">No branches yet</span>}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
