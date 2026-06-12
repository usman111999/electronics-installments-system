import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import PermissionPicker from '../components/PermissionPicker';
import { useAuth } from '../context/AuthContext';

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

const EMPTY_FORM = { role: 'operator', role_id: '' };

export default function Users() {
  const { user, hasPermission } = useAuth();
  const isSuper = user?.role === 'super_admin';
  const [list, setList] = useState([]);
  const [branches, setBranches] = useState([]);
  const [customRoles, setCustomRoles] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showOverrides, setShowOverrides] = useState(false);
  const [overrides, setOverrides] = useState([]);

  const load = async () => {
    const params = filter ? { role: filter } : {};
    const [u, b] = await Promise.all([
      api.get('/users', { params }),
      api.get('/branches'),
    ]);
    setList(u.data);
    setBranches(b.data);
    // Custom roles are optional — fetch but ignore if user lacks permission.
    if (hasPermission('roles.view')) {
      try { const r = await api.get('/roles'); setCustomRoles(Array.isArray(r.data) ? r.data : (r.data?.roles || [])); }
      catch { setCustomRoles([]); }
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [filter]);

  // Branch + free-text filtering is applied client-side on top of the
  // server-side role filter (the list is small).
  const displayed = useMemo(() => {
    let r = list;
    if (branchFilter === 'none') r = r.filter(u => !u.branch_id);
    else if (branchFilter) r = r.filter(u => u.branch_id === branchFilter);
    const s = search.trim().toLowerCase();
    if (s) r = r.filter(u =>
      (u.full_name || '').toLowerCase().includes(s) ||
      (u.email || '').toLowerCase().includes(s) ||
      (u.phone || '').toLowerCase().includes(s)
    );
    return r;
  }, [list, branchFilter, search]);

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setErr('');
    setShowOverrides(false);
    setOverrides([]);
  };

  // Built-in roles the caller is allowed to grant. super_admin can grant
  // 'admin'. Anyone with users.create can grant operator + customer.
  const grantableBuiltins = useMemo(() => {
    const out = [];
    if (isSuper) out.push({ value: 'admin', label: 'Admin' });
    if (isSuper || hasPermission('users.create')) {
      out.push({ value: 'operator', label: 'Branch Operator' });
      out.push({ value: 'customer', label: 'Customer' });
    }
    return out;
  }, [isSuper, hasPermission]);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      const payload = { ...form };
      // role_id empty string → null
      if (!payload.role_id) delete payload.role_id;
      // Only attach overrides if super admin opened the panel for an admin user.
      if (isSuper && showOverrides) payload.permissions = overrides;
      if (editing) await api.patch(`/users/${editing.id}`, payload);
      else await api.post('/users', payload);
      closeModal();
      await load();
    } catch (e) { setErr(e?.response?.data?.error || 'Save failed'); }
  };

  const toggleActive = async (u) => {
    await api.patch(`/users/${u.id}`, { is_active: !u.is_active });
    load();
  };

  const openReset = (u) => {
    setEditing(u);
    setForm({ password: '' });
    setOpen(true);
    setErr('');
  };

  const openEditUser = (u) => {
    setEditing(u);
    setForm({
      full_name: u.full_name || '',
      email: u.email,
      phone: u.phone || '',
      role: u.role,
      role_id: u.role_id || '',
      branch_id: u.branch_id || '',
    });
    setOverrides(Array.isArray(u.permission_overrides) ? u.permission_overrides : []);
    setShowOverrides(false);
    setOpen(true);
    setErr('');
  };

  // Editing super_admin is forbidden — guard the UI as a courtesy.
  const isEditingPasswordOnly = editing && !form.email && !form.full_name;
  const isAdminTarget = editing?.role === 'admin' || form.role === 'admin';

  return (
    <div className="p-6">
      <PageHeader title="Users" subtitle="Admins, branch operators, and customers"
        actions={
          <>
            <input className="input !w-auto" placeholder="Search name / email / phone"
              value={search} onChange={e => setSearch(e.target.value)} />
            <select className="input !w-auto" value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="">All roles</option>
              {isSuper && <option value="super_admin">Super Admin</option>}
              <option value="admin">Admin</option>
              <option value="operator">Operator</option>
              <option value="customer">Customer</option>
            </select>
            <select className="input !w-auto" value={branchFilter} onChange={e => setBranchFilter(e.target.value)}>
              <option value="">All branches</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              <option value="none">— No branch —</option>
            </select>
            {hasPermission('users.create') && (
              <button className="btn-primary" onClick={() => { setEditing(null); setForm({ role: grantableBuiltins[0]?.value || 'operator', role_id: '' }); setOpen(true); setErr(''); }}>+ Add User</button>
            )}
          </>
        } />

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead><tr><th>Name</th><th>Email</th><th>Password</th><th>Role</th><th>Branch</th><th>Phone</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {displayed.map(u => (
              <tr key={u.id}>
                <td className="font-medium">{u.full_name || '-'}</td>
                <td>{u.email}</td>
                <td><PasswordCell value={u.password_plain} /></td>
                <td>
                  <span className={`badge-${u.role === 'super_admin' ? 'red' : u.role === 'admin' ? 'red' : u.role === 'operator' ? 'blue' : 'green'}`}>
                    {u.role}
                  </span>
                  {u.role_name && <div className="text-[11px] text-slate-500 mt-0.5">{u.role_name}</div>}
                </td>
                <td>
                  {u.branches?.name
                    ? <span className="badge-blue">{u.branches.name}</span>
                    : (u.role === 'admin' || u.role === 'super_admin')
                      ? <span className="text-xs text-slate-400">All branches</span>
                      : <span className="text-xs text-amber-600" title="This user has no branch assigned — they can see all branches' data. Edit to assign one.">⚠ No branch</span>}
                </td>
                <td>{u.phone || '-'}</td>
                <td>{u.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Disabled</span>}</td>
                <td className="space-x-3 whitespace-nowrap">
                  {hasPermission('users.update') && u.role !== 'super_admin' && (
                    <button onClick={() => openEditUser(u)} className="text-brand-600 text-sm">Edit</button>
                  )}
                  {hasPermission('users.update') && <button onClick={() => openReset(u)} className="text-brand-600 text-sm">Reset Password</button>}
                  {hasPermission('users.disable') && u.role !== 'super_admin' && (
                    <button onClick={() => toggleActive(u)}
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                        u.is_active
                          ? 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                      }`}>
                      {u.is_active
                        ? <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Disable</>
                        : <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg> Enable</>}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {displayed.length === 0 && <tr><td colSpan="8" className="text-center text-slate-400 py-8">{list.length === 0 ? 'No users' : 'No users match these filters'}</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={closeModal}
        title={editing ? (isEditingPasswordOnly ? `Reset password — ${editing.email}` : `Edit user — ${editing.email}`) : 'Create User'} size="lg">
        <form onSubmit={submit} className="space-y-3">
          {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{err}</div>}

          {editing && isEditingPasswordOnly ? (
            <div>
              <label className="label">New Password *</label>
              <input type="text" className="input font-mono" required value={form.password || ''} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} autoFocus />
              <p className="text-xs text-slate-500 mt-2">Visible to admin/operator. The user can sign in with this password immediately.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="label">Full Name *</label><input className="input" required value={form.full_name || ''} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}/></div>
                <div><label className="label">Email *</label><input type="email" className="input" required disabled={!!editing} value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}/></div>
                {!editing && <div><label className="label">Password *</label><input type="text" className="input font-mono" required value={form.password || ''} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}/></div>}
                <div><label className="label">Phone</label><input className="input" value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}/></div>
                <div><label className="label">Role *</label>
                  <select className="input" value={form.role}
                    onChange={e => setForm(f => ({ ...f, role: e.target.value, role_id: '' }))}>
                    {grantableBuiltins.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                {(hasPermission('roles.view') && customRoles.length > 0) && (
                  <div>
                    <label className="label">Custom role (optional)</label>
                    <select className="input" value={form.role_id || ''}
                      onChange={e => {
                        const id = e.target.value;
                        const role = customRoles.find(r => r.id === id);
                        setForm(f => ({
                          ...f,
                          role_id: id || '',
                          // If custom role selected, prefer its base_role for `role`.
                          role: role?.base_role || f.role,
                        }));
                      }}>
                      <option value="">— Use built-in role —</option>
                      {customRoles
                        .filter(r => grantableBuiltins.some(g => g.value === r.base_role))
                        .map(r => <option key={r.id} value={r.id}>{r.name}{r.branches?.name ? ` (${r.branches.name})` : ''}</option>)}
                    </select>
                  </div>
                )}
                {(hasPermission('branches.view') || isSuper) && (
                  <div><label className="label">Branch {form.role !== 'admin' && form.role !== 'super_admin' && '*'}</label>
                    <select className="input" value={form.branch_id || ''} onChange={e => setForm(f => ({ ...f, branch_id: e.target.value || null }))}>
                      <option value="">(none)</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                )}
              </div>

              {isSuper && isAdminTarget && (
                <div className="border-t border-slate-100 pt-3">
                  <button type="button"
                    onClick={() => setShowOverrides(s => !s)}
                    className="text-sm text-brand-600 hover:underline flex items-center gap-1">
                    <svg className={`w-4 h-4 transition-transform ${showOverrides ? 'rotate-90' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="9 18 15 12 9 6"/>
                    </svg>
                    Custom permissions {showOverrides ? '(open)' : ''}
                  </button>
                  {showOverrides && (
                    <div className="mt-3">
                      <p className="text-xs text-slate-500 mb-2">
                        Override this admin's permission set. Leave empty to inherit the default admin bundle.
                      </p>
                      <PermissionPicker value={overrides} onChange={setOverrides} />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeModal} className="btn-secondary">Cancel</button>
            <button className="btn-primary">{editing ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
