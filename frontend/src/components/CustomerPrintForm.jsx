import dayjs from 'dayjs';
import { COMPANY_NAME, LOGO_URL } from '../branding';

const blank = (s) => s || '';
const fmt = (n) => Number(n || 0).toLocaleString();

// A4 printable replica of the supplied "Customer Account Information Detail" form
export default function CustomerPrintForm({ customer }) {
  const orders = customer.orders || [];
  const installments = orders.flatMap(o => (o.installments || []).map(i => ({ ...i, order_no: o.order_no, recovery_officer: i.recovery_officer || o.recovery_officer })));
  installments.sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  const firstOrder = orders[0];
  const g1 = customer.guarantors?.find(g => g.guarantor_number === 1);
  const g2 = customer.guarantors?.find(g => g.guarantor_number === 2);
  const g3 = customer.guarantors?.find(g => g.guarantor_number === 3);

  return (
    <div className="bg-white text-black mx-auto" style={{ maxWidth: '210mm', padding: '8mm', fontSize: '10px', fontFamily: 'Arial, sans-serif' }}>
      <style>{`.printable td, .printable th { border: 1px solid #444; padding: 2px 4px; vertical-align: top; }`}</style>

      <div className="flex items-center justify-center gap-2 mb-2 pb-1" style={{ borderBottom: '2px solid #000' }}>
        <img src={LOGO_URL} alt={COMPANY_NAME} style={{ height: '34px', width: 'auto', background: '#000', padding: '2px', borderRadius: '3px' }} />
        <div className="font-bold" style={{ fontSize: '16px', letterSpacing: '0.5px' }}>{COMPANY_NAME}</div>
      </div>

      <div className="flex justify-between items-start mb-1">
        <div>
          <div><b>Print Date:</b> {dayjs().format('DD-MMM-YYYY')}</div>
          <div><b>Print Time:</b> {dayjs().format('hh:mm:ss A')}</div>
        </div>
        <div className="text-center">
          <div className="font-bold text-lg">{customer.branches?.name || '—'}</div>
          <div className="font-bold underline">Customer Account Information Detail</div>
        </div>
        <div className="text-right">
          <div><b>Print By:</b> System</div>
          <div>Page 1 of 1</div>
        </div>
      </div>

      <table className="printable w-full mb-2">
        <tbody>
          <tr>
            <td style={{ width: '15%' }}><b>Account No.:</b></td>
            <td style={{ width: '25%' }}>{blank(customer.account_no)}</td>
            <td style={{ width: '10%' }}><b>Date:</b></td>
            <td style={{ width: '20%' }}>{firstOrder ? dayjs(firstOrder.order_date).format('DD-MMM-YYYY') : '-'}</td>
            <td style={{ width: '15%' }}><b>FOMS AccNo:</b></td>
            <td style={{ width: '15%' }}>0</td>
          </tr>
          <tr>
            <td><b>Customer:</b></td>
            <td>{blank(customer.customer_name)}</td>
            <td colSpan={2}><b>Repeat As Customer:</b> {orders.length}</td>
            <td colSpan={2}><b>Repeat As Guarantor:</b> -</td>
          </tr>
          <tr>
            <td><b>F/H Name:</b></td>
            <td>{blank(customer.father_husband_name)}</td>
            <td><b>Occupation:</b></td>
            <td>{blank(customer.occupation)}</td>
            <td><b>Gender:</b></td>
            <td>{blank(customer.gender)}</td>
          </tr>
          <tr>
            <td><b>Residential:</b></td>
            <td colSpan={5}>{blank(customer.home_address)}</td>
          </tr>
          <tr>
            <td><b>Off. Address:</b></td>
            <td colSpan={5}>{blank(customer.official_address)}</td>
          </tr>
          <tr>
            <td><b>Mobile 1:</b></td>
            <td>{blank(customer.phone_1)}</td>
            <td><b>Mobile 2:</b></td>
            <td>{blank(customer.phone_2)}</td>
            <td><b>NIC:</b></td>
            <td>{blank(customer.cnic)}</td>
          </tr>
          {firstOrder && (
            <>
              <tr>
                <td><b>Company:</b></td>
                <td>{blank(firstOrder.products?.company)}</td>
                <td><b>Product:</b></td>
                <td>{blank(firstOrder.product_name_snapshot)}</td>
                <td><b>Model:</b></td>
                <td>{blank(firstOrder.product_model_snapshot)}</td>
              </tr>
              <tr>
                <td><b>Serial No:</b></td>
                <td>{blank(firstOrder.product_serial_snapshot)}</td>
                <td><b>Inst Price:</b></td>
                <td>{fmt(firstOrder.installment_amount)}</td>
                <td><b>Total Rev:</b></td>
                <td>{fmt(firstOrder.total_price)}</td>
              </tr>
              {firstOrder.accessories && (
                <tr>
                  <td><b>Accessories:</b></td>
                  <td colSpan={5}>{blank(firstOrder.accessories)}</td>
                </tr>
              )}
              <tr>
                <td><b>Advance:</b></td>
                <td>{fmt(firstOrder.advance_payment)}</td>
                <td><b>Discount:</b></td>
                <td>{fmt(firstOrder.discount)}</td>
                <td><b>Duration:</b></td>
                <td>{firstOrder.duration_months} months</td>
              </tr>
              <tr>
                <td><b>Inst Rev:</b></td>
                <td>{(firstOrder.installments || []).filter(i => i.status === 'paid').length}</td>
                <td><b>Inst Rem:</b></td>
                <td>{(firstOrder.installments || []).filter(i => i.status !== 'paid').length}</td>
                <td><b>Status:</b></td>
                <td>{firstOrder.status}</td>
              </tr>
            </>
          )}
          <tr>
            <td><b>CRC Remarks:</b></td>
            <td colSpan={5}>{blank(customer.crc_remarks)}</td>
          </tr>
        </tbody>
      </table>

      <table className="printable w-full mb-2">
        <thead><tr>
          <th>Criteria</th>
          <th>Guarantor #1</th>
          <th>Guarantor #2</th>
          <th>Guarantor #3</th>
        </tr></thead>
        <tbody>
          <tr><td><b>Name</b></td><td>{blank(g1?.name)}</td><td>{blank(g2?.name)}</td><td>{blank(g3?.name)}</td></tr>
          <tr><td><b>F/H Name</b></td><td>{blank(g1?.father_name)}</td><td>{blank(g2?.father_name)}</td><td>{blank(g3?.father_name)}</td></tr>
          <tr><td><b>Office Ph #</b></td><td>{blank(g1?.phone_1)}</td><td>{blank(g2?.phone_1)}</td><td>{blank(g3?.phone_1)}</td></tr>
          <tr><td><b>Mobile</b></td><td>{blank(g1?.phone_2)}</td><td>{blank(g2?.phone_2)}</td><td>{blank(g3?.phone_2)}</td></tr>
          <tr><td><b>NIC #</b></td><td>{blank(g1?.cnic)}</td><td>{blank(g2?.cnic)}</td><td>{blank(g3?.cnic)}</td></tr>
          <tr><td><b>Rest. Addr.</b></td><td>{blank(g1?.home_address)}</td><td>{blank(g2?.home_address)}</td><td>{blank(g3?.home_address)}</td></tr>
          <tr><td><b>Office Addr.</b></td><td>{blank(g1?.official_address)}</td><td>{blank(g2?.official_address)}</td><td>{blank(g3?.official_address)}</td></tr>
          <tr><td><b>Occupation</b></td><td>{blank(g1?.occupation)}</td><td>{blank(g2?.occupation)}</td><td>{blank(g3?.occupation)}</td></tr>
          <tr><td><b>Relation</b></td><td>{blank(g1?.relation)}</td><td>{blank(g2?.relation)}</td><td>{blank(g3?.relation)}</td></tr>
        </tbody>
      </table>

      <table className="printable w-full">
        <thead><tr>
          <th>S.#</th><th>Date</th><th>Rcpt #</th><th>Pre-Bal</th><th>Install.</th>
          <th>Disc</th><th>Balance</th><th>Fine</th><th>F-Type</th><th>Recovery Officer</th><th>Remarks</th>
        </tr></thead>
        <tbody>
          {installments.map((i, idx) => (
            <tr key={i.id}>
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
          {installments.length === 0 && <tr><td colSpan={11} className="text-center">No installments</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
