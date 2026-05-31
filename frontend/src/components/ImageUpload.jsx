import { useState, useRef } from 'react';
import { api } from '../api/client';

// Uploads to the given bucket via /api/uploads/:bucket and writes the public
// URL back via onChange.
export default function ImageUpload({ value, onChange, bucket = 'customer-pictures', label = 'Picture' }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const inputRef = useRef(null);

  const pick = () => inputRef.current?.click();

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(''); setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post(`/uploads/${bucket}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onChange(data.url);
    } catch (e2) {
      setErr(e2?.response?.data?.error || 'Upload failed');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-3">
        <div className="w-20 h-20 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center text-slate-300">
          {value ? <img src={value} alt="" className="w-full h-full object-cover" />
                 : <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>}
        </div>
        <div className="space-y-1">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={onFile} hidden />
          <button type="button" onClick={pick} disabled={busy} className="btn-secondary !py-1">
            {busy ? 'Uploading…' : value ? 'Replace' : 'Upload Image'}
          </button>
          {value && <button type="button" onClick={() => onChange('')} className="text-xs text-red-600 block">Remove</button>}
          {err && <div className="text-xs text-red-600">{err}</div>}
        </div>
      </div>
    </div>
  );
}
