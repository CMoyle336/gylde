/**
 * Message Stress Test Script
 * 
 * Generates random messages between two specified users at a configurable interval.
 * Useful for testing the performance of the messages panel.
 * 
 * Usage:
 *   npm run stress:messages -- <user1> <user2> [count] [interval]
 * 
 * Examples:
 *   npm run stress:messages -- seed-user-002 seed-user-011
 *   npm run stress:messages -- seed-user-002 seed-user-011 100
 *   npm run stress:messages -- seed-user-002 seed-user-011 100 500
 *   npm run stress:messages -- seed-user-002 seed-user-011 100 burst
 * 
 * Arguments:
 *   user1      First user UID (required)
 *   user2      Second user UID (required)
 *   count      Number of messages to generate (default: 50)
 *   interval   Milliseconds between messages, or "burst" for max speed (default: 1000)
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { faker } from '@faker-js/faker';

// Configuration
const FIRESTORE_EMULATOR_HOST = 'localhost:8080';
const PROJECT_ID = 'gylde-dba55';

// Parse command line arguments (positional)
function parseArgs(): {
  user1: string;
  user2: string;
  count: number;
  interval: number;
  burst: boolean;
} {
  const args = process.argv.slice(2);
  
  const user1 = args[0];
  const user2 = args[1];
  const countArg = args[2];
  const intervalArg = args[3];

  if (!user1 || !user2) {
    console.error('❌ Error: Both user1 and user2 are required');
    console.error('\nUsage:');
    console.error('  npm run stress:messages -- <user1> <user2> [count] [interval]');
    console.error('\nExamples:');
    console.error('  npm run stress:messages -- seed-user-002 seed-user-011');
    console.error('  npm run stress:messages -- seed-user-002 seed-user-011 100');
    console.error('  npm run stress:messages -- seed-user-002 seed-user-011 100 500');
    console.error('  npm run stress:messages -- seed-user-002 seed-user-011 100 burst');
    console.error('\nArguments:');
    console.error('  user1      First user UID');
    console.error('  user2      Second user UID');
    console.error('  count      Number of messages (default: 50)');
    console.error('  interval   Milliseconds between messages, or "burst" (default: 1000)');
    process.exit(1);
  }

  const burst = intervalArg === 'burst';

  return {
    user1,
    user2,
    count: countArg ? parseInt(countArg, 10) : 50,
    interval: burst ? 0 : (intervalArg ? parseInt(intervalArg, 10) : 1000),
    burst,
  };
}

// Message templates for variety
const messageTemplates = [
  "Hey, how's it going?",
  "What are you up to today?",
  "That's so interesting!",
  "I totally agree with you on that.",
  "Haha, that's hilarious! 😂",
  "Tell me more about that!",
  "I've been thinking about what you said...",
  "Have you ever tried {activity}?",
  "What do you think about {topic}?",
  "I had the best {food} today!",
  "The weather here is {weather}",
  "I can't stop thinking about our conversation",
  "You're so easy to talk to!",
  "What's your take on {topic}?",
  "I just got back from {place}",
  "Have you seen {movie}? It's amazing!",
  "I'm really enjoying getting to know you",
  "That reminds me of a story...",
  "Oh wow, I didn't know that!",
  "You have such great taste in {thing}",
  "I'm curious, what made you interested in that?",
  "That sounds like so much fun!",
  "I wish I could do that too",
  "Maybe we should try that together sometime?",
  "You always know how to make me smile 😊",
  "I appreciate you sharing that with me",
  "That's a really unique perspective",
  "I never thought of it that way before",
  "You're really passionate about this, I can tell!",
  "Same here! We have so much in common",
];

const activities = ['hiking', 'cooking', 'traveling', 'reading', 'yoga', 'photography', 'dancing'];
const topics = ['movies', 'music', 'travel', 'food', 'art', 'technology', 'sports'];
const foods = ['sushi', 'pizza', 'tacos', 'curry', 'pasta', 'ramen', 'salad'];
const weather = ['beautiful', 'sunny', 'a bit cloudy', 'perfect', 'surprisingly warm'];
const places = ['the gym', 'a great coffee shop', 'an amazing restaurant', 'a walk in the park'];
const movies = ['that new thriller', 'the latest Marvel movie', 'an indie film', 'a great documentary'];
const things = ['music', 'food', 'movies', 'books', 'art', 'style'];

function generateMessage(): string {
  let message = faker.helpers.arrayElement(messageTemplates);
  
  // Replace placeholders
  message = message
    .replace('{activity}', faker.helpers.arrayElement(activities))
    .replace('{topic}', faker.helpers.arrayElement(topics))
    .replace('{food}', faker.helpers.arrayElement(foods))
    .replace('{weather}', faker.helpers.arrayElement(weather))
    .replace('{place}', faker.helpers.arrayElement(places))
    .replace('{movie}', faker.helpers.arrayElement(movies))
    .replace('{thing}', faker.helpers.arrayElement(things));

  return message;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const config = parseArgs();

  console.log('💬 Message Stress Test Script');
  console.log('==============================\n');
  console.log(`User 1: ${config.user1}`);
  console.log(`User 2: ${config.user2}`);
  console.log(`Messages: ${config.count}`);
  console.log(`Mode: ${config.burst ? 'Burst (as fast as possible)' : `Interval (${config.interval}ms)`}`);
  console.log('');

  // Connect to Firestore emulator
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_EMULATOR_HOST;
  
  initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore();

  // Check if users exist
  console.log('🔍 Verifying users exist...');
  const user1Doc = await db.collection('users').doc(config.user1).get();
  const user2Doc = await db.collection('users').doc(config.user2).get();

  if (!user1Doc.exists) {
    console.error(`❌ User 1 (${config.user1}) not found in Firestore`);
    process.exit(1);
  }
  if (!user2Doc.exists) {
    console.error(`❌ User 2 (${config.user2}) not found in Firestore`);
    process.exit(1);
  }

  const user1Data = user1Doc.data()!;
  const user2Data = user2Doc.data()!;
  console.log(`✅ User 1: ${user1Data.displayName || config.user1}`);
  console.log(`✅ User 2: ${user2Data.displayName || config.user2}`);

  // Find or create conversation between the two users
  console.log('\n🔍 Finding or creating conversation...');
  
  const conversationsRef = db.collection('conversations');
  const existingConvo = await conversationsRef
    .where('participants', 'array-contains', config.user1)
    .get();

  let conversationId: string | null = null;
  
  for (const doc of existingConvo.docs) {
    const participants = doc.data().participants as string[];
    if (participants.includes(config.user2)) {
      conversationId = doc.id;
      break;
    }
  }

  if (!conversationId) {
    // Create new conversation
    const newConvo = await conversationsRef.add({
      participants: [config.user1, config.user2],
      participantInfo: {
        [config.user1]: {
          displayName: user1Data.displayName,
          photoURL: user1Data.photoURL,
        },
        [config.user2]: {
          displayName: user2Data.displayName,
          photoURL: user2Data.photoURL,
        },
      },
      lastMessage: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      unreadCount: {
        [config.user1]: 0,
        [config.user2]: 0,
      },
      lastViewedAt: {
        [config.user1]: FieldValue.serverTimestamp(),
        [config.user2]: FieldValue.serverTimestamp(),
      },
    });
    conversationId = newConvo.id;
    console.log(`✅ Created new conversation: ${conversationId}`);
  } else {
    console.log(`✅ Found existing conversation: ${conversationId}`);
  }

  // Generate messages
  console.log(`\n📤 Generating ${config.count} messages...\n`);
  
  const users = [
    { uid: config.user1, name: user1Data.displayName || 'User 1' },
    { uid: config.user2, name: user2Data.displayName || 'User 2' },
  ];

  const messagesRef = db.collection('conversations').doc(conversationId).collection('messages');
  const startTime = Date.now();

  // Track last message for final conversation update
  let lastContent = '';
  let lastSenderId = '';
  let unreadCount1 = 0; // unread for user1
  let unreadCount2 = 0; // unread for user2
  
  // Batch size for conversation metadata updates (reduces writes)
  const METADATA_UPDATE_INTERVAL = 10;

  for (let i = 0; i < config.count; i++) {
    // Randomly pick sender
    const sender = faker.helpers.arrayElement(users);
    const recipient = users.find(u => u.uid !== sender.uid)!;
    const content = generateMessage();

    // Create message (this is the main operation we're testing)
    await messagesRef.add({
      senderId: sender.uid,
      content,
      createdAt: FieldValue.serverTimestamp(),
      read: false,
    });

    // Track for batched metadata update
    lastContent = content;
    lastSenderId = sender.uid;
    if (recipient.uid === config.user1) {
      unreadCount1++;
    } else {
      unreadCount2++;
    }

    // Only update conversation metadata every N messages (reduces Firestore writes)
    // This simulates a more realistic pattern where metadata is batched
    if ((i + 1) % METADATA_UPDATE_INTERVAL === 0 || i === config.count - 1) {
      await conversationsRef.doc(conversationId).update({
        lastMessageAt: FieldValue.serverTimestamp(),
        lastMessage: { content: lastContent, senderId: lastSenderId, createdAt: FieldValue.serverTimestamp() },
        updatedAt: FieldValue.serverTimestamp(),
        [`unreadCount.${config.user1}`]: FieldValue.increment(unreadCount1),
        [`unreadCount.${config.user2}`]: FieldValue.increment(unreadCount2),
      });
      // Reset counters after update
      unreadCount1 = 0;
      unreadCount2 = 0;
    }

    // Progress indicator
    const progress = Math.round(((i + 1) / config.count) * 100);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    process.stdout.write(`\r  [${i + 1}/${config.count}] ${progress}% - ${elapsed}s - Last: "${content.substring(0, 40)}..."`);

    // Wait if not in burst mode
    if (!config.burst && i < config.count - 1) {
      await sleep(config.interval);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  const msgsPerSecond = (config.count / parseFloat(totalTime)).toFixed(2);

  console.log(`\n\n✅ Done! Generated ${config.count} messages in ${totalTime}s (${msgsPerSecond} msg/s)`);
  console.log(`\n📱 Open the conversation in the app to test performance:`);
  console.log(`   http://localhost:4200/messages/${conversationId}`);
}

main().catch(console.error);
