/**
 * Stripe Subscription Cloud Functions
 * Handles subscription checkout, management, and webhook events
 *
 * Simplified to free/premium model. Price controlled by Remote Config (subscription_monthly_price_cents)
 */
import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {db} from "../config/firebase";
import {FieldValue} from "firebase-admin/firestore";
import Stripe from "stripe";
import {getAppBaseUrl} from "../config/app-url";

// Initialize Stripe
const getStripe = (): Stripe => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Stripe secret key not configured");
  }
  return new Stripe(secretKey, {
    apiVersion: "2025-12-15.clover",
  });
};

// Subscription tier type - simplified to free/premium
type SubscriptionTier = "free" | "premium";

// Price ID for premium subscription
// Set via: firebase functions:secrets:set STRIPE_PRICE_PREMIUM_MONTHLY
const getPriceId = (): string => {
  const priceId = process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
  if (!priceId) {
    throw new Error("Price ID not configured for premium subscription");
  }
  return priceId;
};

/**
 * Create a Stripe Checkout Session for premium subscription
 */
export const createSubscriptionCheckout = onCall(
  {
    region: "us-central1",
    secrets: ["STRIPE_SECRET_KEY", "STRIPE_PRICE_PREMIUM_MONTHLY"],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const {tier} = request.data as { tier: string };
    const userId = request.auth.uid;

    // Validate tier - only accept 'premium'
    if (tier !== "premium") {
      throw new HttpsError("invalid-argument", "Invalid subscription tier");
    }

    try {
      const stripe = getStripe();

      // Get user data
      const userDoc = await db.collection("users").doc(userId).get();
      const userData = userDoc.data();
      const email = request.auth.token.email;

      // Check if user already has a Stripe customer ID
      let customerId = userData?.stripeCustomerId;

      if (!customerId) {
        // Create a new Stripe customer
        const customer = await stripe.customers.create({
          email,
          metadata: {
            firebaseUserId: userId,
          },
        });
        customerId = customer.id;

        // Save customer ID to user profile
        await db.collection("users").doc(userId).update({
          stripeCustomerId: customerId,
        });
      }

      // Get the price ID for premium
      const priceId = getPriceId();

      // Check for existing active subscriptions
      const existingSubscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "active",
        limit: 10,
      });

      // If user has an active subscription, they're already premium
      if (existingSubscriptions.data.length > 0) {
        throw new HttpsError(
          "already-exists",
          "You are already a premium subscriber"
        );
      }

      // Determine success and cancel URLs
      const baseUrl = process.env.FUNCTIONS_EMULATOR ?
        "http://localhost:4200" :
        getAppBaseUrl();

      // Create Checkout Session
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        mode: "subscription",
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/discover?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/discover?subscription=canceled`,
        metadata: {
          userId,
          tier: "premium",
        },
        subscription_data: {
          metadata: {
            userId,
            tier: "premium",
          },
        },
      });

      console.log(`Created checkout session ${session.id} for user ${userId}`);

      return {
        sessionId: session.id,
        url: session.url,
      };
    } catch (error) {
      console.error("Error creating checkout session:", error);
      if (error instanceof HttpsError) throw error;
      if (error instanceof Error && error.message.includes("Price ID not configured")) {
        throw new HttpsError("failed-precondition", "Subscription not configured");
      }
      throw new HttpsError("internal", "Failed to create checkout session");
    }
  }
);

/**
 * Create a Stripe Customer Portal session for subscription management
 */
export const createCustomerPortal = onCall(
  {
    region: "us-central1",
    secrets: ["STRIPE_SECRET_KEY"],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const userId = request.auth.uid;

    try {
      const stripe = getStripe();

      // Get user's Stripe customer ID
      const userDoc = await db.collection("users").doc(userId).get();
      const userData = userDoc.data();
      const customerId = userData?.stripeCustomerId;

      if (!customerId) {
        throw new HttpsError("failed-precondition", "No subscription found");
      }

      const baseUrl = process.env.FUNCTIONS_EMULATOR ?
        "http://localhost:4200" :
        getAppBaseUrl();

      // Create Customer Portal session
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${baseUrl}/settings`,
      });

      return {url: session.url};
    } catch (error) {
      console.error("Error creating customer portal:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Failed to create customer portal session");
    }
  }
);

/**
 * Stripe Webhook handler for subscription events
 */
export const stripeWebhook = onRequest(
  {
    region: "us-central1",
    secrets: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const stripe = getStripe();
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("Stripe webhook secret not configured");
      res.status(500).send("Webhook secret not configured");
      return;
    }

    const sig = req.headers["stripe-signature"];
    if (!sig) {
      res.status(400).send("Missing stripe-signature header");
      return;
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      res.status(400).send("Webhook signature verification failed");
      return;
    }

    console.log(`Received Stripe webhook: ${event.type}`);

    try {
      switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await handleCheckoutComplete(session);
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionUpdate(subscription);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await handleSubscriptionCanceled(subscription);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        await handlePaymentFailed(invoice);
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
      }

      res.status(200).send("OK");
    } catch (error) {
      console.error(`Error handling webhook ${event.type}:`, error);
      res.status(500).send("Webhook handler error");
    }
  }
);

/**
 * Handle successful checkout completion
 */
async function handleCheckoutComplete(session: Stripe.Checkout.Session): Promise<void> {
  const userId = session.metadata?.userId;
  if (!userId) {
    console.error("No userId in checkout session metadata");
    return;
  }

  console.log(`Checkout complete for user ${userId}, tier: premium`);

  // Log the successful checkout
  await db.collection("users").doc(userId).collection("payments").add({
    type: "subscription_checkout",
    sessionId: session.id,
    tier: "premium",
    amount: session.amount_total,
    currency: session.currency,
    status: "completed",
    createdAt: FieldValue.serverTimestamp(),
  });
}

/**
 * Handle subscription updates (created, updated)
 */
async function handleSubscriptionUpdate(subscription: Stripe.Subscription): Promise<void> {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    // Try to find user by customer ID
    const customerId = subscription.customer as string;
    const userQuery = await db.collection("users")
      .where("stripeCustomerId", "==", customerId)
      .limit(1)
      .get();

    if (userQuery.empty) {
      console.error("Could not find user for subscription:", subscription.id);
      return;
    }

    await updateUserSubscription(userQuery.docs[0].id, subscription);
    return;
  }

  await updateUserSubscription(userId, subscription);
}

/**
 * Update user's subscription data in Firestore
 */
async function updateUserSubscription(userId: string, subscription: Stripe.Subscription): Promise<void> {
  const status = subscription.status;

  // Map Stripe status to our status
  let mappedStatus: "active" | "canceled" | "past_due" | "trialing" = "active";
  if (status === "canceled") mappedStatus = "canceled";
  else if (status === "past_due") mappedStatus = "past_due";
  else if (status === "trialing") mappedStatus = "trialing";
  else if (status === "active") mappedStatus = "active";
  else mappedStatus = "canceled"; // For incomplete, incomplete_expired, unpaid

  const isActive = ["active", "trialing"].includes(status);
  const tier: SubscriptionTier = isActive ? "premium" : "free";

  // Get subscription items to extract period info
  const subscriptionItem = subscription.items?.data?.[0];
  const currentPeriodStart = subscriptionItem?.current_period_start ?
    new Date(subscriptionItem.current_period_start * 1000) :
    null;
  const currentPeriodEnd = subscriptionItem?.current_period_end ?
    new Date(subscriptionItem.current_period_end * 1000) :
    null;

  // Check if subscription is scheduled to cancel
  const isScheduledToCancel = subscription.cancel_at_period_end || subscription.cancel_at !== null;
  const cancelAt = subscription.cancel_at ?
    new Date(subscription.cancel_at * 1000) :
    null;

  // Update user document
  await db.collection("users").doc(userId).update({
    isPremium: isActive,
  });

  // Build subscription data update
  const subscriptionData: Record<string, unknown> = {
    tier,
    status: mappedStatus,
    stripeSubscriptionId: subscription.id,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd: isScheduledToCancel,
    cancelAt: cancelAt,
  };

  // Update private subscription data
  await db.collection("users").doc(userId).collection("private").doc("data").set({
    subscription: subscriptionData,
  }, {merge: true});

  console.log(`Updated subscription for user ${userId}: tier=${tier}, status=${mappedStatus}`);
}

/**
 * Handle subscription cancellation
 */
async function handleSubscriptionCanceled(subscription: Stripe.Subscription): Promise<void> {
  const customerId = subscription.customer as string;

  // Find user by customer ID
  const userQuery = await db.collection("users")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get();

  if (userQuery.empty) {
    console.error("Could not find user for canceled subscription:", subscription.id);
    return;
  }

  const userId = userQuery.docs[0].id;

  // Update user document
  await db.collection("users").doc(userId).update({
    isPremium: false,
  });

  // Update private subscription data
  await db.collection("users").doc(userId).collection("private").doc("data").set({
    subscription: {
      tier: "free",
      status: "canceled",
      stripeSubscriptionId: subscription.id,
      canceledAt: FieldValue.serverTimestamp(),
    },
  }, {merge: true});

  console.log(`Subscription canceled for user ${userId}`);
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = invoice.customer as string;

  // Find user by customer ID
  const userQuery = await db.collection("users")
    .where("stripeCustomerId", "==", customerId)
    .limit(1)
    .get();

  if (userQuery.empty) {
    console.error("Could not find user for failed payment:", invoice.id);
    return;
  }

  const userId = userQuery.docs[0].id;

  // Log the failed payment
  await db.collection("users").doc(userId).collection("payments").add({
    type: "subscription_payment_failed",
    invoiceId: invoice.id,
    amount: invoice.amount_due,
    currency: invoice.currency,
    createdAt: FieldValue.serverTimestamp(),
  });

  console.log(`Payment failed for user ${userId}, invoice: ${invoice.id}`);
}

/**
 * Cancel a user's active Stripe subscription
 * Used when a user disables or deletes their account
 *
 * @param userId - The Firebase user ID
 * @param immediate - If true, cancel immediately. If false, cancel at period end.
 * @returns true if a subscription was canceled, false if no active subscription found
 */
export async function cancelUserSubscription(
  userId: string,
  immediate = true
): Promise<boolean> {
  // Get user's private data to find subscription info
  const privateDoc = await db
    .collection("users")
    .doc(userId)
    .collection("private")
    .doc("data")
    .get();

  const privateData = privateDoc.data();
  const subscription = privateData?.subscription;

  if (!subscription?.stripeSubscriptionId) {
    console.log(`No Stripe subscription found for user ${userId}`);
    return false;
  }

  // Check if subscription is already canceled
  if (subscription.status === "canceled") {
    console.log(`Subscription already canceled for user ${userId}`);
    return false;
  }

  try {
    const stripe = getStripe();

    if (immediate) {
      // Cancel immediately
      await stripe.subscriptions.cancel(subscription.stripeSubscriptionId);
      console.log(`Immediately canceled subscription for user ${userId}`);
    } else {
      // Cancel at period end (user keeps access until end of billing period)
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        cancel_at_period_end: true,
      });
      console.log(`Scheduled subscription cancellation at period end for user ${userId}`);
    }

    return true;
  } catch (error) {
    console.error(`Error canceling subscription for user ${userId}:`, error);
    // Don't throw - we don't want subscription cancellation failure to block account operations
    return false;
  }
}
