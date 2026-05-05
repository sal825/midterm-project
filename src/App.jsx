import React, { useState, useEffect, useRef } from "react";
import { auth, db } from "./firebase";
import { 
  onAuthStateChanged, signOut, createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, updateProfile, updateEmail,
  GoogleAuthProvider, signInWithPopup // 引入 Google 登入所需組件[cite: 1]
} from "firebase/auth";
import { 
  collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, 
  where, getDocs, doc, updateDoc, arrayUnion, setDoc, getDoc, deleteDoc, limit
} from "firebase/firestore";

// --- CSS 樣式 ---
const style = document.createElement('style');
style.textContent = `
  @keyframes messageSlideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  .message-bubble { animation: messageSlideIn 0.3s ease-out forwards; position: relative; }
  .modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center; z-index: 1000; }
  .modal-content { background: white; padding: 30px; border-radius: 15px; width: 450px; max-height: 80vh; overflow-y: auto; box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
  .profile-input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ddd; border-radius: 5px; box-sizing: border-box; }
  .user-select-item { display: flex; align-items: center; justify-content: space-between; padding: 10px; border-bottom: 1px solid #eee; cursor: pointer; }
  .user-select-item:hover { background: #f0f7ff; }
  .sidebar-avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: #eee; flex-shrink: 0; }
  button:disabled { background: #ccc !important; cursor: not-allowed; }
  
  .msg-action-bar { display: flex; gap: 8px; font-size: 12px; margin-top: 4px; opacity: 0; transition: 0.2s; }
  .message-container:hover .msg-action-bar { opacity: 1; }
  .action-btn { cursor: pointer; color: #666; background: none; border: none; padding: 0; text-decoration: underline; }
  .action-btn:hover { color: #0084ff; }
  .search-bar { padding: 8px 15px; border-radius: 20px; border: 1px solid #ddd; width: 200px; outline: none; font-size: 14px; }
  .image-preview { max-width: 250px; border-radius: 10px; cursor: pointer; margin-top: 5px; }

  /* Google 登入按鈕樣式[cite: 1] */
  .google-btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 10px; margin-top: 10px; background: white; border: 1px solid #ddd; border-radius: 5px; cursor: pointer; font-weight: bold; }
  .google-btn:hover { background: #f9f9f9; }
`;
document.head.appendChild(style);

function App() {
  const [user, setUser] = useState(null);
  const [rooms, setRooms] = useState([]); 
  const [activeRoom, setActiveRoom] = useState(null); 
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [allUsers, setAllUsers] = useState([]); 
  
  const [searchTerm, setSearchTerm] = useState(""); 
  const [editingId, setEditingId] = useState(null); 
  const [editText, setEditText] = useState("");     

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [addingIds, setAddingIds] = useState([]); 
  const [profileData, setProfileData] = useState({ displayName: "", photoURL: "", email: "", phone: "", address: "" });

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState(""); 
  const [isRegistering, setIsRegistering] = useState(false);
  
  const scrollRef = useRef();
  const activeRoomRef = useRef(null);
  const fileInputRef = useRef(); 

  const MY_DEFAULT_AVATAR = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQX5yy5UXGD6VOurditkh6kO3et1ydkRMnzAw&s";
  const GROUP_DEFAULT_AVATAR = "https://cdn-icons-png.flaticon.com/512/615/615075.png";

  useEffect(() => { activeRoomRef.current = activeRoom; }, [activeRoom]);

  // --- XSS 防禦函式 (2%)[cite: 1] ---
  const sanitize = (str) => {
    if (!str) return "";
    return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const userRef = doc(db, "users", currentUser.uid);
        const userSnap = await getDoc(userRef);
        const dbData = userSnap.exists() ? userSnap.data() : {};
        if (!currentUser.photoURL) await updateProfile(currentUser, { photoURL: MY_DEFAULT_AVATAR });

        const initialData = {
          uid: currentUser.uid,
          displayName: sanitize(dbData.displayName || currentUser.displayName || username || currentUser.email), 
          photoURL: dbData.photoURL || currentUser.photoURL || MY_DEFAULT_AVATAR,
          email: currentUser.email || "",
          phone: dbData.phone || "",
          address: dbData.address || ""
        };
        setProfileData(initialData);
        setUser({ ...currentUser, displayName: initialData.displayName, photoURL: initialData.photoURL });
        await setDoc(userRef, initialData, { merge: true });
        if (Notification.permission === "default") Notification.requestPermission();
      } else { setUser(null); }
    });
    return () => unsubscribe();
  }, [username]);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, "rooms"), where("members", "array-contains", user.uid));
    const unsubscribeRooms = onSnapshot(q, (snapshot) => {
      const roomList = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRooms(roomList);
    });
    const unsubscribeUsers = onSnapshot(collection(db, "users"), (snapshot) => {
      setAllUsers(snapshot.docs.map(doc => doc.data()));
    });
    return () => { unsubscribeRooms(); unsubscribeUsers(); };
  }, [user]);

  useEffect(() => {
    if (!user || rooms.length === 0) return;
    const listeners = rooms.map(room => {
      const q = query(collection(db, "rooms", room.id, "messages"), orderBy("createdAt", "desc"), limit(1));
      let isFirstLoad = true;
      return onSnapshot(q, (snapshot) => {
        if (isFirstLoad) { isFirstLoad = false; return; }
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added") {
            const msgData = change.doc.data();
            // 未讀通知邏輯優化 (5%): 判斷發送者及目前視窗[cite: 1]
            if (msgData.uid !== user.uid && activeRoomRef.current?.id !== room.id) {
              sendBrowserNotification(room, msgData);
            }
          }
        });
      });
    });
    return () => listeners.forEach(unsub => unsub());
  }, [rooms, user]);

  useEffect(() => {
    if (!activeRoom || !user) return;
    const q = query(collection(db, "rooms", activeRoom.id, "messages"), orderBy("createdAt", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    });
    return () => unsubscribe();
  }, [activeRoom, user]);

  
  const handleUnsend = async (msgId) => {
    if (window.confirm("確定要回收此訊息嗎？")) {
      await deleteDoc(doc(db, "rooms", activeRoom.id, "messages", msgId));
    }
  };

  // 編輯訊息 - 套用 XSS 防禦 (2%)[cite: 1]
  const handleEdit = async (msgId) => {
    if (!editText.trim()) return;
    await updateDoc(doc(db, "rooms", activeRoom.id, "messages", msgId), {
      text: sanitize(editText), 
      isEdited: true
    });
    setEditingId(null);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      await addDoc(collection(db, "rooms", activeRoom.id, "messages"), {
        imageUrl: event.target.result,
        createdAt: serverTimestamp(),
        uid: user.uid,
        displayName: user.displayName,
      });
    };
    reader.readAsDataURL(file);
  };

  // 未讀通知標題優化[cite: 1]
  const sendBrowserNotification = (room, msg) => {
    if (Notification.permission === "granted") {
      const title = `[未讀訊息] ${room.isGroup ? room.name : msg.displayName}`; 
      const options = {
        body: msg.imageUrl ? "傳送了一張圖片" : msg.text,
        icon: room.isGroup ? GROUP_DEFAULT_AVATAR : (allUsers.find(u => u.uid === msg.uid)?.photoURL || MY_DEFAULT_AVATAR),
        silent: false
      };
      const n = new Notification(title, options);
      n.onclick = () => { window.focus(); setActiveRoom(room); };
    }
  };

  const getRoomDisplayName = (room) => {
    if (room.isGroup) return `👥 ${room.name}`;
    const otherId = room.members.find(uid => uid !== user.uid);
    const otherUser = allUsers.find(u => u.uid === otherId);
    return otherUser ? otherUser.displayName : "未知好友";
  };

  const getRoomDisplayAvatar = (room) => {
    if (room.isGroup) return GROUP_DEFAULT_AVATAR;
    const otherId = room.members.find(uid => uid !== user.uid);
    const otherUser = allUsers.find(u => u.uid === otherId);
    return otherUser ? otherUser.photoURL : MY_DEFAULT_AVATAR;
  };

  const getFriends = () => {
    const friendUids = rooms
      .filter(r => !r.isGroup && r.members.length === 2)
      .map(r => r.members.find(uid => uid !== user.uid));
    return allUsers.filter(u => friendUids.includes(u.uid));
  };

  const createFriendship = async (targetUser) => {
    const existing = rooms.find(r => !r.isGroup && r.members.length === 2 && r.members.includes(targetUser.uid));
    if (existing) { setActiveRoom(existing); return; }
    const newRoom = { members: [user.uid, targetUser.uid], isGroup: false, createdAt: serverTimestamp() };
    const docRef = await addDoc(collection(db, "rooms"), newRoom);
    setActiveRoom({ id: docRef.id, ...newRoom });
  };

  const handleCreateGroup = async () => {
    const name = prompt("請輸入群組名稱:");
    if (!name) return;
    const newGroup = { name: sanitize(name), members: [user.uid], isGroup: true, creator: user.uid, createdAt: serverTimestamp() };
    const docRef = await addDoc(collection(db, "rooms"), newGroup);
    setActiveRoom({ id: docRef.id, ...newGroup });
  };

  const dissolveGroup = async () => {
    if (!activeRoom || activeRoom.creator !== user.uid) return;
    if (window.confirm("確定要解散此群組嗎？")) {
      await deleteDoc(doc(db, "rooms", activeRoom.id));
    }
  };

  const addFriendToGroup = async (friendUid) => {
    if (addingIds.includes(friendUid)) return;
    setAddingIds(prev => [...prev, friendUid]);
    try {
      await updateDoc(doc(db, "rooms", activeRoom.id), { members: arrayUnion(friendUid) });
    } catch (e) {
      alert("邀請失敗");
      setAddingIds(prev => prev.filter(id => id !== friendUid));
    }
  };

  // 發送訊息 - 套用 XSS 防禦 (2%)[cite: 1]
  const sendMessage = async (e) => {
    e.preventDefault();
    if (newMessage.trim() === "" || !activeRoom) return;
    await addDoc(collection(db, "rooms", activeRoom.id, "messages"), {
      text: sanitize(newMessage), 
      createdAt: serverTimestamp(), 
      uid: user.uid, 
      displayName: user.displayName,
    });
    setNewMessage("");
  };

  const handleSaveProfile = async () => {
    try {
      if (profileData.email !== user.email) await updateEmail(auth.currentUser, profileData.email);
      await updateProfile(auth.currentUser, { displayName: sanitize(profileData.displayName), photoURL: profileData.photoURL });
      await updateDoc(doc(db, "users", user.uid), {
        displayName: sanitize(profileData.displayName), photoURL: profileData.photoURL, email: profileData.email, phone: profileData.phone, address: profileData.address
      });
      alert("更新成功！");
      setIsProfileOpen(false);
    } catch (e) { alert("儲存失敗: " + e.message); }
  };

  // 註冊/登入 - 套用 XSS 防禦 (2%)[cite: 1]
  const handleEmailAuth = async (e) => {
    e.preventDefault();
    try {
      if (isRegistering) {
        const res = await createUserWithEmailAndPassword(auth, email, password);
        const cleanName = sanitize(username);
        await updateProfile(res.user, { displayName: cleanName, photoURL: MY_DEFAULT_AVATAR });
        await setDoc(doc(db, "users", res.user.uid), { uid: res.user.uid, displayName: cleanName, email: email, photoURL: MY_DEFAULT_AVATAR, phone: "", address: "" });
      } else { await signInWithEmailAndPassword(auth, email, password); }
    } catch (error) { alert(error.message); }
  };

  // Google 登入實作 (1%)[cite: 1]
  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      alert("Google 登入失敗: " + error.message);
    }
  };

  const filteredMessages = messages.filter(msg => 
    msg.text?.toLowerCase().includes(searchTerm.toLowerCase()) || 
    !msg.text 
  );

  if (!user) {
    return (
      <div style={{ maxWidth: "400px", margin: "100px auto", padding: "30px", border: "1px solid #ddd", borderRadius: "15px", textAlign: "center" }}>
        <h2>Chatroom Login</h2>
        <form onSubmit={handleEmailAuth} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {isRegistering && <input placeholder="暱稱" onChange={e => setUsername(e.target.value)} required style={{ padding: "10px" }} />}
          <input placeholder="Email" onChange={e => setEmail(e.target.value)} required style={{ padding: "10px" }} />
          <input type="password" placeholder="密碼" onChange={e => setPassword(e.target.value)} required style={{ padding: "10px" }} />
          <button type="submit" style={{ padding: "10px", background: "#4caf50", color: "#fff", border: "none", borderRadius: "5px", cursor: "pointer" }}>確認</button>
        </form>
        {/* Google 登入按鈕[cite: 1] */}
        <button onClick={handleGoogleLogin} className="google-btn">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/04-gplus-logo.png" width="18" alt="G" />
          使用 Google 帳號登入
        </button>
        <button onClick={() => setIsRegistering(!isRegistering)} style={{ marginTop: "15px", background: "none", border: "none", color: "blue", cursor: "pointer" }}>
          {isRegistering ? "已有帳號？登入" : "還沒帳號？註冊"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh", background: "#f0f2f5", fontFamily: "sans-serif" }}>
      {/* 邀請 Modal */}
      {isInviteOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ display: "flex", justifyContent: "space-between" }}>邀請好友 <button onClick={() => {setIsInviteOpen(false); setAddingIds([]);}} style={{ border: "none", background: "none", cursor: "pointer" }}>✕</button></h3>
            {getFriends().length === 0 && <p style={{ color: "#999" }}>您目前沒有好友</p>}
            {getFriends().map(f => {
              const isAlreadyIn = activeRoom.members.includes(f.uid);
              const isBeingAdded = addingIds.includes(f.uid);
              return (
                <div key={f.uid} className="user-select-item">
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <img src={f.photoURL} className="sidebar-avatar" style={{ width: "30px", height: "30px" }} />
                    <span>{f.displayName}</span>
                  </div>
                  {isAlreadyIn ? (
                    <span style={{ color: "#22c55e", fontSize: "12px", fontWeight: "bold" }}>已在群組</span>
                  ) : (
                    <button 
                      onClick={() => addFriendToGroup(f.uid)} 
                      disabled={isBeingAdded}
                      style={{ padding: "5px 15px", background: isBeingAdded ? "#ccc" : "#0084ff", color: "white", border: "none", borderRadius: "5px", cursor: "pointer" }}
                    >
                      {isBeingAdded ? "正在加入..." : "邀請"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Profile Modal */}
      {isProfileOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>個人資料</h3>
            <label>頭像網址:</label> <input className="profile-input" value={profileData.photoURL} onChange={e => setProfileData({...profileData, photoURL: e.target.value})} />
            <label>暱稱:</label> <input className="profile-input" value={profileData.displayName} onChange={e => setProfileData({...profileData, displayName: e.target.value})} />
            <label>Email:</label> <input className="profile-input" value={profileData.email} onChange={e => setProfileData({...profileData, email: e.target.value})} />
            <label>電話:</label> <input className="profile-input" value={profileData.phone} onChange={e => setProfileData({...profileData, phone: e.target.value})} />
            <label>地址:</label> <input className="profile-input" value={profileData.address} onChange={e => setProfileData({...profileData, address: e.target.value})} />
            <div style={{ display: "flex", gap: "10px" }}><button onClick={handleSaveProfile} style={{ flex: 1, padding: "10px", background: "#0084ff", color: "white", border: "none", borderRadius: "5px", cursor: "pointer" }}>儲存</button><button onClick={() => setIsProfileOpen(false)} style={{ flex: 1, padding: "10px", background: "#eee", border: "none", borderRadius: "5px", cursor: "pointer" }}>取消</button></div>
          </div>
        </div>
      )}

      {/* 側邊欄 */}
      <div style={{ width: "320px", background: "#fff", borderRight: "1px solid #ddd", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px", borderBottom: "1px solid #ddd", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div onClick={() => setIsProfileOpen(true)} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "10px" }}>
            <img src={profileData.photoURL} className="sidebar-avatar" style={{ width: "35px", height: "35px" }} />
            <strong style={{ maxWidth: "120px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profileData.displayName}</strong>
          </div>
          <button onClick={() => signOut(auth)} style={{ padding: "5px 10px", fontSize: "12px", cursor: "pointer" }}>登出</button>
        </div>
        
        <div style={{ flex: 1, overflowY: "auto" }}>
          <div style={{ padding: "10px 20px", background: "#f8f9fa", fontSize: "13px", color: "#666", fontWeight: "bold", display: "flex", justifyContent: "space-between" }}>
            <span>聊天室</span> <button onClick={handleCreateGroup} style={{ border: "none", background: "none", cursor: "pointer", fontSize: "16px" }}>👥+</button>
          </div>
          {rooms.map(room => (
            <div 
              key={room.id} 
              onClick={() => { setActiveRoom(room); setSearchTerm(""); }} 
              style={{ 
                padding: "12px 20px", cursor: "pointer", 
                background: activeRoom?.id === room.id ? "#e6f2ff" : "none", 
                borderBottom: "1px solid #eee", display: "flex", alignItems: "center", gap: "12px"
              }}
            >
              <img src={getRoomDisplayAvatar(room)} className="sidebar-avatar" />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {getRoomDisplayName(room)}
              </span>
            </div>
          ))}
          
          <div style={{ padding: "10px 20px", background: "#f8f9fa", fontSize: "13px", color: "#666", fontWeight: "bold", marginTop: "10px" }}>發現新使用者</div>
          {allUsers.filter(u => u.uid !== user.uid && !rooms.some(r => !r.isGroup && r.members.includes(u.uid))).map(u => (
            <div key={u.uid} onClick={() => createFriendship(u)} style={{ padding: "12px 20px", cursor: "pointer", fontSize: "14px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <img src={u.photoURL || MY_DEFAULT_AVATAR} className="sidebar-avatar" />
                <span>{u.displayName}</span>
              </div>
              <span style={{ color: "#0084ff" }}>➕</span>
            </div>
          ))}
        </div>
      </div>

      {/* 主視窗 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {activeRoom ? (
          <>
            <header style={{ padding: "15px 25px", background: "#fff", borderBottom: "1px solid #ddd", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <img src={getRoomDisplayAvatar(activeRoom)} className="sidebar-avatar" style={{ width: "35px", height: "35px" }} />
                <span style={{ fontWeight: "bold", fontSize: "18px" }}>{getRoomDisplayName(activeRoom)}</span>
              </div>
              
              <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
                <input 
                  type="text" 
                  className="search-bar" 
                  placeholder="🔍 搜尋訊息..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                
                {activeRoom.isGroup && (
                  <>
                    <button onClick={() => setIsInviteOpen(true)} style={{ padding: "8px 15px", borderRadius: "5px", border: "1px solid #0084ff", color: "#0084ff", background: "#fff", cursor: "pointer" }}>邀請好友</button>
                    {activeRoom.creator === user.uid && <button onClick={dissolveGroup} style={{ padding: "8px 15px", borderRadius: "5px", border: "1px solid #ef4444", color: "#ef4444", background: "#fff", cursor: "pointer" }}>解散群組</button>}
                  </>
                )}
              </div>
            </header>

            <main style={{ flex: 1, overflowY: "auto", padding: "20px", background: "#fff" }}>
              {filteredMessages.map(msg => (
                <div key={msg.id} className="message-container" style={{ textAlign: msg.uid === user.uid ? "right" : "left", margin: "15px 0" }}>
                  <div style={{ fontSize: "11px", color: "#888", marginBottom: "4px" }}>
                    {msg.displayName} {msg.isEdited && "(已編輯)"}
                  </div>
                  
                  {msg.imageUrl ? (
                    <div style={{ display: "inline-block" }}>
                      <img src={msg.imageUrl} className="image-preview" alt="sent" />
                      {msg.uid === user.uid && (
                        <div className="msg-action-bar" style={{ justifyContent: "flex-end" }}>
                          <button className="action-btn" onClick={() => handleUnsend(msg.id)}>回收圖片</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: "inline-block" }}>
                      {editingId === msg.id ? (
                        <div style={{ display: "flex", gap: "5px" }}>
                          <input 
                            value={editText} 
                            onChange={(e) => setEditText(e.target.value)}
                            style={{ padding: "5px", borderRadius: "5px", border: "1px solid #ccc" }}
                          />
                          <button onClick={() => handleEdit(msg.id)}>儲存</button>
                          <button onClick={() => setEditingId(null)}>取消</button>
                        </div>
                      ) : (
                        <>
                          <div className="message-bubble" style={{ 
                            display: "inline-block", padding: "10px 15px", borderRadius: "18px", 
                            background: msg.uid === user.uid ? "#0084ff" : "#e4e6eb", 
                            color: msg.uid === user.uid ? "#fff" : "#000", maxWidth: "250px", wordBreak: "break-word", textAlign: "left" 
                          }}>
                            {msg.text}
                          </div>
                          {msg.uid === user.uid && (
                            <div className="msg-action-bar" style={{ justifyContent: msg.uid === user.uid ? "flex-end" : "flex-start" }}>
                              <button className="action-btn" onClick={() => { setEditingId(msg.id); setEditText(msg.text); }}>編輯</button>
                              <button className="action-btn" onClick={() => handleUnsend(msg.id)}>回收</button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div ref={scrollRef}></div>
            </main>

            <form onSubmit={sendMessage} style={{ padding: "20px", background: "#fff", borderTop: "1px solid #ddd", display: "flex", alignItems: "center" }}>
              <button 
                type="button" 
                onClick={() => fileInputRef.current.click()}
                style={{ border: "none", background: "none", fontSize: "24px", cursor: "pointer", marginRight: "10px" }}
              >
                🖼️
              </button>
              <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageUpload} />
              
              <input value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder="輸入訊息..." style={{ flex: 1, padding: "12px 20px", borderRadius: "25px", border: "1px solid #ddd", outline: "none" }} />
              <button type="submit" style={{ marginLeft: "10px", padding: "10px 25px", background: "#0084ff", color: "#fff", border: "none", borderRadius: "25px", cursor: "pointer", fontWeight: "bold" }}>傳送</button>
            </form>
          </>
        ) : (
          <div style={{ margin: "auto", color: "#999", textAlign: "center" }}><h3>請選擇聊天室或點擊 👥+ 發起群組</h3></div>
        )}
      </div>
    </div>
  );
}

export default App;