import { v2 as cloudinary } from 'cloudinary';

// ============================================
// Cloudinary Configuration
// ============================================
// SECURITY: No hardcoded fallbacks - all values must come from environment variables
// This ensures credentials are never exposed in the codebase

let isConfigured = false;

/**
 * Ensure Cloudinary is configured with credentials from environment variables
 * This function is called lazily to ensure env vars are loaded first
 */
function ensureConfigured(): void {
  if (isConfigured) {
    return; // Already configured
  }

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  // Validate that all required Cloudinary credentials are present
  if (!cloudName || !apiKey || !apiSecret) {
    console.warn('⚠️ Cloudinary configuration incomplete. File uploads will not work.');
    console.warn('Missing:', {
      CLOUDINARY_CLOUD_NAME: !cloudName ? '❌' : '✓',
      CLOUDINARY_API_KEY: !apiKey ? '❌' : '✓',
      CLOUDINARY_API_SECRET: !apiSecret ? '❌' : '✓',
    });
    return;
  }

  // Configure Cloudinary
  try {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
    isConfigured = true;
    console.log('✅ Cloudinary SDK configured successfully');
    console.log('   - Cloud Name:', cloudName);
    console.log('   - API Key:', apiKey ? '✓ Set' : '✗ Missing');
    console.log('   - API Secret:', apiSecret ? '✓ Set' : '✗ Missing');
  } catch (configError) {
    console.error('❌ Failed to configure Cloudinary:', configError);
  }
}

// Wrap the uploader methods to ensure configuration before use
const originalUploadStream = cloudinary.uploader.upload_stream.bind(cloudinary.uploader);
const originalDestroy = cloudinary.uploader.destroy.bind(cloudinary.uploader);

(cloudinary.uploader as any).upload_stream = function(options: any, callback: any) {
  ensureConfigured();
  return originalUploadStream(options, callback);
};

(cloudinary.uploader as any).destroy = async function(publicId: string, options?: any) {
  ensureConfigured();
  return originalDestroy(publicId, options);
};

// Export the cloudinary instance directly (compatible with CloudinaryStorage)
export default cloudinary;
