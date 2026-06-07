import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { COMPANY_NAME, LOGO_URL } from '../branding';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setLoading(true);
    try {
      const u = await login(email, password);
      const from = location.state?.from?.pathname;
      if (from) return navigate(from, { replace: true });
      if (u.role === 'customer') navigate('/portal', { replace: true });
      else if (u.role === 'super_admin') navigate('/super-admin/overview', { replace: true });
      else navigate('/dashboard', { replace: true });
    } catch (e) {
      setErr(e?.response?.data?.error || e.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-brand-50 via-white to-slate-100">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src={LOGO_URL} alt={COMPANY_NAME} className="mx-auto h-20 w-auto mb-4 rounded-xl bg-black/90 p-3 object-contain" />
          <h1 className="text-2xl font-bold text-slate-900">{COMPANY_NAME}</h1>
          <p className="text-sm text-slate-500 mt-1">Sign in to access your portal</p>
        </div>
        <form onSubmit={submit} className="card space-y-4">
          <div className="text-xs text-blue-900 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
            Use the same email &amp; password whether you are an admin, shop operator, or customer — the system takes you to the right screen automatically.
          </div>
          {err && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</div>}
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Password</label>
            <input type="password" className="input" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          <button className="btn-primary w-full" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </div>
    </div>
  );
}
