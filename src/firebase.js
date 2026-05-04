import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";        // 💡 補上這個：處理登入
import { getFirestore } from "firebase/firestore"; // 💡 補上這個：處理資料庫

const firebaseConfig = {
  apiKey: "AIzaSyBXwWOvlnUwiN9o3Kw66GdcHBhfRJUK83Q",
  authDomain: "chatroom-f605d.firebaseapp.com",
  projectId: "chatroom-f605d",
  storageBucket: "chatroom-f605d.firebasestorage.app",
  messagingSenderId: "46025055233",
  appId: "1:46025055233:web:f940f68360fbb34e0e7400",
  measurementId: "G-T5H28CB0MF",
  databaseURL: "https://chatroom-f605d-default-rtdb.firebaseio.com/"
};

// 1. 初始化 Firebase App
const app = initializeApp(firebaseConfig);

// 2. 💡 建立並導出功能，這樣 App.jsx 才能 import 它們
export const auth = getAuth(app);
export const db = getFirestore(app);

// 如果你想保留原本的 analytics 也可以
// export const analytics = getAnalytics(app);