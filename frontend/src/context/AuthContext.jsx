import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setAccessToken, getAccessToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [branch, setBranch] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!getAccessToken()) { setUser(null); setBranch(null); setLoading(false); return; }
    try {
      const { data } = await api.get('/auth/me');
      setUser(data.user);
      setBranch(data.branch);
    } catch {
      setAccessToken(null);
      setUser(null);
      setBranch(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.access_token);
    setUser(data.user);
    await refresh();
    return data.user;
  };

  const logout = async () => {
    try { await api.post('/auth/logout'); } catch {}
    setAccessToken(null);
    setUser(null);
    setBranch(null);
  };

  const permissions = Array.isArray(user?.permissions) ? user.permissions : [];

  const hasPermission = useCallback((perm) => {
    if (!user) return false;
    // super_admin role always passes — defensive fallback in case the
    // backend omits the explicit '*' marker from /auth/me.
    if (user.role === 'super_admin') return true;
    const list = Array.isArray(user.permissions) ? user.permissions : [];
    if (list.includes('*')) return true;
    if (!perm) return false;
    if (Array.isArray(perm)) return perm.some(p => list.includes(p));
    return list.includes(perm);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, branch, loading, login, logout, refresh, permissions, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
