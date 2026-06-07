import { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import { useAuth } from '../context/AuthContext';

const PIE_COLORS = ['#1f5fed', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#0ea5e9'];

const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

export default function Dashboard() {
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [byBranch, setByBranch] = useState([]);
  const [topProducts, setTopProducts] = useState([]);

  useEffect(() => {
    (async () => {
      const [a, b, d] = await Promise.all([
        api.get('/stats/overview'),
        api.get('/stats/monthly-collections'),
        api.get('/stats/top-products'),
      ]);
      setOverview(a.data);
      setMonthly(b.data);
      setTopProducts(d.data);
      if (user?.role === 'admin') {
        try {
          const c = await api.get('/stats/orders-by-branch');
          setByBranch(c.data);
        } catch {}
      }
    })();
  }, [user]);

  if (!overview) return <div className="p-8 text-slate-500">Loading dashboard…</div>;

  return (
    <div className="p-6">
      <PageHeader title="Dashboard" subtitle="Real-time business overview" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Money in Market (to collect)" value={fmt(overview.money_in_market)} accent="yellow"
          sublabel={`Unpaid from customers · ${overview.installments.overdue_count} overdue`}
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>} />
        <StatCard label="Total Collected" value={fmt(overview.installments.collected)} accent="green"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3"/></svg>} />
        <StatCard label="Total Sales" value={fmt(overview.orders.total_sales)} accent="blue"
          sublabel={`${overview.orders.total} orders`}
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/></svg>} />
        <StatCard label="Estimated Profit" value={fmt(overview.profit_so_far)} accent="purple"
          sublabel="Collected minus advances"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Customers" value={overview.customers} accent="brand"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>} />
        <StatCard label="Stock In Hand" value={overview.stock_in_hand} accent="blue"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 7L12 3 4 7v10l8 4 8-4V7zM12 12L4 7M12 12l8-5M12 12V21"/></svg>} />
        <StatCard label="Active Orders" value={overview.orders.by_status.active || 0} accent="yellow"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>} />
        <StatCard label="Overdue Installments" value={overview.installments.overdue_count} accent="red"
          sublabel={fmt(overview.installments.overdue_amount)}
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="font-semibold mb-3 text-slate-800">Monthly Collections (last 12 months)</h3>
          <div style={{ width: '100%', height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={monthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => fmt(v)} />
                <Line type="monotone" dataKey="amount" stroke="#1f5fed" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <h3 className="font-semibold mb-3 text-slate-800">Order Status Breakdown</h3>
          {(() => {
            const entries = Object.entries(overview.orders?.by_status || {})
              .map(([name, value]) => ({ name, value: Number(value) || 0 }))
              .filter(e => e.value > 0);
            if (entries.length === 0) {
              return <div className="h-[280px] flex items-center justify-center text-slate-400 text-sm">No orders yet</div>;
            }
            return (
              <div style={{ width: '100%', height: 280 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={entries} cx="50%" cy="50%" outerRadius={90} dataKey="value" label>
                      {entries.map((_, idx) => (
                        <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            );
          })()}
        </div>

        {user?.role === 'admin' && byBranch.length > 0 && (
          <div className="card">
            <h3 className="font-semibold mb-3 text-slate-800">Orders by Branch</h3>
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={byBranch}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" />
                  <XAxis dataKey="branch" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="orders" fill="#1f5fed" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="card">
          <h3 className="font-semibold mb-3 text-slate-800">Top Products</h3>
          {topProducts.length === 0 ? (
            <p className="text-sm text-slate-500">No data yet</p>
          ) : (
            <table className="table-base">
              <thead><tr><th>Product</th><th className="text-right">Orders</th><th className="text-right">Revenue</th></tr></thead>
              <tbody>
                {topProducts.map((p, idx) => (
                  <tr key={idx}>
                    <td>{p.name}</td>
                    <td className="text-right">{p.orders}</td>
                    <td className="text-right">{fmt(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
