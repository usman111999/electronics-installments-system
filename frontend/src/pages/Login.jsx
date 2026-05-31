import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

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
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand-600 text-white text-xl font-bold mb-3">E</div>
          <h1 className="text-2xl font-bold text-slate-900">Electronics Instalments System</h1>
          <p className="text-sm text-slate-500 mt-1">Sign in to access your portal</p>
        </div>
        <form onSubmit={submit} className="card space-y-4">
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
          <p className="text-xs text-slate-400 text-center">
            One login for all roles — system detects admin / operator / customer automatically.
          </p>
        </form>
      </div>
    </div>
  );
}
