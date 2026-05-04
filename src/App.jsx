import React, { useState, useEffect, useRef } from "react";
import { auth, db } from "./firebase";
import { 
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  updateProfile 
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
  // --- States 設定 ---
  const [user, setUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState(""); 
  const [isRegistering, setIsRegistering] = useState(false);
  const scrollRef = useRef();

  // --- 監聽登入狀態 ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // --- 即時監聽資料庫訊息 ---
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "messages"), orderBy("createdAt"), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMessages(msgs);
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    });
    return () => unsubscribe();
  }, [user]);

  // --- 處理 Email 登入/註冊 (使用者輸入 Gmail) ---
  const handleEmailAuth = async (e) => {
    e.preventDefault();
    try {
      if (isRegistering) {
        // 註冊邏輯
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName: username });
        alert("註冊成功！歡迎 " + username);
      } else {
        // 登入邏輯
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) {
      // 處理常見錯誤
      if (error.code === 'auth/email-already-in-use') alert("此 Email 已被註冊");
      else if (error.code === 'auth/wrong-password') alert("密碼錯誤");
      else if (error.code === 'auth/user-not-found') alert("找不到此使用者");
      else alert("發生錯誤: " + error.message);
    }
  };

  const logout = () => signOut(auth);

  // --- 傳送訊息邏輯 ---
  const sendMessage = async (e) => {
    e.preventDefault();
    if (newMessage.trim() === "") return;

    await addDoc(collection(db, "messages"), {
      text: newMessage,
      createdAt: serverTimestamp(),
      uid: user.uid,
      displayName: user.displayName || user.email, 
    });
    setNewMessage("");
  };

  // --- 介面 1：未登入 (手動輸入介面) ---
  if (!user) {
    return (
      <div style={{ maxWidth: "400px", margin: "100px auto", padding: "30px", border: "1px solid #ddd", borderRadius: "15px", textAlign: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
        <h2 style={{ marginBottom: "20px", color: "#333" }}>{isRegistering ? "建立帳號" : "登入聊天室"}</h2>
        <form onSubmit={handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: "15px" }}>
          {isRegistering && (
            <input 
              type="text" 
              placeholder="你想顯示的暱稱" 
              value={username} 
              onChange={(e) => setUsername(e.target.value)} 
              required 
              style={{ padding: "12px", borderRadius: "8px", border: "1px solid #ccc" }}
            />
          )}
          <input 
            type="email" 
            placeholder="輸入你的 Gmail" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)} 
            required 
            style={{ padding: "12px", borderRadius: "8px", border: "1px solid #ccc" }}
          />
          <input 
            type="password" 
            placeholder="設定密碼 (至少6位)" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)} 
            required 
            style={{ padding: "12px", borderRadius: "8px", border: "1px solid #ccc" }}
          />
          <button type="submit" style={{ padding: "12px", background: "#4caf50", color: "white", border: "none", borderRadius: "8px", fontSize: "16px", cursor: "pointer" }}>
            {isRegistering ? "立即註冊" : "登入"}
          </button>
        </form>
        
        <div style={{ marginTop: "20px" }}>
          <button onClick={() => setIsRegistering(!isRegistering)} style={{ background: "none", border: "none", color: "#2196f3", cursor: "pointer", fontSize: "14px" }}>
            {isRegistering ? "已有帳號？返回登入" : "還沒有帳號？按此註冊"}
          </button>
        </div>
      </div>
    );
  }

  // --- 介面 2：已登入 (聊天室介面) ---
  return (
    <div className="chatroom-container" style={{ maxWidth: "800px", margin: "0 auto", height: "100vh", display: "flex", flexDirection: "column", background: "#f5f5f5" }}>
      <header style={{ display: "flex", justifyContent: "space-between", padding: "15px 25px", background: "#fff", borderBottom: "1px solid #ddd" }}>
        <span style={{ fontSize: "18px" }}>歡迎, <strong>{user.displayName || user.email}</strong></span>
        <button onClick={logout} style={{ background: "none", border: "1px solid #ff5252", color: "#ff5252", padding: "5px 15px", borderRadius: "5px", cursor: "pointer" }}>登出</button>
      </header>

      <main style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
        {messages.map((msg) => (
          <div key={msg.id} style={{ 
            textAlign: msg.uid === user.uid ? "right" : "left",
            margin: "15px 0"
          }}>
            <div style={{ fontSize: "12px", color: "#777", marginBottom: "4px" }}>{msg.displayName}</div>
            <div style={{ 
              display: "inline-block", 
              padding: "10px 18px", 
              borderRadius: "15px", 
              background: msg.uid === user.uid ? "#2196f3" : "#fff",
              color: msg.uid === user.uid ? "#white" : "#333",
              boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
              maxWidth: "70%",
              textAlign: "left"
            }}>
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={scrollRef}></div>
      </main>

      <form onSubmit={sendMessage} style={{ display: "flex", padding: "20px", background: "#fff", borderTop: "1px solid #ddd" }}>
        <input 
          value={newMessage} 
          onChange={(e) => setNewMessage(e.target.value)} 
          placeholder="輸入訊息..." 
          style={{ flex: 1, padding: "12px 20px", borderRadius: "25px", border: "1px solid #ddd", outline: "none" }}
        />
        <button type="submit" style={{ marginLeft: "15px", padding: "10px 25px", background: "#2196f3", color: "white", border: "none", borderRadius: "25px", cursor: "pointer" }}>傳送</button>
      </form>
    </div>
  );
}

export default App;