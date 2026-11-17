import { useEffect, useId, useState } from 'react';
import { api } from '../api/client';

// Customer categories shown on the outstanding report. Stored in
// customers.employee_status (an existing column that nothing else uses).
export const CUSTOMER_CATEGORIES = ['Self Employee Deposit', 'Floor Customer Deposit'];

export function CategorySelect({ value, onChange, className = 'input' }) {
  const options = value && !CUSTOMER_CATEGORIES.includes(value) ? [...CUSTOMER_CATEGORIES, value] : CUSTOMER_CATEGORIES;
  return (
    <select className={className} value={value || ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">— select —</option>
      {options.map(c => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

// Free-text recovery-officer field that suggests names already in use, and
// snaps a differently-cased entry ("naveed ali") to the existing spelling, so
// one officer isn't split across groups in the officer-wise report.
export default function RecoveryOfficerInput({ value, onChange, className = 'input' }) {
  const listId = useId();
  const [names, setNames] = useState([]);

  useEffect(() => {
    let alive = true;
    api.get('/orders/officers')
      .then(r => { if (alive) setNames(Array.isArray(r.data) ? r.data : []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const tidy = (v) => {
    const t = (v || '').trim().replace(/\s+/g, ' ');
    return names.find(n => n.toLowerCase() === t.toLowerCase()) || t;
  };

  return (
    <>
      <input className={className} list={listId} placeholder="e.g. Naveed Ali"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        onBlur={e => onChange(tidy(e.target.value))} />
      <datalist id={listId}>
        {names.map(n => <option key={n} value={n} />)}
      </datalist>
    </>
  );
}
