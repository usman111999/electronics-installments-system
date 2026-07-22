const express = require('express');
const multer = require('multer');
const path = require('path');
const { supabaseAdmin } = require('../config/supabase');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, or WEBP images allowed'));
  },
});

const ALLOWED_BUCKETS = ['customer-pictures', 'product-images', 'branding'];

router.post('/:bucket', requireRole('super_admin', 'admin', 'operator'), upload.single('file'), async (req, res) => {
  const { bucket } = req.params;
  if (!ALLOWED_BUCKETS.includes(bucket)) {
    return res.status(400).json({ error: 'invalid bucket' });
  }
  if (!req.file) return res.status(400).json({ error: 'file is required (multipart/form-data field "file")' });

  // Operators can only upload customer pictures (their branch's customers).
  // Only admins can upload product images.
  if (req.user.role === 'operator' && bucket === 'product-images') {
    return res.status(403).json({ error: 'Only admins can upload product images' });
  }
  // Company logos are branding — only a super_admin (creating/editing companies)
  // or a Company Owner (their own logo) may upload them.
  if (bucket === 'branding' && req.user.role === 'operator') {
    return res.status(403).json({ error: 'Only admins can upload company logos' });
  }

  const ext = (path.extname(req.file.originalname) || '').toLowerCase() || '.jpg';
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  // admin/super_admin have no branch — store under admin/. Operators store under
  // their branch folder.
  const isManager = req.user.role === 'admin' || req.user.role === 'super_admin';
  const objectPath = isManager ? `admin/${safeName}` : `${req.user.branch_id}/${safeName}`;

  const { error: upErr } = await supabaseAdmin.storage
    .from(bucket)
    .upload(objectPath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

  if (upErr) return res.status(500).json({ error: upErr.message });

  const { data: pub } = supabaseAdmin.storage.from(bucket).getPublicUrl(objectPath);

  res.status(201).json({ path: objectPath, url: pub.publicUrl });
});

module.exports = router;
