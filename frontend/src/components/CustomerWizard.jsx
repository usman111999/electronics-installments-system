import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { api } from '../api/client';
import Modal from './Modal';
import ImageUpload from './ImageUpload';

const blankGuarantor = () => ({ name: '', father_name: '', cnic: '', home_address: '', official_address: '', phone_1: '', phone_2: '', occupation: '', relation: '' });

const emptyCustomer = () => ({ guarantors: [blankGuarantor(), blankGuarantor(), blankGuarantor()] });
const emptyOrder = () => ({ order_date: dayjs().format('YYYY-MM-DD'), due_day: 5 });

// Slot a customer's saved guarantors into the fixed three rows the form renders.
const customerToForm = (c) => {
  const slots = [blankGuarantor(), blankGuarantor(), blankGuarantor()];
  (c.guarantors || []).forEach(g => {
    const idx = Math.min(Math.max((g.guarantor_number || 1) - 1, 0), 2);
    slots[idx] = { ...blankGuarantor(), ...g };
  });
  return { ...c, guarantors: slots };
};

const fmt = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

/**
 * Multi-step create/edit flow.
 *  - New:  Customer → Product → Guarantors → Review  (creates customer, then an
 *          order if product+price fields are filled).
 *  - Edit: Customer → Guarantors → Review            (patches the customer only).
 */
export default function CustomerWizard({ open, onClose, editing, branches, isAdmin, onSaved }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(emptyCustomer());
  const [order, setOrder] = useState(emptyOrder());
  const [products, setProducts] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);

  const isEdit = !!editing;

  // Steps differ between create and edit (no product step when editing).
  const steps = useMemo(
    () => isEdit
      ? ['Customer', 'Guarantors', 'Review']
      : ['Customer', 'Product', 'Guarantors', 'Review'],
    [isEdit]
  );

  // Reset whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setErr('');
    setForm(editing ? customerToForm(editing) : emptyCustomer());
    setOrder(emptyOrder());
    setInventory([]);
    api.get('/products', { params: { active: 'true' } }).then(r => setProducts(r.data)).catch(() => setProducts([]));
  }, [open, editing]);

  // Load in-stock serials for the chosen catalog product.
  useEffect(() => {
    if (order.product_id) {
      api.get('/inventory', { params: { product_id: order.product_id, status: 'in_stock' } })
        .then(r => setInventory(r.data)).catch(() => setInventory([]));
    } else setInventory([]);
  }, [order.product_id]);

  const setC = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const setO = (key, value) => setOrder(o => ({ ...o, [key]: value }));
  const updateGuarantor = (idx, key, value) => setForm(f => {
    const g = [...(f.guarantors || [])];
    g[idx] = { ...g[idx], [key]: value };
    return { ...f, guarantors: g };
  });

  const onPickProduct = (id) => {
    const p = products.find(x => x.id === id);
    setOrder(o => ({
      ...o,
      product_id: id,
      product_name_snapshot: p?.name ?? o.product_name_snapshot,
      product_model_snapshot: p?.model ?? o.product_model_snapshot,
      total_price: p?.base_price ?? o.total_price,
      installment_amount: p?.default_installment_price ?? o.installment_amount,
    }));
  };

  const stepName = steps[step];
  const branchName = branches.find(b => b.id === form.branch_id)?.name;
  const hasOrder = !isEdit && order.total_price && order.installment_amount && order.total_installments;

  const validateStep = () => {
    if (stepName === 'Customer') {
      if (!form.customer_name) return 'Customer name is required';
      if (!form.phone_1) return 'Phone 1 is required';
      if (isAdmin && !form.branch_id) return 'Please select a branch';
      if (form.create_login && (!form.email || !form.password)) return 'Login email and password are required';
    }
    return '';
  };

  const next = () => {
    const v = validateStep();
    if (v) { setErr(v); return; }
    setErr('');
    setStep(s => Math.min(s + 1, steps.length - 1));
  };
  const back = () => { setErr(''); setStep(s => Math.max(s - 1, 0)); };

  const finish = async () => {
    setErr(''); setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/customers/${editing.id}`, form);
      } else {
        const { data: customer } = await api.post('/customers', form);
        if (hasOrder) {
          await api.post('/orders', {
            customer_id: customer.id,
            branch_id: form.branch_id,
            ...order,
          });
        }
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e?.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? `Edit Customer — ${editing.customer_name}` : 'New Customer'} size="xl">
      {/* Stepper */}
      <div className="flex items-center mb-5">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center flex-1 last:flex-none">
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-brand-600 text-white' : 'bg-slate-200 text-slate-500'
              }`}>{i < step ? '✓' : i + 1}</div>
              <span className={`text-sm font-medium ${i === step ? 'text-slate-900' : 'text-slate-400'}`}>{s}</span>
            </div>
            {i < steps.length - 1 && <div className={`flex-1 h-0.5 mx-2 ${i < step ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
          </div>
        ))}
      </div>

      {err && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded mb-3">{err}</div>}

      <div className="min-h-[320px]">
        {/* ---------------- STEP: Customer ---------------- */}
        {stepName === 'Customer' && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-1 sm:row-span-3">
              <ImageUpload value={form.picture_url || ''} onChange={(url) => setC('picture_url', url)} bucket="customer-pictures" label="Customer Picture" />
            </div>
            <div><label className="label">Customer Name *</label><input required className="input" value={form.customer_name || ''} onChange={e => setC('customer_name', e.target.value)} /></div>
            <div><label className="label">Father / Husband</label><input className="input" value={form.father_husband_name || ''} onChange={e => setC('father_husband_name', e.target.value)} /></div>
            <div><label className="label">CNIC</label><input className="input" value={form.cnic || ''} onChange={e => setC('cnic', e.target.value)} /></div>
            <div><label className="label">Gender</label>
              <select className="input" value={form.gender || ''} onChange={e => setC('gender', e.target.value)}>
                <option value="">-</option><option value="M">Male</option><option value="F">Female</option>
              </select>
            </div>
            <div><label className="label">Phone 1 *</label><input required className="input" value={form.phone_1 || ''} onChange={e => setC('phone_1', e.target.value)} /></div>
            <div><label className="label">Phone 2</label><input className="input" value={form.phone_2 || ''} onChange={e => setC('phone_2', e.target.value)} /></div>
            <div><label className="label">Occupation</label><input className="input" value={form.occupation || ''} onChange={e => setC('occupation', e.target.value)} /></div>
            <div><label className="label">Monthly Income</label><input type="number" className="input" value={form.monthly_income || ''} onChange={e => setC('monthly_income', e.target.value)} /></div>
            {isAdmin && (
              <div><label className="label">Branch *</label>
                <select required className="input" value={form.branch_id || ''} onChange={e => setC('branch_id', e.target.value)}>
                  <option value="">— select —</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <div className="sm:col-span-3"><label className="label">Home Address</label><textarea className="input" value={form.home_address || ''} onChange={e => setC('home_address', e.target.value)} /></div>
            <div className="sm:col-span-3"><label className="label">Official Address</label><textarea className="input" value={form.official_address || ''} onChange={e => setC('official_address', e.target.value)} /></div>
            <div className="sm:col-span-3"><label className="label">CRC Remarks</label><textarea className="input" value={form.crc_remarks || ''} onChange={e => setC('crc_remarks', e.target.value)} /></div>

            {!isEdit && (
              <div className="sm:col-span-3 border-t pt-3 mt-1">
                <div className="flex items-center gap-2 mb-2">
                  <input type="checkbox" id="wl" checked={!!form.create_login} onChange={e => setC('create_login', e.target.checked)} />
                  <label htmlFor="wl" className="text-sm">Give this customer an online login (so they can check their own installments). Optional.</label>
                </div>
                {form.create_login && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><label className="label">Email</label><input type="email" className="input" value={form.email || ''} onChange={e => setC('email', e.target.value)} /></div>
                    <div><label className="label">Password</label><input type="text" className="input font-mono" value={form.password || ''} onChange={e => setC('password', e.target.value)} /></div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ---------------- STEP: Product ---------------- */}
        {stepName === 'Product' && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">Sell any electronics on installments (phone, LED, fridge, laptop…). Fill the price fields to start an installment plan now — or leave them blank to just save the customer and add the order later.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="label">Product (from catalog)</label>
                <select className="input" value={order.product_id || ''} onChange={e => onPickProduct(e.target.value)}>
                  <option value="">— none / custom —</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} {p.model && `· ${p.model}`}</option>)}
                </select>
              </div>
              <div><label className="label">Inventory item (serial)</label>
                <select className="input" value={order.inventory_id || ''} onChange={e => setO('inventory_id', e.target.value)}>
                  <option value="">— any —</option>
                  {inventory.map(i => <option key={i.id} value={i.id}>{i.serial_no || 'no-serial'}</option>)}
                </select>
              </div>
              <div><label className="label">Item / Product name</label><input className="input" placeholder="e.g. LED TV, Refrigerator, Laptop…" value={order.product_name_snapshot || ''} onChange={e => setO('product_name_snapshot', e.target.value)} /></div>
              <div><label className="label">Model</label><input className="input" placeholder="e.g. 43U7K, A2895…" value={order.product_model_snapshot || ''} onChange={e => setO('product_model_snapshot', e.target.value)} /></div>
              <div className="sm:col-span-2"><label className="label">Accessories included</label><textarea className="input" rows="2" placeholder="e.g. Charger, earbuds, cover, warranty card, stabiliser…" value={order.accessories || ''} onChange={e => setO('accessories', e.target.value)} /></div>
              <div><label className="label">Order Date</label><input type="date" className="input" value={order.order_date || ''} onChange={e => setO('order_date', e.target.value)} /></div>
              <div><label className="label">Due Day (1–28)</label><input type="number" min="1" max="28" className="input" value={order.due_day || 5} onChange={e => setO('due_day', Number(e.target.value))} /></div>
              <div><label className="label">Total Price (Rs.)</label><input type="number" step="0.01" className="input" value={order.total_price || ''} onChange={e => setO('total_price', e.target.value)} /></div>
              <div><label className="label">Advance / Down payment (Rs.)</label><input type="number" step="0.01" className="input" value={order.advance_payment || ''} onChange={e => setO('advance_payment', e.target.value)} /></div>
              <div><label className="label">Discount (Rs.)</label><input type="number" step="0.01" className="input" value={order.discount || ''} onChange={e => setO('discount', e.target.value)} /></div>
              <div><label className="label">Monthly Installment (Rs.)</label><input type="number" step="0.01" className="input" placeholder="amount per month" value={order.installment_amount || ''} onChange={e => setO('installment_amount', e.target.value)} /></div>
              <div><label className="label">Total Months</label><input type="number" min="1" className="input" placeholder="any number — e.g. 4, 6, 12, 18" value={order.total_installments || ''} onChange={e => setO('total_installments', e.target.value)} /></div>
              <div><label className="label">Recovery Officer</label><input className="input" value={order.recovery_officer || ''} onChange={e => setO('recovery_officer', e.target.value)} /></div>
            </div>
          </div>
        )}

        {/* ---------------- STEP: Guarantors ---------------- */}
        {stepName === 'Guarantors' && (
          <div className="space-y-5">
            {[0, 1, 2].map(idx => (
              <section key={idx}>
                <h3 className="font-semibold text-slate-800 mb-2">
                  Guarantor #{idx + 1} <span className="text-xs font-normal text-slate-400">{idx === 2 ? '(optional)' : '(recommended — leave blank to skip)'}</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div><label className="label">Name</label><input className="input" value={form.guarantors[idx]?.name || ''} onChange={e => updateGuarantor(idx, 'name', e.target.value)} /></div>
                  <div><label className="label">Father Name</label><input className="input" value={form.guarantors[idx]?.father_name || ''} onChange={e => updateGuarantor(idx, 'father_name', e.target.value)} /></div>
                  <div><label className="label">CNIC</label><input className="input" value={form.guarantors[idx]?.cnic || ''} onChange={e => updateGuarantor(idx, 'cnic', e.target.value)} /></div>
                  <div><label className="label">Phone 1</label><input className="input" value={form.guarantors[idx]?.phone_1 || ''} onChange={e => updateGuarantor(idx, 'phone_1', e.target.value)} /></div>
                  <div><label className="label">Phone 2</label><input className="input" value={form.guarantors[idx]?.phone_2 || ''} onChange={e => updateGuarantor(idx, 'phone_2', e.target.value)} /></div>
                  <div><label className="label">Relation</label><input className="input" value={form.guarantors[idx]?.relation || ''} onChange={e => updateGuarantor(idx, 'relation', e.target.value)} /></div>
                  <div><label className="label">Occupation</label><input className="input" value={form.guarantors[idx]?.occupation || ''} onChange={e => updateGuarantor(idx, 'occupation', e.target.value)} /></div>
                  <div className="sm:col-span-3"><label className="label">Home Address</label><textarea className="input" value={form.guarantors[idx]?.home_address || ''} onChange={e => updateGuarantor(idx, 'home_address', e.target.value)} /></div>
                  <div className="sm:col-span-3"><label className="label">Official Address</label><textarea className="input" value={form.guarantors[idx]?.official_address || ''} onChange={e => updateGuarantor(idx, 'official_address', e.target.value)} /></div>
                </div>
              </section>
            ))}
          </div>
        )}

        {/* ---------------- STEP: Review ---------------- */}
        {stepName === 'Review' && (
          <div className="space-y-4 text-sm">
            <ReviewBlock title="Customer">
              <Row k="Name" v={form.customer_name} />
              <Row k="Father / Husband" v={form.father_husband_name} />
              <Row k="CNIC" v={form.cnic} />
              <Row k="Gender" v={form.gender === 'M' ? 'Male' : form.gender === 'F' ? 'Female' : ''} />
              <Row k="Phone 1" v={form.phone_1} />
              <Row k="Phone 2" v={form.phone_2} />
              <Row k="Occupation" v={form.occupation} />
              <Row k="Monthly Income" v={form.monthly_income ? fmt(form.monthly_income) : ''} />
              {isAdmin && <Row k="Branch" v={branchName} />}
              <Row k="Home Address" v={form.home_address} />
              <Row k="Official Address" v={form.official_address} />
              {form.create_login && <Row k="Login" v={form.email} />}
            </ReviewBlock>

            {!isEdit && (
              <ReviewBlock title="Product / Order">
                {hasOrder ? (
                  <>
                    <Row k="Item" v={order.product_name_snapshot} />
                    <Row k="Model" v={order.product_model_snapshot} />
                    <Row k="Accessories" v={order.accessories} />
                    <Row k="Order Date" v={order.order_date} />
                    <Row k="Total Price" v={fmt(order.total_price)} />
                    <Row k="Advance" v={fmt(order.advance_payment)} />
                    <Row k="Discount" v={fmt(order.discount)} />
                    <Row k="Plan" v={`${order.total_installments} × ${fmt(order.installment_amount)} (due day ${order.due_day})`} />
                    <Row k="Recovery Officer" v={order.recovery_officer} />
                  </>
                ) : (
                  <div className="text-slate-400">No order — customer will be registered without a product.</div>
                )}
              </ReviewBlock>
            )}

            <ReviewBlock title="Guarantors">
              {(form.guarantors || []).filter(g => g.name).length === 0
                ? <div className="text-slate-400">None added.</div>
                : (form.guarantors || []).filter(g => g.name).map((g, i) => (
                    <div key={i} className="py-1 border-b last:border-0 border-slate-100">
                      <span className="font-medium">{g.name}</span>
                      {g.relation && <span className="text-slate-500"> · {g.relation}</span>}
                      {g.phone_1 && <span className="text-slate-500"> · 📞 {g.phone_1}</span>}
                    </div>
                  ))}
            </ReviewBlock>
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="flex justify-between items-center gap-2 pt-4 mt-2 border-t">
        <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
        <div className="flex gap-2">
          {step > 0 && <button type="button" onClick={back} className="btn-secondary">← Back</button>}
          {step < steps.length - 1
            ? <button type="button" onClick={next} className="btn-primary">Next →</button>
            : <button type="button" onClick={finish} disabled={saving} className="btn-primary">{saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Customer'}</button>}
        </div>
      </div>
    </Modal>
  );
}

function ReviewBlock({ title, children }) {
  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <h4 className="font-semibold text-slate-800 mb-2">{title}</h4>
      <dl>{children}</dl>
    </div>
  );
}

function Row({ k, v }) {
  if (!v) return null;
  return (
    <div className="flex justify-between gap-4 py-0.5">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-slate-900 text-right">{v}</dd>
    </div>
  );
}
