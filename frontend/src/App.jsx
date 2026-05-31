import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './context/AuthContext';

import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Branches from './pages/Branches';
import Users from './pages/Users';
import Roles from './pages/Roles';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Installments from './pages/Installments';
import ActivityLogs from './pages/ActivityLogs';
import WhatsApp from './pages/WhatsApp';
import Devices from './pages/Devices';

import SuperAdmins from './pages/super-admin/Admins';
import SuperPhones from './pages/super-admin/Phones';
import SuperOverview from './pages/super-admin/Overview';

import CustomerHome from './pages/customer/CustomerHome';
import CustomerInstallments from './pages/customer/CustomerInstallments';
import CustomerProducts from './pages/customer/CustomerProducts';

function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'customer') return <Navigate to="/portal" replace />;
  if (user.role === 'super_admin') return <Navigate to="/super-admin/overview" replace />;
  return <Navigate to="/dashboard" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<HomeRedirect />} />

      {/* Admin / operator / super_admin shared routes (gated by individual permissions). */}
      <Route element={<ProtectedRoute roles={['super_admin', 'admin', 'operator']}><Layout /></ProtectedRoute>}>
        <Route path="/dashboard" element={<ProtectedRoute permission="stats.view"><Dashboard /></ProtectedRoute>} />
        <Route path="/branches" element={<ProtectedRoute permission="branches.view"><Branches /></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute permission="users.view"><Users /></ProtectedRoute>} />
        <Route path="/roles" element={<ProtectedRoute permission="roles.view"><Roles /></ProtectedRoute>} />
        <Route path="/products" element={<ProtectedRoute permission="products.view"><Products /></ProtectedRoute>} />
        <Route path="/inventory" element={<ProtectedRoute permission="inventory.view"><Inventory /></ProtectedRoute>} />
        <Route path="/customers" element={<ProtectedRoute permission="customers.view"><Customers /></ProtectedRoute>} />
        <Route path="/customers/:id" element={<ProtectedRoute permission="customers.view"><CustomerDetail /></ProtectedRoute>} />
        <Route path="/orders" element={<ProtectedRoute permission="orders.view"><Orders /></ProtectedRoute>} />
        <Route path="/orders/:id" element={<ProtectedRoute permission="orders.view"><OrderDetail /></ProtectedRoute>} />
        <Route path="/installments" element={<ProtectedRoute permission="installments.view"><Installments /></ProtectedRoute>} />
        <Route path="/devices" element={<ProtectedRoute permission="devices.view"><Devices /></ProtectedRoute>} />
        <Route path="/activity" element={<ProtectedRoute permission="activity_logs.view"><ActivityLogs /></ProtectedRoute>} />
        <Route path="/whatsapp" element={<ProtectedRoute permission="whatsapp.view"><WhatsApp /></ProtectedRoute>} />
      </Route>

      {/* Super Admin only */}
      <Route element={<ProtectedRoute roles={['super_admin']}><Layout /></ProtectedRoute>}>
        <Route path="/super-admin/admins" element={<SuperAdmins />} />
        <Route path="/super-admin/phones" element={<SuperPhones />} />
        <Route path="/super-admin/overview" element={<SuperOverview />} />
      </Route>

      <Route element={<ProtectedRoute roles={['customer']}><Layout /></ProtectedRoute>}>
        <Route path="/portal" element={<CustomerHome />} />
        <Route path="/portal/installments" element={<CustomerInstallments />} />
        <Route path="/portal/products" element={<CustomerProducts />} />
      </Route>

      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}
