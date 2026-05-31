export default function StatCard({ label, value, icon, accent = 'brand', sublabel }) {
  const accents = {
    brand: 'bg-brand-50 text-brand-700',
    green: 'bg-emerald-50 text-emerald-700',
    yellow: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
    blue: 'bg-blue-50 text-blue-700',
    purple: 'bg-violet-50 text-violet-700',
  };
  return (
    <div className="card flex items-center gap-4">
      <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${accents[accent]}`}>
        {icon}
      </div>
      <div>
        <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        {sublabel && <div className="text-xs text-slate-400">{sublabel}</div>}
      </div>
    </div>
  );
}
