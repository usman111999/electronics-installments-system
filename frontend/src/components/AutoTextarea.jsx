import { useRef, useLayoutEffect } from 'react';

// A textarea that grows with its content so long values (e.g. addresses) are
// never truncated or cramped. Starts at `minRows` and expands as the user types.
export default function AutoTextarea({ value, onChange, minRows = 2, className = '', ...props }) {
  const ref = useRef(null);

  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // Resize on every value change (covers programmatic resets too).
  useLayoutEffect(() => { resize(); }, [value]);

  return (
    <textarea
      ref={ref}
      rows={minRows}
      value={value}
      onChange={onChange}
      onInput={resize}
      className={`input resize-none overflow-hidden leading-relaxed ${className}`}
      {...props}
    />
  );
}
