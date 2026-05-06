import React, { useState, useEffect, useRef } from "react";
import { auth, db } from "./firebase";
import { 
  onAuthStateChanged, signOut, createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, updateProfile, updateEmail,
  GoogleAuthProvider, signInWithPopup 
} from "firebase/auth";
import { 
  collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, 
  where, getDocs, doc, updateDoc, arrayUnion, setDoc, getDoc, deleteDoc, limit, arrayRemove
} from "firebase/firestore";

// --- CSS 樣式 ---
const style = document.createElement('style');
style.textContent = `
  @keyframes messageSlideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes highlightFade { 0% { background: #ffff99; } 100% { background: transparent; } }
  
  .message-bubble { 
    animation: messageSlideIn 0.3s ease-out forwards; 
    position: relative; 
    /* 關鍵：保留換行與空白，且自動折行 */
    white-space: pre-wrap; 
    word-break: break-word; 
    display: inline-block;
    padding: 10px 15px;
    border-radius: 18px;
  }
  .message-highlight { animation: highlightFade 2s ease-out; }
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

  .google-btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 10px; margin-top: 10px; background: white; border: 1px solid #ddd; border-radius: 5px; cursor: pointer; font-weight: bold; }
  .google-btn:hover { background: #f9f9f9; }

  /* 新增：表情回應樣式 */
  .emoji-bar { display: flex; gap: 5px; margin-top: 5px; flex-wrap: wrap; }
  .emoji-badge { cursor: pointer; background: #f0f2f5; border-radius: 12px; padding: 2px 8px; font-size: 14px; border: 1px solid #ddd; transition: 0.2s; }
  .emoji-badge.active { background: #e7f3ff; border-color: #0084ff; }
  .emoji-picker { display: flex; gap: 5px; padding: 5px; background: white; border: 1px solid #ddd; border-radius: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1); position: absolute; top: -35px; z-index: 10; }
  
  /* 新增：回覆訊息樣式 */
  .reply-preview { background: #f8f9fa; border-left: 4px solid #0084ff; padding: 8px; margin-bottom: 5px; border-radius: 4px; display: flex; justify-content: space-between; font-size: 13px; }
  .reply-quote { background: rgba(0,0,0,0.05); border-radius: 8px; padding: 5px 10px; font-size: 12px; margin-bottom: 4px; cursor: pointer; border-left: 3px solid #ccc; text-align: left; }
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
  const [profileData, setProfileData] = useState({ displayName: "", photoURL: "", email: "", phone: "", address: "", blockedUsers: [] });
  const [tempProfileData, setTempProfileData] = useState(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState(""); 
  const [isRegistering, setIsRegistering] = useState(false);
  
  // 新增狀態
  const [replyTo, setReplyTo] = useState(null); 
  const [highlightMsgId, setHighlightMsgId] = useState(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(null);

  const scrollRef = useRef();
  const activeRoomRef = useRef(null);
  const fileInputRef = useRef(); 
  const profilePhotoInputRef = useRef();
  const messageRefs = useRef({}); // 用於跳轉回覆訊息

  const MY_DEFAULT_AVATAR = "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQX5yy5UXGD6VOurditkh6kO3et1ydkRMnzAw&s";
  const GROUP_DEFAULT_AVATAR = "https://cdn-icons-png.flaticon.com/512/615/615075.png";
  const EMOJI_LIST = ["❤️", "😂", "😮", "😢", "😡", "👍"];

  useEffect(() => { activeRoomRef.current = activeRoom; }, [activeRoom]);

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
          address: dbData.address || "",
          blockedUsers: dbData.blockedUsers || [] // 初始化封鎖清單
        };
        setProfileData(initialData);
        setUser({ ...currentUser, ...initialData });
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

  // --- 監聽器一：負責顯示主視窗訊息 ---
  useEffect(() => {
    if (!activeRoom || !user) {
      setMessages([]); // 切換房間時先清空，避免看到上一位的訊息
      return;
    }

    const q = query(
      collection(db, "rooms", activeRoom.id, "messages"), 
      orderBy("createdAt", "asc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newMsgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMessages(newMsgs); // 只有這裡會更新對話框內容
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    });

    return () => unsubscribe();
  }, [activeRoom?.id, user]);


  // --- 監聽器二：負責背景通知 (不影響 UI) ---
  useEffect(() => {
    if (!user || rooms.length === 0) return;

    const unsubscribes = rooms.map((room) => {
      const q = query(
        collection(db, "rooms", room.id, "messages"),
        orderBy("createdAt", "desc"),
        limit(1)
      );

      return onSnapshot(q, (snapshot) => {
        if (snapshot.empty) return;
        const lastMsg = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };

        // 檢查是否為新訊息且非自己發送
        const isNew = lastMsg.createdAt?.toMillis() > Date.now() - 5000;
        const isNotMe = lastMsg.uid !== user.uid;
        const isNotActive = room.id !== activeRoomRef.current?.id || document.hidden;

        if (isNew && isNotMe && isNotActive) {
          if (Notification.permission === "granted") {
            new Notification(`來自 ${lastMsg.displayName} 的訊息`, {
              body: lastMsg.text || "[圖片]",
              icon: room.isGroup ? GROUP_DEFAULT_AVATAR : (allUsers.find(u => u.uid === lastMsg.uid)?.photoURL || MY_DEFAULT_AVATAR)
            });
          }
        }
        // 注意：這裡千萬不要寫 setMessages(...)！
      });
    });

    return () => unsubscribes.forEach(unsub => unsub());
  }, [rooms.length, user]); // 注意依賴項，rooms 長度變了才重新註冊

  // --- 封鎖邏輯 ---
  const handleBlockUser = async (targetUid) => {
    if (!window.confirm("確定要封鎖此使用者嗎？")) return;
    const userRef = doc(db, "users", user.uid);
    await updateDoc(userRef, { blockedUsers: arrayUnion(targetUid) });
    setProfileData(prev => ({ ...prev, blockedUsers: [...prev.blockedUsers, targetUid] }));
  };

  const handleUnblockUser = async (targetUid) => {
    const userRef = doc(db, "users", user.uid);
    await updateDoc(userRef, { blockedUsers: arrayRemove(targetUid) });
    setProfileData(prev => ({ ...prev, blockedUsers: prev.blockedUsers.filter(id => id !== targetUid) }));
  };

  const isBlockedByMe = (uid) => profileData.blockedUsers?.includes(uid);
  const isBlockingMe = (uid) => {
    const otherUser = allUsers.find(u => u.uid === uid);
    return otherUser?.blockedUsers?.includes(user.uid);
  };

  // --- 表情回應邏輯 ---
  const handleEmojiReact = async (msgId, emoji) => {
    const msgRef = doc(db, "rooms", activeRoom.id, "messages", msgId);
    const msg = messages.find(m => m.id === msgId);
    const reactions = msg.reactions || {};
    
    if (reactions[emoji]?.includes(user.uid)) {
      await updateDoc(msgRef, { [`reactions.${emoji}`]: arrayRemove(user.uid) });
    } else {
      await updateDoc(msgRef, { [`reactions.${emoji}`]: arrayUnion(user.uid) });
    }
    setShowEmojiPicker(null);
  };

  // --- 跳轉至原訊息 ---
  const scrollToOriginal = (msgId) => {
    const target = messageRefs.current[msgId];
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightMsgId(msgId);
      setTimeout(() => setHighlightMsgId(null), 2000);
    }
  };

  // --- 現有功能修改 (傳送訊息) ---
  const sendMessage = async (e) => {
    e.preventDefault();
    if (newMessage.trim() === "" || !activeRoom) return;
    
    // 檢查是否互為封鎖
    const otherId = activeRoom.members.find(id => id !== user.uid);
    if (!activeRoom.isGroup && (isBlockedByMe(otherId) || isBlockingMe(otherId))) {
      alert("封鎖狀態下無法傳送訊息");
      return;
    }

    await addDoc(collection(db, "rooms", activeRoom.id, "messages"), {
      text: sanitize(newMessage), 
      createdAt: serverTimestamp(), 
      uid: user.uid, 
      displayName: user.displayName,
      replyTo: replyTo ? { id: replyTo.id, text: replyTo.text, sender: replyTo.displayName } : null
    });
    setNewMessage("");
    setReplyTo(null);
  };

  // 渲染私訊警告 UI
  const renderBlockWarning = () => {
    if (activeRoom.isGroup) return null;
    const otherId = activeRoom.members.find(id => id !== user.uid);
    if (isBlockedByMe(otherId)) return <div style={{ background: "#ffebee", padding: "10px", textAlign: "center", color: "#c62828" }}>你已封鎖此對象，解除封鎖後才能繼續聊天。</div>;
    if (isBlockingMe(otherId)) return <div style={{ background: "#f5f5f5", padding: "10px", textAlign: "center", color: "#666" }}>對方已將你封鎖。</div>;
    return null;
  };

  const handleUnsend = async (msgId) => {
    if (window.confirm("確定要回收此訊息嗎？")) {
      await deleteDoc(doc(db, "rooms", activeRoom.id, "messages", msgId));
    }
  };

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
    // 1. 防止重複點擊
    if (addingIds.includes(friendUid)) return;
    setAddingIds(prev => [...prev, friendUid]);

    try {
      // 2. 更新 Firebase Firestore 資料庫
      const roomRef = doc(db, "rooms", activeRoom.id);
      await updateDoc(roomRef, { 
        members: arrayUnion(friendUid) 
      });

      // 3. 關鍵修正：手動更新本地 activeRoom 狀態
      // 這會觸發 UI 重新渲染，使 Modal 中的 isAlreadyIn 判斷立刻生效
      setActiveRoom(prev => ({
        ...prev,
        members: [...prev.members, friendUid]
      }));

      // 4. 清除「正在加入」的 loading 狀態
      setAddingIds(prev => prev.filter(id => id !== friendUid));
      
    } catch (e) {
      // 錯誤處理
      console.error("邀請失敗:", e);
      alert("邀請失敗");
      setAddingIds(prev => prev.filter(id => id !== friendUid));
    }
  };

  const handleSaveProfile = async () => {
    try {
      // 1. 更新 Firebase Auth 的顯示名稱 (不更新 Email 與 PhotoURL 以免報錯)
      await updateProfile(auth.currentUser, { 
        displayName: sanitize(tempProfileData.displayName) 
      });
      
      // 2. 更新 Firestore 中的使用者資料 (包含電話、地址與顯示用的 Email)
      const userRef = doc(db, "users", user.uid);
      await updateDoc(userRef, {
        displayName: sanitize(tempProfileData.displayName), 
        photoURL: tempProfileData.photoURL, 
        email: tempProfileData.email, // 這裡僅更新資料庫內容，不影響登入
        phone: tempProfileData.phone || "", 
        address: tempProfileData.address || ""
      });

      // 3. 更新本地狀態並關閉 Modal
      setProfileData(tempProfileData); 
      alert("個人資料更新成功！");
      setIsProfileOpen(false);
    } catch (e) { 
      console.error(e);
      alert("儲存失敗: " + e.message); 
    }
  };

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    try {
      if (isRegistering) {
        const res = await createUserWithEmailAndPassword(auth, email, password);
        const cleanName = sanitize(username);
        await updateProfile(res.user, { displayName: cleanName, photoURL: MY_DEFAULT_AVATAR });
        await setDoc(doc(db, "users", res.user.uid), { uid: res.user.uid, displayName: cleanName, email: email, photoURL: MY_DEFAULT_AVATAR, phone: "", address: "", blockedUsers: [] });
      } else { await signInWithEmailAndPassword(auth, email, password); }
    } catch (error) { alert(error.message); }
  };

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try { await signInWithPopup(auth, provider); } catch (error) { alert("Google 登入失敗: " + error.message); }
  };
  // --- 處理個人頭像上傳 ---
  // 處理頭像圖片選取 (改為操作 tempProfileData)
  const handleProfilePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // 1MB = 1048576 bytes
    if (file.size > 1000000) { 
      alert("圖片太大了！請選取小於 1MB 的檔案。");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setTempProfileData(prev => ({ ...prev, photoURL: event.target.result }));
    };
    reader.readAsDataURL(file);
  };


  // 過濾訊息邏輯 (搜尋 + 隱藏互相封鎖者的訊息)
  const filteredMessages = messages.filter(msg => {
    const isSearchMatch = msg.text?.toLowerCase().includes(searchTerm.toLowerCase()) || !msg.text;
    if (activeRoom.isGroup) {
      // 在群組中，若 User A 封鎖 User B，則 User A 看不見 User B 的訊息，反之亦然
      const isSenderBlockedByMe = isBlockedByMe(msg.uid);
      const isSenderBlockingMe = isBlockingMe(msg.uid);
      return isSearchMatch && !isSenderBlockedByMe && !isSenderBlockingMe;
    }
    return isSearchMatch;
  });

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
        <button onClick={handleGoogleLogin} className="google-btn">
          <img src="data:image/png;base64,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" width="18" alt="G" />
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
      {isProfileOpen && tempProfileData && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>個人資料</h3>
            
            {/* 頭像預覽與上傳區 */}
            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              <img 
                src={tempProfileData.photoURL || MY_DEFAULT_AVATAR} 
                style={{ width: "90px", height: "90px", borderRadius: "50%", objectFit: "cover", border: "2px solid #0084ff" }} 
                alt="Avatar Preview"
              />
            </div>

            <label>頭像設定:</label>
            <div style={{ display: "flex", gap: "10px", marginTop: "5px", marginBottom: "15px" }}>
              <input 
                className="profile-input" 
                placeholder="貼上圖片網址..." 
                style={{ flex: 1, margin: 0 }}
                value={tempProfileData.photoURL.startsWith('data:image') ? "已選取圖片檔案" : tempProfileData.photoURL} 
                onChange={e => setTempProfileData({...tempProfileData, photoURL: e.target.value})} 
              />
              <button 
                onClick={() => profilePhotoInputRef.current.click()}
                style={{ padding: "0 10px", background: "#f0f2f5", border: "1px solid #ddd", borderRadius: "5px", cursor: "pointer", fontSize: "13px" }}
              >
                📷 上傳圖片
              </button>
            </div>
            <input type="file" ref={profilePhotoInputRef} hidden accept="image/*" onChange={handleProfilePhotoUpload} />

            <label>暱稱:</label>
            <input className="profile-input" value={tempProfileData.displayName} onChange={e => setTempProfileData({...tempProfileData, displayName: e.target.value})} />
            
            <label>顯示用 Email (不影響登入):</label>
            <input className="profile-input" value={tempProfileData.email} onChange={e => setTempProfileData({...tempProfileData, email: e.target.value})} />
            
            {/* 補回電話與地址欄位 */}
            <label>電話:</label>
            <input className="profile-input" placeholder="請輸入電話" value={tempProfileData.phone || ""} onChange={e => setTempProfileData({...tempProfileData, phone: e.target.value})} />
            
            <label>地址:</label>
            <input className="profile-input" placeholder="請輸入地址" value={tempProfileData.address || ""} onChange={e => setTempProfileData({...tempProfileData, address: e.target.value})} />
            
            <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
              <button onClick={handleSaveProfile} style={{ flex: 1, padding: "10px", background: "#0084ff", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontWeight: "bold" }}>儲存變更</button>
              <button 
                onClick={() => { setIsProfileOpen(false); setTempProfileData(null); }} 
                style={{ flex: 1, padding: "10px", background: "#eee", border: "none", borderRadius: "5px", cursor: "pointer" }}
              >
                取消
              </button>
            </div>
            
            <hr style={{ margin: "25px 0", border: "0", borderTop: "1px solid #eee" }} />
            <h4 style={{ color: "#666" }}>已封鎖清單</h4>
            {profileData.blockedUsers?.map(uid => {
              const u = allUsers.find(user => user.uid === uid);
              return (
                <div key={uid} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #fafafa" }}>
                  <span style={{ fontSize: "14px" }}>{u?.displayName || uid}</span>
                  <button onClick={() => handleUnblockUser(uid)} style={{ color: "#ff4d4f", background: "none", border: "none", cursor: "pointer", fontSize: "13px" }}>解除封鎖</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 側邊欄 */}
      <div style={{ width: "320px", background: "#fff", borderRight: "1px solid #ddd", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "20px", borderBottom: "1px solid #ddd", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div onClick={() =>{setTempProfileData({ ...profileData });setIsProfileOpen(true);}} style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: "10px" }}>
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
            <div key={room.id} onClick={() =>{ setActiveRoom(room);setSearchTerm("");setReplyTo(null);setNewMessage("")}} style={{ padding: "12px 20px", cursor: "pointer", background: activeRoom?.id === room.id ? "#e6f2ff" : "none", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", gap: "12px" }}>
              <img src={getRoomDisplayAvatar(room)} className="sidebar-avatar" />
              <span style={{ flex: 1 }}>{getRoomDisplayName(room)}</span>
            </div>
          ))}
          
          <div style={{ padding: "10px 20px", background: "#f8f9fa", fontSize: "13px", color: "#666", fontWeight: "bold" }}>發現新使用者</div>
          {allUsers.filter(u => u.uid !== user.uid && !rooms.some(r => !r.isGroup && r.members.includes(u.uid))).map(u => (
            <div key={u.uid} onClick={() => {createFriendship(u);setReplyTo(null)}} style={{ padding: "12px 20px", cursor: "pointer", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
                <input type="text" className="search-bar" placeholder="🔍 搜尋訊息..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                {!activeRoom.isGroup && (
                  <button onClick={() => isBlockedByMe(activeRoom.members.find(id => id !== user.uid)) ? handleUnblockUser(activeRoom.members.find(id => id !== user.uid)) : handleBlockUser(activeRoom.members.find(id => id !== user.uid))} style={{ color: "red", background: "none", border: "1px solid red", borderRadius: "5px", padding: "5px 10px", cursor: "pointer" }}>
                    {isBlockedByMe(activeRoom.members.find(id => id !== user.uid)) ? "解除封鎖" : "封鎖對象"}
                  </button>
                )}
                {activeRoom.isGroup && (
                  <>
                    <button onClick={() => setIsInviteOpen(true)} style={{ padding: "8px 15px", borderRadius: "5px", border: "1px solid #0084ff", color: "#0084ff", background: "#fff", cursor: "pointer" }}>邀請</button>
                    {activeRoom.creator === user.uid && <button onClick={dissolveGroup} style={{ color: "red", border: "1px solid red", background: "none", padding: "8px 15px", borderRadius: "5px", cursor: "pointer" }}>解散</button>}
                  </>
                )}
              </div>
            </header>

            {renderBlockWarning()}

            <main style={{ flex: 1, overflowY: "auto", padding: "20px", background: "#fff" }}>
              {filteredMessages.map(msg => (
                <div key={msg.id} ref={el => messageRefs.current[msg.id] = el} className={`message-container ${highlightMsgId === msg.id ? 'message-highlight' : ''}`} style={{ textAlign: msg.uid === user.uid ? "right" : "left", margin: "15px 0" }}>
                  <div style={{ fontSize: "11px", color: "#888", marginBottom: "4px" }}>
                    {msg.displayName} {msg.isEdited && "(已編輯)"}
                  </div>
                  
                  <div style={{ display: "inline-block", position: "relative" }}>
                    {/* 回覆引用 UI */}
                    {msg.replyTo && (
                      <div className="reply-quote" onClick={() => scrollToOriginal(msg.replyTo.id)}>
                        <div style={{ fontWeight: "bold", fontSize: "10px" }}>回覆 {msg.replyTo.sender}</div>
                        <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "200px" }}>{msg.replyTo.text}</div>
                      </div>
                    )}

                    {msg.imageUrl ? (
                      <img src={msg.imageUrl} className="image-preview" alt="sent" />
                    ) : (
                      <div className="message-bubble" style={{ 
                        display: "inline-block", padding: "10px 15px", borderRadius: "18px", 
                        background: msg.uid === user.uid ? "#0084ff" : "#e4e6eb", 
                        color: msg.uid === user.uid ? "#fff" : "#000", maxWidth: "250px", wordBreak: "break-word", textAlign: "left" 
                      }}>
                        {editingId === msg.id ? (
                          <input value={editText} onChange={(e) => setEditText(e.target.value)} onBlur={() => handleEdit(msg.id)} autoFocus />
                        ) : msg.text}
                      </div>
                    )}

                    {/* 表情回應顯示區 */}
                    <div className="emoji-bar" style={{ justifyContent: msg.uid === user.uid ? "flex-end" : "flex-start" }}>
                      {msg.reactions && Object.entries(msg.reactions).map(([emoji, uids]) => uids.length > 0 && (
                        <div key={emoji} className={`emoji-badge ${uids.includes(user.uid) ? 'active' : ''}`} onClick={() => handleEmojiReact(msg.id, emoji)}>
                          {emoji} {uids.length}
                        </div>
                      ))}
                    </div>

                    {/* 功能選單 */}
                    <div className="msg-action-bar" style={{ justifyContent: msg.uid === user.uid ? "flex-end" : "flex-start" }}>
                      <button className="action-btn" onClick={() => setShowEmojiPicker(msg.id)}>😀</button>
                      <button className="action-btn" onClick={() => setReplyTo(msg)}>回覆</button>
                      {msg.uid === user.uid && (
                        <>
                          <button className="action-btn" onClick={() => { setEditingId(msg.id); setEditText(msg.text); }}>編輯</button>
                          <button className="action-btn" onClick={() => handleUnsend(msg.id)}>回收</button>
                        </>
                      )}
                      
                      {/* Emoji 選擇器 */}
                      {showEmojiPicker === msg.id && (
                        <div className="emoji-picker" onMouseLeave={() => setShowEmojiPicker(null)}>
                          {EMOJI_LIST.map(e => <span key={e} style={{ cursor: "pointer" }} onClick={() => handleEmojiReact(msg.id, e)}>{e}</span>)}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={scrollRef}></div>
            </main>

            {/* 回覆預覽區 */}
            {replyTo && (
              <div className="reply-preview">
                <div>回覆給 <strong>{replyTo.displayName}</strong>: {replyTo.text}</div>
                <button onClick={() => setReplyTo(null)} style={{ border: "none", background: "none", cursor: "pointer" }}>✕</button>
              </div>
            )}

            <form onSubmit={sendMessage} style={{ padding: "20px", background: "#fff", borderTop: "1px solid #ddd", display: "flex", alignItems: "flex-end" }}>
            <button 
              type="button" 
              onClick={() => fileInputRef.current.click()} 
              style={{ border: "none", background: "none", fontSize: "24px", cursor: "pointer", marginRight: "10px", marginBottom: "5px" }}
            >
              🖼️
            </button>
            <input type="file" ref={fileInputRef} hidden accept="image/*" onChange={handleImageUpload} />
            
            <textarea 
              value={newMessage} 
              onChange={e => setNewMessage(e.target.value)} 
              placeholder="輸入訊息..." 
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(e);
                }
              }}
              style={{ 
                flex: 1, 
                padding: "12px 20px", 
                borderRadius: "20px", 
                border: "1px solid #ddd", 
                outline: "none", 
                resize: "none", 
                height: "45px", 
                fontFamily: "inherit",
                lineHeight: "1.5"
              }} 
            />
            
            <button 
              type="submit" 
              style={{ marginLeft: "10px", padding: "10px 25px", background: "#0084ff", color: "#fff", border: "none", borderRadius: "25px", cursor: "pointer", fontWeight: "bold", marginBottom: "5px" }}
            >
              傳送
            </button>
          </form>
          </>
        ) : (
          <div style={{ margin: "auto", color: "#999", textAlign: "center" }}><h3>請選擇聊天室或發起群組</h3></div>
        )}
      </div>
    </div>
  );
}

export default App;