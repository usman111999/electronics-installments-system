// Small circular customer avatar with an initial fallback when no picture is set.
export default function Avatar({ src, name = '', size = 40, className = '' }) {
  const dim = { width: size, height: size };
  if (src) {
    return (
      <img src={src} alt={name} style={dim}
        className={`rounded-full object-cover shrink-0 bg-slate-100 ${className}`} />
    );
  }
  return (
    <div style={{ ...dim, fontSize: size * 0.4 }}
      className={`rounded-full bg-slate-200 text-slate-500 flex items-center justify-center font-medium shrink-0 ${className}`}>
      {(name || '?').trim().charAt(0).toUpperCase()}
    </div>
  );
}
