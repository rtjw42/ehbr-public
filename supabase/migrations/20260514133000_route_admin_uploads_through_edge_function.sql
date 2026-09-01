-- Admin file uploads now go through the upload-admin-file Edge Function.
-- The function validates auth, admin role, MIME signatures, and file size
-- before writing to Storage with the service role. Browser clients should not
-- write directly to these buckets.

DROP POLICY IF EXISTS "Admins can upload event posters" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update event posters" ON storage.objects;

DROP POLICY IF EXISTS "Admins can upload backline documents" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update backline documents" ON storage.objects;
