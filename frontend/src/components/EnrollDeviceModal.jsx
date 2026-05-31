import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import dayjs from 'dayjs';
import { api } from '../api/client';
import Modal from './Modal';

// Shows the enrollment QR code + bilingual instructions. Polls the order every
// 5 seconds and closes when device_imei lands on the order (meaning the phone
// successfully called /api/devices/enroll).
export default function EnrollDeviceModal({ open, onClose, orderId, onEnrolled }) {
  const [enrollment, setEnrollment] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);

  useEffect(() => {
    if (!open || !orderId) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError('');
      try {
        const { data } = await api.post('/devices/enrollment-tokens', { order_id: orderId });
        if (!cancelled) setEnrollment(data);
      } catch (e) {
        if (!cancelled) setError(e?.response?.data?.error || 'Failed to generate enrollment token');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [open, orderId]);

  useEffect(() => {
    if (!open || !enrollment) return;
    // Poll until the order has device_imei set
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get(`/orders/${orderId}`);
        if (data.device_imei) {
          clearInterval(pollRef.current); pollRef.current = null;
          onEnrolled && onEnrolled(data);
        }
      } catch {/* ignore */}
    }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open, enrollment, orderId, onEnrolled]);

  const expiresIn = enrollment?.expires_at
    ? Math.max(0, Math.round((new Date(enrollment.expires_at) - Date.now()) / 60000))
    : null;

  return (
    <Modal open={open} onClose={onClose} title="Enroll Device" size="lg">
      {loading && <div className="text-sm text-slate-500 py-8 text-center">Generating enrollment code…</div>}
      {error && <div className="text-sm text-red-700 bg-red-50 px-3 py-2 rounded mb-3">{error}</div>}

      {enrollment && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col items-center">
            <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
              {/* Use the Android-wrapped provisioning payload when present so
                  the Setup Wizard "tap 6 times" flow can install + bind the
                  Device Owner app. Fall back to the inner bundle for older
                  backend builds + for manually-installed APK flows. */}
              <QRCodeSVG
                value={JSON.stringify(enrollment.provisioning_qr || enrollment.qr_payload)}
                size={260}
                level="M"
                includeMargin={false}
              />
            </div>
            <div className="text-xs text-slate-500 mt-3">
              Expires {expiresIn != null ? `in ${expiresIn} min` : '—'}
              {' · '}
              {dayjs(enrollment.expires_at).format('HH:mm')}
            </div>
            {enrollment.provisioning_qr &&
              !enrollment.provisioning_qr['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION'] && (
              <div className="text-xs text-red-700 bg-red-50 px-3 py-2 rounded mt-3 max-w-[260px]">
                ⚠ APK download URL not configured on the server. Setup Wizard cannot fetch the app. Install the APK on the phone manually before scanning, or ask the admin to set ANDROID_APK_DOWNLOAD_URL.
              </div>
            )}
            <div className="text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded mt-3 max-w-[260px]">
              Waiting for device to enroll… This modal will close automatically once the phone reports in.
            </div>
          </div>

          <div className="text-sm text-slate-700">
            <h4 className="font-semibold mb-2">Instructions — English</h4>
            <ol className="list-decimal pl-5 space-y-1 mb-4">
              <li>Factory reset the customer's Android phone.</li>
              <li>On the Welcome screen, tap the screen 6 times to open the QR scanner.</li>
              <li>Scan the QR code on the left.</li>
              <li>Approve the installer prompts; the device-owner app installs automatically.</li>
              <li>Wait for the on-screen "Enrollment complete" message (~30s).</li>
            </ol>
            <h4 className="font-semibold mb-2">ہدایات — اردو</h4>
            <ol dir="rtl" className="list-decimal pr-5 space-y-1 text-right">
              <li>فون کو فیکٹری ری سیٹ کریں۔</li>
              <li>ویلکم سکرین پر چھ بار ٹیپ کریں تاکہ QR سکینر کھل جائے۔</li>
              <li>سامنے نظر آنے والا QR سکین کریں۔</li>
              <li>انسٹالر کی اجازت دیں؛ ایپ خود بخود انسٹال ہو جائے گی۔</li>
              <li>"Enrollment complete" پیغام کا انتظار کریں (تقریباً ۳۰ سیکنڈ)۔</li>
            </ol>
          </div>
        </div>
      )}

      <div className="flex justify-end pt-4 mt-4 border-t">
        <button onClick={onClose} className="btn-secondary">Close</button>
      </div>
    </Modal>
  );
}
