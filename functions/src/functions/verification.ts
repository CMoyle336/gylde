/**
 * Identity Verification Cloud Functions (Veriff Integration)
 */
import { onRequest } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import * as logger from "firebase-functions/logger";
import * as crypto from "crypto";

// Veriff webhook secret for signature verification
// Set this in Firebase Functions config: firebase functions:secrets:set VERIFF_WEBHOOK_SECRET
const VERIFF_WEBHOOK_SECRET = process.env.VERIFF_WEBHOOK_SECRET || "";

/**
 * Veriff decision webhook
 * 
 * This endpoint receives verification decision events from Veriff.
 * It updates the user's profile with the verification result.
 * 
 * Webhook setup in Veriff Station:
 * 1. Go to Integrations > Webhooks
 * 2. Add new webhook with this URL
 * 3. Select "decision" event type
 * 4. Copy the signing secret and set it as VERIFF_WEBHOOK_SECRET
 */
export const veriffWebhook = onRequest(
  { 
    cors: false,
    secrets: ["VERIFF_WEBHOOK_SECRET"],
  },
  async (req, res) => {
    // Only accept POST requests
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    try {
      const signature = req.headers["x-auth-client"] as string;
      const payload = JSON.stringify(req.body);

      // Verify webhook signature if secret is configured
      if (VERIFF_WEBHOOK_SECRET) {
        const expectedSignature = crypto
          .createHmac("sha256", VERIFF_WEBHOOK_SECRET)
          .update(payload)
          .digest("hex");

        if (signature !== expectedSignature) {
          logger.warn("Invalid Veriff webhook signature");
          res.status(401).send("Unauthorized");
          return;
        }
      } else {
        logger.warn("VERIFF_WEBHOOK_SECRET not configured - skipping signature verification");
      }

      const data = req.body;
      
      // Log the full payload for debugging
      logger.info("Received Veriff webhook payload:", JSON.stringify(data));

      // Extract verification data - handle both flat and nested structures
      // Flat (events): { id, attemptId, action, code, vendorData, status }
      // Nested (decisions): { status: "success", verification: { id, status, code, vendorData } }
      const sessionId = data.verification?.id || data.id;
      // For decisions, verification.status has the actual result (approved/declined)
      // Top-level status is just "success" meaning API call succeeded
      const verificationStatus = data.verification?.status || data.status;
      const action = data.action;
      // Code can be in verification object or top level
      const code = data.verification?.code || data.code;
      const vendorData = data.verification?.vendorData || data.vendorData;

      logger.info("Parsed Veriff data:", { sessionId, verificationStatus, action, code, vendorData });

      if (!sessionId) {
        logger.error("Missing sessionId in Veriff webhook. Payload:", JSON.stringify(data));
        res.status(400).send("Missing sessionId");
        return;
      }

      // Find user by vendor data (uid) or session ID
      let userId: string | null = vendorData || null;

      if (!userId) {
        // Query for user with this session ID
        const usersQuery = await db
          .collection("users")
          .where("identityVerificationSessionId", "==", sessionId)
          .limit(1)
          .get();

        if (!usersQuery.empty) {
          userId = usersQuery.docs[0].id;
        }
      }

      if (!userId) {
        logger.error("Could not find user for verification session:", sessionId);
        res.status(404).send("User not found");
        return;
      }

      // Map Veriff status/code to our status
      // Veriff codes: 9001=approved, 9102=declined, 9103=resubmission, 9104=expired, 9121=abandoned
      // Actions: submitted, started, etc. are intermediate events
      let finalStatus: "approved" | "declined" | "pending";
      let identityVerified = false;

      // Check by code first (more reliable), then by status string
      if (code === 9001 || verificationStatus === "approved") {
        finalStatus = "approved";
        identityVerified = true;
        logger.info(`Verification APPROVED for user ${userId}, session ${sessionId}`);
      } else if (
        code === 9102 || code === 9103 || code === 9104 || code === 9121 ||
        verificationStatus === "declined" || verificationStatus === "resubmission_requested" || 
        verificationStatus === "expired" || verificationStatus === "abandoned"
      ) {
        finalStatus = "declined";
        identityVerified = false;
        logger.info(`Verification DECLINED for user ${userId}, session ${sessionId}`);
      } else if (action === "submitted" || action === "started") {
        // These are intermediate events - user is still in the flow
        finalStatus = "pending";
        identityVerified = false;
        logger.info(`Verification ${action} for user ${userId}, session ${sessionId}`);
      } else {
        finalStatus = "pending";
        identityVerified = false;
      }

      // Update user profile
      await db.collection("users").doc(userId).update({
        identityVerified,
        identityVerificationStatus: finalStatus,
        identityVerificationCompletedAt: new Date(),
      });

      logger.info(`Updated verification status for user ${userId}:`, {
        status: finalStatus,
        verified: identityVerified,
      });

      res.status(200).send("OK");
    } catch (error) {
      logger.error("Error processing Veriff webhook:", error);
      res.status(500).send("Internal Server Error");
    }
  }
);
