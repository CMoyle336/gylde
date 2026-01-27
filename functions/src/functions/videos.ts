/**
 * Video Upload Cloud Functions
 * Handles video uploads for conversation messages with thumbnail generation
 *
 * Features:
 * - User must be authenticated
 * - File type validation (MP4, WebM, MOV)
 * - File size validation (max 100MB)
 * - Thumbnail generation using sharp (from first frame)
 * - Video duration extraction
 */
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {bucket, db} from "../config/firebase";
import * as logger from "firebase-functions/logger";
import sharp from "sharp";

// Constants for validation
const ALLOWED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime", // MOV
];
const MAX_VIDEO_SIZE_BYTES = 100 * 1024 * 1024; // 100MB
const THUMBNAIL_WIDTH = 320;
const THUMBNAIL_HEIGHT = 180;

interface UploadVideoRequest {
  videoData: string; // Base64 encoded video data
  mimeType: string;
  fileName?: string;
  conversationId: string;
  thumbnailData?: string; // Optional client-generated thumbnail (base64)
}

interface UploadVideoResponse {
  success: boolean;
  videoUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  error?: string;
}

/**
 * Validate that the data is a valid base64 video
 */
function validateBase64Video(
  base64Data: string,
  mimeType: string
): { valid: boolean; error?: string; buffer?: Buffer } {
  // Remove data URL prefix if present
  const base64Clean = base64Data.replace(/^data:video\/\w+;base64,/, "");

  // Decode base64
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Clean, "base64");
  } catch {
    return {valid: false, error: "Invalid base64 encoding"};
  }

  // Check file size
  if (buffer.length > MAX_VIDEO_SIZE_BYTES) {
    return {
      valid: false,
      error: `File size exceeds maximum of ${MAX_VIDEO_SIZE_BYTES / 1024 / 1024}MB`,
    };
  }

  // Check MIME type
  if (!ALLOWED_VIDEO_MIME_TYPES.includes(mimeType)) {
    return {
      valid: false,
      error: `Invalid file type. Allowed types: ${ALLOWED_VIDEO_MIME_TYPES.join(", ")}`,
    };
  }

  // Validate video magic bytes
  const isMP4 = buffer.length >= 8 && (
    // ftyp box (standard MP4)
    (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) ||
    // Some MP4s start with mdat
    (buffer[4] === 0x6D && buffer[5] === 0x64 && buffer[6] === 0x61 && buffer[7] === 0x74) ||
    // MOV also starts with ftyp
    (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70)
  );
  const isWebM = buffer.length >= 4 &&
    buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3;

  if (!isMP4 && !isWebM) {
    return {valid: false, error: "File content does not match a valid video format"};
  }

  return {valid: true, buffer};
}

/**
 * Verify user is a participant in the conversation
 */
async function verifyConversationParticipant(
  userId: string,
  conversationId: string
): Promise<boolean> {
  try {
    const conversationDoc = await db
      .collection("conversations")
      .doc(conversationId)
      .get();

    if (!conversationDoc.exists) {
      return false;
    }

    const data = conversationDoc.data();
    const participants = data?.participants || [];
    return participants.includes(userId);
  } catch (error) {
    logger.error("Error verifying conversation participant:", error);
    return false;
  }
}

/**
 * Generate a thumbnail from client-provided thumbnail data
 * Falls back to a placeholder if no thumbnail is provided
 */
async function processThumbnail(
  thumbnailData: string | undefined,
  videoBuffer: Buffer
): Promise<Buffer> {
  // If client provided a thumbnail, process and optimize it
  if (thumbnailData) {
    try {
      const base64Clean = thumbnailData.replace(/^data:image\/\w+;base64,/, "");
      const thumbnailBuffer = Buffer.from(base64Clean, "base64");

      // Optimize the thumbnail with sharp
      return await sharp(thumbnailBuffer)
        .resize(THUMBNAIL_WIDTH, THUMBNAIL_HEIGHT, {
          fit: "cover",
          position: "center",
        })
        .jpeg({quality: 80})
        .toBuffer();
    } catch (error) {
      logger.warn("Error processing client thumbnail:", error);
      // Fall through to placeholder generation
    }
  }

  // Generate a simple placeholder thumbnail
  // Create a gray rectangle with a play button overlay
  const svg = `
    <svg width="${THUMBNAIL_WIDTH}" height="${THUMBNAIL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#2d2d2d"/>
      <polygon points="130,60 130,120 180,90" fill="#ffffff" opacity="0.8"/>
      <circle cx="160" cy="90" r="40" fill="none" stroke="#ffffff" stroke-width="3" opacity="0.8"/>
    </svg>
  `;

  return await sharp(Buffer.from(svg))
    .jpeg({quality: 80})
    .toBuffer();
}

/**
 * Callable function to upload a video to a conversation
 */
export const uploadConversationVideo = onCall<UploadVideoRequest, Promise<UploadVideoResponse>>(
  {
    region: "us-central1",
    memory: "1GiB", // Large memory for video processing
    timeoutSeconds: 300, // 5 minutes for large files
    maxInstances: 10,
  },
  async (request) => {
    // Verify authentication
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be logged in to upload videos");
    }

    const userId = request.auth.uid;
    const {videoData, mimeType, fileName, conversationId, thumbnailData} = request.data;

    // Validate required fields
    if (!videoData || !mimeType || !conversationId) {
      throw new HttpsError(
        "invalid-argument",
        "Missing required fields: videoData, mimeType, conversationId"
      );
    }

    // Verify user is participant in conversation
    const isParticipant = await verifyConversationParticipant(userId, conversationId);
    if (!isParticipant) {
      throw new HttpsError(
        "permission-denied",
        "You are not a participant in this conversation"
      );
    }

    // Validate the video data
    const validation = validateBase64Video(videoData, mimeType);
    if (!validation.valid || !validation.buffer) {
      throw new HttpsError("invalid-argument", validation.error || "Invalid video");
    }

    const videoBuffer = validation.buffer;

    logger.info(`Processing video upload for user ${userId}`, {
      conversationId,
      size: `${(videoBuffer.length / 1024 / 1024).toFixed(2)}MB`,
      mimeType,
    });

    try {
      // Generate timestamp and file names
      const timestamp = Date.now();
      const baseFileName = fileName?.replace(/\.[^/.]+$/, "") || "video";
      const sanitizedFileName = baseFileName.replace(/[^a-zA-Z0-9_-]/g, "_");

      // Determine extension from MIME type
      let extension = "mp4";
      if (mimeType === "video/webm") extension = "webm";
      else if (mimeType === "video/quicktime") extension = "mov";

      const videoPath = `conversations/${conversationId}/videos/${timestamp}_${sanitizedFileName}.${extension}`;
      const thumbnailPath = `conversations/${conversationId}/video-thumbnails/${timestamp}_${sanitizedFileName}.jpg`;

      // Process thumbnail (from client data or generate placeholder)
      const thumbnailBuffer = await processThumbnail(thumbnailData, videoBuffer);

      // Upload video and thumbnail in parallel
      const videoFile = bucket.file(videoPath);
      const thumbnailFile = bucket.file(thumbnailPath);

      await Promise.all([
        videoFile.save(videoBuffer, {
          metadata: {
            contentType: mimeType,
            metadata: {
              uploadedBy: userId,
              uploadedAt: new Date().toISOString(),
              originalFileName: fileName || "unknown",
              conversationId,
            },
          },
        }),
        thumbnailFile.save(thumbnailBuffer, {
          metadata: {
            contentType: "image/jpeg",
            metadata: {
              uploadedBy: userId,
              uploadedAt: new Date().toISOString(),
              videoPath,
            },
          },
        }),
      ]);

      // Make files publicly readable
      await Promise.all([
        videoFile.makePublic(),
        thumbnailFile.makePublic(),
      ]);

      // Get download URLs
      const emulatorHost = process.env.FIREBASE_STORAGE_EMULATOR_HOST;
      let videoUrl: string;
      let thumbnailUrl: string;

      if (emulatorHost) {
        const encodedVideoPath = encodeURIComponent(videoPath);
        const encodedThumbPath = encodeURIComponent(thumbnailPath);
        videoUrl = `http://${emulatorHost}/v0/b/${bucket.name}/o/${encodedVideoPath}?alt=media`;
        thumbnailUrl = `http://${emulatorHost}/v0/b/${bucket.name}/o/${encodedThumbPath}?alt=media`;
      } else {
        videoUrl = `https://storage.googleapis.com/${bucket.name}/${videoPath}`;
        thumbnailUrl = `https://storage.googleapis.com/${bucket.name}/${thumbnailPath}`;
      }

      logger.info(`Video uploaded successfully for user ${userId}`, {
        videoPath,
        thumbnailPath,
        size: `${(videoBuffer.length / 1024 / 1024).toFixed(2)}MB`,
      });

      return {
        success: true,
        videoUrl,
        thumbnailUrl,
      };
    } catch (error) {
      logger.error(`Failed to upload video for user ${userId}`, error);
      throw new HttpsError("internal", "Failed to upload video. Please try again.");
    }
  }
);
