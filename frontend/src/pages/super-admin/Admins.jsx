import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../../api/client';
import PageHeader from '../../components/PageHeader';
import Modal from '../../components/Modal';
import PermissionPicker from '../../components/PermissionPicker';

function PasswordCell({ value }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-slate-400 text-xs">—</span>;
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return (
    <div className="flex items-center gap-2">
      <code className="text-xs bg-slate-100 px-2 py-0.5 rounded font-mono">
        {shown ? value : '•'.repeat(Math.min(value.length, 10))}
      </code>
      <button onClick={() => setShown(s => !s)} title={shown ? 'Hide' : 'Show'} className="text-slate-500 hover:text-slate-800">
        {shown
          ? <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          : <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
      </button>
      <button onClick={copy} title="Copy" className="text-slate-500 hover:text-slate-800">
        {copied
          ? <svg className="w-4 h-4 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
          : <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>}
      </button>
    </div>
  );
}

// Default admin permission bundle from spec §2.9
const DEFAULT_ADMIN_BUNDLE = [
  'branches.view', 'branches.create', 'branches.update', 'branches.delete',
  'users.view', 'users.create', 'users.update', 'users.disable',
  'roles.view', 'roles.manage',
  'products.view', 'products.manage',
  'inventory.view', 'inventory.manage',
  'customers.view', 'customers.manage',
  'orders.view', 'orders.create', 'orders.update',
  'installments.view', 'installments.record_payment',
  'devices.view', 'devices.enroll', 'devices.lock', 'devices.unlock', 'devices.locate', 'devices.global_view',
  'activity_logs.view', 'activity_logs.global_view',
  'whatsapp.send', 'whatsapp.view',
  'stats.view', 'stats.global_view',
];

const EMPTY_FORM = {
  full_name: '', email: '', phone: '', password: '',
  permissions: DEFAULT_ADMIN_BUNDLE,
};

export default function SuperAdmins() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetOpen, setResetOpen] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetErr, setResetErr] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/super-admin/admins');
      setList(Array.isArray(data) ? data : (data?.admins || []));
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setErr('');
    setSaving(false);
  };

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErr('');
    setOpen(true);
  };

  const openEdit = (a) => {
    setEditing(a);
    setForm({
      full_name: a.full_name || '',
      email: a.email || '',
      phone: a.phone || '',
      password: '',
      permissions: Array.isArray(a.permissions) ? a.permissions : DEFAULT_ADMIN_BUNDLE,
    });
    setErr('');
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setSaving(true);
    try {
      const payload = {
        full_name: form.full_name.trim(),
        email: form.email.trim(),
        phone: form.phone?.trim() || null,
        permissions: form.permissions,
      };
      if (!editing || form.password) payload.password = form.password;
      if (editing) await api.patch(`/super-admin/admins/${editing.id}`, payload);
      else await api.post('/super-admin/admins', payload);
      closeModal();
      await load();
    } catch (e) {
      setErr(e?.response?.data?.error || 'Save failed');
      setSaving(false);
    }
  };

  const toggleEnable = async (a) => {
    try {
      if (a.is_active) await api.post(`/super-admin/admins/${a.id}/disable`);
      else await api.post(`/super-admin/admins/${a.id}/enable`);
      await load();
    } catch {/* ignore */}
  };

  const openReset = (a) => { setResetOpen(a); setResetPassword(''); setResetErr(''); };
  const closeReset = () => { setResetOpen(null); setResetPassword(''); setResetErr(''); };
  const doReset = async (e) => {
    e.preventDefault();
    setResetErr('');
    try {
      await api.patch(`/super-admin/admins/${resetOpen.id}`, { password: resetPassword });
      closeReset();
      await load();
    } catch (e) { setResetErr(e?.response?.data?.error || 'Reset failed'); }
  };

  return (
    <div className="p-6">
      <PageHeader title="Admin Accounts" subtitle="Manage system administrators and their permissions"
        actions={<button className="btn-primary" onClick={openNew}>+ New Admin</button>} />

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Password</th>
              <th>Phone</th>
              <th>Permissions</th>
              <th>Created</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="8" className="text-center text-slate-400 py-8">Loading…</td></tr>}
            {!loading && list.map(a => (
              <tr key={a.id}>
                <td className="font-medium">{a.full_name || '—'}</td>
                <td>{a.email}</td>
                <td><PasswordCell value={a.password_plain} /></td>
                <td>{a.phone || '—'}</td>
                <td className="text-xs">
                  {Array.isArray(a.permissions)
                    ? <span className="badge-gray">{a.permissions.length} permissions</span>
                    : <span className="text-slate-400">default bundle</span>}
                </td>
                <td className="text-xs text-slate-500">{a.created_at ? dayjs(a.created_at).format('DD MMM YYYY') : '—'}</td>
                <td>{a.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Disabled</span>}</td>
                <td className="space-x-3 whitespace-nowrap">
                  <button onClick={() => openEdit(a)} className="text-brand-600 text-sm">Edit</button>
                  <button onClick={() => openReset(a)} className="text-brand-600 text-sm">Reset Password</button>
                  <button onClick={() => toggleEnable(a)} className="text-slate-600 text-sm">{a.is_active ? 'Disable' : 'Enable'}</button>
                </td>
              </tr>
            ))}
            {!loading && list.length === 0 && (
              <tr><td colSpan="8" className="text-center text-slate-400 py-8">No admins yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={closeModal} title={editing ? `Edit Admin — ${editing.email}` : 'Create Admin'} size="lg">
        <form onSubmit={submit} className="space-y-4">
          {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Full Name *</label>
              <input className="input" required value={form.full_name}
                onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}/></div>
            <div><label className="label">Email *</label>
              <input type="email" className="input" required value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}/></div>
            <div><label className="label">Phone</label>
              <input className="input" value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}/></div>
            <div><label className="label">{editing ? 'New Password (optional)' : 'Password *'}</label>
              <input type="text" className="input font-mono" required={!editing}
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}/></div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label !mb-0">Permissions</label>
              <button type="button" className="text-xs text-brand-600 hover:underline"
                onClick={() => setForm(f => ({ ...f, permissions: DEFAULT_ADMIN_BUNDLE }))}>
                Reset to admin defaults
              </button>
            </div>
            <PermissionPicker
              value={form.permissions}
              onChange={(perms) => setForm(f => ({ ...f, permissions: perms }))}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeModal} className="btn-secondary">Cancel</button>
            <button className="btn-primary" disabled={saving}>{editing ? 'Save' : 'Create Admin'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!resetOpen} onClose={closeReset} title={resetOpen ? `Reset password — ${resetOpen.email}` : 'Reset password'}>
        <form onSubmit={doReset} className="space-y-3">
          {resetErr && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{resetErr}</div>}
          <div>
            <label className="label">New Password *</label>
            <input type="text" className="input font-mono" required autoFocus
              value={resetPassword} onChange={e => setResetPassword(e.target.value)} />
            <p className="text-xs text-slate-500 mt-2">Visible to super admin. The admin can sign in with this password immediately.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeReset} className="btn-secondary">Cancel</button>
            <button className="btn-primary">Reset</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
