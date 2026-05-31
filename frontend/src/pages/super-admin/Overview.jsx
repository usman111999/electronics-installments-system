import { useEffect, useState } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { api } from '../../api/client';
import PageHeader from '../../components/PageHeader';
import StatCard from '../../components/StatCard';

const PIE_COLORS = ['#10b981', '#ef4444', '#f59e0b', '#3b82f6', '#a855f7', '#0ea5e9'];

const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

export default function SuperOverview() {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get('/super-admin/system-overview');
        if (alive) setOverview(data);
      } catch (e) {
        if (alive) setError(e?.response?.data?.error || 'Failed to load system overview');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="p-8 text-slate-500">Loading system overview…</div>;
  if (error) return (
    <div className="p-6">
      <PageHeader title="System Overview" subtitle="Global KPIs across every branch" />
      <div className="card text-sm text-red-700 bg-red-50">{error}</div>
    </div>
  );
  if (!overview) return null;

  const devicesPie = Object.entries(overview.devices?.by_status || {})
    .map(([name, value]) => ({ name, value: Number(value) || 0 }))
    .filter(e => e.value > 0);

  const monthly = overview.monthly_collection || overview.monthly_collections || [];
  const topBranches = (overview.top_branches || []).slice(0, 5);

  return (
    <div className="p-6">
      <PageHeader title="System Overview" subtitle="Global KPIs across every branch" />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard label="Branches" value={overview.branches ?? 0} accent="brand"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18M5 21V7l7-4 7 4v14"/></svg>} />
        <StatCard label="Users" value={overview.users ?? 0} accent="blue"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>} />
        <StatCard label="Customers" value={overview.customers ?? 0} accent="purple"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>} />
        <StatCard label="Devices" value={overview.devices?.total ?? overview.devices ?? 0} accent="green"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/></svg>} />
        <StatCard label="Money in Market" value={fmt(overview.money_in_market)} accent="yellow"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>} />
        <StatCard label="Payments YTD" value={fmt(overview.payments_ytd)} accent="red"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/></svg>} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h3 className="font-semibold mb-3 text-slate-800">Devices by status</h3>
          {devicesPie.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-slate-400 text-sm">No device data</div>
          ) : (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={devicesPie} cx="50%" cy="50%" outerRadius={90} dataKey="value" nameKey="name" label>
                    {devicesPie.map((_, idx) => (
                      <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="font-semibold mb-3 text-slate-800">Monthly collection (last 12 months)</h3>
          {monthly.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-slate-400 text-sm">No collection data</div>
          ) : (
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
          )}
        </div>

        <div className="card lg:col-span-2">
          <h3 className="font-semibold mb-3 text-slate-800">Top 5 branches by orders</h3>
          {topBranches.length === 0 ? (
            <div className="h-[280px] flex items-center justify-center text-slate-400 text-sm">No branch data</div>
          ) : (
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={topBranches}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="orders" fill="#1f5fed" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
