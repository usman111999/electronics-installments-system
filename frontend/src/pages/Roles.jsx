import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import PermissionPicker from '../components/PermissionPicker';
import { useAuth } from '../context/AuthContext';

function slugify(name) {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const EMPTY_FORM = {
  name: '',
  slug: '',
  description: '',
  base_role: 'operator',
  branch_id: '',
  permissions: [],
};

export default function Roles() {
  const { user, hasPermission } = useAuth();
  const canManage = hasPermission('roles.manage');
  const isSuper = user?.role === 'super_admin';

  const [list, setList] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [err, setErr] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleteErr, setDeleteErr] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/roles');
      setList(Array.isArray(data) ? data : (data?.roles || []));
    } catch (e) {
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    if (isSuper) {
      api.get('/branches').then(({ data }) => setBranches(data || [])).catch(() => {});
    }
  }, [isSuper]);

  const closeModal = () => {
    setOpen(false);
    setEditing(null);
    setForm(EMPTY_FORM);
    setErr('');
    setSlugManuallyEdited(false);
    setSaving(false);
  };

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setSlugManuallyEdited(false);
    setErr('');
    setOpen(true);
  };

  const openEdit = (r) => {
    setEditing(r);
    setForm({
      name: r.name || '',
      slug: r.slug || '',
      description: r.description || '',
      base_role: r.base_role || 'operator',
      branch_id: r.branch_id || '',
      permissions: Array.isArray(r.permissions)
        ? r.permissions
        : (r.permissions || []).map(p => (typeof p === 'string' ? p : p.id)),
    });
    setSlugManuallyEdited(true); // don't overwrite an existing slug
    setErr('');
    setOpen(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      slug: (form.slug || slugify(form.name)).trim(),
      description: form.description?.trim() || null,
      base_role: form.base_role,
      branch_id: form.branch_id || null,
      permissions: form.permissions,
    };
    try {
      if (editing) await api.patch(`/roles/${editing.id}`, payload);
      else await api.post('/roles', payload);
      closeModal();
      await load();
    } catch (e) {
      setErr(e?.response?.data?.error || 'Save failed');
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    setDeleteErr(null);
    try {
      await api.delete(`/roles/${confirmDelete.id}`);
      setConfirmDelete(null);
      await load();
    } catch (e) {
      // Backend may respond 409 with a list of users that still reference the role.
      const body = e?.response?.data;
      if (e?.response?.status === 409) {
        setDeleteErr({
          message: body?.error || 'Role is still assigned to users.',
          users: body?.users || [],
        });
      } else {
        setDeleteErr({ message: body?.error || 'Delete failed', users: [] });
      }
    }
  };

  const permCount = (r) => {
    if (Array.isArray(r.permissions)) return r.permissions.length;
    if (typeof r.permission_count === 'number') return r.permission_count;
    return 0;
  };

  const sorted = useMemo(() => {
    return list.slice().sort((a, b) => {
      if (!!a.is_system !== !!b.is_system) return a.is_system ? -1 : 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [list]);

  return (
    <div className="p-6">
      <PageHeader title="Roles" subtitle="Custom roles & permission templates"
        actions={canManage ? <button className="btn-primary" onClick={openNew}>+ New Role</button> : null} />

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role type</th>
              <th>Branch</th>
              <th>Permissions</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan="6" className="text-center text-slate-400 py-8">Loading…</td></tr>}
            {!loading && sorted.map(r => (
              <tr key={r.id}>
                <td className="font-medium">
                  {r.name}
                  {r.is_system && <span className="ml-2 badge-gray">system</span>}
                  {r.description && <div className="text-[11px] text-slate-500 mt-0.5">{r.description}</div>}
                </td>
                <td><span className="badge-blue">{r.base_role}</span></td>
                <td>{r.branches?.name || r.branch?.name || (r.branch_id ? r.branch_id : <span className="text-slate-400">global</span>)}</td>
                <td>{permCount(r)}</td>
                <td className="text-xs text-slate-500">{r.created_at ? dayjs(r.created_at).format('DD MMM YYYY') : '—'}</td>
                <td className="space-x-3 whitespace-nowrap">
                  {canManage && (
                    <>
                      <button onClick={() => openEdit(r)} className="text-brand-600 text-sm">Edit</button>
                      {!r.is_system && (
                        <button onClick={() => { setConfirmDelete(r); setDeleteErr(null); }} className="text-red-600 text-sm">Delete</button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!loading && sorted.length === 0 && (
              <tr><td colSpan="6" className="text-center text-slate-400 py-8">No roles yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={closeModal} title={editing ? `Edit Role — ${editing.name}` : 'New Role'} size="lg">
        <form onSubmit={submit} className="space-y-4">
          {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{err}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Role name *</label>
              <input className="input" required value={form.name}
                placeholder="e.g. Branch Cashier"
                onChange={e => {
                  const name = e.target.value;
                  setForm(f => ({ ...f, name, slug: slugify(name) }));
                }} />
            </div>
            <div>
              <label className="label">Role type *</label>
              <select className="input" value={form.base_role}
                onChange={e => setForm(f => ({ ...f, base_role: e.target.value }))}>
                {isSuper && <option value="admin">Admin — full company access</option>}
                <option value="operator">Operator — staff for one branch</option>
                <option value="customer">Customer — end customer</option>
              </select>
              <div className="text-[11px] text-slate-500 mt-1">Sets the base access level this role starts from. You then tick exactly what they can do below.</div>
            </div>
            {isSuper && (
              <div>
                <label className="label">Branch (optional)</label>
                <select className="input" value={form.branch_id}
                  onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))}>
                  <option value="">Global (all branches)</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div className="col-span-2">
              <label className="label">Description</label>
              <textarea className="input" rows="2" value={form.description}
                placeholder="e.g. Can record payments and view customers for their branch"
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>

          <div>
            <label className="label">Permissions</label>
            <PermissionPicker
              value={form.permissions}
              onChange={(perms) => setForm(f => ({ ...f, permissions: perms }))}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeModal} className="btn-secondary">Cancel</button>
            <button className="btn-primary" disabled={saving}>{editing ? 'Save' : 'Create Role'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!confirmDelete} onClose={() => { setConfirmDelete(null); setDeleteErr(null); }} title="Delete role">
        {confirmDelete && (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              Delete role <strong>{confirmDelete.name}</strong>? This cannot be undone.
            </p>
            {deleteErr && (
              <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">
                <div className="font-medium">{deleteErr.message}</div>
                {deleteErr.users?.length > 0 && (
                  <ul className="mt-2 max-h-40 overflow-y-auto text-xs list-disc list-inside">
                    {deleteErr.users.map(u => (
                      <li key={u.id || u.email}>{u.full_name || u.email || u.id}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setConfirmDelete(null); setDeleteErr(null); }}>Cancel</button>
              <button className="btn-danger" onClick={doDelete}>Delete</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
