import dayjs from 'dayjs';
import { COMPANY_NAME, LOGO_URL } from '../branding';

const blank = (s) => (s === 0 || s ? s : '—');
const fmt = (n) => Number(n || 0).toLocaleString();
const money = (n) => `Rs. ${Number(n || 0).toLocaleString()}`;

// A4 "Customer Account Information Detail" form — redesigned for clarity:
// a customer block with photo, a highlighted account/finance summary, a
// guarantor comparison table and a full payment schedule with totals.
export default function CustomerPrintForm({ customer }) {
  const orders = customer.orders || [];
  const installments = orders
    .flatMap(o => (o.installments || []).map(i => ({ ...i, order_no: o.order_no, recovery_officer: i.recovery_officer || o.recovery_officer })))
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  const firstOrder = orders[0] || {};
  const guarantors = [1, 2, 3].map(n => customer.guarantors?.find(g => g.guarantor_number === n) || null);
  const multiOrder = orders.length > 1;

  // ---- Financial summary ----
  const advance = Number(firstOrder.advance_payment || 0);
  const discount = Number(firstOrder.discount || 0);
  const total = Number(firstOrder.total_price || 0);
  const financed = Math.max(0, total - advance - discount);
  const paidCount = installments.filter(i => i.status === 'paid').length;
  const remainingCount = Math.max(0, Number(firstOrder.total_installments || 0) - paidCount);
  const instCollected = installments.reduce((s, i) => s + Number(i.amount_paid || 0), 0);
  const collected = advance + instCollected;
  const outstanding = installments.reduce(
    (s, i) => s + Math.max(0, Number(i.amount_due || 0) + Number(i.fine || 0) - Number(i.discount || 0) - Number(i.amount_paid || 0)),
    0,
  );

  // Schedule totals
  const tot = installments.reduce((a, i) => ({
    due: a.due + Number(i.amount_due || 0),
    disc: a.disc + Number(i.discount || 0),
    fine: a.fine + Number(i.fine || 0),
    paid: a.paid + Number(i.amount_paid || 0),
  }), { due: 0, disc: 0, fine: 0, paid: 0 });

  const guarantorRows = [
    ['Name', g => g?.name],
    ['F / H Name', g => g?.father_name],
    ['Mobile', g => g?.phone_1],
    ['Office Ph #', g => g?.phone_2],
    ['NIC #', g => g?.cnic],
    ['Home Address', g => g?.home_address],
    ['Office Address', g => g?.official_address],
    ['Occupation', g => g?.occupation],
    ['Relation', g => g?.relation],
  ];

  return (
    <div className="print-form bg-white mx-auto" style={{ maxWidth: '210mm', padding: '10mm', fontSize: '10px', fontFamily: 'Arial, Helvetica, sans-serif', color: '#1f2937' }}>
      <style>{`
        @media print { @page { size: A4; margin: 10mm; } }
        .pf table { border-collapse: collapse; width: 100%; }
        .pf td, .pf th { border: 1px solid #cbd5e1; padding: 6px 8px; vertical-align: top; line-height: 1.45; }
        .pf thead { display: table-header-group; }
        .pf tr { page-break-inside: avoid; }
        .pf .sec {
          background: #1e3a5f; color: #fff; font-weight: 700; font-size: 10.5px;
          letter-spacing: 0.8px; text-transform: uppercase; padding: 6px 10px; border: 1px solid #1e3a5f;
        }
        .pf .lbl { background: #eef2f7; font-weight: 700; color: #334155; white-space: nowrap; width: 1%; }
        .pf .val { color: #111827; }
        .pf .chead th {
          background: #e2e8f0; font-weight: 700; color: #1e3a5f; font-size: 9px;
          text-transform: uppercase; letter-spacing: 0.3px; text-align: left; white-space: nowrap;
        }
        .pf .zebra:nth-child(even) td { background: #f8fafc; }
        .pf .muted { color: #94a3b8; }
        .pf .num { text-align: right; font-variant-numeric: tabular-nums; }
        .pf .totals td { background: #eef2f7; font-weight: 700; }
        .pf .pill { display: inline-block; padding: 1px 7px; border-radius: 9px; font-size: 8.5px; font-weight: 700; text-transform: uppercase; }
        .pf .pill-paid { background: #dcfce7; color: #166534; }
        .pf .pill-due  { background: #fef9c3; color: #854d0e; }
      `}</style>

      <div className="pf">
        {/* ---- Letterhead ---- */}
        <div className="flex items-center justify-between pb-2 mb-3" style={{ borderBottom: '3px solid #1e3a5f' }}>
          <div className="flex items-center gap-2">
            <img src={LOGO_URL} alt={COMPANY_NAME} style={{ height: '40px', width: 'auto', background: '#000', padding: '3px', borderRadius: '4px' }} />
            <div>
              <div className="font-bold" style={{ fontSize: '18px', letterSpacing: '0.5px', color: '#111827', lineHeight: 1.1 }}>{COMPANY_NAME}</div>
              <div style={{ fontSize: '9px', color: '#64748b', letterSpacing: '0.4px' }}>Customer Account Information Detail</div>
            </div>
          </div>
          <div className="text-right" style={{ fontSize: '9px', color: '#475569', lineHeight: 1.6 }}>
            <div className="font-bold" style={{ fontSize: '12px', color: '#1e3a5f' }}>{customer.branches?.name || '—'}</div>
            <div>Printed: {dayjs().format('DD-MMM-YYYY hh:mm A')}</div>
            <div>Account #: <b>{blank(customer.account_no)}</b></div>
          </div>
        </div>

        {/* ---- Customer Information ---- */}
        <div className="sec mb-0">Customer Information</div>
        <table className="mb-3">
          <tbody>
            <tr>
              <td className="lbl">Customer Name</td>
              <td className="val" style={{ width: '23%' }}>{blank(customer.customer_name)}</td>
              <td className="lbl">F / H Name</td>
              <td className="val" style={{ width: '23%' }}>{blank(customer.father_husband_name)}</td>
              <td rowSpan={6} style={{ width: '22%', textAlign: 'center', verticalAlign: 'middle', padding: '8px' }}>
                {customer.picture_url
                  ? <img src={customer.picture_url} alt="Customer" style={{ width: '108px', height: '132px', objectFit: 'cover', border: '1px solid #94a3b8', borderRadius: '4px', display: 'block', margin: '0 auto' }} />
                  : <div style={{ width: '108px', height: '132px', margin: '0 auto', border: '1px dashed #94a3b8', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="muted">Photo</div>}
                <div className="muted" style={{ fontSize: '8px', marginTop: '4px', letterSpacing: '0.4px' }}>CUSTOMER PHOTO</div>
              </td>
            </tr>
            <tr>
              <td className="lbl">CNIC</td>
              <td className="val">{blank(customer.cnic)}</td>
              <td className="lbl">Gender</td>
              <td className="val">{blank(customer.gender)}</td>
            </tr>
            <tr>
              <td className="lbl">Mobile 1</td>
              <td className="val">{blank(customer.phone_1)}</td>
              <td className="lbl">Mobile 2</td>
              <td className="val">{blank(customer.phone_2)}</td>
            </tr>
            <tr>
              <td className="lbl">Occupation</td>
              <td className="val">{blank(customer.occupation)}</td>
              <td className="lbl">Salary / Income</td>
              <td className="val">{customer.monthly_income ? money(customer.monthly_income) : '—'}</td>
            </tr>
            <tr>
              <td className="lbl">Home Address</td>
              <td className="val" colSpan={3} style={{ whiteSpace: 'pre-wrap' }}>{blank(customer.home_address)}</td>
            </tr>
            <tr>
              <td className="lbl">Office Address</td>
              <td className="val" colSpan={3} style={{ whiteSpace: 'pre-wrap' }}>{blank(customer.official_address)}</td>
            </tr>
            {customer.crc_remarks && (
              <tr>
                <td className="lbl">CRC Remarks</td>
                <td className="val" colSpan={4} style={{ whiteSpace: 'pre-wrap' }}>{blank(customer.crc_remarks)}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* ---- Product & Account Summary ---- */}
        <div className="sec mb-0">Product &amp; Account Summary</div>
        <table className="mb-1">
          <tbody>
            <tr>
              <td className="lbl">Company</td><td className="val">{blank(firstOrder.products?.company)}</td>
              <td className="lbl">Product</td><td className="val">{blank(firstOrder.product_name_snapshot)}</td>
              <td className="lbl">Model</td><td className="val">{blank(firstOrder.product_model_snapshot)}</td>
            </tr>
            <tr>
              <td className="lbl">Serial No</td><td className="val">{blank(firstOrder.product_serial_snapshot)}</td>
              <td className="lbl">Order Date</td><td className="val">{firstOrder.order_date ? dayjs(firstOrder.order_date).format('DD-MMM-YYYY') : '—'}</td>
              <td className="lbl">Status</td><td className="val" style={{ textTransform: 'capitalize' }}>{blank(firstOrder.status)}</td>
            </tr>
            {firstOrder.accessories && (
              <tr><td className="lbl">Accessories</td><td className="val" colSpan={5}>{blank(firstOrder.accessories)}</td></tr>
            )}
          </tbody>
        </table>

        {/* finance figure strip */}
        <table className="mb-3">
          <tbody>
            <tr>
              <td className="lbl">Total Price</td><td className="val num">{money(total)}</td>
              <td className="lbl">Advance</td><td className="val num">{money(advance)}</td>
              <td className="lbl">Discount</td><td className="val num">{money(discount)}</td>
            </tr>
            <tr>
              <td className="lbl">Financed</td><td className="val num">{money(financed)}</td>
              <td className="lbl">Monthly Installment</td><td className="val num">{money(firstOrder.installment_amount)}</td>
              <td className="lbl">Duration</td><td className="val">{firstOrder.total_installments || firstOrder.duration_months || 0} months</td>
            </tr>
            <tr>
              <td className="lbl">Collected</td><td className="val num" style={{ color: '#166534', fontWeight: 700 }}>{money(collected)}</td>
              <td className="lbl">Outstanding</td><td className="val num" style={{ color: '#9a3412', fontWeight: 700 }}>{money(outstanding)}</td>
              <td className="lbl">Paid / Remaining</td><td className="val">{paidCount} paid · {remainingCount} left</td>
            </tr>
          </tbody>
        </table>

        {/* ---- Guarantor Details (criteria × guarantor) ---- */}
        <div className="sec mb-0">Guarantor Details</div>
        <table className="mb-3">
          <thead>
            <tr className="chead">
              <th style={{ width: '14%' }}>Criteria</th>
              <th style={{ width: '28.6%' }}>Guarantor #1</th>
              <th style={{ width: '28.6%' }}>Guarantor #2</th>
              <th style={{ width: '28.6%' }}>Guarantor #3</th>
            </tr>
          </thead>
          <tbody>
            {guarantorRows.map(([label, get]) => (
              <tr key={label} className="zebra">
                <td className="lbl">{label}</td>
                {guarantors.map((g, idx) => (
                  <td key={idx} className="val" style={{ whiteSpace: 'pre-wrap' }}>{blank(get(g))}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {/* ---- Payment Schedule ---- */}
        <div className="sec mb-0">Payment Schedule</div>
        <table className="mb-3">
          <thead>
            <tr className="chead">
              <th style={{ width: '4%' }}>#</th>
              {multiOrder && <th>Order</th>}
              <th>Due Date</th>
              <th>Receipt #</th>
              <th className="num">Pre-Bal</th>
              <th className="num">Installment</th>
              <th className="num">Disc</th>
              <th className="num">Fine</th>
              <th className="num">Paid</th>
              <th className="num">Balance</th>
              <th>Status</th>
              <th>Recovery Officer</th>
              <th>Remarks</th>
            </tr>
          </thead>
          <tbody>
            {installments.map((i, idx) => (
              <tr key={i.id} className="zebra">
                <td>{idx + 1}</td>
                {multiOrder && <td>{blank(i.order_no)}</td>}
                <td>{dayjs(i.due_date).format('DD/MM/YYYY')}</td>
                <td>{blank(i.receipt_no)}</td>
                <td className="num">{fmt(i.pre_balance)}</td>
                <td className="num">{fmt(i.amount_due)}</td>
                <td className="num">{fmt(i.discount)}</td>
                <td className="num">{fmt(i.fine)}</td>
                <td className="num">{fmt(i.amount_paid)}</td>
                <td className="num">{fmt(i.balance)}</td>
                <td><span className={`pill ${i.status === 'paid' ? 'pill-paid' : 'pill-due'}`}>{i.status === 'paid' ? 'Paid' : 'Pending'}</span></td>
                <td>{blank(i.recovery_officer)}</td>
                <td>{blank(i.remarks)}</td>
              </tr>
            ))}
            {installments.length === 0 && (
              <tr><td colSpan={multiOrder ? 13 : 12} className="muted" style={{ textAlign: 'center', padding: '14px' }}>No installments generated yet</td></tr>
            )}
            {installments.length > 0 && (
              <tr className="totals">
                <td colSpan={multiOrder ? 5 : 4} style={{ textAlign: 'right' }}>Totals</td>
                <td className="num">{fmt(tot.due)}</td>
                <td className="num">{fmt(tot.disc)}</td>
                <td className="num">{fmt(tot.fine)}</td>
                <td className="num">{fmt(tot.paid)}</td>
                <td colSpan={4}></td>
              </tr>
            )}
          </tbody>
        </table>

        {/* ---- Signatures ---- */}
        <table style={{ marginTop: '14px' }}>
          <tbody>
            <tr>
              {['Customer Signature', 'Guarantor Signature', `For ${COMPANY_NAME}`].map(s => (
                <td key={s} style={{ height: '46px', verticalAlign: 'bottom', textAlign: 'center', width: '33.3%' }}>
                  <div style={{ borderTop: '1px solid #475569', paddingTop: '3px', fontSize: '9px', color: '#475569' }}>{s}</div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>

        <div className="muted" style={{ textAlign: 'center', marginTop: '8px', fontSize: '8px' }}>
          This is a system-generated account statement from {COMPANY_NAME}. Figures are accurate as of {dayjs().format('DD-MMM-YYYY hh:mm A')}.
        </div>
      </div>
    </div>
  );
}
