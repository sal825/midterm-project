import React, { useState, useEffect, useRef } from "react";
import { auth, db } from "./firebase";
import { 
  onAuthStateChanged, signOut, createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, updateProfile, updateEmail
} from "firebase/auth";
import { 
  collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, 
  where, getDocs, doc, updateDoc, arrayUnion, setDoc, getDoc 
} from "firebase/firestore";

// --- 進階功能：CSS 樣式與動畫 ---
const style = document.createElement('style');
style.textContent = `
  @keyframes messageSlideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  .message-bubble { animation: messageSlideIn 0.3s ease-out forwards; }
  .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 1000; }
  .modal-content { background: white; padding: 30px; border-radius: 15px; width: 400px; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
  .profile-input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; }
`;
document.head.appendChild(style);

function App() {
  const [user, setUser] = useState(null);
  const [rooms, setRooms] = useState([]); 
  const [activeRoom, setActiveRoom] = useState(null); 
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [allUsers, setAllUsers] = useState([]); 
  
  // User Profile States
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [profileData, setProfileData] = useState({
    displayName: "", photoURL: "", email: "", phone: "", address: ""
  });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState(""); 
  const [isRegistering, setIsRegistering] = useState(false);
  const scrollRef = useRef();

  // 1. 監聽登入：強化名稱抓取邏輯
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const userRef = doc(db, "users", currentUser.uid);
        const userSnap = await getDoc(userRef);
        const dbData = userSnap.exists() ? userSnap.data() : {};
        
        const MY_DEFAULT_AVATAR = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQX5yy5UXGD6VOurditkh6kO3et1ydkRMnzAw&s";

        const initialData = {
          uid: currentUser.uid,
          // 優先級：資料庫名稱 > Auth 顯示名稱 > 註冊時填寫的暫存名稱 > Email
          displayName: dbData.displayName || currentUser.displayName || username || currentUser.email, 
          photoURL: dbData.photoURL || currentUser.photoURL || MY_DEFAULT_AVATAR,
          email: currentUser.email || "",
          phone: dbData.phone || "",
          address: dbData.address || ""
        };
        
        setProfileData(initialData);
        setUser({ ...currentUser, displayName: initialData.displayName, photoURL: initialData.photoURL });
        await setDoc(userRef, initialData, { merge: true });

        if (Notification.permission !== "granted") Notification.requestPermission();
      } else {
        setUser(null);
      }
    });
    return () => unsubscribe();
  }, [username]); // 加入 username 依賴

  // 2. 獲取房間
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "rooms"), where("members", "array-contains", user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setRooms(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [user]);

  // 3. 訊息與通知
  useEffect(() => {
    if (!activeRoom || !user) return;
    const q = query(collection(db, "rooms", activeRoom.id, "messages"), orderBy("createdAt", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newMsgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      if (newMsgs.length > messages.length && messages.length > 0) {
        const lastMsg = newMsgs[newMsgs.length - 1];
        if (lastMsg.uid !== user.uid && document.visibilityState !== "visible") {
          new Notification(`新訊息來自 ${lastMsg.displayName}`, { body: lastMsg.text });
        }
      }
      setMessages(newMsgs);
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    });
    return () => unsubscribe();
  }, [activeRoom, user, messages.length]);

  // 4. 監聽所有人
  useEffect(() => {
    const q = query(collection(db, "users"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setAllUsers(snapshot.docs.map(doc => doc.data()));
    });
    return () => unsubscribe();
  }, []);

  const handleSaveProfile = async () => {
    try {
      if (profileData.email !== user.email) await updateEmail(auth.currentUser, profileData.email);
      await updateProfile(auth.currentUser, { displayName: profileData.displayName, photoURL: profileData.photoURL });
      await updateDoc(doc(db, "users", user.uid), {
        displayName: profileData.displayName,
        photoURL: profileData.photoURL,
        email: profileData.email,
        phone: profileData.phone,
        address: profileData.address
      });
      alert("更新成功！");
      setIsProfileOpen(false);
    } catch (e) { alert("儲存失敗: " + e.message); }
  };

  const getRoomDisplayName = (room) => {
    if (!room) return "";
    if (room.members && room.members.length === 2) {
      const otherId = room.members.find(uid => uid !== user.uid);
      const otherUser = allUsers.find(u => u.uid === otherId);
      return otherUser ? `與 ${otherUser.displayName} 的聊天` : "載入中...";
    }
    return room.name || "群組聊天";
  };

  const createRoom = async (targetUser) => {
    const existingRoom = rooms.find(room => room.members.length === 2 && room.members.includes(user.uid) && room.members.includes(targetUser.uid));
    if (existingRoom) { setActiveRoom(existingRoom); return; }
    const newRoomData = { name: `與 ${targetUser.displayName} 的聊天`, members: [user.uid, targetUser.uid], createdAt: serverTimestamp() };
    const docRef = await addDoc(collection(db, "rooms"), newRoomData);
    setActiveRoom({ id: docRef.id, ...newRoomData });
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (newMessage.trim() === "" || !activeRoom) return;
    const cleanText = newMessage.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    await addDoc(collection(db, "rooms", activeRoom.id, "messages"), {
      text: cleanText, createdAt: serverTimestamp(), uid: user.uid, displayName: user.displayName || user.email,
    });
    setNewMessage("");
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    try {
      if (isRegistering) {
        const res = await createUserWithEmailAndPassword(auth, email, password);
        // 註冊時立刻更新 Auth Profile
        await updateProfile(res.user, { 
          displayName: username,
          photoURL: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQX5yy5UXGD6VOurditkh6kO3et1ydkRMnzAw&s"
        });
        // 註冊時立刻寫入 Firestore 確保資料一致
        await setDoc(doc(db, "users", res.user.uid), {
          uid: res.user.uid,
          displayName: username,
          email: email,
          photoURL: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQX5yy5UXGD6VOurditkh6kO3et1ydkRMnzAw&s",
          phone: "", address: ""
        });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) { alert(error.message); }
  };

  if (!user) {
    return (
      <div style={{ maxWidth: "400px", margin: "100px auto", padding: "30px", border: "1px solid #ddd", borderRadius: "15px", textAlign: "center" }}>
        <h2>{isRegistering ? "註冊" : "登入"}</h2>
        <form onSubmit={handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {isRegistering && <input placeholder="暱稱" onChange={e => setUsername(e.target.value)} required style={{ padding: "10px" }} />}
          <input placeholder="Gmail" onChange={e => setEmail(e.target.value)} required style={{ padding: "10px" }} />
          <input type="password" placeholder="密碼" onChange={e => setPassword(e.target.value)} required style={{ padding: "10px" }} />
          <button type="submit" style={{ padding: "10px", background: "#4caf50", color: "#fff", border: "none", borderRadius: "5px" }}>{isRegistering ? "立即註冊" : "立即登入"}</button>
        </form>
        <button onClick={() => setIsRegistering(!isRegistering)} style={{ marginTop: "15px", background: "none", border: "none", color: "blue", cursor: "pointer" }}>{isRegistering ? "已有帳號？返回登入" : "還沒有帳號？按此註冊"}</button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: "#f0f2f5", fontFamily: "sans-serif" }}>
      {/* User Profile Modal (10%) */}
      {isProfileOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>編輯個人資料</h3>
            <label>頭像網址:</label>
            <input className="profile-input" value={profileData.photoURL} onChange={e => setProfileData({...profileData, photoURL: e.target.value})} />
            <label>使用者名稱:</label>
            <input className="profile-input" value={profileData.displayName} onChange={e => setProfileData({...profileData, displayName: e.target.value})} />
            <label>Email:</label>
            <input className="profile-input" value={profileData.email} onChange={e => setProfileData({...profileData, email: e.target.value})} placeholder="請輸入新 Email"/>
            <label>電話:</label>
            <input className="profile-input" value={profileData.phone} onChange={e => setProfileData({...profileData, phone: e.target.value})} />
            <label>地址:</label>
            <input className="profile-input" value={profileData.address} onChange={e => setProfileData({...profileData, address: e.target.value})} />
            <div style={{ display: "flex", gap: "10px", marginTop: "10px" }}>
              <button onClick={handleSaveProfile} style={{ flex: 1, padding: "10px", background: "#0084ff", color: "white", border: "none", borderRadius: "5px", cursor: "pointer" }}>儲存</button>
              <button onClick={() => setIsProfileOpen(false)} style={{ flex: 1, padding: "10px", background: "#eee", border: "none", borderRadius: "5px", cursor: "pointer" }}>取消</button>
            </div>
          </div>
        </div>
      )}

      {/* 側邊欄 */}
      <div style={{ width: "300px", background: "#fff", borderRight: "1px solid #ddd", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px", borderBottom: "1px solid #ddd", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div onClick={() => setIsProfileOpen(true)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "10px" }}>
            <img src={profileData.photoURL} style={{ width: "30px", height: "30px", borderRadius: "50%", objectFit: "cover" }} alt="me" />
            <strong style={{ maxWidth: "150px", overflow: "hidden", textOverflow: "ellipsis" }}>{profileData.displayName}</strong>
          </div>
          <button onClick={() => signOut(auth)} style={{ padding: "5px 10px", fontSize: "12px" }}>登出</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "10px 20px", background: "#f8f9fa", fontSize: "13px", color: "#666", fontWeight: "bold" }}>我的聊天室</div>
          {rooms.map(room => (
            <div key={room.id} onClick={() => setActiveRoom(room)} style={{ padding: "15px 20px", cursor: "pointer", background: activeRoom?.id === room.id ? "#e6f2ff" : "none", borderBottom: "1px solid #eee" }}>
              {getRoomDisplayName(room)}
            </div>
          ))}
          <div style={{ padding: "10px 20px", background: "#f8f9fa", fontSize: "13px", color: "#666", fontWeight: "bold", marginTop: "10px" }}>發起新聊天</div>
          {allUsers.filter(u => u.uid !== user.uid && !rooms.some(r => r.members.length === 2 && r.members.includes(u.uid))).map(u => (
            <div key={u.uid} onClick={() => createRoom(u)} style={{ padding: "12px 20px", cursor: "pointer", fontSize: "14px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <img src={u.photoURL} style={{ width: "25px", height: "25px", borderRadius: "50%", objectFit: "cover" }} alt="u" />
                <span>{u.displayName}</span>
              </div>
              <span style={{ color: "#0084ff" }}>➕</span>
            </div>
          ))}
        </div>
      </div>

      {/* 聊天視窗 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {activeRoom ? (
          <>
            <header style={{ padding: "15px 25px", background: "#fff", borderBottom: "1px solid #ddd" }}>
              <span style={{ fontWeight: "bold", fontSize: "18px" }}>{getRoomDisplayName(activeRoom)}</span>
            </header>
            <main style={{ flex: 1, overflowY: "auto", padding: "20px", background: "#fff" }}>
              {messages.map(msg => {
                const sender = allUsers.find(u => u.uid === msg.uid);
                return (
                  <div key={msg.id} style={{ textAlign: msg.uid === user.uid ? "right" : "left", margin: "15px 0" }}>
                    <div style={{ display: "flex", flexDirection: msg.uid === user.uid ? "row-reverse" : "row", alignItems: "flex-end", gap: "8px" }}>
                      <img src={sender?.photoURL} style={{ width: "35px", height: "35px", borderRadius: "50%", objectFit: "cover", background: "#eee" }} alt="avatar" />
                      <div>
                        <div style={{ fontSize: "11px", color: "#888", marginBottom: "4px" }}>{sender?.displayName || msg.displayName}</div>
                        <div className="message-bubble" style={{ 
                          display: "inline-block", padding: "10px 15px", borderRadius: "18px", 
                          background: msg.uid === user.uid ? "#0084ff" : "#e4e6eb", color: msg.uid === user.uid ? "#fff" : "#000",
                          maxWidth: "250px", wordBreak: "break-word", textAlign: "left"
                        }}>{msg.text}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={scrollRef}></div>
            </main>
            <form onSubmit={sendMessage} style={{ padding: "20px", background: "#fff", borderTop: "1px solid #ddd", display: "flex" }}>
              <input value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder="輸入訊息..." style={{ flex: 1, padding: "12px 20px", borderRadius: "25px", border: "1px solid #ddd", outline: "none" }} />
              <button type="submit" style={{ marginLeft: "10px", padding: "10px 25px", background: "#0084ff", color: "#fff", border: "none", borderRadius: "25px", cursor: "pointer", fontWeight: "bold" }}>傳送</button>
            </form>
          </>
        ) : (
          <div style={{ margin: "auto", color: "#999", textAlign: "center" }}><h3>請選擇好友開始聊天</h3></div>
        )}
      </div>
    </div>
  );
}

export default App;