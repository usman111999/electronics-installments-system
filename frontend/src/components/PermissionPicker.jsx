import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';

// Plain-language labels so non-technical admins understand each permission at a
// glance. Falls back to the registry description, then the raw id.
const FRIENDLY_LABELS = {
  'activity_logs.view': 'View activity history',
  'activity_logs.global_view': 'View activity for all branches',
  'admins.manage': 'Add or edit admin accounts',
  'admins.view': 'View admin accounts',
  'branches.create': 'Add new branches',
  'branches.delete': 'Delete branches',
  'branches.update': 'Edit branch details',
  'branches.view': 'View branches',
  'customers.manage': 'Add and edit customers',
  'customers.view': 'View customers',
  'devices.enroll': 'Register a phone / issue QR code',
  'devices.global_view': 'View phones in all branches',
  'devices.locate': 'Locate a phone on demand',
  'devices.lock': 'Lock a phone',
  'devices.unlock': 'Unlock a phone',
  'devices.view': 'View registered phones',
  'installments.record_payment': 'Record customer payments',
  'installments.view': 'View installments',
  'inventory.manage': 'Add, edit or remove stock',
  'inventory.view': 'View stock',
  'orders.create': 'Create new orders',
  'orders.update': 'Edit orders',
  'orders.view': 'View orders',
  'products.manage': 'Add, edit or delete products',
  'products.view': 'View products',
  'stats.global_view': 'View reports for all branches',
  'stats.view': 'View reports & dashboard',
  'roles.manage': 'Create or edit custom roles',
  'roles.view': 'View custom roles',
  'users.create': 'Add new users',
  'users.disable': 'Enable or disable users',
  'users.update': 'Edit users & reset passwords',
  'users.view': 'View users',
  'whatsapp.send': 'Send WhatsApp messages',
  'whatsapp.view': 'View WhatsApp message log',
};

const friendlyLabel = (p) => FRIENDLY_LABELS[p.id] || p.description || p.id;

// Module-level cache so we only hit the registry once per session.
let REGISTRY_CACHE = null;
let REGISTRY_PROMISE = null;

async function loadRegistry() {
  if (REGISTRY_CACHE) return REGISTRY_CACHE;
  if (!REGISTRY_PROMISE) {
    REGISTRY_PROMISE = api.get('/roles/permissions/registry')
      .then(({ data }) => {
        // Accept either { permissions: [...] } or a bare array — defensive.
        const list = Array.isArray(data) ? data : (data?.permissions || []);
        REGISTRY_CACHE = list;
        return list;
      })
      .catch(err => { REGISTRY_PROMISE = null; throw err; });
  }
  return REGISTRY_PROMISE;
}

export function clearPermissionRegistryCache() {
  REGISTRY_CACHE = null;
  REGISTRY_PROMISE = null;
}

export default function PermissionPicker({ value, onChange, disabled, filter }) {
  const [registry, setRegistry] = useState(REGISTRY_CACHE || []);
  const [loading, setLoading] = useState(!REGISTRY_CACHE);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    if (REGISTRY_CACHE) { setRegistry(REGISTRY_CACHE); setLoading(false); return; }
    setLoading(true);
    loadRegistry()
      .then(list => { if (alive) { setRegistry(list); setLoading(false); } })
      .catch(e => { if (alive) { setError(e?.response?.data?.error || 'Failed to load permissions'); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  const selectedSet = useMemo(() => new Set(value || []), [value]);

  const grouped = useMemo(() => {
    const map = new Map();
    const filterSet = filter && filter.length ? new Set(filter) : null;
    for (const p of registry) {
      if (filterSet && !filterSet.has(p.id)) continue;
      const cat = p.category || 'Other';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(p);
    }
    return Array.from(map.entries()).map(([category, items]) => ({
      category,
      items: items.slice().sort((a, b) => friendlyLabel(a).localeCompare(friendlyLabel(b))),
    }));
  }, [registry, filter]);

  const toggle = (id) => {
    if (disabled) return;
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(Array.from(next));
  };

  const toggleCategory = (items) => {
    if (disabled) return;
    const ids = items.map(i => i.id);
    const allSelected = ids.every(id => selectedSet.has(id));
    const next = new Set(selectedSet);
    if (allSelected) ids.forEach(id => next.delete(id));
    else ids.forEach(id => next.add(id));
    onChange(Array.from(next));
  };

  if (loading) return <div className="text-sm text-slate-500 py-3">Loading permissions…</div>;
  if (error) return <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded">{error}</div>;
  if (grouped.length === 0) return <div className="text-sm text-slate-400 py-3">No permissions available.</div>;

  const totalSelected = (value || []).length;

  return (
    <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
      <div className="px-3 py-2 bg-slate-50 text-xs text-slate-600 flex items-center justify-between rounded-t-lg">
        <span>{totalSelected} permission{totalSelected === 1 ? '' : 's'} selected</span>
        {!disabled && (
          <button type="button"
            onClick={() => onChange([])}
            className="text-brand-600 hover:underline">
            Clear all
          </button>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto">
        {grouped.map(({ category, items }) => {
          const allSelected = items.every(i => selectedSet.has(i.id));
          const someSelected = !allSelected && items.some(i => selectedSet.has(i.id));
          return (
            <div key={category} className="border-b border-slate-100 last:border-b-0">
              <label className="flex items-center gap-2 px-3 py-2 bg-slate-50/60 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={el => { if (el) el.indeterminate = someSelected; }}
                  onChange={() => toggleCategory(items)}
                  disabled={disabled}
                  className="rounded border-slate-300"
                />
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{category}</span>
                <span className="text-[11px] text-slate-400 ml-auto">
                  {items.filter(i => selectedSet.has(i.id)).length}/{items.length}
                </span>
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4">
                {items.map(p => (
                  <label key={p.id} title={p.id}
                    className="flex items-start gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-slate-300"
                      checked={selectedSet.has(p.id)}
                      onChange={() => toggle(p.id)}
                      disabled={disabled}
                    />
                    <span className="text-sm text-slate-700 leading-snug">{friendlyLabel(p)}</span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
