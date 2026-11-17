import dayjs from 'dayjs';

// Amount still owed on one invoice (never negative).
export function outstandingOf(i) {
  return Math.max(0, Number(i.amount_due || 0) + Number(i.fine || 0) - Number(i.discount || 0) - Number(i.amount_paid || 0));
}

// Worst status wins when an order has several invoices.
const STATUS_RANK = { overdue: 4, partial: 3, pending: 2, paid: 1 };

/**
 * Reduce the flat installments list (GET /installments) into one summary row
 * per order. "Due now" is everything unpaid whose due date falls on or before
 * the end of the current month: last month's arrears plus this month's
 * installment. An invoice paid ahead (advance) is status 'paid', so it never
 * counts as due and that customer drops off the due-this-month list.
 */
export function summarizeOrders(installments, today = dayjs()) {
  const monthEnd = today.endOf('month');
  const byOrder = new Map();

  for (const i of installments || []) {
    const order = i?.orders;
    const customer = order?.customers;
    if (!order?.id) continue;

    let row = byOrder.get(order.id);
    if (!row) {
      const totalPrice = Number(order.total_price || 0);
      const advance = Number(order.advance_payment || 0);
      const discount = Number(order.discount || 0);
      row = {
        order_id: order.id,
        order_no: order.order_no || '',
        order_date: order.order_date || null,
        order_status: order.status || 'active',
        customer_id: customer?.id || null,
        customer_name: customer?.customer_name || '—',
        account_no: customer?.account_no || '',
        phone_1: customer?.phone_1 || '',
        picture_url: customer?.picture_url || '',
        category: customer?.employee_status || '',
        recovery_officer: (order.recovery_officer || '').trim(),
        branch_name: order?.branches?.name || '',
        planned: Number(order.total_installments || 0),
        monthly: Number(order.installment_amount || 0),
        financed: Math.max(0, totalPrice - advance - discount),
        created: 0,
        paid_count: 0,
        pending_count: 0,
        overdue_count: 0,
        partial_count: 0,
        collected: 0,
        due_now: 0,
        due_now_count: 0,
        last_paid_date: null,
        next_due_date: null,
        worst_status: 'paid',
      };
      byOrder.set(order.id, row);
    }

    row.created += 1;
    row.collected += Number(i.amount_paid || 0);

    if (i.status === 'paid') row.paid_count++;
    else if (i.status === 'overdue') row.overdue_count++;
    else if (i.status === 'partial') row.partial_count++;
    else if (i.status === 'pending') row.pending_count++;

    if (Number(i.amount_paid || 0) > 0 && i.payment_date) {
      if (!row.last_paid_date || dayjs(i.payment_date).isAfter(row.last_paid_date)) row.last_paid_date = i.payment_date;
    }

    if (i.status !== 'paid' && i.due_date) {
      if (!row.next_due_date || dayjs(i.due_date).isBefore(row.next_due_date)) row.next_due_date = i.due_date;
      if (!dayjs(i.due_date).isAfter(monthEnd, 'day')) {
        const owed = outstandingOf(i);
        if (owed > 0) { row.due_now += owed; row.due_now_count += 1; }
      }
    }

    if ((STATUS_RANK[i.status] || 0) > (STATUS_RANK[row.worst_status] || 0)) row.worst_status = i.status;
  }

  return Array.from(byOrder.values()).map(r => {
    const planned = r.planned || r.created;
    return {
      ...r,
      planned,
      unpaid_count: Math.max(0, planned - r.paid_count),
      remaining: Math.max(0, r.financed - r.collected),
      fully_paid: planned > 0 && r.paid_count >= planned,
      is_due: r.order_status !== 'cancelled' && r.due_now > 0.009,
    };
  });
}

// Money as plain grouped digits ("222,575"), matching the printed report.
export const num = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');
export const rs = (n) => `Rs. ${num(n)}`;

// How long an unpaid installment is past its due date, in plain months and
// days ("3 months 12 days", "1 month", "5 days"). Empty when it isn't late.
export function lateBy(dueDate, today = dayjs()) {
  if (!dueDate) return '';
  const due = dayjs(dueDate).startOf('day');
  const now = today.startOf('day');
  if (!now.isAfter(due)) return '';
  const months = now.diff(due, 'month');
  const days = now.diff(due.add(months, 'month'), 'day');
  const part = (n, word) => (n > 0 ? `${n} ${word}${n === 1 ? '' : 's'}` : '');
  return [part(months, 'month'), part(days, 'day')].filter(Boolean).join(' ');
}
