/**
 * Email Service
 * Handles sending email notifications via SendGrid
 */
import sgMail from "@sendgrid/mail";
import {db, auth} from "../config/firebase";
import * as logger from "firebase-functions/logger";

// Email types
export type EmailType = "match" | "message" | "favorite";

// Email templates
interface EmailTemplate {
  subject: string;
  text: string;
  html: string;
}

// Initialize SendGrid - call this before sending emails
export function initializeEmailService(): void {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    logger.warn("SENDGRID_API_KEY not configured - emails will not be sent");
    return;
  }
  sgMail.setApiKey(apiKey);
  logger.info("SendGrid email service initialized");
}

/**
 * Get user's email from Firebase Auth and notification preferences from Firestore
 */
async function getUserEmailPreferences(userId: string): Promise<{
  email: string | null;
  emailMatches: boolean;
  emailMessages: boolean;
  emailFavorites: boolean;
} | null> {
  try {
    // Get email from Firebase Auth (source of truth)
    let email: string | null = null;
    try {
      const authUser = await auth.getUser(userId);
      email = authUser.email || null;
    } catch (authError) {
      logger.warn(`Could not get auth record for user ${userId}:`, authError);
      return null;
    }

    // Get notification preferences from Firestore
    const userDoc = await db.collection("users").doc(userId).get();
    const userData = userDoc.data();
    const notifications = userData?.settings?.notifications || {};

    return {
      email,
      emailMatches: notifications.emailMatches !== false, // Default true
      emailMessages: notifications.emailMessages !== false, // Default true
      emailFavorites: notifications.emailFavorites !== false, // Default true
    };
  } catch (error) {
    logger.error(`Error getting email preferences for ${userId}:`, error);
    return null;
  }
}

/**
 * Generate email template based on type
 */
function generateEmailTemplate(
  type: EmailType,
  fromUserName: string,
  recipientName: string,
  fromUserId: string,
  conversationId?: string
): EmailTemplate {
  const appName = "Gylde";
  const appUrl = "https://www.gylde.com";

  // Links based on email type
  const profileLink = `${appUrl}/user/${fromUserId}`;
  const messageLink = conversationId ? `${appUrl}/messages/${conversationId}` : `${appUrl}/messages`;

  switch (type) {
  case "match":
    return {
      subject: `${appName}: You have a new match! 💫`,
      text: `Hey ${recipientName},\n\nGreat news! You and ${fromUserName} have matched on ${appName}.\n\nCheck out their profile: ${profileLink}\n\nHappy connecting!\nThe ${appName} Team`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #0d0b0e;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: linear-gradient(135deg, #1a1618 0%, #0d0b0e 100%); border-radius: 16px; padding: 40px; border: 1px solid rgba(201, 169, 98, 0.2);">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #c9a962; margin: 0; font-size: 28px;">It's a Match! 💫</h1>
      </div>
      <p style="color: #e8e6e9; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Hey ${recipientName},
      </p>
      <p style="color: #e8e6e9; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
        Great news! You and <strong style="color: #c9a962;">${fromUserName}</strong> have matched on ${appName}. This could be the start of something special.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${profileLink}" style="display: inline-block; background-color: #c9a962; color: #0d0b0e; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Their Profile</a>
      </div>
      <p style="color: #a09a9c; font-size: 14px; line-height: 1.5; margin: 24px 0 0; text-align: center;">
        Happy connecting!<br>The ${appName} Team
      </p>
    </div>
    <p style="color: #6b6669; font-size: 12px; text-align: center; margin-top: 24px;">
      Don't want these emails? <a href="${appUrl}/settings" style="color: #c9a962;">Update your preferences</a>
    </p>
  </div>
</body>
</html>`,
    };

  case "message":
    return {
      subject: `${appName}: ${fromUserName} sent you a message`,
      text: `Hey ${recipientName},\n\n${fromUserName} just sent you a message on ${appName}.\n\nRead and reply: ${messageLink}\n\nBest,\nThe ${appName} Team`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #0d0b0e;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: linear-gradient(135deg, #1a1618 0%, #0d0b0e 100%); border-radius: 16px; padding: 40px; border: 1px solid rgba(201, 169, 98, 0.2);">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #c9a962; margin: 0; font-size: 28px;">New Message 💬</h1>
      </div>
      <p style="color: #e8e6e9; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Hey ${recipientName},
      </p>
      <p style="color: #e8e6e9; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
        <strong style="color: #c9a962;">${fromUserName}</strong> just sent you a message on ${appName}. Don't keep them waiting!
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${messageLink}" style="display: inline-block; background-color: #c9a962; color: #0d0b0e; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Read Message</a>
      </div>
      <p style="color: #a09a9c; font-size: 14px; line-height: 1.5; margin: 24px 0 0; text-align: center;">
        Best,<br>The ${appName} Team
      </p>
    </div>
    <p style="color: #6b6669; font-size: 12px; text-align: center; margin-top: 24px;">
      Don't want these emails? <a href="${appUrl}/settings" style="color: #c9a962;">Update your preferences</a>
    </p>
  </div>
</body>
</html>`,
    };

  case "favorite":
    return {
      subject: `${appName}: ${fromUserName} favorited you! ⭐`,
      text: `Hey ${recipientName},\n\n${fromUserName} just favorited your profile on ${appName}. Check them out!\n\nView their profile: ${profileLink}\n\nBest,\nThe ${appName} Team`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #0d0b0e;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: linear-gradient(135deg, #1a1618 0%, #0d0b0e 100%); border-radius: 16px; padding: 40px; border: 1px solid rgba(201, 169, 98, 0.2);">
      <div style="text-align: center; margin-bottom: 32px;">
        <h1 style="color: #c9a962; margin: 0; font-size: 28px;">Someone's Interested! ⭐</h1>
      </div>
      <p style="color: #e8e6e9; font-size: 16px; line-height: 1.6; margin: 0 0 16px;">
        Hey ${recipientName},
      </p>
      <p style="color: #e8e6e9; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
        <strong style="color: #c9a962;">${fromUserName}</strong> just favorited your profile on ${appName}. Maybe it's time to check them out?
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${profileLink}" style="display: inline-block; background-color: #c9a962; color: #0d0b0e; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">View Their Profile</a>
      </div>
      <p style="color: #a09a9c; font-size: 14px; line-height: 1.5; margin: 24px 0 0; text-align: center;">
        Best,<br>The ${appName} Team
      </p>
    </div>
    <p style="color: #6b6669; font-size: 12px; text-align: center; margin-top: 24px;">
      Don't want these emails? <a href="${appUrl}/settings" style="color: #c9a962;">Update your preferences</a>
    </p>
  </div>
</body>
</html>`,
    };
  }
}

/**
 * Send an email notification to a user
 * Checks user preferences before sending
 * @param fromUserId - The user ID of who triggered this notification (for profile links)
 * @param conversationId - Optional conversation ID for message emails
 */
export async function sendEmailNotification(
  recipientUserId: string,
  type: EmailType,
  fromUserName: string,
  fromUserId: string,
  conversationId?: string
): Promise<boolean> {
  try {
    // Check if SendGrid is configured
    if (!process.env.SENDGRID_API_KEY) {
      logger.warn("SendGrid not configured, skipping email");
      return false;
    }

    // Get user's email and preferences
    const prefs = await getUserEmailPreferences(recipientUserId);
    if (!prefs || !prefs.email) {
      logger.info(`No email for user ${recipientUserId}, skipping notification`);
      return false;
    }

    // Check if user wants this type of email
    const wantsEmail = type === "match" ? prefs.emailMatches :
      type === "message" ? prefs.emailMessages :
        prefs.emailFavorites;

    if (!wantsEmail) {
      logger.info(`User ${recipientUserId} has disabled ${type} emails, skipping`);
      return false;
    }

    // Get recipient's name for personalization
    const userDoc = await db.collection("users").doc(recipientUserId).get();
    const recipientName = userDoc.data()?.displayName || "there";

    // Generate email template with proper links
    const template = generateEmailTemplate(type, fromUserName, recipientName, fromUserId, conversationId);

    // Send email
    const msg = {
      to: prefs.email,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || "noreply@gylde.com",
        name: "Gylde",
      },
      subject: template.subject,
      text: template.text,
      html: template.html,
    };

    await sgMail.send(msg);
    logger.info(`${type} email sent to ${recipientUserId} at email ${prefs.email}`);
    return true;
  } catch (error) {
    logger.error(`Error sending ${type} email to ${recipientUserId}:`, error);
    return false;
  }
}

/**
 * Rate limiting for message emails
 * Prevents spamming users with too many emails
 */
const messageEmailCooldowns = new Map<string, number>();
const MESSAGE_EMAIL_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export async function sendMessageEmailNotification(
  recipientUserId: string,
  senderUserId: string,
  fromUserName: string,
  conversationId: string
): Promise<boolean> {
  // Check cooldown - don't spam emails for every message
  const cooldownKey = `${recipientUserId}_${senderUserId}`;
  const lastSent = messageEmailCooldowns.get(cooldownKey) || 0;
  const now = Date.now();

  if (now - lastSent < MESSAGE_EMAIL_COOLDOWN_MS) {
    logger.info(`Message email cooldown active for ${cooldownKey}, skipping`);
    return false;
  }

  const sent = await sendEmailNotification(recipientUserId, "message", fromUserName, senderUserId, conversationId);
  if (sent) {
    messageEmailCooldowns.set(cooldownKey, now);
  }
  return sent;
}
