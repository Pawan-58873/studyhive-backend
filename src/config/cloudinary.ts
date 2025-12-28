import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dtmqrvz0d',
  api_key: process.env.CLOUDINARY_API_KEY || '219129781192414',
  api_secret: process.env.CLOUDINARY_API_SECRET || '0Q8EWwpV1E7xA2L4TNkavQyIidg',
  secure: true,
});

export default cloudinary;
