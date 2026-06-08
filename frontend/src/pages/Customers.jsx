import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import CustomerWizard from '../components/CustomerWizard';
import ConfirmDialog from '../components/ConfirmDialog';
import { useAuth } from '../context/AuthContext';

export default function Customers() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const canDelete = isAdmin;
  const [list, setList] = useState([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toDelete, setToDelete] = useState(null);
  const [delErr, setDelErr] = useState('');
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    const params = search ? { search } : {};
    const [c, b] = await Promise.all([
      api.get('/customers', { params }),
      api.get('/branches'),
    ]);
    setList(c.data); setBranches(b.data);
    setLoading(false);
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [search]);

  const openNew = () => { setEditing(null); setOpen(true); };
  const openEdit = (c) => { setEditing(c); setOpen(true); };
  const closeModal = () => { setOpen(false); setEditing(null); };

  const askDelete = (c) => { setToDelete(c); setDelErr(''); };
  const confirmDelete = async () => {
    setDeleting(true); setDelErr('');
    try {
      await api.delete(`/customers/${toDelete.id}`);
      setToDelete(null);
      await load();
    } catch (e) {
      setDelErr(e?.response?.data?.error || 'Delete failed');
    } finally { setDeleting(false); }
  };

  return (
    <div className="p-6">
      <PageHeader title="Customers" subtitle="Customer accounts and guarantors"
        actions={
          <>
            <input className="input !w-72" placeholder="Search name, account, phone…" value={search} onChange={e => setSearch(e.target.value)} />
            <button className="btn-primary" onClick={openNew}>+ New Customer</button>
          </>
        } />

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead><tr><th>Account #</th><th>Name</th><th>Father/Husband</th><th>Phone</th><th>Branch</th><th>Address</th><th>CNIC</th><th className="text-right">Actions</th></tr></thead>
          <tbody>
            {list.map(c => (
              <tr key={c.id}>
                <td className="font-medium">{c.account_no}</td>
                <td>{c.customer_name}</td>
                <td>{c.father_husband_name || '-'}</td>
                <td>{c.phone_1}</td>
                <td>{c.branches?.name || '-'}</td>
                <td className="max-w-[220px] truncate text-slate-600" title={c.home_address || c.official_address || ''}>{c.home_address || c.official_address || '-'}</td>
                <td className="text-xs">{c.cnic || '-'}</td>
                <td>
                  <div className="flex items-center justify-end gap-3 text-sm">
                    <Link to={`/customers/${c.id}`} className="text-brand-600">View</Link>
                    <button onClick={() => openEdit(c)} className="text-slate-600 hover:text-slate-900">Edit</button>
                    {canDelete && <button onClick={() => askDelete(c)} className="text-red-600 hover:text-red-700">Delete</button>}
                  </div>
                </td>
              </tr>
            ))}
            {!loading && list.length === 0 && (
              <tr><td colSpan="8" className="text-center py-10">
                <p className="text-slate-400 mb-3">{search ? 'No customers match your search.' : 'No customers yet.'}</p>
                {!search && <button onClick={openNew} className="btn-primary">+ Add your first customer</button>}
              </td></tr>
            )}
            {loading && <tr><td colSpan="8" className="text-center text-slate-400 py-8">Loading…</td></tr>}
          </tbody>
        </table>
      </div>

      <CustomerWizard
        open={open}
        onClose={closeModal}
        editing={editing}
        branches={branches}
        isAdmin={isAdmin}
        onSaved={load}
      />

      <ConfirmDialog
        open={!!toDelete}
        title="Delete customer?"
        message={toDelete ? `This permanently deletes "${toDelete.customer_name}" (#${toDelete.account_no}). This cannot be undone.` : ''}
        error={delErr}
        confirmLabel="Delete customer"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
