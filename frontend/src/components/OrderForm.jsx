import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api/client';
import ProductPicker from './ProductPicker';

const emptyOrder = () => ({ order_date: dayjs().format('YYYY-MM-DD'), due_day: 5 });

/**
 * Self-contained order/sale form for an EXISTING customer (customer + branch are
 * fixed, so there's no customer/branch picker). Used on the customer page so a
 * sale is created right where you're looking at the customer.
 */
export default function OrderForm({ customerId, branchId, onCreated, onCancel }) {
  const [order, setOrder] = useState(emptyOrder());
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/products', { params: { active: 'true' } }).then(r => setProducts(r.data)).catch(() => setProducts([]));
  }, []);

  useEffect(() => {
    if (order.product_id) {
      api.get('/inventory', { params: { product_id: order.product_id, status: 'in_stock' } })
        .then(r => setInventory(r.data)).catch(() => setInventory([]));
    } else setInventory([]);
  }, [order.product_id]);

  // Auto-calculate monthly installment = (total − advance − discount) ÷ months.
  useEffect(() => {
    const total = Number(order.total_price);
    const months = Number(order.total_installments);
    if (total > 0 && months > 0) {
      const monthly = Math.round(Math.max(0, total - Number(order.advance_payment || 0) - Number(order.discount || 0)) / months);
      setOrder(o => (Number(o.installment_amount) === monthly ? o : { ...o, installment_amount: monthly }));
    }
  }, [order.total_price, order.advance_payment, order.discount, order.total_installments]);

  const setO = (k, v) => setOrder(o => ({ ...o, [k]: v }));

  const onPickProduct = (id, picked) => {
    const p = picked || products.find(x => x.id === id);
    setOrder(o => ({
      ...o,
      product_id: id,
      product_name_snapshot: p?.name ?? o.product_name_snapshot,
      product_model_snapshot: p?.model ?? o.product_model_snapshot,
      total_price: p?.base_price ?? o.total_price,
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setSaving(true);
    try {
      const { data } = await api.post('/orders', { customer_id: customerId, branch_id: branchId, ...order });
      onCreated?.(data);
    } catch (e2) {
      setErr(e2?.response?.data?.error || 'Could not create order');
    } finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{err}</div>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div><label className="label">Product (search or create new)</label>
          <ProductPicker
            products={products}
            value={order.product_id}
            onPick={(id, p) => onPickProduct(id, p)}
            onCreated={(p) => setProducts(prev => [p, ...prev])}
          />
        </div>
        <div><label className="label">Inventory item (serial)</label>
          <select className="input" value={order.inventory_id || ''} onChange={e => setO('inventory_id', e.target.value)}>
            <option value="">— any —</option>
            {inventory.map(i => <option key={i.id} value={i.id}>{i.serial_no || 'no-serial'}</option>)}
          </select>
        </div>
        <div><label className="label">Item / Product name</label><input className="input" placeholder="e.g. LED TV, Refrigerator…" value={order.product_name_snapshot || ''} onChange={e => setO('product_name_snapshot', e.target.value)} /></div>
        <div><label className="label">Model</label><input className="input" value={order.product_model_snapshot || ''} onChange={e => setO('product_model_snapshot', e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Accessories included</label><textarea className="input" rows="2" placeholder="Charger, earbuds, cover…" value={order.accessories || ''} onChange={e => setO('accessories', e.target.value)} /></div>
        <div><label className="label">Order Date</label><input type="date" className="input" value={order.order_date || ''} onChange={e => setO('order_date', e.target.value)} /></div>
        <div><label className="label">Due Day (1–28)</label><input type="number" min="1" max="28" className="input" value={order.due_day || 5} onChange={e => setO('due_day', Number(e.target.value))} /></div>
        <div><label className="label">Total Price (Rs.) *</label><input type="number" step="0.01" required className="input" value={order.total_price || ''} onChange={e => setO('total_price', e.target.value)} /></div>
        <div><label className="label">Advance / Down payment (Rs.)</label><input type="number" step="0.01" className="input" value={order.advance_payment || ''} onChange={e => setO('advance_payment', e.target.value)} /></div>
        <div><label className="label">Discount (Rs.)</label><input type="number" step="0.01" className="input" value={order.discount || ''} onChange={e => setO('discount', e.target.value)} /></div>
        <div><label className="label">Total Months *</label><input type="number" min="1" required className="input" placeholder="any number — e.g. 4, 6, 12" value={order.total_installments || ''} onChange={e => setO('total_installments', e.target.value)} /></div>
        <div><label className="label">Monthly Installment (Rs.) * <span className="font-normal text-slate-400">· auto</span></label><input type="number" step="0.01" required className="input" placeholder="auto-calculated" value={order.installment_amount || ''} onChange={e => setO('installment_amount', e.target.value)} /></div>
        <div><label className="label">Sales Officer</label><input className="input" value={order.sales_officer || ''} onChange={e => setO('sales_officer', e.target.value)} /></div>
      </div>
      <div className="text-xs text-blue-900 bg-blue-50 border border-blue-100 rounded px-3 py-2">
        Only the first month's invoice opens now; generate the next one from the order page when you collect a payment.
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Cancel</button>
        <button disabled={saving} className="btn-primary">{saving ? 'Creating…' : 'Create Order'}</button>
      </div>
    </form>
  );
}
