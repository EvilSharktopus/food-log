// Firebase FCM Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBntACQyO30LiXg1oid74oewFsjvTu5PUQ",
  authDomain: "personal-214d2.firebaseapp.com",
  projectId: "personal-214d2",
  storageBucket: "personal-214d2.firebasestorage.app",
  messagingSenderId: "532101043328",
  appId: "1:532101043328:web:2144677c9ab750c3bd8265"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);
  const notificationTitle = payload.notification?.title || 'Daily Log Update';
  const notificationOptions = {
    body: payload.notification?.body || '',
    icon: '/food/assets/icon-192.png',
    data: payload.data
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});
