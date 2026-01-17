/**
 * Stripe Payment Cloud Functions
 * Handles payment intents for various paid features
 */
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {db} from "../config/firebase";
import {FieldValue} from "firebase-admin/firestore";
import Stripe from "stripe";

// Initialize Stripe with secret key from environment
// In production, set this via: firebase functions:secrets:set STRIPE_SECRET_KEY
const getStripe = (): Stripe => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Stripe secret key not configured");
  }
  return new Stripe(secretKey, {
    apiVersion: "2025-12-15.clover",
  });
};

// Price configuration (in cents)
const PRICES = {
  identity_verification: 499, // $4.99
};

/**
 * Create a payment intent for a specific product/service
 */
export const createPaymentIntent = onCall(
  {
    region: "us-central1",
    secrets: ["STRIPE_SECRET_KEY"],
  },
  async (request) => {
    // Verify user is authenticated
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const {type} = request.data as { type: keyof typeof PRICES };
    const userId = request.auth.uid;

    // Validate payment type
    if (!type || !PRICES[type]) {
      throw new HttpsError("invalid-argument", "Invalid payment type");
    }

    const amount = PRICES[type];

    try {
      const stripe = getStripe();

      // Get user's email for the payment receipt
      const userDoc = await db.collection("users").doc(userId).get();
      const userData = userDoc.data();
      const email = userData?.email || request.auth.token.email;

      // Create the payment intent
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: "usd",
        metadata: {
          userId,
          type,
          createdAt: new Date().toISOString(),
        },
        receipt_email: email,
        description: getPaymentDescription(type),
      });

      // Log the payment intent creation
      await db.collection("users").doc(userId).collection("payments").add({
        paymentIntentId: paymentIntent.id,
        type,
        amount,
        currency: "usd",
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
      });

      console.log(`Created payment intent ${paymentIntent.id} for user ${userId}, type: ${type}`);

      return {
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
      };
    } catch (error) {
      console.error("Error creating payment intent:", error);
      if (error instanceof Error && error.message === "Stripe secret key not configured") {
        throw new HttpsError("failed-precondition", "Payment system not configured");
      }
      throw new HttpsError("internal", "Failed to create payment intent");
    }
  }
);

/**
 * Confirm a payment was successful (called after client-side confirmation)
 * This is a backup verification - primary verification should be via webhooks
 */
export const confirmPayment = onCall(
  {
    region: "us-central1",
    secrets: ["STRIPE_SECRET_KEY"],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const {paymentIntentId, type} = request.data as {
      paymentIntentId: string;
      type: keyof typeof PRICES;
    };
    const userId = request.auth.uid;

    if (!paymentIntentId) {
      throw new HttpsError("invalid-argument", "Payment intent ID required");
    }

    try {
      const stripe = getStripe();

      // Verify the payment intent
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

      // Verify the payment belongs to this user
      if (paymentIntent.metadata.userId !== userId) {
        throw new HttpsError("permission-denied", "Payment does not belong to this user");
      }

      // Verify payment was successful
      if (paymentIntent.status !== "succeeded") {
        throw new HttpsError("failed-precondition", "Payment was not successful");
      }

      // Update the payment record
      const paymentsRef = db.collection("users").doc(userId).collection("payments");
      const paymentQuery = await paymentsRef
        .where("paymentIntentId", "==", paymentIntentId)
        .limit(1)
        .get();

      if (!paymentQuery.empty) {
        await paymentQuery.docs[0].ref.update({
          status: "succeeded",
          confirmedAt: FieldValue.serverTimestamp(),
        });
      }

      // Grant the purchased feature
      await grantPurchasedFeature(userId, type || paymentIntent.metadata.type as keyof typeof PRICES);

      console.log(`Payment ${paymentIntentId} confirmed for user ${userId}`);

      return {success: true};
    } catch (error) {
      console.error("Error confirming payment:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Failed to confirm payment");
    }
  }
);

/**
 * Grant the purchased feature to the user
 */
async function grantPurchasedFeature(userId: string, type: keyof typeof PRICES): Promise<void> {
  switch (type) {
  case "identity_verification":
    // Mark that user has paid for verification
    // The actual verification will be done via Veriff
    await db.collection("users").doc(userId).update({
      identityVerificationPaid: true,
      identityVerificationPaidAt: FieldValue.serverTimestamp(),
    });
    break;
  default:
    console.warn(`Unknown purchase type: ${type}`);
  }
}

/**
 * Get a human-readable description for the payment
 */
function getPaymentDescription(type: keyof typeof PRICES): string {
  switch (type) {
  case "identity_verification":
    return "Gylde Identity Verification";
  default:
    return "Gylde Purchase";
  }
}
