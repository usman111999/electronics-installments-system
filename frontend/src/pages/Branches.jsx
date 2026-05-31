import { useEffect, useState } from 'react';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';

export default function Branches() {
  const [list, setList] = useState([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({});
  const [err, setErr] = useState('');

  const load = async () => {
    const { data } = await api.get('/branches');
    setList(data);
  };
  useEffect(() => { load(); }, []);

  const closeModal = () => { setOpen(false); setEdit(null); setForm({}); setErr(''); };

  const openNew = () => { setEdit(null); setForm({}); setOpen(true); setErr(''); };
  const openEdit = (b) => {
    setEdit(b);
    // Only spread editable fields — never include id, created_at, updated_at
    setForm({
      name: b.name, code: b.code, city: b.city, phone: b.phone,
      address: b.address, manager_name: b.manager_name, is_active: b.is_active,
      auto_lock_days: b.auto_lock_days ?? '',
    });
    setOpen(true);
    setErr('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      // Normalize auto_lock_days: empty string → null (means manual-only)
      const payload = { ...form };
      if (payload.auto_lock_days === '' || payload.auto_lock_days == null) payload.auto_lock_days = null;
      else payload.auto_lock_days = Number(payload.auto_lock_days);
      if (edit) await api.patch(`/branches/${edit.id}`, payload);
      else await api.post('/branches', payload);
      closeModal(); await load();
    } catch (e) { setErr(e?.response?.data?.error || 'Save failed'); }
  };

  return (
    <div className="p-6">
      <PageHeader title="Branches" subtitle="Manage company branches"
        actions={<button className="btn-primary" onClick={openNew}>+ Add Branch</button>} />
      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead><tr><th>Name</th><th>Code</th><th>City</th><th>Phone</th><th>Manager</th><th>Auto-lock</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {list.map(b => (
              <tr key={b.id}>
                <td className="font-medium">{b.name}</td>
                <td>{b.code || '-'}</td>
                <td>{b.city || '-'}</td>
                <td>{b.phone || '-'}</td>
                <td>{b.manager_name || '-'}</td>
                <td>{b.auto_lock_days ? `${b.auto_lock_days} days` : <span className="text-slate-400">off</span>}</td>
                <td>{b.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Disabled</span>}</td>
                <td><button onClick={() => openEdit(b)} className="text-brand-600 text-sm">Edit</button></td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="8" className="text-center text-slate-400 py-8">No branches yet</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={closeModal} title={edit ? 'Edit Branch' : 'New Branch'}>
        <form onSubmit={submit} className="space-y-3">
          {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Name *</label><input className="input" required value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}/></div>
            <div><label className="label">Code</label><input className="input" value={form.code || ''} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}/></div>
            <div><label className="label">City</label><input className="input" value={form.city || ''} onChange={e => setForm(f => ({ ...f, city: e.target.value }))}/></div>
            <div><label className="label">Phone</label><input className="input" value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}/></div>
            <div className="col-span-2"><label className="label">Address</label><textarea className="input" value={form.address || ''} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}/></div>
            <div><label className="label">Manager Name</label><input className="input" value={form.manager_name || ''} onChange={e => setForm(f => ({ ...f, manager_name: e.target.value }))}/></div>
            <div>
              <label className="label">Auto-lock after (days overdue)</label>
              <input className="input" type="number" min="1" placeholder="blank = manual only"
                value={form.auto_lock_days ?? ''}
                onChange={e => setForm(f => ({ ...f, auto_lock_days: e.target.value }))} />
              <div className="text-[11px] text-slate-500 mt-1">Leave blank to disable auto-lock for this branch.</div>
            </div>
            {edit && (
              <div><label className="label">Active</label>
                <select className="input" value={form.is_active ? 'true' : 'false'} onChange={e => setForm(f => ({ ...f, is_active: e.target.value === 'true' }))}>
                  <option value="true">Active</option><option value="false">Disabled</option>
                </select>
              </div>
            )}
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
