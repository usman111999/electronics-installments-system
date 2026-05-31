import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';

export default function ActivityLogs() {
  const [list, setList] = useState([]);
  const [action, setAction] = useState('');

  const load = async () => {
    const params = action ? { action } : {};
    const { data } = await api.get('/activity-logs', { params });
    setList(data);
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [action]);

  return (
    <div className="p-6">
      <PageHeader title="Activity Logs" subtitle="System audit trail"
        actions={
          <input className="input !w-64" placeholder="Filter by action…" value={action} onChange={e => setAction(e.target.value)} />
        } />

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Branch</th><th>Details</th></tr></thead>
          <tbody>
            {list.map(l => (
              <tr key={l.id}>
                <td className="text-xs whitespace-nowrap">{dayjs(l.created_at).format('DD MMM YY HH:mm')}</td>
                <td>{l.profiles?.full_name || '-'} <span className="text-xs text-slate-400">({l.profiles?.role || '-'})</span></td>
                <td><code className="text-xs bg-slate-100 px-2 py-0.5 rounded">{l.action}</code></td>
                <td className="text-xs">{l.entity_type || '-'}</td>
                <td>{l.branches?.name || '-'}</td>
                <td className="text-xs text-slate-500 max-w-xs truncate">{l.details ? JSON.stringify(l.details) : '-'}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan="6" className="text-center text-slate-400 py-8">No activity yet</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
