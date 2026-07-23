// Firebase FCM Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBfQNvbEDERrDoM816JFmtkOKBsCXFYXCI",
  authDomain: "project-7910201586224417193.firebaseapp.com",
  projectId: "project-7910201586224417193",
  storageBucket: "project-7910201586224417193.firebasestorage.app",
  messagingSenderId: "885278922704",
  appId: "1:885278922704:web:feea02463fa11035094bd5"
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
