import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../context/AuthContext';

const statusClass = {
  sent: 'badge-green', delivered: 'badge-green', failed: 'badge-red', pending: 'badge-yellow',
};

export default function WhatsApp() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [send, setSend] = useState({ phone: '', message: '' });

  const load = async () => {
    const { data } = await api.get('/whatsapp/notifications');
    setList(data);
  };
  useEffect(() => { load(); }, []);

  const runJob = async () => {
    setBusy(true); setResult(null);
    try {
      const { data } = await api.post('/whatsapp/run-reminders');
      setResult(data);
      await load();
    } catch (e) {
      setResult({ error: e?.response?.data?.error || e.message });
    } finally { setBusy(false); }
  };

  const sendMsg = async (e) => {
    e.preventDefault();
    try {
      await api.post('/whatsapp/send', send);
      setSend({ phone: '', message: '' });
      await load();
    } catch (e) {
      alert(e?.response?.data?.error || 'Send failed');
    }
  };

  return (
    <div className="p-6">
      <PageHeader title="WhatsApp" subtitle="Installment reminders & notifications"
        actions={user?.role === 'admin' && <button onClick={runJob} disabled={busy} className="btn-primary">{busy ? 'Running…' : 'Run reminder job now'}</button>} />

      {result && <div className="card mb-4 bg-slate-50 text-sm">{JSON.stringify(result)}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form onSubmit={sendMsg} className="card lg:col-span-1 space-y-3">
          <h3 className="font-semibold">Send Custom Message</h3>
          <div><label className="label">Phone (with country code)</label>
            <input className="input" required value={send.phone} onChange={e => setSend(s => ({ ...s, phone: e.target.value }))} placeholder="+923001234567" />
          </div>
          <div><label className="label">Message</label>
            <textarea required className="input" rows="4" value={send.message} onChange={e => setSend(s => ({ ...s, message: e.target.value }))} />
          </div>
          <button className="btn-primary w-full">Send</button>
          <p className="text-xs text-slate-400">Reminders go out automatically on days 1–5 each month at 9:30 AM.</p>
        </form>

        <div className="card lg:col-span-2 p-0 overflow-hidden">
          <div className="p-4 border-b font-semibold">Notification History</div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>When</th><th>Customer</th><th>Phone</th><th>Status</th><th>Preview</th></tr></thead>
              <tbody>
                {list.map(n => (
                  <tr key={n.id}>
                    <td className="text-xs whitespace-nowrap">{dayjs(n.created_at).format('DD MMM HH:mm')}</td>
                    <td>{n.customers?.customer_name || '-'}</td>
                    <td>{n.phone}</td>
                    <td><span className={statusClass[n.status] || 'badge-gray'}>{n.status}</span></td>
                    <td className="text-xs text-slate-500 max-w-md truncate">{n.message}</td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan="5" className="text-center text-slate-400 py-8">No messages sent yet</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
