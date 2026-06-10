import dayjs from 'dayjs';
import { COMPANY_NAME, LOGO_URL } from '../branding';

const blank = (s) => (s === 0 || s ? s : '');
const fmt = (n) => Number(n || 0).toLocaleString();

// A4 printable "Customer Account Information Detail" form.
// Laid out as four clearly separated sections, each introduced by a light-grey
// title bar: Customer Account Information, Product Detail, Guarantor Details
// (one row per guarantor) and the Payment Schedule.
export default function CustomerPrintForm({ customer }) {
  const orders = customer.orders || [];
  const installments = orders.flatMap(o => (o.installments || []).map(i => ({ ...i, order_no: o.order_no, recovery_officer: i.recovery_officer || o.recovery_officer })));
  installments.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  const firstOrder = orders[0];
  const guarantors = [1, 2, 3].map(n => customer.guarantors?.find(g => g.guarantor_number === n) || null);

  return (
    <div className="print-form bg-white text-black mx-auto" style={{ maxWidth: '210mm', padding: '8mm', fontSize: '10px', fontFamily: 'Arial, Helvetica, sans-serif', color: '#1f2937' }}>
      <style>{`
        .pf table { border-collapse: collapse; width: 100%; }
        .pf td, .pf th { border: 1px solid #c7ced8; padding: 7px 8px; vertical-align: middle; line-height: 1.5; }
        .pf .sec-title {
          background: #e8edf3; border: 1px solid #b6c0cf;
          font-weight: 700; font-size: 11px; letter-spacing: 0.6px;
          text-transform: uppercase; color: #1e3a5f; padding: 8px 10px;
          border-left: 3px solid #2f5d8a;
        }
        .pf .lbl { background: #f4f6f9; font-weight: 700; color: #374151; white-space: nowrap; }
        .pf .col-head th {
          background: #eef1f6; font-weight: 700; color: #1e3a5f;
          font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.3px; text-align: left;
        }
        .pf .gtag { background: #f4f6f9; font-weight: 700; color: #1e3a5f; white-space: nowrap; }
        .pf .zebra:nth-child(even) td { background: #fafbfc; }
        .pf .muted { color: #9aa3af; }
      `}</style>

      <div className="pf">
        {/* ---- Letterhead ---- */}
        <div className="flex items-center justify-center gap-2 mb-2 pb-2" style={{ borderBottom: '2px solid #1e3a5f' }}>
          <img src={LOGO_URL} alt={COMPANY_NAME} style={{ height: '34px', width: 'auto', background: '#000', padding: '2px', borderRadius: '3px' }} />
          <div className="font-bold" style={{ fontSize: '17px', letterSpacing: '0.5px', color: '#111827' }}>{COMPANY_NAME}</div>
        </div>

        <div className="flex justify-between items-start mb-3">
          <div style={{ lineHeight: 1.5 }}>
            <div><b>Print Date:</b> {dayjs().format('DD-MMM-YYYY')}</div>
            <div><b>Print Time:</b> {dayjs().format('hh:mm:ss A')}</div>
          </div>
          <div className="text-center">
            <div className="font-bold" style={{ fontSize: '15px', color: '#111827' }}>{customer.branches?.name || '—'}</div>
            <div className="font-bold" style={{ fontSize: '11px', color: '#1e3a5f', letterSpacing: '0.4px' }}>CUSTOMER ACCOUNT INFORMATION DETAIL</div>
          </div>
          <div className="text-right" style={{ lineHeight: 1.5 }}>
            <div><b>Print By:</b> System</div>
            <div>Page 1 of 1</div>
          </div>
        </div>

        {/* ---- Section 1: Customer Account Information ---- */}
        <table className="mb-3">
          <tbody>
            <tr><td colSpan={6} className="sec-title">Customer Account Information</td></tr>
            <tr>
              <td className="lbl" style={{ width: '15%' }}>Account No.</td>
              <td style={{ width: '18%' }}>{blank(customer.account_no)}</td>
              <td className="lbl" style={{ width: '15%' }}>Date</td>
              <td style={{ width: '18%' }}>{firstOrder ? dayjs(firstOrder.order_date).format('DD-MMM-YYYY') : '-'}</td>
              <td className="lbl" style={{ width: '16%' }}>FOMS AccNo</td>
              <td style={{ width: '18%' }}>0</td>
            </tr>
            <tr>
              <td className="lbl">Customer</td>
              <td>{blank(customer.customer_name)}</td>
              <td className="lbl">Repeat As Customer</td>
              <td>{orders.length}</td>
              <td className="lbl">Repeat As Guarantor</td>
              <td>-</td>
            </tr>
            <tr>
              <td className="lbl">F/H Name</td>
              <td>{blank(customer.father_husband_name)}</td>
              <td className="lbl">Occupation</td>
              <td>{blank(customer.occupation)}</td>
              <td className="lbl">Gender</td>
              <td>{blank(customer.gender)}</td>
            </tr>
            <tr>
              <td className="lbl">Mobile 1</td>
              <td>{blank(customer.phone_1)}</td>
              <td className="lbl">Mobile 2</td>
              <td>{blank(customer.phone_2)}</td>
              <td className="lbl">NIC</td>
              <td>{blank(customer.cnic)}</td>
            </tr>
            <tr>
              <td className="lbl">CRC Remarks</td>
              <td colSpan={5}>{blank(customer.crc_remarks)}</td>
            </tr>
          </tbody>
        </table>

        {/* ---- Section 2: Product Detail ---- */}
        <table className="mb-3">
          <tbody>
            <tr><td colSpan={6} className="sec-title">Product Detail</td></tr>
            {firstOrder ? (
              <>
                <tr>
                  <td className="lbl" style={{ width: '15%' }}>Company</td>
                  <td style={{ width: '18%' }}>{blank(firstOrder.products?.company)}</td>
                  <td className="lbl" style={{ width: '15%' }}>Product</td>
                  <td style={{ width: '18%' }}>{blank(firstOrder.product_name_snapshot)}</td>
                  <td className="lbl" style={{ width: '16%' }}>Model</td>
                  <td style={{ width: '18%' }}>{blank(firstOrder.product_model_snapshot)}</td>
                </tr>
                <tr>
                  <td className="lbl">Serial No</td>
                  <td>{blank(firstOrder.product_serial_snapshot)}</td>
                  <td className="lbl">Inst Price</td>
                  <td>{fmt(firstOrder.installment_amount)}</td>
                  <td className="lbl">Total Rev</td>
                  <td>{fmt(firstOrder.total_price)}</td>
                </tr>
                <tr>
                  <td className="lbl">Advance</td>
                  <td>{fmt(firstOrder.advance_payment)}</td>
                  <td className="lbl">Discount</td>
                  <td>{fmt(firstOrder.discount)}</td>
                  <td className="lbl">Duration</td>
                  <td>{firstOrder.duration_months} months</td>
                </tr>
                <tr>
                  <td className="lbl">Inst Rev</td>
                  <td>{(firstOrder.installments || []).filter(i => i.status === 'paid').length}</td>
                  <td className="lbl">Inst Rem</td>
                  <td>{(firstOrder.installments || []).filter(i => i.status !== 'paid').length}</td>
                  <td className="lbl">Status</td>
                  <td style={{ textTransform: 'capitalize' }}>{firstOrder.status}</td>
                </tr>
                {firstOrder.accessories && (
                  <tr>
                    <td className="lbl">Accessories</td>
                    <td colSpan={5}>{blank(firstOrder.accessories)}</td>
                  </tr>
                )}
              </>
            ) : (
              <tr><td colSpan={6} className="muted text-center">No product / order on file</td></tr>
            )}
          </tbody>
        </table>

        {/* ---- Section 3: Guarantor Details (one row per guarantor) ---- */}
        <table className="mb-3">
          <tbody>
            <tr><td colSpan={10} className="sec-title">Guarantor Details</td></tr>
            <tr className="col-head">
              <th style={{ width: '9%' }}>Guarantor</th>
              <th>Name</th>
              <th>F/H Name</th>
              <th>Office Ph #</th>
              <th>Mobile</th>
              <th>NIC #</th>
              <th>Rest. Addr.</th>
              <th>Office Addr.</th>
              <th>Occupation</th>
              <th>Relation</th>
            </tr>
            {guarantors.map((g, idx) => (
              <tr key={idx} className="zebra">
                <td className="gtag">#{idx + 1}</td>
                <td>{blank(g?.name)}</td>
                <td>{blank(g?.father_name)}</td>
                <td>{blank(g?.phone_1)}</td>
                <td>{blank(g?.phone_2)}</td>
                <td>{blank(g?.cnic)}</td>
                <td>{blank(g?.home_address)}</td>
                <td>{blank(g?.official_address)}</td>
                <td>{blank(g?.occupation)}</td>
                <td>{blank(g?.relation)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ---- Section 4: Payment Schedule ---- */}
        <table>
          <tbody>
            <tr><td colSpan={11} className="sec-title">Payment Schedule</td></tr>
            <tr className="col-head">
              <th style={{ width: '4%' }}>S.#</th>
              <th>Date</th>
              <th>Rcpt #</th>
              <th>Pre-Bal</th>
              <th>Install.</th>
              <th>Disc</th>
              <th>Balance</th>
              <th>Fine</th>
              <th>Status</th>
              <th>Recovery Officer</th>
              <th>Remarks</th>
            </tr>
            {installments.map((i, idx) => (
              <tr key={i.id} className="zebra">
                <td>{idx + 1}</td>
                <td>{dayjs(i.due_date).format('DD/MM/YYYY')}</td>
                <td>{blank(i.receipt_no)}</td>
                <td>{fmt(i.pre_balance)}</td>
                <td>{fmt(i.amount_due)}</td>
                <td>{fmt(i.discount)}</td>
                <td>{fmt(i.balance)}</td>
                <td>{fmt(i.fine)}</td>
                <td>{i.status === 'paid' ? 'Paid' : 'Pending'}</td>
                <td>{blank(i.recovery_officer)}</td>
                <td>{blank(i.remarks)}</td>
              </tr>
            ))}
            {installments.length === 0 && <tr><td colSpan={11} className="muted text-center">No installments</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
