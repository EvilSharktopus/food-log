const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const messaging = admin.messaging();

// Helper to get today's date formatted as YYYY-MM-DD in America/Edmonton timezone
function getTodayEdmontonStr() {
  const options = { timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options);
  return formatter.format(new Date()); // Outputs YYYY-MM-DD
}

// Send FCM message to all active tokens
async function sendPushNotification(title, body, data = {}) {
  const tokensSnap = await db.collection('fcm_tokens').get();
  if (tokensSnap.empty) {
    console.log('No FCM tokens registered.');
    return;
  }

  const tokens = [];
  tokensSnap.forEach(doc => {
    if (doc.data().token) tokens.push(doc.data().token);
  });

  if (tokens.length === 0) return;

  const message = {
    notification: { title, body },
    data: { url: 'https://food.mcraesocial.com', ...data },
    tokens
  };

  try {
    const response = await messaging.sendEachForMulticast(message);
    console.log(`Successfully sent push notifications: ${response.successCount} succeeded, ${response.failureCount} failed.`);
  } catch (err) {
    console.error('Error sending multicast message:', err);
  }
}

// 19:45 Evening Nutrition Check
exports.eveningNutritionCheck = onSchedule(
  {
    schedule: '45 19 * * *',
    timeZone: 'America/Edmonton'
  },
  async event => {
    const todayStr = getTodayEdmontonStr();
    const docRef = db.collection('food_logs').doc(todayStr);
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      await sendPushNotification('Evening Nutrition Check', 'Nothing logged yet today. Tap to log your meals.');
      return;
    }

    const data = docSnap.data() || {};
    const foodEntries = data.foodEntries || [];
    const activities = data.activities || [];
    const garminBurnOverride = data.garminBurnOverride;

    const totalKcal = foodEntries.reduce((sum, item) => sum + (Number(item.kcal) || 0), 0);
    const totalProtein = foodEntries.reduce((sum, item) => sum + (Number(item.protein) || 0), 0);

    const isTrainingDay = activities.length > 0;
    const calorieTarget = isTrainingDay ? 2600 : 2300;
    const remainingKcal = calorieTarget - totalKcal;
    const proteinShort = 180 - totalProtein;

    let bodyMsg = '';
    if (foodEntries.length === 0) {
      bodyMsg = 'Nothing logged yet today. Tap to log your meals.';
    } else if (remainingKcal >= 250) {
      bodyMsg = `${remainingKcal} kcal left.`;
      if (proteinShort > 0) {
        bodyMsg += ` ${proteinShort}g short on protein — make your snack protein-forward.`;
      }
    } else if (remainingKcal > 0) {
      bodyMsg = `Only ${remainingKcal} kcal left. This is the window — water first, wait 20 mins.`;
    } else {
      bodyMsg = `${Math.abs(remainingKcal)} kcal over target. Kitchen's closed.`;
    }

    await sendPushNotification('Evening Check-in', bodyMsg);
  }
);

// 20:00 Daily Rehab Nudge
exports.eveningRehabCheck = onSchedule(
  {
    schedule: '0 20 * * *',
    timeZone: 'America/Edmonton'
  },
  async event => {
    const todayStr = getTodayEdmontonStr();
    const docSnap = await db.collection('food_logs').doc(todayStr).get();

    const data = docSnap.exists ? docSnap.data() : {};
    const rehabTicks = data.rehabTicks || [];

    if (rehabTicks.length === 0) {
      await sendPushNotification('Rehab Check-in', 'Rehab not logged. Five minutes before bed.');
    }
  }
);
