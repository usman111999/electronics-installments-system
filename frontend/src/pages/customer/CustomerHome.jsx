import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../../api/client';
import StatCard from '../../components/StatCard';
import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../context/AuthContext';

const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

export default function CustomerHome() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    (async () => {
      const [s, c] = await Promise.all([
        api.get('/stats/customer'),
        api.get('/customers'), // backend returns just the customer's own row for role=customer
      ]);
      setStats(s.data);
      setProfile(Array.isArray(c.data) ? (c.data[0] || null) : c.data);
    })();
  }, []);

  if (!stats) return <div className="p-8 text-slate-500">Loading…</div>;

  return (
    <div className="p-6">
      <PageHeader title={`Welcome, ${user?.full_name || 'Customer'}`} subtitle="Your account overview" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard label="Outstanding" value={fmt(stats.outstanding)} accent="yellow"
          sublabel={stats.next_due ? `Next due ${dayjs(stats.next_due).format('DD MMM')}` : 'No upcoming'}
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>}
        />
        <StatCard label="Paid so far" value={fmt(stats.paid)} accent="green"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3"/></svg>}
        />
        <StatCard label="Orders" value={stats.orders} accent="blue"
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11H1l8-8 8 8h-8v8H1"/></svg>}
        />
        <StatCard label="Account" value={`#${profile?.account_no || '-'}`} accent="brand" sublabel={profile?.branches?.name}
          icon={<svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>}
        />
      </div>

      {profile && (
        <div className="card max-w-3xl">
          <h3 className="font-semibold mb-4">Your Details</h3>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6 text-sm">
            <div><dt className="text-xs text-slate-500">Name</dt><dd>{profile.customer_name}</dd></div>
            <div><dt className="text-xs text-slate-500">Father / Husband</dt><dd>{profile.father_husband_name || '-'}</dd></div>
            <div><dt className="text-xs text-slate-500">Phone 1</dt><dd>{profile.phone_1}</dd></div>
            <div><dt className="text-xs text-slate-500">Phone 2</dt><dd>{profile.phone_2 || '-'}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Home Address</dt><dd>{profile.home_address || '-'}</dd></div>
            <div className="sm:col-span-2"><dt className="text-xs text-slate-500">Office Address</dt><dd>{profile.official_address || '-'}</dd></div>
          </dl>
        </div>
      )}
    </div>
  );
}
