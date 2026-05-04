import React, { useState, useEffect, useRef } from "react";
import { auth, db } from "./firebase";
import { 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged 
} from "firebase/auth";
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp 
} from "firebase/firestore";

function App() {
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const scrollRef = useRef();

  // 1. 監聽登入狀態
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // 2. 即時監聽資料庫訊息 (Database read)
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "messages"), orderBy("createdAt"), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMessages(msgs);
      // 自動捲動到底部
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    });
    return () => unsubscribe();
  }, [user]);

  // 3. 傳送訊息 (Database write)
  const sendMessage = async (e) => {
    e.preventDefault();
    if (newMessage.trim() === "") return;

    await addDoc(collection(db, "messages"), {
      text: newMessage,
      createdAt: serverTimestamp(),
      uid: user.uid,
      displayName: user.displayName,
      photoURL: user.photoURL,
    });
    setNewMessage("");
  };

  const login = () => signInWithPopup(auth, new GoogleAuthProvider());
  const logout = () => signOut(auth);

  if (!user) {
    return (
      <div style={{ display: "flex", justifyContent: "center", marginTop: "100px" }}>
        <button onClick={login} style={{ padding: "10px 20px", fontSize: "16px" }}>
          使用 Google 登入聊天室
        </button>
      </div>
    );
  }

  return (
    <div className="chatroom-container" style={{ maxWidth: "600px", margin: "0 auto", height: "100vh", display: "flex", flexDirection: "column" }}>
      <header style={{ display: "flex", justifyContent: "space-between", padding: "10px", background: "#eee" }}>
        <span>你好, {user.displayName}</span>
        <button onClick={logout}>登出</button>
      </header>

      <main style={{ flex: 1, overflowY: "auto", padding: "20px", border: "1px solid #ddd" }}>
        {messages.map((msg) => (
          <div key={msg.id} style={{ 
            textAlign: msg.uid === user.uid ? "right" : "left",
            margin: "10px 0"
          }}>
            <div style={{ 
              display: "inline-block", 
              padding: "8px 12px", 
              borderRadius: "15px", 
              background: msg.uid === user.uid ? "#007bff" : "#e9e9eb",
              color: msg.uid === user.uid ? "white" : "black"
            }}>
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={scrollRef}></div>
      </main>

      <form onSubmit={sendMessage} style={{ display: "flex", padding: "10px" }}>
        <input 
          value={newMessage} 
          onChange={(e) => setNewMessage(e.target.value)} 
          placeholder="輸入訊息.." 
          style={{ flex: 1, padding: "10px" }}
        />
        <button type="submit" style={{ padding: "10px 20px" }}>傳送</button>
      </form>
    </div>
  );
}

export default App;