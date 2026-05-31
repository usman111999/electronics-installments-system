import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import ImageUpload from '../components/ImageUpload';
import { useAuth } from '../context/AuthContext';

const blankGuarantor = () => ({ name: '', father_name: '', cnic: '', home_address: '', official_address: '', phone_1: '', phone_2: '', occupation: '', relation: '' });
const initialForm = () => ({ guarantors: [blankGuarantor(), blankGuarantor(), blankGuarantor()] });

export default function Customers() {
  const { user } = useAuth();
  const [list, setList] = useState([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initialForm());
  const [branches, setBranches] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

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

  const closeModal = () => {
    setOpen(false);
    setForm(initialForm());
    setErr('');
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try {
      await api.post('/customers', form);
      closeModal();
      await load();
    } catch (e) { setErr(e?.response?.data?.error || 'Save failed'); }
  };

  const updateGuarantor = (idx, key, value) => {
    setForm(f => {
      const g = [...(f.guarantors || [])];
      g[idx] = { ...g[idx], [key]: value };
      return { ...f, guarantors: g };
    });
  };

  return (
    <div className="p-6">
      <PageHeader title="Customers" subtitle="Customer accounts and guarantors"
        actions={
          <>
            <input className="input !w-72" placeholder="Search name, account, phone…" value={search} onChange={e => setSearch(e.target.value)} />
            <button className="btn-primary" onClick={() => { setForm(initialForm()); setOpen(true); setErr(''); }}>+ New Customer</button>
          </>
        } />

      <div className="card overflow-x-auto p-0">
        <table className="table-base">
          <thead><tr><th>Account #</th><th>Name</th><th>Father/Husband</th><th>Phone</th><th>Branch</th><th>CNIC</th><th></th></tr></thead>
          <tbody>
            {list.map(c => (
              <tr key={c.id}>
                <td className="font-medium">{c.account_no}</td>
                <td>{c.customer_name}</td>
                <td>{c.father_husband_name || '-'}</td>
                <td>{c.phone_1}</td>
                <td>{c.branches?.name || '-'}</td>
                <td className="text-xs">{c.cnic || '-'}</td>
                <td><Link to={`/customers/${c.id}`} className="text-brand-600 text-sm">View</Link></td>
              </tr>
            ))}
            {!loading && list.length === 0 && <tr><td colSpan="7" className="text-center text-slate-400 py-8">No customers</td></tr>}
            {loading && <tr><td colSpan="7" className="text-center text-slate-400 py-8">Loading…</td></tr>}
          </tbody>
        </table>
      </div>

      <Modal open={open} onClose={closeModal} title="New Customer" size="xl">
        <form onSubmit={submit} className="space-y-6">
          {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{err}</div>}

          <section>
            <h3 className="font-semibold text-slate-800 mb-3">Customer Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-1 sm:row-span-3">
                <ImageUpload value={form.picture_url || ''} onChange={(url) => setForm(f => ({ ...f, picture_url: url }))} bucket="customer-pictures" label="Customer Picture" />
              </div>
              <div><label className="label">Customer Name *</label><input required className="input" value={form.customer_name || ''} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))}/></div>
              <div><label className="label">Father / Husband</label><input className="input" value={form.father_husband_name || ''} onChange={e => setForm(f => ({ ...f, father_husband_name: e.target.value }))}/></div>
              <div><label className="label">CNIC</label><input className="input" value={form.cnic || ''} onChange={e => setForm(f => ({ ...f, cnic: e.target.value }))}/></div>
              <div><label className="label">Gender</label>
                <select className="input" value={form.gender || ''} onChange={e => setForm(f => ({ ...f, gender: e.target.value }))}>
                  <option value="">-</option><option value="M">Male</option><option value="F">Female</option>
                </select>
              </div>
              <div><label className="label">Phone 1 *</label><input required className="input" value={form.phone_1 || ''} onChange={e => setForm(f => ({ ...f, phone_1: e.target.value }))}/></div>
              <div><label className="label">Phone 2</label><input className="input" value={form.phone_2 || ''} onChange={e => setForm(f => ({ ...f, phone_2: e.target.value }))}/></div>
              <div><label className="label">Occupation</label><input className="input" value={form.occupation || ''} onChange={e => setForm(f => ({ ...f, occupation: e.target.value }))}/></div>
              <div><label className="label">Monthly Income</label><input type="number" className="input" value={form.monthly_income || ''} onChange={e => setForm(f => ({ ...f, monthly_income: e.target.value }))}/></div>
              <div className="sm:col-span-3"><label className="label">Home Address</label><textarea className="input" value={form.home_address || ''} onChange={e => setForm(f => ({ ...f, home_address: e.target.value }))}/></div>
              <div className="sm:col-span-3"><label className="label">Official Address</label><textarea className="input" value={form.official_address || ''} onChange={e => setForm(f => ({ ...f, official_address: e.target.value }))}/></div>
              <div className="sm:col-span-3"><label className="label">CRC Remarks</label><textarea className="input" value={form.crc_remarks || ''} onChange={e => setForm(f => ({ ...f, crc_remarks: e.target.value }))}/></div>
              {user?.role === 'admin' && (
                <div><label className="label">Branch *</label>
                  <select required className="input" value={form.branch_id || ''} onChange={e => setForm(f => ({ ...f, branch_id: e.target.value }))}>
                    <option value="">— select —</option>
                    {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          </section>

          {[0, 1, 2].map(idx => (
            <section key={idx}>
              <h3 className="font-semibold text-slate-800 mb-3">
                Guarantor #{idx + 1} {idx === 2 && <span className="text-xs font-normal text-slate-400">(optional)</span>}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><label className="label">Name</label><input className="input" value={form.guarantors[idx]?.name || ''} onChange={e => updateGuarantor(idx, 'name', e.target.value)}/></div>
                <div><label className="label">Father Name</label><input className="input" value={form.guarantors[idx]?.father_name || ''} onChange={e => updateGuarantor(idx, 'father_name', e.target.value)}/></div>
                <div><label className="label">CNIC</label><input className="input" value={form.guarantors[idx]?.cnic || ''} onChange={e => updateGuarantor(idx, 'cnic', e.target.value)}/></div>
                <div><label className="label">Phone 1</label><input className="input" value={form.guarantors[idx]?.phone_1 || ''} onChange={e => updateGuarantor(idx, 'phone_1', e.target.value)}/></div>
                <div><label className="label">Phone 2</label><input className="input" value={form.guarantors[idx]?.phone_2 || ''} onChange={e => updateGuarantor(idx, 'phone_2', e.target.value)}/></div>
                <div><label className="label">Relation</label><input className="input" value={form.guarantors[idx]?.relation || ''} onChange={e => updateGuarantor(idx, 'relation', e.target.value)}/></div>
                <div className="sm:col-span-3"><label className="label">Home Address</label><textarea className="input" value={form.guarantors[idx]?.home_address || ''} onChange={e => updateGuarantor(idx, 'home_address', e.target.value)}/></div>
                <div className="sm:col-span-3"><label className="label">Official Address</label><textarea className="input" value={form.guarantors[idx]?.official_address || ''} onChange={e => updateGuarantor(idx, 'official_address', e.target.value)}/></div>
              </div>
            </section>
          ))}

          <section>
            <h3 className="font-semibold text-slate-800 mb-3">Customer Login (optional)</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="flex items-center gap-2 sm:col-span-3">
                <input type="checkbox" id="cl" checked={!!form.create_login} onChange={e => setForm(f => ({ ...f, create_login: e.target.checked }))}/>
                <label htmlFor="cl" className="text-sm">Create login so this customer can sign in</label>
              </div>
              {form.create_login && <>
                <div><label className="label">Email</label><input type="email" className="input" value={form.email || ''} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}/></div>
                <div><label className="label">Password</label><input type="text" className="input font-mono" value={form.password || ''} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}/></div>
              </>}
            </div>
          </section>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <button type="button" onClick={closeModal} className="btn-secondary">Cancel</button>
            <button className="btn-primary">Create Customer</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
