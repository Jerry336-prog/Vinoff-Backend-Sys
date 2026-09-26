import cloudinary from "../config/cloudinary.js";
import { Readable } from "stream";

const isPdfUpload = (options = {}) => {
  const mime = String(options.mimetype || options.mimeType || "").toLowerCase();
  const filename = String(options.filename || options.originalname || "").toLowerCase();
  const format = String(options.format || "").toLowerCase();
  return mime === "application/pdf" || format === "pdf" || filename.endsWith(".pdf");
};

/**
 * Uploads a file buffer to Cloudinary
 * @param {Buffer} buffer
 * @param {string} folder
 * @param {object} options
 * @returns {Promise<{ url: string, publicId: string, resourceType: string }>}
 */
export const uploadBuffer = (buffer, folder = "vinoff_uploads", options = {}) => {
  const { mimetype, mimeType, filename, originalname, ...cloudinaryOptions } = options;
  const pdf = isPdfUpload({ mimetype, mimeType, filename, originalname, format: cloudinaryOptions.format });

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: pdf ? "raw" : "auto",
        ...(pdf ? { format: "pdf" } : {}),
        ...cloudinaryOptions,
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }
        resolve({
          url: result.secure_url || result.url,
          publicId: result.public_id,
          resourceType: result.resource_type || (pdf ? "raw" : "image"),
        });
      }
    );

    const readable = new Readable();
    readable._read = () => {};
    readable.push(buffer);
    readable.push(null);
    readable.pipe(uploadStream);
  });
};

export const parseCloudinaryUrl = (fileUrl) => {
  try {
    const parsed = new URL(String(fileUrl || ""));
    if (!parsed.hostname.includes("cloudinary.com")) return null;

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 4) return null;

    const resourceType = parts[1];
    const deliveryType = parts[2];
    let rest = parts.slice(3);
    const versionIndex = rest.findIndex((part) => /^v\d+$/.test(part));
    if (versionIndex >= 0) {
      rest = rest.slice(versionIndex + 1);
    } else {
      const fileIndex = rest.findIndex((part) => part.includes("."));
      if (fileIndex >= 0) rest = rest.slice(fileIndex);
    }

    const last = rest.join("/");
    if (!last) return null;
    const dot = last.lastIndexOf(".");
    const format = dot >= 0 ? last.slice(dot + 1) : "";
    const publicId = dot >= 0 ? last.slice(0, dot) : last;

    return { resourceType, deliveryType, publicId, format };
  } catch {
    return null;
  }
};

export const stripCloudinaryTransforms = (fileUrl) => {
  return String(fileUrl || "").replace("/upload/fl_attachment/", "/upload/");
};

const httpGetBuffer = async (url, redirects = 0) => {
  const response = await fetch(url, { redirect: "manual" });
  const location = response.headers.get("location");
  if ([301, 302, 303, 307, 308].includes(response.status) && location && redirects < 5) {
    return httpGetBuffer(location, redirects + 1);
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

/**
 * Downloads an asset through Cloudinary's signed API so PDF delivery
 * is not blocked by public CDN 401s (free-plan PDF restrictions / unsigned transforms).
 */
export const downloadAssetBuffer = async (fileUrl) => {
  const originalUrl = stripCloudinaryTransforms(fileUrl);
  const parsed = parseCloudinaryUrl(originalUrl);

  try {
    const publicBuffer = await httpGetBuffer(originalUrl);
    if (publicBuffer?.length) return publicBuffer;
  } catch {
    // Fall through to authenticated Cloudinary download.
  }

  if (!parsed?.publicId) {
    throw new Error("Unable to parse Cloudinary attachment URL");
  }

  const resourceTypes = [...new Set([parsed.resourceType, "raw", "image"].filter(Boolean))];
  const publicIds = [...new Set([
    parsed.publicId,
    parsed.format ? `${parsed.publicId}.${parsed.format}` : null,
  ].filter(Boolean))];
  const format = parsed.format || "pdf";

  let lastError = null;
  for (const resourceType of resourceTypes) {
    for (const publicId of publicIds) {
      try {
        const signedUrl = cloudinary.utils.private_download_url(publicId, format, {
          resource_type: resourceType,
          type: parsed.deliveryType || "upload",
          attachment: true,
        });
        const buffer = await httpGetBuffer(signedUrl);
        if (buffer?.length) return buffer;
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw lastError || new Error("Unable to retrieve file from Cloudinary");
};

/**
 * Deletes a file from Cloudinary by public ID
 * @param {string} publicId
 * @param {string} resourceType
 */
export const deleteResource = async (publicId, resourceType = "image") => {
  if (!publicId) return null;
  try {
    return await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (error) {
    console.error(`[Cloudinary Delete Error] Failed to delete ${publicId}:`, error.message);
    return null;
  }
};

export default {
  uploadBuffer,
  deleteResource,
  parseCloudinaryUrl,
  stripCloudinaryTransforms,
  downloadAssetBuffer,
};
