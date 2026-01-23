/**
 * Virtual Phone Cloud Functions
 *
 * Handles provisioning, managing, and releasing virtual phone numbers
 * for Premium subscribers using Twilio.
 */

import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import * as twilio from "twilio";

const db = getFirestore();

// Initialize Twilio client
function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    throw new HttpsError(
      "failed-precondition",
      "Twilio credentials not configured"
    );
  }

  return twilio.default(accountSid, authToken);
}

/**
 * Verify user has Premium subscription
 */
async function verifyPremiumSubscription(uid: string): Promise<void> {
  const userDoc = await db.collection("users").doc(uid).collection("private").doc("data").get();
  const userData = userDoc.data();
  const tier = userData?.subscription?.tier || "free";

  if (tier !== "premium") {
    throw new HttpsError("permission-denied", "Virtual phone numbers are only available for Premium subscribers");
  }
}

/**
 * Verify user has a verified phone number for forwarding
 */
async function getVerifiedPhoneNumber(uid: string): Promise<string> {
  const userDoc = await db.collection("users").doc(uid).get();
  const userData = userDoc.data();

  if (!userData?.phoneNumberVerified || !userData?.phoneNumber) {
    throw new HttpsError(
      "failed-precondition",
      "You must verify your phone number in Settings before getting a virtual number"
    );
  }

  return userData.phoneNumber;
}

/**
 * Extract area code from a US phone number in E.164 format
 * E.g., +15551234567 -> 555
 */
function extractAreaCode(phoneNumber: string): string | undefined {
  // Remove any non-digit characters except the leading +
  const cleaned = phoneNumber.replace(/[^\d+]/g, "");

  // US E.164 format: +1XXXXXXXXXX (11 digits with +1)
  if (cleaned.startsWith("+1") && cleaned.length === 12) {
    return cleaned.substring(2, 5);
  }

  // US format without +: 1XXXXXXXXXX (11 digits)
  if (cleaned.startsWith("1") && cleaned.length === 11) {
    return cleaned.substring(1, 4);
  }

  // 10-digit US format: XXXXXXXXXX
  if (cleaned.length === 10 && !cleaned.startsWith("+")) {
    return cleaned.substring(0, 3);
  }

  return undefined;
}

/**
 * Check if user already has a virtual phone number
 */
async function getExistingVirtualPhone(uid: string) {
  const virtualPhoneRef = db
    .collection("users")
    .doc(uid)
    .collection("private")
    .doc("virtualPhone");
  const snapshot = await virtualPhoneRef.get();

  if (snapshot.exists) {
    return snapshot.data();
  }
  return null;
}

/**
 * Provision a new virtual phone number for a user
 */
export const provisionVirtualNumber = onCall(
  {cors: true},
  async (request) => {
    // Verify authentication
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }

    const uid = request.auth.uid;

    // Verify Premium subscription
    await verifyPremiumSubscription(uid);

    // Verify user has a verified phone number for forwarding
    const forwardingNumber = await getVerifiedPhoneNumber(uid);

    // Check if user already has a number
    const existingPhone = await getExistingVirtualPhone(uid);
    if (existingPhone) {
      // Return existing number
      return existingPhone;
    }

    try {
      const client = getTwilioClient();

      // Extract area code from user's verified phone number
      const areaCode = extractAreaCode(forwardingNumber);
      console.log(`[VirtualPhone] User area code: ${areaCode || "unknown"}`);

      // First, try to find a number in the user's area code
      let availableNumbers = await client.availablePhoneNumbers("US")
        .local.list({
          areaCode: areaCode ? parseInt(areaCode) : undefined,
          voiceEnabled: true,
          smsEnabled: true,
          limit: 1,
        });

      // If no numbers available in the user's area code, try without area code restriction
      if (availableNumbers.length === 0 && areaCode) {
        console.log(`[VirtualPhone] No numbers in area code ${areaCode}, searching without restriction`);
        availableNumbers = await client.availablePhoneNumbers("US")
          .local.list({
            voiceEnabled: true,
            smsEnabled: true,
            limit: 1,
          });
      }

      if (availableNumbers.length === 0) {
        throw new HttpsError(
          "unavailable",
          "No phone numbers available. Please try again later."
        );
      }

      const selectedNumber = availableNumbers[0];

      // Get webhook URLs from environment
      const voiceWebhookUrl = process.env.TWILIO_VOICE_WEBHOOK_URL;
      const smsWebhookUrl = process.env.TWILIO_SMS_WEBHOOK_URL;

      // Purchase the number with webhook configuration
      const purchasedNumber = await client.incomingPhoneNumbers.create({
        phoneNumber: selectedNumber.phoneNumber,
        friendlyName: `Gylde-${uid.slice(0, 8)}`,
        // Configure webhooks for incoming calls/SMS
        ...(voiceWebhookUrl && {voiceUrl: voiceWebhookUrl, voiceMethod: "POST"}),
        ...(smsWebhookUrl && {smsUrl: smsWebhookUrl, smsMethod: "POST"}),
      });

      // Store the virtual phone data in Firestore
      const virtualPhoneData = {
        number: purchasedNumber.phoneNumber,
        twilioSid: purchasedNumber.sid,
        friendlyName: purchasedNumber.friendlyName,
        forwardingNumber: forwardingNumber, // User's verified phone for forwarding
        capabilities: {
          voice: purchasedNumber.capabilities?.voice ?? true,
          sms: purchasedNumber.capabilities?.sms ?? true,
          mms: purchasedNumber.capabilities?.mms ?? false,
        },
        settings: {
          doNotDisturb: false,
          forwardCalls: true,
          forwardTexts: true,
        },
        provisionedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

      // Save to user's private data
      await db
        .collection("users")
        .doc(uid)
        .collection("private")
        .doc("virtualPhone")
        .set(virtualPhoneData);

      // Update user's main profile to indicate they have a virtual number
      await db.collection("users").doc(uid).update({
        hasVirtualPhone: true,
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`[VirtualPhone] Provisioned ${purchasedNumber.phoneNumber} for user ${uid}`);

      // Return the data (without twilioSid for security)
      return {
        number: virtualPhoneData.number,
        forwardingNumber: virtualPhoneData.forwardingNumber,
        capabilities: virtualPhoneData.capabilities,
        settings: virtualPhoneData.settings,
        provisionedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error("[VirtualPhone] Failed to provision number:", error);

      // Handle Twilio-specific errors
      if (error.code) {
        switch (error.code) {
        case 21422:
          throw new HttpsError(
            "invalid-argument",
            "Invalid phone number format"
          );
        case 21452:
          throw new HttpsError(
            "resource-exhausted",
            "Phone number limit reached"
          );
        case 21606:
          throw new HttpsError(
            "unavailable",
            "Phone number is not available"
          );
        default:
          throw new HttpsError(
            "internal",
            "Failed to provision phone number. Please try again."
          );
        }
      }

      // Re-throw HttpsErrors
      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        "Failed to provision phone number. Please try again."
      );
    }
  }
);

/**
 * Release a virtual phone number
 */
export const releaseVirtualNumber = onCall(
  {cors: true},
  async (request) => {
    // Verify authentication
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }

    const uid = request.auth.uid;

    // Get existing virtual phone
    const existingPhone = await getExistingVirtualPhone(uid);
    if (!existingPhone) {
      throw new HttpsError("not-found", "No virtual phone number found");
    }

    try {
      const client = getTwilioClient();

      // Release the number from Twilio
      if (existingPhone.twilioSid) {
        await client.incomingPhoneNumbers(existingPhone.twilioSid).remove();
      }

      // Delete from Firestore
      await db
        .collection("users")
        .doc(uid)
        .collection("private")
        .doc("virtualPhone")
        .delete();

      // Update user's main profile
      await db.collection("users").doc(uid).update({
        hasVirtualPhone: false,
        updatedAt: FieldValue.serverTimestamp(),
      });

      console.log(`[VirtualPhone] Released ${existingPhone.number} for user ${uid}`);

      return {success: true};
    } catch (error: any) {
      console.error("[VirtualPhone] Failed to release number:", error);

      // If Twilio fails but we still want to clean up Firestore
      if (error.status === 404) {
        // Number already deleted from Twilio, just clean up Firestore
        await db
          .collection("users")
          .doc(uid)
          .collection("private")
          .doc("virtualPhone")
          .delete();

        await db.collection("users").doc(uid).update({
          hasVirtualPhone: false,
          updatedAt: FieldValue.serverTimestamp(),
        });

        return {success: true};
      }

      throw new HttpsError(
        "internal",
        "Failed to release phone number. Please try again."
      );
    }
  }
);

/**
 * Update virtual phone settings
 */
export const updateVirtualPhoneSettings = onCall(
  {cors: true},
  async (request) => {
    // Verify authentication
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }

    const uid = request.auth.uid;
    const {settings} = request.data as {
      settings: {
        doNotDisturb?: boolean;
        forwardCalls?: boolean;
        forwardTexts?: boolean;
      };
    };

    if (!settings) {
      throw new HttpsError("invalid-argument", "Settings are required");
    }

    // Get existing virtual phone
    const existingPhone = await getExistingVirtualPhone(uid);
    if (!existingPhone) {
      throw new HttpsError("not-found", "No virtual phone number found");
    }

    // Merge settings
    const updatedSettings = {
      ...existingPhone.settings,
      ...settings,
    };

    // Update in Firestore
    await db
      .collection("users")
      .doc(uid)
      .collection("private")
      .doc("virtualPhone")
      .update({
        settings: updatedSettings,
        updatedAt: FieldValue.serverTimestamp(),
      });

    return {settings: updatedSettings};
  }
);

/**
 * Get virtual phone number info
 */
export const getVirtualPhoneInfo = onCall(
  {cors: true},
  async (request) => {
    // Verify authentication
    if (!request.auth?.uid) {
      throw new HttpsError("unauthenticated", "Must be signed in");
    }

    const uid = request.auth.uid;

    const existingPhone = await getExistingVirtualPhone(uid);
    if (!existingPhone) {
      return null;
    }

    // Return without sensitive data
    return {
      number: existingPhone.number,
      forwardingNumber: existingPhone.forwardingNumber,
      capabilities: existingPhone.capabilities,
      settings: existingPhone.settings,
      provisionedAt: existingPhone.provisionedAt,
    };
  }
);

/**
 * Find user by their virtual phone number
 */
async function findUserByVirtualNumber(virtualNumber: string) {
  // Query all users' private/virtualPhone docs for this number
  const usersSnapshot = await db.collectionGroup("private").where("number", "==", virtualNumber).get();

  if (usersSnapshot.empty) {
    return null;
  }

  // Get the first matching document
  const doc = usersSnapshot.docs[0];
  // Path is: users/{uid}/private/virtualPhone
  const uid = doc.ref.parent.parent?.id;

  if (!uid) return null;

  return {
    uid,
    virtualPhone: doc.data(),
  };
}

/**
 * Twilio Voice Webhook - Handle incoming calls
 *
 * When someone calls the virtual number, this webhook:
 * 1. Looks up who owns the virtual number
 * 2. Checks their settings (do not disturb, forward calls)
 * 3. Forwards the call to their real phone number
 */
export const twilioVoiceWebhook = onRequest(
  {cors: false},
  async (req, res) => {
    console.log("[VirtualPhone] Incoming voice webhook:", req.body);

    const {To, From, CallSid} = req.body;

    if (!To || !From) {
      console.error("[VirtualPhone] Missing To or From in voice webhook");
      res.status(400).send("Missing required parameters");
      return;
    }

    try {
      // Find the user who owns this virtual number
      const user = await findUserByVirtualNumber(To);

      if (!user) {
        console.warn(`[VirtualPhone] No user found for virtual number ${To}`);
        // Respond with a message that the number is not in service
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say("The number you have called is not in service.");
        twiml.hangup();
        res.type("text/xml").send(twiml.toString());
        return;
      }

      const {virtualPhone} = user;

      // Check if Do Not Disturb is enabled
      if (virtualPhone.settings?.doNotDisturb) {
        console.log(`[VirtualPhone] DND enabled for ${To}, rejecting call`);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say("This user is not accepting calls at this time.");
        twiml.hangup();
        res.type("text/xml").send(twiml.toString());
        return;
      }

      // Check if call forwarding is enabled
      if (virtualPhone.settings?.forwardCalls === false) {
        console.log(`[VirtualPhone] Call forwarding disabled for ${To}`);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say("This user is not accepting calls at this time.");
        twiml.hangup();
        res.type("text/xml").send(twiml.toString());
        return;
      }

      // Get the forwarding number
      const forwardingNumber = virtualPhone.forwardingNumber;
      if (!forwardingNumber) {
        console.error(`[VirtualPhone] No forwarding number for ${To}`);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say("This number is not configured to receive calls.");
        twiml.hangup();
        res.type("text/xml").send(twiml.toString());
        return;
      }

      console.log(`[VirtualPhone] Forwarding call ${CallSid} from ${From} to ${forwardingNumber}`);

      // Forward the call
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.dial(
        {
          callerId: To, // Show virtual number as caller ID on user's real phone
          timeout: 30,
        },
        forwardingNumber
      );

      // Log the call
      await db.collection("users").doc(user.uid).collection("private").doc("virtualPhone").collection("callLogs").add({
        type: "incoming",
        from: From,
        to: To,
        forwardedTo: forwardingNumber,
        callSid: CallSid,
        timestamp: FieldValue.serverTimestamp(),
      });

      res.type("text/xml").send(twiml.toString());
    } catch (error) {
      console.error("[VirtualPhone] Error handling voice webhook:", error);
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say("An error occurred. Please try again later.");
      twiml.hangup();
      res.type("text/xml").send(twiml.toString());
    }
  }
);

/**
 * Twilio SMS Webhook - Handle incoming text messages
 *
 * When someone texts the virtual number, this webhook:
 * 1. Looks up who owns the virtual number
 * 2. Checks their settings (do not disturb, forward texts)
 * 3. Forwards the text to their real phone number
 */
export const twilioSmsWebhook = onRequest(
  {cors: false},
  async (req, res) => {
    console.log("[VirtualPhone] Incoming SMS webhook:", req.body);

    const {To, From, Body, MessageSid} = req.body;

    if (!To || !From) {
      console.error("[VirtualPhone] Missing To or From in SMS webhook");
      res.status(400).send("Missing required parameters");
      return;
    }

    try {
      // Find the user who owns this virtual number
      const user = await findUserByVirtualNumber(To);

      if (!user) {
        console.warn(`[VirtualPhone] No user found for virtual number ${To}`);
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      const {virtualPhone} = user;

      // Check if Do Not Disturb is enabled
      if (virtualPhone.settings?.doNotDisturb) {
        console.log(`[VirtualPhone] DND enabled for ${To}, not forwarding SMS`);
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      // Check if text forwarding is enabled
      if (virtualPhone.settings?.forwardTexts === false) {
        console.log(`[VirtualPhone] Text forwarding disabled for ${To}`);
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      // Get the forwarding number
      const forwardingNumber = virtualPhone.forwardingNumber;
      if (!forwardingNumber) {
        console.error(`[VirtualPhone] No forwarding number for ${To}`);
        res.type("text/xml").send("<Response></Response>");
        return;
      }

      console.log(`[VirtualPhone] Forwarding SMS ${MessageSid} from ${From} to ${forwardingNumber}`);

      // Forward the SMS using Twilio API
      try {
        const client = getTwilioClient();
        const forwardedMessage = await client.messages.create({
          body: `From ${From}: ${Body}`,
          from: To, // Send from the virtual number
          to: forwardingNumber,
        });
        console.log(`[VirtualPhone] SMS forwarded successfully, SID: ${forwardedMessage.sid}`);
      } catch (twilioError: any) {
        console.error("[VirtualPhone] Failed to forward SMS:", twilioError.message, twilioError.code);
        // Common issues:
        // - 21608: The number is not verified (trial accounts can only send to verified numbers)
        // - 21211: Invalid 'To' phone number
        // - 21614: 'To' number is not a valid mobile number
      }

      // Log the message
      await db.collection("users").doc(user.uid).collection("private").doc("virtualPhone").collection("messageLogs").add({
        type: "incoming",
        from: From,
        to: To,
        forwardedTo: forwardingNumber,
        body: Body,
        messageSid: MessageSid,
        timestamp: FieldValue.serverTimestamp(),
      });

      // Send empty response (no auto-reply)
      res.type("text/xml").send("<Response></Response>");
    } catch (error) {
      console.error("[VirtualPhone] Error handling SMS webhook:", error);
      res.type("text/xml").send("<Response></Response>");
    }
  }
);
