/*
# Gift image storage bucket

1. Storage
- New public bucket `gift-images` for gift card room photos.
2. Security
- Public read (guests view the gift card), authenticated users may upload only
  into their own user-named folder.
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('gift-images', 'gift-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "gift_images_public_read" ON storage.objects;
CREATE POLICY "gift_images_public_read" ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'gift-images');

DROP POLICY IF EXISTS "gift_images_auth_upload" ON storage.objects;
CREATE POLICY "gift_images_auth_upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'gift-images' AND (storage.foldername(name))[1] = auth.uid()::text);
