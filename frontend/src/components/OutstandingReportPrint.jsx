import dayjs from 'dayjs';
import { num } from '../utils/installmentSummary';

const UNASSIGNED = 'Unassigned';
const d = (v) => (v ? dayjs(v).format('DD-MM-YYYY') : '—');

// Group summary rows by recovery officer (A→Z, unassigned last); inside a group
// accounts are listed oldest sale first, as on the paper report.
function groupByOfficer(rows) {
  const groups = new Map();
  for (const r of rows) {
    const key = r.recovery_officer || UNASSIGNED;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => (a === UNASSIGNED) - (b === UNASSIGNED) || a.localeCompare(b))
    .map(([officer, list]) => ({
      officer,
      list: list.sort((a, b) => String(a.order_date).localeCompare(String(b.order_date))),
      total: list.reduce((s, r) => s + r.due_now, 0),
    }));
}

/**
 * A4 "Outstanding Report (Recovery Officer Wise)": one block per recovery
 * officer with an Individual Total, a Grand Total at the end, and the column
 * order of the paper report the shop already uses.
 */
export default function OutstandingReportPrint({ rows, month, branchLabel, categoryLabel, printedBy, companyName, logoUrl }) {
  const groups = groupByOfficer(rows);
  const grand = groups.reduce((s, g) => s + g.total, 0);
  const now = dayjs();
  let sr = 0;

  return (
    <div className="print-form bg-white mx-auto" style={{ maxWidth: '210mm', padding: '8mm', fontSize: '9px', fontFamily: 'Arial, Helvetica, sans-serif', color: '#111827' }}>
      <style>{`
        @media print {
          @page {
            size: A4 portrait; margin: 8mm 8mm 12mm;
            @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 9px Arial, sans-serif; color: #475569; }
          }
        }
        .orp table { border-collapse: collapse; width: 100%; }
        .orp th, .orp td { border: 1px solid #94a3b8; padding: 3px 4px; vertical-align: middle; line-height: 1.3; }
        .orp thead { display: table-header-group; }
        .orp tr { page-break-inside: avoid; }
        .orp th { background: #e2e8f0; font-weight: 700; font-size: 8.5px; text-align: left; white-space: nowrap; }
        .orp .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .orp .grp td { background: #cbd5e1; font-weight: 700; font-size: 10px; }
        .orp .grand td { background: #1e293b; color: #fff; font-weight: 700; font-size: 10.5px; }
        .orp .muted { color: #64748b; }
      `}</style>

      <div className="orp">
        {/* ---- Header ---- */}
        <div className="flex items-start justify-between gap-3 pb-2 mb-2" style={{ borderBottom: '2px solid #1e293b' }}>
          <div className="flex items-center gap-2" style={{ minWidth: '30%' }}>
            <img src={logoUrl} alt={companyName} style={{ height: '46px', width: '46px', objectFit: 'contain' }} />
            <div className="font-bold" style={{ fontSize: '15px', lineHeight: 1.1 }}>{companyName}</div>
          </div>
          <div className="text-center flex-1">
            <div className="font-bold" style={{ fontSize: '15px' }}>Outstanding Report (Recovery Officer Wise)</div>
            <div className="font-semibold" style={{ fontSize: '11px', marginTop: '2px' }}>{branchLabel}</div>
            <div style={{ fontSize: '10px', marginTop: '2px' }}>
              Outstand Month : <b>{month.format('MMM-YYYY')}</b>&nbsp;&nbsp;&nbsp;Category : <b>{categoryLabel}</b>
            </div>
          </div>
          <div className="text-right" style={{ minWidth: '22%', fontSize: '9.5px', lineHeight: 1.6 }}>
            <div>Print Date : <b>{now.format('DD-MMM-YYYY')}</b></div>
            <div>Print Time : <b>{now.format('hh:mm:ss A')}</b></div>
            <div>Print By : <b>{printedBy || '—'}</b></div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style={{ width: '3%' }}>Sr</th>
              <th>Acc #</th>
              <th>Sale Date</th>
              <th>Customer / Phone</th>
              <th>Last Paid</th>
              <th>Category</th>
              <th className="num">Total Amount</th>
              <th className="num">Inst.</th>
              <th className="num">Balance</th>
              <th className="num">Monthly</th>
              <th className="num">Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(g => [
              <tr key={`g-${g.officer}`} className="grp">
                <td colSpan={7}>{g.officer} <span style={{ fontWeight: 400 }}>· {g.list.length} account{g.list.length === 1 ? '' : 's'}</span></td>
                <td colSpan={4} className="num">Individual Total : {num(g.total)}</td>
              </tr>,
              ...g.list.map(r => {
                sr += 1;
                return (
                  <tr key={r.order_id}>
                    <td>{sr}</td>
                    <td>{r.account_no || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{d(r.order_date)}</td>
                    <td><div className="font-semibold">{r.customer_name}</div><div>{r.phone_1 || ''}</div></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{d(r.last_paid_date)}</td>
                    <td>{r.category || <span className="muted">—</span>}</td>
                    <td className="num">{num(r.financed)}</td>
                    <td className="num">{r.planned}</td>
                    <td className="num">{num(r.remaining)}</td>
                    <td className="num">{num(r.monthly)}</td>
                    <td className="num font-semibold">{num(r.due_now)}</td>
                  </tr>
                );
              }),
            ])}
            {rows.length === 0 && (
              <tr><td colSpan={11} className="muted" style={{ textAlign: 'center', padding: '16px' }}>Nothing outstanding for {month.format('MMM-YYYY')}.</td></tr>
            )}
            {rows.length > 0 && (
              <tr className="grand">
                <td colSpan={7}>Grand Total · {rows.length} account{rows.length === 1 ? '' : 's'}</td>
                <td colSpan={4} className="num">{num(grand)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
