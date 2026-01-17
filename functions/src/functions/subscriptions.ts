/**
 * Stripe Subscription Cloud Functions
 * Handles subscription checkout, management, and webhook events
 */
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { db } from "../config/firebase";
import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";

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

// Subscription tier type
type SubscriptionTier = "free" | "plus" | "elite";

// Tier order for determining upgrade vs downgrade
const TIER_ORDER: Record<SubscriptionTier, number> = {
  free: 0,
  plus: 1,
  elite: 2,
};

/**
 * Determine if changing from one tier to another is an upgrade or downgrade
 */
function isUpgrade(fromTier: SubscriptionTier, toTier: SubscriptionTier): boolean {
  return TIER_ORDER[toTier] > TIER_ORDER[fromTier];
}

// Price ID configuration - these should be set as environment variables or secrets
// Format: STRIPE_PRICE_PLUS_MONTHLY, STRIPE_PRICE_PLUS_QUARTERLY, etc.
const getPriceId = (tier: SubscriptionTier, interval: "monthly" | "quarterly"): string => {
  const key = `STRIPE_PRICE_${tier.toUpperCase()}_${interval.toUpperCase()}`;
  const priceId = process.env[key];
  if (!priceId) {
    throw new Error(`Price ID not configured for ${tier} ${interval}`);
  }
  return priceId;
};

/**
 * Create a Stripe Checkout Session for subscription
 * Handles new subscriptions and upgrades/downgrades
 */
export const createSubscriptionCheckout = onCall(
  {
    region: "us-central1",
    secrets: ["STRIPE_SECRET_KEY"],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }

    const { tier, interval } = request.data as {
      tier: SubscriptionTier;
      interval: "monthly" | "quarterly";
    };
    const userId = request.auth.uid;

    // Validate tier
    if (!tier || !["plus", "elite"].includes(tier)) {
      throw new HttpsError("invalid-argument", "Invalid subscription tier");
    }

    if (!interval || !["monthly", "quarterly"].includes(interval)) {
      throw new HttpsError("invalid-argument", "Invalid billing interval");
    }

    try {
      const stripe = getStripe();

      // Get user data
      const userDoc = await db.collection("users").doc(userId).get();
      const userData = userDoc.data();
      const email = userData?.email || request.auth.token.email;

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

      // Get the price ID for the selected plan
      const priceId = getPriceId(tier, interval);

      // Check for existing active subscriptions and handle upgrade/downgrade
      const existingSubscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "active",
        limit: 10,
      });

      // If user has an active subscription, update it instead of creating new
      if (existingSubscriptions.data.length > 0) {
        const existingSub = existingSubscriptions.data[0];
        const existingItem = existingSub.items.data[0];
        const stripeTier = (existingSub.metadata?.tier as SubscriptionTier) || "plus";

        // Check Firestore for pending downgrade
        const privateDoc = await db.collection("users").doc(userId).collection("private").doc("data").get();
        const privateData = privateDoc.data();
        const pendingDowngradeTier = privateData?.subscription?.pendingDowngradeTier as SubscriptionTier | null;
        const firestoreTier = (privateData?.subscription?.tier as SubscriptionTier) || stripeTier;

        // If there's a pending downgrade, the Stripe tier is the pending tier, not the current tier
        // The user's actual current tier is in Firestore
        const currentTier = pendingDowngradeTier ? firestoreTier : stripeTier;

        // Check if trying to subscribe to the same plan
        if (existingItem.price.id === priceId) {
          // If there's a pending downgrade to this tier, inform the user
          if (pendingDowngradeTier === tier) {
            throw new HttpsError(
              "already-exists",
              "You already have a scheduled downgrade to this plan"
            );
          }
          throw new HttpsError(
            "already-exists",
            "You are already subscribed to this plan"
          );
        }

        // If user is trying to go back to their current tier (canceling downgrade)
        if (pendingDowngradeTier && tier === firestoreTier) {
          // Cancel the pending downgrade by reverting to the original price
          const originalPriceId = getPriceId(firestoreTier, interval);
          const updatedSubscription = await stripe.subscriptions.update(existingSub.id, {
            items: [
              {
                id: existingItem.id,
                price: originalPriceId,
              },
            ],
            metadata: {
              userId,
              tier: firestoreTier,
            },
            proration_behavior: "none",
          });

          console.log(`Cancelled downgrade for user ${userId}, staying on ${firestoreTier}`);

          // Clear the pending downgrade in Firestore
          await db.collection("users").doc(userId).collection("private").doc("data").set({
            subscription: {
              pendingDowngradeTier: null,
              pendingDowngradeDate: null,
            },
          }, { merge: true });

          return {
            updated: true,
            subscriptionId: updatedSubscription.id,
            message: `Downgrade cancelled. You'll continue with your ${firestoreTier === "elite" ? "Elite" : "Connect"} subscription.`,
          };
        }

        // Determine if this is an upgrade, downgrade, or interval change
        const upgrading = isUpgrade(currentTier, tier);
        const sameTier = currentTier === tier;
        const isIntervalChange = sameTier && existingItem.price.id !== priceId;

        // Handle interval changes (same tier, different billing period)
        if (isIntervalChange) {
          // Apply immediately with proration - user gets credit for unused time
          const updatedSubscription = await stripe.subscriptions.update(existingSub.id, {
            items: [
              {
                id: existingItem.id,
                price: priceId,
              },
            ],
            metadata: {
              userId,
              tier,
            },
            proration_behavior: "create_prorations", // Credit for unused time
          });

          console.log(`Interval change for user ${userId}: updated to ${interval} billing`);

          // Clear any pending downgrade since this is a fresh update
          await db.collection("users").doc(userId).collection("private").doc("data").set({
            subscription: {
              pendingDowngradeTier: null,
              pendingDowngradeDate: null,
            },
          }, { merge: true });

          const tierName = tier === "elite" ? "Elite" : "Connect";
          const intervalName = interval === "quarterly" ? "quarterly" : "monthly";
          return {
            updated: true,
            subscriptionId: updatedSubscription.id,
            message: `Switched to ${tierName} ${intervalName} billing. Your new billing cycle starts now.`,
          };
        }

        if (upgrading) {
          // UPGRADE: Apply immediately with proration
          // User pays the difference now, gets access immediately
          const updatedSubscription = await stripe.subscriptions.update(existingSub.id, {
            items: [
              {
                id: existingItem.id,
                price: priceId,
              },
            ],
            metadata: {
              userId,
              tier,
            },
            proration_behavior: "create_prorations", // Credit for unused time, charge difference
          });

          console.log(`Upgraded subscription ${updatedSubscription.id} for user ${userId} from ${currentTier} to ${tier}`);

          // Update Firestore immediately for upgrades
          await db.collection("users").doc(userId).update({
            isElite: tier === "elite",
          });

          const subscriptionItem = updatedSubscription.items?.data?.[0];
          const currentPeriodEnd = subscriptionItem?.current_period_end
            ? new Date(subscriptionItem.current_period_end * 1000)
            : null;

          await db.collection("users").doc(userId).collection("private").doc("data").set({
            subscription: {
              tier,
              status: "active",
              stripeSubscriptionId: updatedSubscription.id,
              currentPeriodEnd,
              pendingDowngradeTier: null, // Clear any pending downgrade
              pendingDowngradeDate: null,
            },
          }, { merge: true });

          // Log the plan change
          await db.collection("users").doc(userId).collection("payments").add({
            type: "subscription_upgrade",
            previousTier: currentTier,
            newTier: tier,
            subscriptionId: updatedSubscription.id,
            interval,
            createdAt: FieldValue.serverTimestamp(),
          });

          return {
            updated: true,
            subscriptionId: updatedSubscription.id,
            message: `Successfully upgraded to ${tier === "elite" ? "Elite" : "Connect"}! You now have access to all features.`,
          };
        } else {
          // DOWNGRADE: Schedule for end of billing period
          // User keeps current tier until period ends, then switches to new tier
          const updatedSubscription = await stripe.subscriptions.update(existingSub.id, {
            items: [
              {
                id: existingItem.id,
                price: priceId,
              },
            ],
            metadata: {
              userId,
              tier,
              pendingFrom: currentTier, // Track what they're downgrading from
            },
            proration_behavior: "none", // No proration - new price at next billing cycle
          });

          console.log(`Scheduled downgrade for subscription ${updatedSubscription.id} for user ${userId} from ${currentTier} to ${tier}`);

          // Get the date when the downgrade takes effect
          const subscriptionItem = updatedSubscription.items?.data?.[0];
          const currentPeriodEnd = subscriptionItem?.current_period_end
            ? new Date(subscriptionItem.current_period_end * 1000)
            : null;

          // Store pending downgrade info but KEEP current tier active
          await db.collection("users").doc(userId).collection("private").doc("data").set({
            subscription: {
              tier: currentTier, // Keep current tier until period ends
              status: "active",
              stripeSubscriptionId: updatedSubscription.id,
              currentPeriodEnd,
              pendingDowngradeTier: tier, // The tier they're downgrading to
              pendingDowngradeDate: currentPeriodEnd, // When it takes effect
            },
          }, { merge: true });

          // Log the scheduled downgrade
          await db.collection("users").doc(userId).collection("payments").add({
            type: "subscription_downgrade_scheduled",
            previousTier: currentTier,
            newTier: tier,
            subscriptionId: updatedSubscription.id,
            effectiveDate: currentPeriodEnd,
            interval,
            createdAt: FieldValue.serverTimestamp(),
          });

          const effectiveDateStr = currentPeriodEnd 
            ? currentPeriodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
            : "your next billing date";

          return {
            updated: true,
            scheduled: true,
            subscriptionId: updatedSubscription.id,
            effectiveDate: currentPeriodEnd?.toISOString(),
            message: `Your plan will change to ${tier === "plus" ? "Connect" : "Explorer"} on ${effectiveDateStr}. You'll keep your current features until then.`,
          };
        }
      }

      // No existing subscription - create new checkout session
      // Determine success and cancel URLs
      const baseUrl = process.env.FUNCTIONS_EMULATOR
        ? "http://localhost:4200"
        : "https://gylde-dba55.web.app"; // TODO: Update with actual domain

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
        success_url: `${baseUrl}/subscription?success=true&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/subscription?canceled=true`,
        metadata: {
          userId,
          tier,
          interval,
        },
        subscription_data: {
          metadata: {
            userId,
            tier,
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
        throw new HttpsError("failed-precondition", "Subscription plans not configured");
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

      const baseUrl = process.env.FUNCTIONS_EMULATOR
        ? "http://localhost:4200"
        : "https://gylde-dba55.web.app";

      // Create Customer Portal session
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${baseUrl}/subscription`,
      });

      return { url: session.url };
    } catch (error) {
      console.error("Error creating customer portal:", error);
      if (error instanceof HttpsError) throw error;
      throw new HttpsError("internal", "Failed to create customer portal session");
    }
  }
);

/**
 * Stripe Webhook handler for subscription events
 * This should be called by Stripe when subscription events occur
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

  const tier = session.metadata?.tier as SubscriptionTier;
  
  console.log(`Checkout complete for user ${userId}, tier: ${tier}`);

  // The subscription update will be handled by the subscription.updated event
  // But we can log the successful checkout here
  await db.collection("users").doc(userId).collection("payments").add({
    type: "subscription_checkout",
    sessionId: session.id,
    tier,
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
 * Handles both regular updates and scheduled downgrades
 */
async function updateUserSubscription(userId: string, subscription: Stripe.Subscription): Promise<void> {
  const tier = subscription.metadata?.tier as SubscriptionTier || "plus";
  const pendingFrom = subscription.metadata?.pendingFrom as SubscriptionTier | undefined;
  const status = subscription.status;

  // Map Stripe status to our status
  let mappedStatus: "active" | "canceled" | "past_due" | "trialing" = "active";
  if (status === "canceled") mappedStatus = "canceled";
  else if (status === "past_due") mappedStatus = "past_due";
  else if (status === "trialing") mappedStatus = "trialing";
  else if (status === "active") mappedStatus = "active";
  else mappedStatus = "canceled"; // For incomplete, incomplete_expired, unpaid

  const isActive = ["active", "trialing"].includes(status);

  // Get subscription items to extract period info
  const subscriptionItem = subscription.items?.data?.[0];
  const currentPeriodStart = subscriptionItem?.current_period_start 
    ? new Date(subscriptionItem.current_period_start * 1000)
    : null;
  const currentPeriodEnd = subscriptionItem?.current_period_end
    ? new Date(subscriptionItem.current_period_end * 1000)
    : null;
  
  // Determine billing interval from the price
  // interval_count of 3 months = quarterly, 1 month = monthly
  const priceInterval = subscriptionItem?.price?.recurring?.interval;
  const priceIntervalCount = subscriptionItem?.price?.recurring?.interval_count;
  let billingInterval: "monthly" | "quarterly" = "monthly";
  if (priceInterval === "month" && priceIntervalCount === 3) {
    billingInterval = "quarterly";
  }

  // Check if there's a pending downgrade that just took effect
  // This happens when the billing period renews at the lower tier
  const privateDoc = await db.collection("users").doc(userId).collection("private").doc("data").get();
  const privateData = privateDoc.data();
  const pendingDowngradeTier = privateData?.subscription?.pendingDowngradeTier;
  const pendingDowngradeDate = privateData?.subscription?.pendingDowngradeDate?.toDate?.();

  // Determine the effective tier
  let effectiveTier = tier;
  
  // If there was a pending downgrade and we've passed the downgrade date,
  // the new tier from Stripe metadata should now be in effect
  if (pendingDowngradeTier && pendingDowngradeDate) {
    const now = new Date();
    if (now >= pendingDowngradeDate) {
      // The downgrade has taken effect
      effectiveTier = tier; // Use the tier from Stripe (which is the new lower tier)
      console.log(`Downgrade took effect for user ${userId}: now on tier ${effectiveTier}`);
    } else {
      // Still in the grace period - keep the higher tier
      effectiveTier = pendingFrom || privateData?.subscription?.tier || tier;
    }
  }

  // Update user document
  await db.collection("users").doc(userId).update({
    isElite: isActive && effectiveTier === "elite",
  });

  // Check if subscription is scheduled to cancel
  // Stripe can use either cancel_at_period_end OR cancel_at (timestamp)
  const isScheduledToCancel = subscription.cancel_at_period_end || subscription.cancel_at !== null;
  const cancelAt = subscription.cancel_at 
    ? new Date(subscription.cancel_at * 1000) 
    : null;

  // Build subscription data update
  const subscriptionData: Record<string, unknown> = {
    tier: isActive ? effectiveTier : "free",
    status: mappedStatus,
    billingInterval,
    stripeSubscriptionId: subscription.id,
    currentPeriodStart,
    currentPeriodEnd,
    cancelAtPeriodEnd: isScheduledToCancel,
    cancelAt: cancelAt,
  };

  // Clear pending downgrade if it has taken effect OR if subscription is set to cancel
  if (pendingDowngradeTier && pendingDowngradeDate) {
    const now = new Date();
    if (now >= pendingDowngradeDate || isScheduledToCancel) {
      subscriptionData.pendingDowngradeTier = null;
      subscriptionData.pendingDowngradeDate = null;
    }
  }
  
  // Also clear pending downgrade if subscription is explicitly set to cancel
  if (isScheduledToCancel) {
    subscriptionData.pendingDowngradeTier = null;
    subscriptionData.pendingDowngradeDate = null;
  }

  // Update private subscription data
  await db.collection("users").doc(userId).collection("private").doc("data").set({
    subscription: subscriptionData,
  }, { merge: true });

  console.log(`Updated subscription for user ${userId}: tier=${effectiveTier}, status=${mappedStatus}`);
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
    isElite: false,
  });

  // Update private subscription data
  await db.collection("users").doc(userId).collection("private").doc("data").set({
    subscription: {
      tier: "free",
      status: "canceled",
      stripeSubscriptionId: subscription.id,
      canceledAt: FieldValue.serverTimestamp(),
    },
  }, { merge: true });

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
