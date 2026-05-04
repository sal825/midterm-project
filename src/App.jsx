import React, { useState, useEffect, useRef } from "react";
import { auth, db } from "./firebase";
import { 
  onAuthStateChanged, signOut, createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, updateProfile 
} from "firebase/auth";
import { 
  collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, 
  where, getDocs, doc, updateDoc, arrayUnion, setDoc 
} from "firebase/firestore";

function App() {
  const [user, setUser] = useState(null);
  const [rooms, setRooms] = useState([]); 
  const [activeRoom, setActiveRoom] = useState(null); 
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [allUsers, setAllUsers] = useState([]); 
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState(""); 
  const [isRegistering, setIsRegistering] = useState(false);
  const scrollRef = useRef();

  // 1. 監聽登入狀態並更新個人資料至資料庫
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setDoc(doc(db, "users", currentUser.uid), {
          uid: currentUser.uid,
          displayName: currentUser.displayName || currentUser.email,
          email: currentUser.email
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. 獲取我參與的房間
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "rooms"), where("members", "array-contains", user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setRooms(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [user]);

  // 3. 獲取目前選中房間的訊息
  useEffect(() => {
    if (!activeRoom) return;
    const q = query(collection(db, "rooms", activeRoom.id, "messages"), orderBy("createdAt", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    });
    return () => unsubscribe();
  }, [activeRoom]);

  // 4. 獲取系統內所有使用者 (用於動態顯示名稱與發起聊天)
  useEffect(() => {
    if (!user) return;
    const fetchUsers = async () => {
      const snapshot = await getDocs(collection(db, "users"));
      setAllUsers(snapshot.docs.map(doc => doc.data())); // 這裡存入所有人，不 filter 掉自己
    };
    fetchUsers();
  }, [user]);

  // --- 關鍵修改：動態取得房間顯示名稱 ---
  const getRoomDisplayName = (room) => {
    if (!room) return "";
    // 如果是 1 對 1 私訊 (成員剛好 2 人)
    if (room.members && room.members.length === 2) {
      const otherId = room.members.find(uid => uid !== user.uid);
      const otherUser = allUsers.find(u => u.uid === otherId);
      return otherUser ? `與 ${otherUser.displayName} 的聊天` : "載入中...";
    }
    // 如果是群組聊天
    return room.name || "群組聊天";
  };

  // 建立新房間邏輯
  const createRoom = async (targetUser) => {
    const existingRoom = rooms.find(room => 
      room.members.length === 2 && 
      room.members.includes(user.uid) && 
      room.members.includes(targetUser.uid)
    );

    if (existingRoom) {
      setActiveRoom(existingRoom);
      return;
    }

    const newRoomData = {
      name: `與 ${targetUser.displayName} 的聊天`, // 初始名稱，但顯示時會被動態計算取代
      members: [user.uid, targetUser.uid],
      createdAt: serverTimestamp(),
    };

    const docRef = await addDoc(collection(db, "rooms"), newRoomData);
    setActiveRoom({ id: docRef.id, ...newRoomData });
  };

  const inviteMember = async () => {
    const targetEmail = prompt("請輸入要邀請的成員 Email:");
    if (!targetEmail || !activeRoom) return;

    const q = query(collection(db, "users"), where("email", "==", targetEmail));
    const querySnapshot = await getDocs(q);
    if (querySnapshot.empty) {
      alert("找不到該使用者");
      return;
    }
    const targetUid = querySnapshot.docs[0].data().uid;
    await updateDoc(doc(db, "rooms", activeRoom.id), {
      members: arrayUnion(targetUid)
    });
    alert("邀請成功！");
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    try {
      if (isRegistering) {
        const res = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(res.user, { displayName: username });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error) { alert(error.message); }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (newMessage.trim() === "" || !activeRoom) return;
    await addDoc(collection(db, "rooms", activeRoom.id, "messages"), {
      text: newMessage,
      createdAt: serverTimestamp(),
      uid: user.uid,
      displayName: user.displayName || user.email,
    });
    setNewMessage("");
  };

  if (!user) {
    return (
      <div style={{ maxWidth: "400px", margin: "100px auto", padding: "30px", border: "1px solid #ddd", borderRadius: "15px", textAlign: "center" }}>
        <h2>{isRegistering ? "註冊" : "登入"}</h2>
        <form onSubmit={handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {isRegistering && <input placeholder="暱稱" onChange={e => setUsername(e.target.value)} required style={{ padding: "10px" }} />}
          <input placeholder="Gmail" onChange={e => setEmail(e.target.value)} required style={{ padding: "10px" }} />
          <input type="password" placeholder="密碼" onChange={e => setPassword(e.target.value)} required style={{ padding: "10px" }} />
          <button type="submit" style={{ padding: "10px", background: "#4caf50", color: "#fff", border: "none", borderRadius: "5px" }}>
            {isRegistering ? "立即註冊" : "立即登入"}
          </button>
        </form>
        <button onClick={() => setIsRegistering(!isRegistering)} style={{ marginTop: "15px", background: "none", border: "none", color: "blue", cursor: "pointer" }}>
          {isRegistering ? "已有帳號？返回登入" : "還沒有帳號？按此註冊"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: "#f0f2f5", fontFamily: "sans-serif" }}>
      {/* 側邊欄 */}
      <div style={{ width: "300px", background: "#fff", borderRight: "1px solid #ddd", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px", borderBottom: "1px solid #ddd", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong>{user.displayName}</strong> 
          <button onClick={() => signOut(auth)} style={{ padding: "5px 10px", fontSize: "12px" }}>登出</button>
        </div>
        
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "10px 20px", background: "#f8f9fa", fontSize: "13px", color: "#666", fontWeight: "bold" }}>我的聊天室</div>
          {rooms.map(room => (
            <div key={room.id} onClick={() => setActiveRoom(room)} 
                 style={{ padding: "15px 20px", cursor: "pointer", background: activeRoom?.id === room.id ? "#e6f2ff" : "none", borderBottom: "1px solid #eee", transition: "0.2s" }}>
              {/* 使用動態顯示名稱 */}
              {getRoomDisplayName(room)}
            </div>
          ))}
          
          <div style={{ padding: "10px 20px", background: "#f8f9fa", fontSize: "13px", color: "#666", fontWeight: "bold", marginTop: "10px" }}>
            發起新聊天
          </div>
          {allUsers
            .filter(u => {
              // 1. 過濾掉自己
              if (u.uid === user.uid) return false;
              // 2. 過濾掉已經有 1 對 1 房間的人
              const alreadyHasRoom = rooms.some(r => r.members.length === 2 && r.members.includes(u.uid));
              return !alreadyHasRoom;
            })
            .map(u => (
              <div key={u.uid} onClick={() => createRoom(u)} 
                  style={{ padding: "12px 20px", cursor: "pointer", fontSize: "14px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between" }}>
                <span>{u.displayName}</span>
                <span style={{ color: "#0084ff" }}>➕</span>
              </div>
            ))
          }
        </div>
      </div>

      {/* 主聊天視窗 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {activeRoom ? (
          <>
            <header style={{ padding: "15px 25px", background: "#fff", borderBottom: "1px solid #ddd", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: "bold", fontSize: "18px" }}>
                {/* 使用動態顯示名稱 */}
                {getRoomDisplayName(activeRoom)}
              </span>
              <button onClick={inviteMember} style={{ padding: "8px 15px", borderRadius: "5px", border: "1px solid #0084ff", color: "#0084ff", background: "#fff", cursor: "pointer" }}>
                邀請成員
              </button>
            </header>
            
            <main style={{ flex: 1, overflowY: "auto", padding: "20px", background: "#fff" }}>
              {messages.map(msg => (
                <div key={msg.id} style={{ textAlign: msg.uid === user.uid ? "right" : "left", margin: "15px 0" }}>
                  <div style={{ fontSize: "11px", color: "#888", marginBottom: "4px" }}>{msg.displayName}</div>
                  <div style={{ 
                    display: "inline-block", 
                    padding: "10px 15px", 
                    borderRadius: "18px", 
                    background: msg.uid === user.uid ? "#0084ff" : "#e4e6eb", 
                    color: msg.uid === user.uid ? "#fff" : "#000",
                    maxWidth: "70%",
                    wordBreak: "break-word"
                  }}>
                    {msg.text}
                  </div>
                </div>
              ))}
              <div ref={scrollRef}></div>
            </main>

            <form onSubmit={sendMessage} style={{ padding: "20px", background: "#fff", borderTop: "1px solid #ddd", display: "flex" }}>
              <input 
                value={newMessage} 
                onChange={e => setNewMessage(e.target.value)} 
                placeholder="輸入訊息..." 
                style={{ flex: 1, padding: "12px 20px", borderRadius: "25px", border: "1px solid #ddd", outline: "none" }} 
              />
              <button type="submit" style={{ marginLeft: "10px", padding: "10px 25px", background: "#0084ff", color: "#fff", border: "none", borderRadius: "25px", cursor: "pointer", fontWeight: "bold" }}>
                傳送
              </button>
            </form>
          </>
        ) : (
          <div style={{ margin: "auto", color: "#999", textAlign: "center" }}>
            <h3>歡迎來到 NTHU 聊天室</h3>
            <p>從左側選擇一個好友或點擊 ➕ 開始新對話</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;