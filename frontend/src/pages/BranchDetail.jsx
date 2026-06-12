import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import dayjs from 'dayjs';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import Avatar from '../components/Avatar';

const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

const ROLE_BADGE = {
  super_admin: 'badge-red',
  admin: 'badge-red',
  operator: 'badge-blue',
  customer: 'badge-green',
};
const STOCK_BADGE = {
  in_stock: 'badge-green',
  sold: 'badge-gray',
  locked: 'badge-red',
  reserved: 'badge-yellow',
};

export default function BranchDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    api.get(`/branches/${id}/detail`)
      .then(({ data }) => { if (alive) setData(data); })
      .catch(e => { if (alive) setErr(e?.response?.data?.error || 'Could not load branch'); });
    return () => { alive = false; };
  }, [id]);

  if (err) return (
    <div className="p-6">
      <div className="text-sm text-red-700 bg-red-50 px-4 py-3 rounded mb-3">{err}</div>
      <Link to="/branches" className="btn-secondary">← Back to branches</Link>
    </div>
  );
  if (!data) return <div className="p-8 text-slate-500">Loading…</div>;

  const { branch, stats, users, customers, inventory } = data;

  return (
    <div className="p-6">
      <PageHeader title={branch.name}
        subtitle={`${branch.code ? `Code ${branch.code} · ` : ''}${branch.city || ''}${branch.manager_name ? ` · Manager: ${branch.manager_name}` : ''}`}
        actions={
          <>
            <span className={branch.is_active ? 'badge-green' : 'badge-gray'}>{branch.is_active ? 'Active' : 'Disabled'}</span>
            <Link to="/branches" className="btn-secondary">← Back</Link>
          </>
        } />

      {/* Branch info strip */}
      <div className="card mb-4 text-sm text-slate-600 flex flex-wrap gap-x-8 gap-y-1">
        {branch.phone && <div><span className="text-slate-400">Phone:</span> {branch.phone}</div>}
        {branch.address && <div><span className="text-slate-400">Address:</span> {branch.address}</div>}
        <div><span className="text-slate-400">Auto-lock:</span> {branch.auto_lock_days ? `${branch.auto_lock_days} days overdue` : 'off'}</div>
        <div><span className="text-slate-400">Created:</span> {dayjs(branch.created_at).format('DD MMM YYYY')}</div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <StatCard label="Customers" value={stats.customers} accent="brand" />
        <StatCard label="Orders" value={stats.orders} accent="blue" />
        <StatCard label="Installments" value={stats.installments_total} accent="purple" />
        <StatCard label="Outstanding" value={fmt(stats.outstanding)} accent="yellow" />
        <StatCard label="Collected" value={fmt(stats.collected)} accent="green" />
        <StatCard label="Stock Items" value={stats.inventory_items} accent="brand" />
      </div>

      {/* Installment status breakdown */}
      <div className="card mb-4 flex flex-wrap gap-2 text-xs">
        <span className="font-medium text-slate-600 mr-1">Installments:</span>
        <span className="badge-green">{stats.installments_paid} paid</span>
        <span className="badge-yellow">{stats.installments_pending} pending</span>
        <span className="badge-blue">{stats.installments_partial} partial</span>
        <span className="badge-red">{stats.installments_overdue} overdue</span>
      </div>

      {/* Users in this branch */}
      <div className="card mb-4 p-0 overflow-x-auto">
        <div className="px-4 pt-3 pb-2 font-semibold text-slate-900">Users in this branch ({users.length})</div>
        <table className="table-base">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Phone</th><th>Status</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td className="font-medium">{u.full_name || '-'}</td>
                <td>{u.email}</td>
                <td><span className={ROLE_BADGE[u.role] || 'badge-gray'}>{u.role}</span></td>
                <td>{u.phone || '-'}</td>
                <td>{u.is_active ? <span className="badge-green">Active</span> : <span className="badge-gray">Disabled</span>}</td>
              </tr>
            ))}
            {users.length === 0 && <tr><td colSpan="5" className="text-center text-slate-400 py-6">No users assigned to this branch</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Customers */}
      <div className="card mb-4 p-0 overflow-x-auto">
        <div className="px-4 pt-3 pb-2 font-semibold text-slate-900">Customers ({stats.customers})</div>
        <table className="table-base">
          <thead><tr><th>Customer</th><th>Account #</th><th>Phone</th><th>Orders</th><th>Joined</th></tr></thead>
          <tbody>
            {customers.map(c => (
              <tr key={c.id}>
                <td>
                  <Link to={`/customers/${c.id}`} className="flex items-center gap-2.5">
                    <Avatar src={c.picture_url} name={c.customer_name} size={32} />
                    <span className="font-medium text-brand-600">{c.customer_name}</span>
                  </Link>
                </td>
                <td>{c.account_no || '-'}</td>
                <td>{c.phone_1 || '-'}</td>
                <td>{c.orders?.[0]?.count ?? 0}</td>
                <td>{dayjs(c.created_at).format('DD MMM YYYY')}</td>
              </tr>
            ))}
            {customers.length === 0 && <tr><td colSpan="5" className="text-center text-slate-400 py-6">No customers in this branch</td></tr>}
          </tbody>
        </table>
        {stats.customers > customers.length && (
          <div className="px-4 py-2 text-xs text-slate-400">Showing first {customers.length} of {stats.customers}.</div>
        )}
      </div>

      {/* Stock / products */}
      <div className="card p-0 overflow-x-auto">
        <div className="px-4 pt-3 pb-2 font-semibold text-slate-900">Stock / Products ({stats.inventory_items})</div>
        <table className="table-base">
          <thead><tr><th>Product</th><th>Model</th><th>Company</th><th>Serial #</th><th>Price</th><th>Status</th></tr></thead>
          <tbody>
            {inventory.map(it => (
              <tr key={it.id}>
                <td className="font-medium">{it.products?.name || '-'}</td>
                <td>{it.products?.model || '-'}</td>
                <td>{it.products?.company || '-'}</td>
                <td className="text-xs">{it.serial_no || '-'}</td>
                <td>{it.products?.base_price ? fmt(it.products.base_price) : '-'}</td>
                <td><span className={STOCK_BADGE[it.status] || 'badge-gray'}>{it.status}</span></td>
              </tr>
            ))}
            {inventory.length === 0 && <tr><td colSpan="6" className="text-center text-slate-400 py-6">No stock in this branch</td></tr>}
          </tbody>
        </table>
        {stats.inventory_items > inventory.length && (
          <div className="px-4 py-2 text-xs text-slate-400">Showing first {inventory.length} of {stats.inventory_items}.</div>
        )}
      </div>
    </div>
  );
}
