/**
 * Image Upload Cloud Functions
 * Handles secure, validated image uploads for profile photos
 *
 * Security features:
 * - User must be authenticated
 * - File type validation (JPEG, PNG only)
 * - File size validation (max 10MB)
 * - Image dimension validation
 * - OpenAI content moderation (NSFW detection)
 * - OpenAI Vision person detection (ensures photos contain real people)
 * - Duplicate image detection (content hash)
 * - Rate limiting (optional)
 */
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {defineSecret} from "firebase-functions/params";
import {bucket, db} from "../config/firebase";
import * as logger from "firebase-functions/logger";
import sharp from "sharp";
import * as crypto from "crypto";
import {moderateImage, detectPerson} from "../services/openai.service";

// Define the OpenAI API key as a secret
const openaiApiKey = defineSecret("OPENAI_API_KEY");

// Constants for validation
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/jpg"];
const MAX_DIMENSION = 4096; // Max width or height
const MIN_DIMENSION = 100; // Min width or height

// Image optimization settings
const OPTIMIZED_MAX_WIDTH = 1200; // Max width for web-ready images
const OPTIMIZED_MAX_HEIGHT = 1600; // Max height for web-ready images
const JPEG_QUALITY = 85; // Quality for JPEG compression (0-100)
const PNG_COMPRESSION = 8; // PNG compression level (0-9)

// Subscription tier type
type SubscriptionTier = "free" | "plus" | "elite";

/**
 * Get max photos allowed based on subscription tier
 */
function getMaxPhotosForTier(tier: SubscriptionTier): number {
  switch (tier) {
  case "elite":
    return 20;
  case "plus":
    return 6;
  case "free":
  default:
    return 3;
  }
}

/**
 * Compute SHA-256 hash of image buffer for duplicate detection
 */
function computeImageHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Check if an image with the given hash already exists for the user
 * Returns the URL of the duplicate if found, null otherwise
 */
async function checkForDuplicateImage(
  userId: string,
  imageHash: string,
  folder: string
): Promise<string | null> {
  try {
    // List all files in the user's folder
    const prefix = `users/${userId}/${folder}/`;
    const [files] = await bucket.getFiles({prefix});

    // Check metadata of each file for matching hash
    for (const file of files) {
      const [metadata] = await file.getMetadata();
      const storedHash = metadata.metadata?.imageHash;

      if (storedHash === imageHash) {
        // Found a duplicate - return its URL
        const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
        if (emulatorHost) {
          const encodedPath = encodeURIComponent(file.name);
          return `http://${emulatorHost}/v0/b/${bucket.name}/o/${encodedPath}?alt=media`;
        } else {
          return `https://storage.googleapis.com/${bucket.name}/${file.name}`;
        }
      }
    }

    return null;
  } catch (error) {
    logger.warn("Error checking for duplicate images:", error);
    // Don't block upload if duplicate check fails
    return null;
  }
}

interface ImageInput {
  imageData: string; // Base64 encoded image data
  mimeType: string;
  fileName?: string;
}

interface UploadImageRequest {
  imageData: string; // Base64 encoded image data (single image - backwards compatible)
  mimeType: string;
  fileName?: string;
  folder?: string; // 'photos' | 'verification' etc.
}

interface UploadImagesRequest {
  images: ImageInput[]; // Multiple images
  folder?: string; // 'photos' | 'verification' etc.
}

interface ImageResult {
  success: boolean;
  url?: string;
  error?: string;
  fileName?: string;
}

interface UploadImageResponse {
  success: boolean;
  url?: string;
  error?: string;
}

interface UploadImagesResponse {
  success: boolean;
  results: ImageResult[];
  successCount: number;
  failureCount: number;
}

/**
 * Validate that the data is a valid base64 image
 */
function validateBase64Image(
  base64Data: string,
  mimeType: string
): { valid: boolean; error?: string; buffer?: Buffer } {
  // Remove data URL prefix if present
  const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, "");

  // Decode base64
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Clean, "base64");
  } catch {
    return {valid: false, error: "Invalid base64 encoding"};
  }

  // Check file size
  if (buffer.length > MAX_FILE_SIZE) {
    return {
      valid: false,
      error: `File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`,
    };
  }

  // Check MIME type
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}`,
    };
  }

  // Validate image magic bytes (file signature)
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47;

  if (!isJpeg && !isPng) {
    return {valid: false, error: "File content does not match a valid image format"};
  }

  // Verify MIME type matches actual content
  if ((mimeType === "image/jpeg" || mimeType === "image/jpg") && !isJpeg) {
    return {valid: false, error: "MIME type does not match file content"};
  }
  if (mimeType === "image/png" && !isPng) {
    return {valid: false, error: "MIME type does not match file content"};
  }

  return {valid: true, buffer};
}

/**
 * Extract image dimensions from buffer (basic implementation)
 * For JPEG and PNG
 */
function getImageDimensions(
  buffer: Buffer,
  mimeType: string
): { width: number; height: number } | null {
  try {
    if (mimeType === "image/png") {
      // PNG: dimensions are at bytes 16-23
      if (buffer.length < 24) return null;
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return {width, height};
    } else if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
      // JPEG: need to parse segments to find SOF marker
      let offset = 2; // Skip SOI marker
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) break;

        const marker = buffer[offset + 1];
        const length = buffer.readUInt16BE(offset + 2);

        // SOF0, SOF1, SOF2 markers contain dimensions
        if (marker >= 0xc0 && marker <= 0xc3) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return {width, height};
        }

        offset += 2 + length;
      }
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Optimize image for web delivery
 * - Resize to max dimensions while maintaining aspect ratio
 * - Compress with quality settings
 * - Convert to JPEG for smaller file size (unless PNG with transparency)
 */
async function optimizeImage(
  buffer: Buffer,
  mimeType: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  try {
    const image = sharp(buffer);
    const metadata = await image.metadata();

    // Check if PNG has alpha channel (transparency)
    const hasAlpha = metadata.hasAlpha && mimeType === "image/png";

    // Resize if larger than max dimensions
    const needsResize =
      (metadata.width && metadata.width > OPTIMIZED_MAX_WIDTH) ||
      (metadata.height && metadata.height > OPTIMIZED_MAX_HEIGHT);

    let pipeline = image;

    if (needsResize) {
      pipeline = pipeline.resize(OPTIMIZED_MAX_WIDTH, OPTIMIZED_MAX_HEIGHT, {
        fit: "inside", // Maintain aspect ratio, fit within bounds
        withoutEnlargement: true, // Don't upscale smaller images
      });
    }

    // Rotate based on EXIF orientation and strip metadata
    pipeline = pipeline.rotate(); // Auto-rotate based on EXIF

    let outputBuffer: Buffer;
    let outputMimeType: string;

    if (hasAlpha) {
      // Keep as PNG if it has transparency
      outputBuffer = await pipeline
        .png({compressionLevel: PNG_COMPRESSION})
        .toBuffer();
      outputMimeType = "image/png";
    } else {
      // Convert to JPEG for smaller file size
      outputBuffer = await pipeline
        .jpeg({quality: JPEG_QUALITY, mozjpeg: true})
        .toBuffer();
      outputMimeType = "image/jpeg";
    }

    const originalSize = buffer.length;
    const optimizedSize = outputBuffer.length;
    const savings = ((originalSize - optimizedSize) / originalSize * 100).toFixed(1);

    logger.info("Image optimized", {
      originalSize: `${(originalSize / 1024).toFixed(1)}KB`,
      optimizedSize: `${(optimizedSize / 1024).toFixed(1)}KB`,
      savings: `${savings}%`,
      originalDimensions: `${metadata.width}x${metadata.height}`,
      needsResize,
      outputFormat: outputMimeType,
    });

    return {buffer: outputBuffer, mimeType: outputMimeType};
  } catch (error) {
    logger.error("Error optimizing image:", error);
    // Return original if optimization fails
    return {buffer, mimeType};
  }
}

/**
 * Callable function to upload a profile image
 * This function handles all validation server-side for security
 */
export const uploadProfileImage = onCall<UploadImageRequest, Promise<UploadImageResponse>>(
  {
    region: "us-central1",
    memory: "512MiB", // Increased for image processing
    timeoutSeconds: 120, // Increased for moderation API call
    maxInstances: 20,
    secrets: [openaiApiKey], // Inject the secret
  },
  async (request) => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in to upload images");
    }

    const userId = request.auth.uid;
    const {imageData, mimeType, fileName, folder = "photos"} = request.data;

    // Validate required fields
    if (!imageData || !mimeType) {
      throw new HttpsError("invalid-argument", "Missing required fields: imageData, mimeType");
    }

    // Validate the image data
    const validation = validateBase64Image(imageData, mimeType);
    if (!validation.valid || !validation.buffer) {
      throw new HttpsError("invalid-argument", validation.error || "Invalid image");
    }

    // Check image dimensions
    const dimensions = getImageDimensions(validation.buffer, mimeType);
    if (dimensions) {
      if (dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION) {
        throw new HttpsError(
          "invalid-argument",
          `Image dimensions too large. Maximum: ${MAX_DIMENSION}x${MAX_DIMENSION}px`
        );
      }
      if (dimensions.width < MIN_DIMENSION || dimensions.height < MIN_DIMENSION) {
        throw new HttpsError(
          "invalid-argument",
          `Image dimensions too small. Minimum: ${MIN_DIMENSION}x${MIN_DIMENSION}px`
        );
      }
    }

    // Check for duplicate image (before expensive moderation)
    const imageHash = computeImageHash(validation.buffer);
    const duplicateUrl = await checkForDuplicateImage(userId, imageHash, folder);
    if (duplicateUrl) {
      logger.info(`Duplicate image detected for user ${userId}`, {hash: imageHash});
      throw new HttpsError(
        "already-exists",
        "This image has already been uploaded. Please choose a different photo."
      );
    }

    // Check user's photo count based on subscription tier
    const userDoc = await db.collection("users").doc(userId).get();
    const userData = userDoc.data();
    const currentPhotoDetails = userData?.onboarding?.photoDetails || [];
    const subscriptionTier = (userData?.subscription?.tier || "free") as SubscriptionTier;
    const maxPhotos = getMaxPhotosForTier(subscriptionTier);

    if (folder === "photos" && currentPhotoDetails.length >= maxPhotos) {
      throw new HttpsError(
        "resource-exhausted",
        `Maximum of ${maxPhotos} photos allowed for your subscription tier. Please delete a photo or upgrade your subscription.`
      );
    }

    // Content moderation using OpenAI
    const apiKey = openaiApiKey.value();
    if (apiKey) {
      const moderation = await moderateImage(imageData, mimeType, apiKey);

      if (moderation.flagged) {
        logger.warn(`Image rejected for user ${userId} - inappropriate content`, {
          categories: moderation.categories,
        });
        throw new HttpsError(
          "invalid-argument",
          "This image contains content that violates our community guidelines. Please upload a different photo."
        );
      }

      if (moderation.error) {
        // Log the error but don't block the upload
        logger.warn("Moderation check failed, proceeding with upload", {
          error: moderation.error,
          userId,
        });
      }

      // Person detection - ensure the image contains a real person
      if (folder === "photos") {
        const personCheck = await detectPerson(imageData, mimeType, apiKey);

        if (!personCheck.containsPerson && !personCheck.error) {
          logger.warn(`Image rejected for user ${userId} - no person detected`);
          throw new HttpsError(
            "invalid-argument",
            "Profile photos must contain a person. Please upload a photo of yourself."
          );
        }

        if (personCheck.error) {
          logger.warn("Person detection check had an error, proceeding with upload", {
            error: personCheck.error,
            userId,
          });
        }
      }
    } else {
      logger.warn("OpenAI API key not configured, skipping content moderation");
    }

    // Optimize image for web delivery
    const optimized = await optimizeImage(validation.buffer, mimeType);
    const optimizedBuffer = optimized.buffer;
    const optimizedMimeType = optimized.mimeType;

    // Generate unique file path
    const timestamp = Date.now();
    const extension = optimizedMimeType === "image/png" ? "png" : "jpg";
    // Remove existing extension from filename to avoid double extensions
    const baseFileName = fileName?.replace(/\.[^/.]+$/, "") || "image";
    const sanitizedFileName = baseFileName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = `users/${userId}/${folder}/${timestamp}_${sanitizedFileName}.${extension}`;

    try {
      // Upload optimized image to Firebase Storage
      const file = bucket.file(filePath);
      await file.save(optimizedBuffer, {
        metadata: {
          contentType: optimizedMimeType,
          metadata: {
            uploadedBy: userId,
            uploadedAt: new Date().toISOString(),
            originalFileName: fileName || "unknown",
            originalSize: validation.buffer.length.toString(),
            optimizedSize: optimizedBuffer.length.toString(),
            imageHash, // Store hash for duplicate detection
          },
        },
      });

      // Make the file publicly readable
      await file.makePublic();

      // Get the download URL - works with both emulator and production
      let downloadUrl: string;
      const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;

      if (emulatorHost) {
        // Running in emulator - construct emulator URL
        const encodedPath = encodeURIComponent(filePath);
        downloadUrl = `http://${emulatorHost}/v0/b/${bucket.name}/o/${encodedPath}?alt=media`;
      } else {
        // Production - use public URL
        downloadUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
      }

      logger.info(`Image uploaded successfully for user ${userId}`, {
        path: filePath,
        originalSize: `${(validation.buffer.length / 1024).toFixed(1)}KB`,
        optimizedSize: `${(optimizedBuffer.length / 1024).toFixed(1)}KB`,
        dimensions,
        url: downloadUrl,
      });

      return {
        success: true,
        url: downloadUrl,
      };
    } catch (error) {
      logger.error(`Failed to upload image for user ${userId}`, error);
      throw new HttpsError("internal", "Failed to upload image. Please try again.");
    }
  }
);

/**
 * Process a single image - shared logic for single and batch uploads
 */
async function processSingleImage(
  userId: string,
  image: ImageInput,
  folder: string,
  currentPhotoCount: number,
  maxPhotos: number,
  apiKey: string | undefined
): Promise<ImageResult> {
  const {imageData, mimeType, fileName} = image;

  try {
    // Validate the image data
    const validation = validateBase64Image(imageData, mimeType);
    if (!validation.valid || !validation.buffer) {
      return {success: false, error: validation.error || "Invalid image", fileName};
    }

    // Check image dimensions
    const dimensions = getImageDimensions(validation.buffer, mimeType);
    if (dimensions) {
      if (dimensions.width > MAX_DIMENSION || dimensions.height > MAX_DIMENSION) {
        return {
          success: false,
          error: `Image dimensions too large. Maximum: ${MAX_DIMENSION}x${MAX_DIMENSION}px`,
          fileName,
        };
      }
      if (dimensions.width < MIN_DIMENSION || dimensions.height < MIN_DIMENSION) {
        return {
          success: false,
          error: `Image dimensions too small. Minimum: ${MIN_DIMENSION}x${MIN_DIMENSION}px`,
          fileName,
        };
      }
    }

    // Check for duplicate image (before expensive moderation)
    const imageHash = computeImageHash(validation.buffer);
    const duplicateUrl = await checkForDuplicateImage(userId, imageHash, folder);
    if (duplicateUrl) {
      logger.info(`Duplicate image detected for user ${userId}`, {hash: imageHash, fileName});
      return {
        success: false,
        error: "This image has already been uploaded. Please choose a different photo.",
        fileName,
      };
    }

    // Content moderation using OpenAI
    if (apiKey) {
      const moderation = await moderateImage(imageData, mimeType, apiKey);

      if (moderation.flagged) {
        logger.warn(`Image rejected for user ${userId} - inappropriate content`, {
          categories: moderation.categories,
          fileName,
        });
        return {
          success: false,
          error: "This image contains content that violates our community guidelines.",
          fileName,
        };
      }

      // Person detection - ensure the image contains a real person
      if (folder === "photos") {
        const personCheck = await detectPerson(imageData, mimeType, apiKey);

        if (!personCheck.containsPerson && !personCheck.error) {
          logger.warn(`Image rejected for user ${userId} - no person detected`, {fileName});
          return {
            success: false,
            error: "Profile photos must contain a person. Please upload a photo of yourself.",
            fileName,
          };
        }
      }
    }

    // Optimize image for web delivery
    const optimized = await optimizeImage(validation.buffer, mimeType);
    const optimizedBuffer = optimized.buffer;
    const optimizedMimeType = optimized.mimeType;

    // Generate unique file path
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const extension = optimizedMimeType === "image/png" ? "png" : "jpg";
    const baseFileName = fileName?.replace(/\.[^/.]+$/, "") || "image";
    const sanitizedFileName = baseFileName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filePath = `users/${userId}/${folder}/${timestamp}_${randomSuffix}_${sanitizedFileName}.${extension}`;

    // Upload to Firebase Storage
    const file = bucket.file(filePath);
    await file.save(optimizedBuffer, {
      metadata: {
        contentType: optimizedMimeType,
        metadata: {
          uploadedBy: userId,
          uploadedAt: new Date().toISOString(),
          originalFileName: fileName || "unknown",
          originalSize: validation.buffer.length.toString(),
          optimizedSize: optimizedBuffer.length.toString(),
          imageHash, // Store hash for duplicate detection
        },
      },
    });

    // Make the file publicly readable
    await file.makePublic();

    // Get the download URL
    let downloadUrl: string;
    const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;

    if (emulatorHost) {
      const encodedPath = encodeURIComponent(filePath);
      downloadUrl = `http://${emulatorHost}/v0/b/${bucket.name}/o/${encodedPath}?alt=media`;
    } else {
      downloadUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
    }

    logger.info(`Image uploaded successfully for user ${userId}`, {
      path: filePath,
      originalSize: `${(validation.buffer.length / 1024).toFixed(1)}KB`,
      optimizedSize: `${(optimizedBuffer.length / 1024).toFixed(1)}KB`,
      fileName,
    });

    return {success: true, url: downloadUrl, fileName};
  } catch (error) {
    logger.error(`Failed to process image for user ${userId}`, {error, fileName});
    return {success: false, error: "Failed to process image", fileName};
  }
}

/**
 * Callable function to upload multiple profile images at once
 */
export const uploadProfileImages = onCall<UploadImagesRequest, Promise<UploadImagesResponse>>(
  {
    region: "us-central1",
    memory: "1GiB", // More memory for batch processing
    timeoutSeconds: 300, // 5 minutes for multiple images
    maxInstances: 10,
    secrets: [openaiApiKey],
  },
  async (request) => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in to upload images");
    }

    const userId = request.auth.uid;
    const {images, folder = "photos"} = request.data;

    // Validate request
    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new HttpsError("invalid-argument", "No images provided");
    }

    if (images.length > 10) {
      throw new HttpsError("invalid-argument", "Maximum 10 images per upload batch");
    }

    // Check user's current photo count and subscription tier
    const userDoc = await db.collection("users").doc(userId).get();
    const userData = userDoc.data();
    const currentPhotoDetails = userData?.onboarding?.photoDetails || [];
    const subscriptionTier = (userData?.subscription?.tier || "free") as SubscriptionTier;
    const maxPhotos = getMaxPhotosForTier(subscriptionTier);
    const availableSlots = maxPhotos - currentPhotoDetails.length;

    if (folder === "photos" && images.length > availableSlots) {
      throw new HttpsError(
        "resource-exhausted",
        `You can only upload ${availableSlots} more photo(s). Maximum is ${maxPhotos} for your subscription tier.`
      );
    }

    const apiKey = openaiApiKey.value();

    if (!apiKey) {
      logger.warn("OpenAI API key not configured, skipping content moderation");
    }

    // Process images in parallel (with concurrency limit)
    const results: ImageResult[] = [];
    const concurrencyLimit = 3; // Process 3 at a time to avoid overwhelming resources

    for (let i = 0; i < images.length; i += concurrencyLimit) {
      const batch = images.slice(i, i + concurrencyLimit);
      const batchResults = await Promise.all(
        batch.map((image, idx) =>
          processSingleImage(
            userId,
            image,
            folder,
            currentPhotoDetails.length + results.filter((r) => r.success).length + idx,
            maxPhotos,
            apiKey
          )
        )
      );
      results.push(...batchResults);
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.filter((r) => !r.success).length;

    logger.info(`Batch upload completed for user ${userId}`, {
      totalImages: images.length,
      successCount,
      failureCount,
    });

    return {
      success: failureCount === 0,
      results,
      successCount,
      failureCount,
    };
  }
);

/**
 * Extract file path from a storage URL (handles both emulator and production formats)
 */
function extractFilePathFromUrl(imageUrl: string, bucketName: string): string | null {
  // Production format: https://storage.googleapis.com/{bucket}/{filePath}
  const productionPrefix = `https://storage.googleapis.com/${bucketName}/`;
  if (imageUrl.startsWith(productionPrefix)) {
    return imageUrl.replace(productionPrefix, "");
  }

  // Emulator format: http://{host}/v0/b/{bucket}/o/{encodedPath}?alt=media
  const emulatorPattern = new RegExp(`/v0/b/${bucketName}/o/([^?]+)`);
  const emulatorMatch = imageUrl.match(emulatorPattern);
  if (emulatorMatch) {
    // The path is URL-encoded in emulator URLs
    return decodeURIComponent(emulatorMatch[1]);
  }

  return null;
}

/**
 * Callable function to delete a profile image
 */
export const deleteProfileImage = onCall<{ imageUrl: string }, Promise<{ success: boolean }>>(
  {
    region: "us-central1",
    memory: "128MiB",
    timeoutSeconds: 30,
  },
  async (request) => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in to delete images");
    }

    const userId = request.auth.uid;
    const {imageUrl} = request.data;

    if (!imageUrl) {
      throw new HttpsError("invalid-argument", "Missing required field: imageUrl");
    }

    // Extract file path from URL (handles both emulator and production formats)
    const bucketName = bucket.name;
    const filePath = extractFilePathFromUrl(imageUrl, bucketName);

    if (!filePath) {
      throw new HttpsError("permission-denied", "Invalid image URL");
    }

    // Verify the file belongs to this user
    if (!filePath.startsWith(`users/${userId}/`)) {
      throw new HttpsError("permission-denied", "You can only delete your own images");
    }

    try {
      const file = bucket.file(filePath);
      const [exists] = await file.exists();

      if (exists) {
        await file.delete();
        logger.info(`Image deleted for user ${userId}`, {path: filePath});
      }

      return {success: true};
    } catch (error) {
      logger.error(`Failed to delete image for user ${userId}`, error);
      throw new HttpsError("internal", "Failed to delete image. Please try again.");
    }
  }
);
