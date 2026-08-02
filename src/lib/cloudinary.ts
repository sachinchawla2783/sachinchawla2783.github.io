import { v2 as cloudinary } from "cloudinary";

let configured = false;

/**
 * Configures the Cloudinary SDK from env vars on first use. Used by the
 * admin product image upload flow (src/app/admin/products). The storefront
 * itself does not require Cloudinary — mock products render procedural
 * imagery (see components/product/ProductVisual).
 */
export function getCloudinary() {
  if (!configured) {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}
