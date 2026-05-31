import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, roles, permission, permissions }) {
  const { user, loading, hasPermission } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center text-slate-500">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;

  const fallback = user.role === 'customer' ? '/portal' : '/dashboard';

  if (roles && !roles.includes(user.role)) {
    return <Navigate to={fallback} replace />;
  }

  // Normalize permission props — caller may pass a single string, an array via
  // `permissions`, or both `permission` + `permissions`.
  const required = [];
  if (typeof permission === 'string') required.push(permission);
  if (Array.isArray(permissions)) required.push(...permissions);

  if (required.length > 0) {
    // ALL required permissions must pass (matches spec §4.2 "both must pass").
    const ok = required.every(p => hasPermission(p));
    if (!ok) return <Navigate to={fallback} replace />;
  }

  return children;
}
