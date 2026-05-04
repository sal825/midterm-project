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
  const [rooms, setRooms] = useState([]); // 我加入的房間列表
  const [activeRoom, setActiveRoom] = useState(null); // 目前選中的房間
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [allUsers, setAllUsers] = useState([]); // 系統內所有使用者 (用於邀請)
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState(""); 
  const [isRegistering, setIsRegistering] = useState(false);
  const scrollRef = useRef();

  // 1. 監聽登入狀態
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // 登入後將自己資訊存入 users 集合，方便別人邀請
        setDoc(doc(db, "users", currentUser.uid), {
          uid: currentUser.uid,
          displayName: currentUser.displayName || currentUser.email,
          email: currentUser.email
        });
      }
    });
    return () => unsubscribe();
  }, []);

  // 2. 獲取我參與的房間 (根據 members 欄位含有我的 UID)
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "rooms"), where("members", "array-contains", user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setRooms(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return () => unsubscribe();
  }, [user]);

  // 3. 獲取目前房間的訊息 (歷史紀錄)
  useEffect(() => {
    if (!activeRoom) return;
    const q = query(collection(db, "rooms", activeRoom.id, "messages"), orderBy("createdAt", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    });
    return () => unsubscribe();
  }, [activeRoom]);

  // 4. 獲取所有使用者列表 (用於發起聊天)
  useEffect(() => {
    if (!user) return;
    const fetchUsers = async () => {
      const snapshot = await getDocs(collection(db, "users"));
      setAllUsers(snapshot.docs.map(doc => doc.data()).filter(u => u.uid !== user.uid));
    };
    fetchUsers();
  }, [user]);

  // 功能：建立新房間 (私訊)
  const createRoom = async (targetUser) => {
    const roomName = `與 ${targetUser.displayName} 的聊天`;
    await addDoc(collection(db, "rooms"), {
      name: roomName,
      members: [user.uid, targetUser.uid],
      createdAt: serverTimestamp(),
    });
  };

  // 功能：邀請新成員 (群組邏輯)
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
          {isRegistering && <input placeholder="暱稱" onChange={e => setUsername(e.target.value)} required />}
          <input placeholder="Gmail" onChange={e => setEmail(e.target.value)} required />
          <input type="password" placeholder="密碼" onChange={e => setPassword(e.target.value)} required />
          <button type="submit">{isRegistering ? "註冊" : "登入"}</button>
        </form>
        <button onClick={() => setIsRegistering(!isRegistering)} style={{ marginTop: "10px", background: "none", border: "none", color: "blue" }}>
          切換至 {isRegistering ? "登入" : "註冊"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: "#f0f2f5" }}>
      {/* 側邊欄：房間列表與好友列表 */}
      <div style={{ width: "300px", background: "#fff", borderRight: "1px solid #ddd", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px", borderBottom: "1px solid #ddd" }}>
          <strong>{user.displayName}</strong> <button onClick={() => signOut(auth)}>登出</button>
        </div>
        
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "10px", background: "#eee" }}>我的聊天室</div>
          {rooms.map(room => (
            <div key={room.id} onClick={() => setActiveRoom(room)} 
                 style={{ padding: "15px", cursor: "pointer", background: activeRoom?.id === room.id ? "#e6f2ff" : "none", borderBottom: "1px solid #eee" }}>
              {room.name}
            </div>
          ))}
          
          <div style={{ padding: "10px", background: "#eee" }}>發起新聊天 (所有使用者)</div>
          {allUsers.map(u => (
            <div key={u.uid} onClick={() => createRoom(u)} style={{ padding: "10px", cursor: "pointer", fontSize: "14px", borderBottom: "1px solid #eee" }}>
              ➕ {u.displayName}
            </div>
          ))}
        </div>
      </div>

      {/* 主聊天視窗 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {activeRoom ? (
          <>
            <header style={{ padding: "15px", background: "#fff", borderBottom: "1px solid #ddd", display: "flex", justifyContent: "space-between" }}>
              <strong>{activeRoom.name}</strong>
              <button onClick={inviteMember}>邀請成員加入房間</button>
            </header>
            
            <main style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
              {messages.map(msg => (
                <div key={msg.id} style={{ textAlign: msg.uid === user.uid ? "right" : "left", margin: "10px 0" }}>
                  <div style={{ fontSize: "10px", color: "#888" }}>{msg.displayName}</div>
                  <div style={{ display: "inline-block", padding: "10px", borderRadius: "10px", background: msg.uid === user.uid ? "#0084ff" : "#e4e6eb", color: msg.uid === user.uid ? "#fff" : "#000" }}>
                    {msg.text}
                  </div>
                </div>
              ))}
              <div ref={scrollRef}></div>
            </main>

            <form onSubmit={sendMessage} style={{ padding: "20px", background: "#fff", display: "flex" }}>
              <input value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder="輸入訊息..." style={{ flex: 1, padding: "10px", borderRadius: "20px", border: "1px solid #ddd" }} />
              <button type="submit" style={{ marginLeft: "10px" }}>傳送</button>
            </form>
          </>
        ) : (
          <div style={{ margin: "auto", color: "#888" }}>請選擇一個房間開始聊天</div>
        )}
      </div>
    </div>
  );
}

export default App;