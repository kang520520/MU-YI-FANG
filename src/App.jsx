import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, doc, deleteDoc, updateDoc, setDoc } from 'firebase/firestore';
// 修正圖示導入方式，解決 Uncaught SyntaxError 錯誤
import * as Icons from 'lucide-react';

// ==========================================
// --- Firebase 配置 (mu-yi-fang-engineering) ---
// ==========================================
// 修正原本 JSON.parse(__firebase_config) 導致的崩潰
const firebaseConfig = {
  apiKey: "AIzaSyBoaTEfnGdsNBiCpQSiXFY7Ojb3IcEosrQ",
  authDomain: "mu-yi-fang-engineering.firebaseapp.com",
  projectId: "mu-yi-fang-engineering",
  storageBucket: "mu-yi-fang-engineering.firebasestorage.app",
  messagingSenderId: "92421340824",
  appId: "1:92421340824:web:7b17a85c34c7d3f31b9aed"
};



// 避免 HMR 重複初始化
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const auth = getAuth(app);
const db = getFirestore(app);

// 強制使用穩定的 appId 路徑
const appId = 'mu-yi-fang-engineering-v300';

const OFFICIAL_LOGO = "image_c21247.jpg"; 
const OFFICIAL_QR = "image_c215ec.png";
const FB_LINK = "https://www.facebook.com/people/%E6%9C%A8%E8%97%9D%E5%9D%8A%E5%B7%A5%E7%A8%8B%E8%A1%8C/100063732565691/";
const LINE_LINK = "https://line.me/ti/p/LC-EUy3rQi";
const DEFAULT_CATEGORIES = ["全屋裝潢", "天花板工程", "地板工程", "店面/商業空間裝潢"];
const PAGE_SIZE = 6; 

// 模擬數據 (僅在資料庫完全沒資料時顯示)
const MOCK_DATA = [];
const imgIds = ["1618221195710-dd6b41faaea6", "1615876234886-fd9a39faa97f", "1616486341351-7025244f243f"];
DEFAULT_CATEGORIES.forEach((cat, cIdx) => {
  for (let i = 1; i <= 2; i++) {
    MOCK_DATA.push({
      id: `mock-${cIdx}-${i}`,
      title: `${cat} 預覽案例`,
      category: cat,
      description: "這是預覽用的模擬案例。上傳真實照片後，系統將自動移除模擬圖。",
      imageData: `https://images.unsplash.com/photo-${imgIds[i % imgIds.length]}?q=80&w=800`,
      createdAt: new Date().toISOString(),
      isMock: true
    });
  }
});

// 強力壓縮工具 (防 1MB 權限拒絕)
const compressImage = (file, maxWidth = 750) => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width, height = img.height;
        if (width > height) { if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; } }
        else { if (height > maxWidth) { width *= maxWidth / height; height = maxWidth; } }
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.4));
      };
    };
  });
};

export default function App() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [view, setView] = useState('portfolio'); 
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isAuthReady, setIsAuthReady] = useState(false);
  
  const [dbConfig, setDbConfig] = useState({
    logo: null, qr: null, adminUser: 'admin', adminPass: '95336315', 
    aboutImg: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?q=80&w=1200'
  });

  const [projects, setProjects] = useState([]);
  const [categories, setCategories] = useState([]);
  const [activeCategory, setActiveCategory] = useState("全部");
  const [currentPage, setCurrentPage] = useState(1);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // 彈窗狀態
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isAdminSettingOpen, setIsAdminSettingOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null); 
  const [catDeleteConfirm, setCatDeleteConfirm] = useState(null);

  // 上傳佇列與管理
  const [uploadQueue, setUploadQueue] = useState([]);
  const [sidebarCatInput, setSidebarCatInput] = useState('');
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [adminSettingForm, setAdminSettingForm] = useState({ username: '', password: '' });
  const [editingProject, setEditingProject] = useState(null);
  const fileInputRef = useRef(null);

  const companyInfo = {
    name: "木藝坊工程行",
    engName: "MU YI FANG ENGINEERING",
    phone: "0972-855-728",
    taxId: "95336315",
    hours: "上午 7:00 ~ 下午 10:00",
    aboutText: "我們是專精於木作與室內裝潢的專業工程團隊，由負責人親自帶領。在每一場工程中，我們都將「藝」與「坊」的精神融入，確保每一項作品都兼具耐用性與美學感。不論是住家空間的細緻木作、商業空間的系統規劃，或是整間房屋的翻新工程，「木藝坊工程行」始終堅持選用優質材料，並落實嚴格的施工程序，確保作品既耐用又美觀。"
  };

  // ==========================================
  // --- SEO 與 結構化數據整合 ---
  // ==========================================
  useEffect(() => {
    document.title = "木藝坊工程行 | 專業室內裝潢、木作工程、海線裝潢";
    
    const metaConfig = [
      { name: "description", content: "木藝坊工程行專業承攬全屋裝潢、天花板工程、地板工程及商業空間設計。由資深師傅親自帶領，堅持細膩工法與優質材料，為您打造理想居家與店面空間。" },
      { name: "keywords", content: "木藝坊工程行, 室內裝潢, 木作工程, 台北裝潢推薦, 天花板裝修, 地板施工, 店面裝潢, 房屋翻修, 木工師傅" },
      { property: "og:title", content: "木藝坊工程行 - 專業室內裝潢與木作工程實績" },
      { property: "og:description", content: "提供高品質木作工法，全台各地工程承攬，歡迎線上諮詢。" },
      { property: "og:image", content: dbConfig.logo || OFFICIAL_LOGO }
    ];

    metaConfig.forEach(item => {
      let tag = item.name ? document.querySelector(`meta[name="${item.name}"]`) : document.querySelector(`meta[property="${item.property}"]`);
      if (!tag) {
        tag = document.createElement('meta');
        if (item.name) tag.name = item.name;
        if (item.property) tag.property = item.property;
        document.head.appendChild(tag);
      }
      tag.content = item.content;
    });

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.innerHTML = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "HomeAndConstructionBusiness",
      "name": companyInfo.name,
      "alternateName": companyInfo.engName,
      "telephone": companyInfo.phone,
      "url": window.location.href,
      "logo": dbConfig.logo || OFFICIAL_LOGO,
      "description": companyInfo.aboutText,
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "台灣",
        "addressRegion": "全台各地工程承攬"
      },
      "openingHours": "Mo-Fr 09:00-18:00"
    });
    document.head.appendChild(script);

    return () => { if(document.head.contains(script)) document.head.removeChild(script); };
  }, [dbConfig.logo]);

  // 1. 初始化 Auth
  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (e) { console.error("Auth Error", e); }
    };
    initAuth();
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      if (localStorage.getItem('isWoodArtAdminFlag') === 'true') setIsAdmin(true);
    });
    return () => unsub();
  }, []);

  // 2. 資料連線
  useEffect(() => {
    if (!user || !isAuthReady) return;

    onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'global'), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setDbConfig(prev => ({ ...prev, ...data }));
        setAdminSettingForm({ username: data.adminUser || 'admin', password: data.adminPass || '95336315' });
      } else {
        setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'global'), dbConfig);
      }
    });

    onSnapshot(query(collection(db, 'artifacts', appId, 'public', 'data', 'projects')), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const realData = data.filter(d => !d.isMock);
      const sortedData = realData.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setProjects(sortedData.length === 0 ? MOCK_DATA : sortedData);
      setLoading(false);
    });

    onSnapshot(query(collection(db, 'artifacts', appId, 'public', 'data', 'categories')), (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const sortedCats = data.sort((a, b) => (a.order || 0) - (b.order || 0));
      setCategories(sortedCats.length === 0 ? DEFAULT_CATEGORIES.map(name => ({ name })) : sortedCats);
    });
  }, [user, isAuthReady]);

  // ==========================================
  // --- 管理引擎 ---
  // ==========================================

  const executeDeleteProject = async () => {
    if (!deleteConfirm || !isAdmin) return;
    setIsProcessing(true);
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'projects', deleteConfirm.id));
      setDeleteConfirm(null);
    } catch (err) { setErrorMsg('刪除失敗'); }
    finally { setIsProcessing(false); }
  };

  const handleFileUpload = async (e) => {
    if (!isAdmin) return;
    const files = Array.from(e.target.files);
    if (uploadQueue.length + files.length > 6) {
      setErrorMsg('一次最多上傳 6 張照片');
      return;
    }

    setIsProcessing(true);
    const newItems = [];
    for (let file of files) {
      const b64 = await compressImage(file);
      let autoGuess = categories[0]?.name || "全屋裝潢";
      if (file.name.includes("天花板")) autoGuess = "天花板工程";
      else if (file.name.includes("地板")) autoGuess = "地板工程";
      else if (file.name.includes("店面")) autoGuess = "店面/商業空間裝潢";

      newItems.push({
        id: Math.random().toString(36).substr(2, 9),
        previewUrl: b64,
        title: '', 
        description: '',
        category: autoGuess,
        fileName: file.name
      });
    }
    setUploadQueue(prev => [...prev, ...newItems]);
    setIsProcessing(false);
    e.target.value = null;
  };

  const handleFinalUploadToCloud = async () => {
    if (!isAdmin || !uploadQueue.length || !user) return;
    setIsProcessing(true);
    try {
      const colRef = collection(db, 'artifacts', appId, 'public', 'data', 'projects');
      for (let item of uploadQueue) {
        const finalTitle = item.title.trim() || item.fileName.replace(/\.[^/.]+$/, "").replace(/[_\-0-9]/g, " ").trim();
        await addDoc(colRef, {
          title: finalTitle,
          category: item.category,
          description: item.description.trim() || "",
          imageData: item.previewUrl,
          createdAt: new Date().toISOString(),
          userId: user.uid
        });
      }
      setUploadQueue([]);
      setIsAddModalOpen(false);
      setErrorMsg('✅ 所有作品已成功同步至雲端');
    } catch (err) { setErrorMsg('寫入失敗'); }
    finally { setIsProcessing(false); setView('portfolio'); setCurrentPage(1); }
  };

  const addCategory = async () => {
    if (!isAdmin || !sidebarCatInput.trim()) return;
    try {
      await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'categories'), {
        name: sidebarCatInput.trim(), order: categories.length, createdAt: new Date().toISOString()
      });
      setSidebarCatInput('');
    } catch (e) { setErrorMsg('新增分類失敗'); }
  };

  const executeDeleteCategory = async () => {
    if (!catDeleteConfirm?.id) return;
    try {
      await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'categories', catDeleteConfirm.id));
      setCatDeleteConfirm(null);
    } catch (e) { setErrorMsg('刪除失敗'); }
  };

  const handleEditCategory = async (cat) => {
    if (!cat.id) { alert("預設分類無法直接修改"); return; }
    const n = window.prompt(`修改分類名稱為：`, cat.name);
    if (n && n !== cat.name) {
      try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'categories', cat.id), { name: n }); }
      catch (e) { setErrorMsg('更新失敗'); }
    }
  };

  const updateQueueInfo = (id, updates) => {
    setUploadQueue(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (loginForm.username === dbConfig.adminUser && loginForm.password === dbConfig.adminPass) {
      setIsAdmin(true);
      localStorage.setItem('isWoodArtAdminFlag', 'true');
      setShowLoginModal(false);
    } else { setErrorMsg('帳號或密碼錯誤。'); }
  };

  const handleLogout = () => { setIsAdmin(false); localStorage.removeItem('isWoodArtAdminFlag'); };

  const handleGearClick = () => {
    if (isAdmin) setIsAdminSettingOpen(true);
    else setShowLoginModal(true);
  };
  const OFFICIAL_QR = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=https://line.me/ti/p/LC-EUy3rQi";
  const FB_LINK = "https://www.facebook.com/people/%E6%9C%A8%E8%97%9D%E5%9D%8A%E5%B7%A5%E7%A8%8B%E8%A1%8C/100063732565691/";
  const LINE_LINK = "https://line.me/ti/p/LC-EUy3rQi";
  
  // 安全圖示
  const SafeIcon = ({ name, size = 24, className = "" }) => {
    const IconComponent = Icons[name];
    if (!IconComponent) return null;
    return <IconComponent size={size} className={className} />;
  };
  // --- 頁面視圖 ---
  

  const NewsPage = () => (
    <div className="animate-fade-in py-16 lg:py-24 max-w-[1440px] mx-auto px-6 lg:px-12">
      <div className="text-center mb-24 space-y-4 text-left">
        <h2 className="text-5xl font-serif text-stone-900 tracking-tighter italic text-center">最新消息</h2>
        <div className="w-full max-w-[120px] mx-auto border-b border-dotted border-stone-400"></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-32">
        {projects.slice(0, 6).map((project) => (
          <div key={project.id} className="group cursor-pointer">
            <div className="relative aspect-[16/9] w-full overflow-hidden bg-stone-50 shadow-md transition-all duration-700 hover:shadow-2xl mb-10 rounded-sm">
              <img 
                src={project.imageData} 
                alt={`木藝坊工程行最新作品 - ${project.title}`} 
                title={`${project.title} | 木藝坊工程行`}
                className="w-full h-full object-cover transition-transform duration-1000 group-hover:scale-105" 
              />
              <div className="absolute top-6 right-6"><span className="bg-white/95 px-4 py-1.5 text-[12px] font-black uppercase tracking-widest text-stone-900 shadow-xl">NEWS</span></div>
            </div>
            <div className="space-y-6 text-left">
              <div className="flex items-center gap-8 text-[22px] font-black text-stone-800 tracking-wide uppercase">
                <span className="flex items-center gap-4 italic font-bold">| {project.title}</span>
                <span className="text-stone-200 font-light">|</span>
                <span className="text-amber-800 opacity-60 font-black">{project.category}</span>
              </div>
              <div className="text-[18px] text-stone-400 font-light leading-relaxed truncate pl-6 border-l-2 border-stone-100 italic">{project.description}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  

  const AboutPage = () => (
    <div className="animate-fade-in py-16 lg:py-24 text-left">
      <section className="text-center mb-24 px-6">
        <h2 className="text-5xl lg:text-7xl font-serif text-stone-900 tracking-tighter italic mb-8">關於木藝坊</h2>
        <div className="h-1.5 w-24 bg-amber-800 mx-auto mb-12"></div>
        <p className="text-[20px] lg:text-[24px] text-stone-500 font-bold tracking-widest uppercase">{companyInfo.engName}</p>
      </section>
      <section className="max-w-[1200px] mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-20 items-center mb-32">
        <div className="relative aspect-square lg:aspect-[4/5] rounded-[2rem] overflow-hidden shadow-2xl group">
          <img 
            src={dbConfig.aboutImg || 'https://images.unsplash.com/photo-1504148455328-c376907d081c?q=80&w=1200'} 
            alt="木藝坊工程行 - 職人木作精神" 
            className="w-full h-full object-cover" 
          />
          {isAdmin && (
            <label className="absolute inset-0 flex flex-col items-center justify-center text-white opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity z-10 bg-black/40">
              <Icons.Camera size={48} className="mb-4" />
              <span className="font-black uppercase tracking-widest bg-stone-900/60 px-6 py-2 rounded-full">更換封面照片</span>
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => { if(e.target.files[0]) { const b64 = await compressImage(e.target.files[0]); await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'global'), { aboutImg: b64 }); } }} />
            </label>
          )}
          <div className="absolute -bottom-10 -right-10 bg-amber-800 text-white p-10 rounded-3xl shadow-2xl hidden md:block">
            <p className="text-4xl font-black mb-1">20+</p>
            <p className="text-xs font-bold tracking-widest uppercase opacity-70">Years Master</p>
          </div>
        </div>
        <div className="space-y-10 text-[20px] leading-relaxed text-stone-500 font-light italic">
          <div className="space-y-4">
             <span className="text-amber-800 text-[14px] font-black uppercase tracking-[0.4em] block">Our Philosophy</span>
             <h3 className="text-4xl font-serif text-stone-900 leading-tight">將「藝」融入空間<br/>讓「坊」成就生活</h3>
          </div>
          <p className="text-[22px] text-stone-600">「我們是專精於木作與室內裝潢的專業工程團隊，由負責人親自帶領。」</p>
          <p>{companyInfo.aboutText}</p>
        </div>
      </section>
    </div>
  );

  const ContactPage = () => (
    <div className="animate-fade-in py-16 lg:py-24 px-6 flex flex-col items-center">
      {/* 限制最大寬度，並讓標題與下方內容寬度一致 */}
      <div className="w-full max-w-5xl">
        
        {/* 標題區：棕色垂直線條標題 */}
        <h2 className="text-4xl md:text-5xl font-black border-l-8 border-stone-800 pl-6 mb-16 leading-tight text-left">
          聯絡我們
        </h2>

        {/* 主內容區：使用 items-stretch 確保高度一致，justify-between 分散對齊 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-stretch">
          
          {/* 左側：文字資訊區 - 使用 justify-center 讓內容在左半部垂直置中 */}
          <div className="flex flex-col justify-center space-y-12 text-left">
            <div className="space-y-6">
              <h3 className="text-lg font-bold text-stone-400 uppercase tracking-widest">
                預約諮詢 MASTER LINE
              </h3>
              <a href={`tel:${companyInfo.phone}`} className="text-5xl md:text-6xl font-black text-amber-900 hover:underline block tracking-tighter leading-none">
                {companyInfo.phone}
              </a>
              <p className="text-stone-500 font-bold text-lg">
                服務時間：{companyInfo.hours}
              </p>
            </div>

            {/* 社群 ICON 上傳區域 */}
            <div className="flex gap-6">
              {/* FB 圖示 */}
              <div className="relative group">
                <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-xl hover:scale-110 transition-all overflow-hidden">
                  {dbConfig.fbIcon ? <img src={dbConfig.fbIcon} className="w-full h-full object-cover" alt="FB" /> : <SafeIcon name="Facebook" size={32} />}
                </div>
                {isAdmin && (
                  <label className="absolute -top-2 -right-2 bg-stone-900 text-white p-1.5 rounded-full cursor-pointer shadow-lg z-10 border border-white/20">
                    <SafeIcon name="Camera" size={12} /><input type="file" className="hidden" onChange={async e => { if(e.target.files[0]) { const b64 = await compressImage(e.target.files[0], 200); await updateDoc(doc(db,'artifacts',appId,'public','data','config','global'), {fbIcon:b64}); } }} />
                  </label>
                )}
              </div>

              {/* LINE 圖示 */}
              <div className="relative group">
                <a href={LINE_LINK} target="_blank" rel="noreferrer" className="w-16 h-16 bg-[#06C755] rounded-2xl flex items-center justify-center text-white shadow-xl hover:scale-110 transition-all overflow-hidden">
                  {dbConfig.lineIcon ? <img src={dbConfig.lineIcon} className="w-full h-full object-cover" alt="LINE" /> : <SafeIcon name="MessageCircle" size={32} />}
                </a>
                {isAdmin && (
                  <label className="absolute -top-2 -right-2 bg-stone-900 text-white p-1.5 rounded-full cursor-pointer shadow-lg z-10 border border-white/20">
                    <SafeIcon name="Camera" size={12} /><input type="file" className="hidden" onChange={async e => { if(e.target.files[0]) { const b64 = await compressImage(e.target.files[0], 200); await updateDoc(doc(db,'artifacts',appId,'public','data','config','global'), {lineIcon:b64}); } }} />
                  </label>
                )}
              </div>
            </div>
          </div>
          
          {/* 右側：諮詢方框區 (對標圖片淺灰圓角) */}
          <div className="bg-stone-50/50 p-12 rounded-[4rem] text-center border border-stone-100 shadow-sm flex flex-col items-center">
             <p className="text-lg font-black text-stone-600 mb-8">掃描 QR 快速預約</p>
             
             <div className="relative group bg-white p-6 rounded-[2.5rem] shadow-md mb-10 w-fit">
               <img src={dbConfig.qr || OFFICIAL_QR} className="w-56 h-56 object-contain" alt="QR" />
               {isAdmin && (
                  <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-white cursor-pointer transition-opacity rounded-[2.5rem]">
                     <SafeIcon name="Camera" size={32} /><span className="text-[10px] mt-2 font-black">更換 QR</span>
                     <input type="file" className="hidden" onChange={async e => { if(e.target.files[0]) { const b64 = await compressImage(e.target.files[0]); await updateDoc(doc(db,'artifacts',appId,'public','data','config','global'), {qr:b64}); } }} />
                  </label>
               )}
             </div>

             <a href={LINE_LINK} target="_blank" className="w-full max-w-[320px] bg-[#06C755] text-white py-6 rounded-2xl font-black text-xl hover:bg-[#05b14c] transition-all shadow-lg">
             加入木藝坊 LINE 諮詢 
             </a>
          </div>

        </div>
      </div>
    </div>
  );

  const PortfolioView = () => (
    <div className="animate-fade-in max-w-[1440px] mx-auto px-6 py-12 md:py-16 text-left">
      <div id="portfolio-top" className="h-1 invisible"></div>
      <div className="flex justify-end text-[20px] text-stone-300 font-bold uppercase tracking-widest mb-16 font-black leading-none uppercase">首頁 / 工程實績 / <span className="text-amber-800">{activeCategory}</span></div>
      
      <div className="text-center mb-24 overflow-x-auto no-scrollbar scroll-smooth">
        <ul className="inline-flex flex-nowrap items-center justify-center gap-x-6 md:gap-x-10 text-[18px] md:text-[30px] font-bold text-stone-300 whitespace-nowrap min-w-full md:min-w-0 px-4 pb-2 text-left">
          <li className="flex items-center shrink-0">
            <button onClick={() => { setActiveCategory("全部"); setCurrentPage(1); }} className={activeCategory === "全部" ? 'text-stone-900 relative after:content-[""] after:absolute after:-bottom-4 after:left-0 after:w-full after:h-[4px] after:bg-amber-800' : 'hover:text-stone-600 transition-colors'}></button>
          </li>
         
          {categories.map((cat) => (
            <li key={cat.id || cat.name} className="flex items-center shrink-0 text-left">
              <span className="mx-4 md:mx-6 w-1.5 h-1.5 bg-stone-100 rounded-full shrink-0"></span>
              <button onClick={() => { setActiveCategory(cat.name); setCurrentPage(1); }} className={activeCategory === cat.name ? 'text-stone-900 relative after:content-[""] after:absolute after:-bottom-4 after:left-0 after:w-full after:h-[4px] after:bg-amber-800' : 'hover:text-stone-600 transition-colors'}>{cat.name}</button>
            </li>
            
          ))}
           <button onClick={() => setIsAddModalOpen(true)} className="p-2 bg-stone-900 text-white rounded-full shadow-lg scale-110 hover:bg-amber-800 transition-all text-left"><Icons.Plus size={26}/></button>
        </ul>
        
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-24 md:gap-y-36">
        {projects.filter(p => activeCategory === "全部" || p.category === activeCategory).slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map((p) => (
          <div key={p.id} className="group cursor-pointer">
            <div className="relative aspect-[16/10] overflow-hidden bg-stone-50 shadow-md rounded-sm md:group-hover:shadow-2xl transition-all duration-700 text-left">
              <img 
                src={p.imageData} 
                alt={`木藝坊工程行 - ${p.category}案例 - ${p.title}`} 
                title={`${p.title} | ${p.category}`}
                className="w-full h-full object-cover transition-transform duration-1000 md:group-hover:scale-105" 
              />
              {isAdmin && !p.isMock && (
                <div className="absolute top-4 right-4 flex gap-4 opacity-0 group-hover:opacity-100 transition-opacity">
                   <button onClick={(e) => { e.stopPropagation(); setEditingProject(p); setIsEditModalOpen(true); }} className="p-3 bg-white/95 rounded-full text-blue-600 shadow-xl hover:bg-white transition-all"><Icons.Edit size={22}/></button>
                   <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(p); }} className="p-3 bg-white/95 rounded-full text-red-600 shadow-xl hover:bg-white hover:scale-110 transition-all text-center"><Icons.Trash2 size={22}/></button>
                </div>
              )}
            </div>
            <div className="mt-10 space-y-6">
              <div className="flex items-center gap-6 text-[26px] md:text-[28px] font-black text-stone-800 tracking-wider text-left">
                 <span>| {p.title}</span><span className="text-amber-800 opacity-60 text-lg uppercase font-black">{p.category}</span>
              </div>
              <p className="text-[22px] text-stone-400 font-light italic border-l-2 border-stone-100 pl-6 leading-relaxed text-left">{p.description}</p>
            </div>
          </div>
        ))}
      </div>
      {Math.ceil(projects.length / PAGE_SIZE) > 1 && (
        <div className="flex justify-center mt-40 mb-12 font-black">
          <div className="flex items-center gap-8 text-stone-300">
            <button onClick={() => setCurrentPage(c => Math.max(1, c-1))} disabled={currentPage === 1} className="p-4 disabled:opacity-10 transition-colors hover:text-stone-900"><Icons.ChevronLeft size={40}/></button>
            {[...Array(Math.ceil(projects.length / PAGE_SIZE))].map((_, i) => (
              <button key={i} onClick={() => { setCurrentPage(i+1); document.getElementById('portfolio-top')?.scrollIntoView({behavior:'smooth'}); }} className={`w-14 h-14 md:w-16 md:h-16 border-2 flex items-center justify-center text-xl md:text-2xl ${currentPage === i + 1 ? 'border-stone-800 text-stone-900 bg-white shadow-lg' : 'border-stone-50'}`}>{i+1}</button>
            ))}
            <button onClick={() => setCurrentPage(c => Math.min(Math.ceil(projects.length / PAGE_SIZE), c+1))} disabled={currentPage === Math.ceil(projects.length / PAGE_SIZE)} className="p-4 disabled:opacity-10 transition-colors hover:text-stone-900"><Icons.ChevronRight size={40}/></button>
          </div>
        </div>
      )}
    </div>
  );

  const ConfirmModal = ({ title, message, onConfirm, onCancel, type = "danger" }) => (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md text-left">
      <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-sm overflow-hidden p-10 text-center animate-in zoom-in-95 duration-200">
        <div className={`w-20 h-20 ${type === 'danger' ? 'bg-red-50 text-red-500' : 'bg-amber-50 text-amber-600'} rounded-full flex items-center justify-center mx-auto mb-8`}>
          <Icons.TriangleAlert size={40} />
        </div>
        <h3 className="text-2xl font-black text-slate-800 mb-3">{title}</h3>
        <p className="text-slate-400 font-medium mb-10 leading-relaxed">{message}</p>
        <div className="flex gap-4">
          <button onClick={onCancel} className="flex-1 px-6 py-4 text-sm font-black text-slate-400 bg-slate-100 rounded-2xl hover:bg-slate-200 transition-all">取消</button>
          <button onClick={onConfirm} className={`flex-1 px-6 py-4 text-sm font-black text-white ${type === 'danger' ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-600 hover:bg-amber-700'} rounded-2xl transition-all shadow-lg`}>確定執行</button>
        </div>
      </div>
    </div>
  );

  if (!isAuthReady) return <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-6 text-center text-left"><Icons.Loader2 className="animate-spin text-amber-800" size={50}/><p className="text-stone-400 font-bold tracking-widest uppercase text-left">WOOD ART SECURITY CONNECTING...</p></div>;

  return (
    <div className="min-h-screen bg-white text-[#333] font-sans antialiased overflow-x-hidden text-left">
      
      {errorMsg && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[300] bg-red-600 text-white p-4 rounded-xl shadow-2xl flex items-center gap-4 animate-bounce text-left">
          <Icons.TriangleAlert size={24} /> <p className="font-bold">{errorMsg}</p>
          <button onClick={() => setErrorMsg('')}><Icons.X size={20}/></button>
        </div>
      )}

      {/* 導覽列 */}
      <nav className="header sticky top-0 z-[60] bg-white/95 backdrop-blur-md border-b border-stone-100 h-24 px-4 md:px-8 shadow-sm">
                <div className="max-w-[1300px] mx-auto h-full flex items-center justify-between text-left">
          <div className="logo flex items-center gap-6 cursor-pointer h-full text-left" onClick={() => { setView('portfolio'); window.scrollTo({top:0, behavior:'smooth'}); }}>
             <div className="relative group shrink-0">
                <img src={dbConfig.logo || OFFICIAL_LOGO} alt="木藝坊工程行首頁" className="h-[65px] w-auto object-contain text-left" />
                {isAdmin && (
                  <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center rounded-md cursor-pointer transition-opacity text-left">
                    <Icons.Camera size={16} className="text-white" />
                    <input type="file" accept="image/*" className="hidden" onChange={async (e) => { if(e.target.files[0]) { const b64 = await compressImage(e.target.files[0]); await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'global'), { logo: b64 }); } }} />
                  </label>
                )}
             </div>
             <div className="hidden sm:flex flex-col border-l border-stone-100 pl-6 text-left leading-none">
                <h1 className="text-[24px] font-black text-stone-800 tracking-widest mb-1.5 uppercase leading-none">{companyInfo.name}</h1>
                <span className="text-[10px] text-amber-800 font-bold uppercase tracking-[0.2em] italic leading-none">{companyInfo.engName}</span>
             </div>
          </div>
          <div className="hidden lg:block">
            
            <ul className="flex flex-col lg:flex-row gap-8 lg:gap-14 text-[30px] font-bold uppercase tracking-[0.2em] text-stone-400">
               <li><button onClick={() => setView('about')} className={view === 'about' ? 'text-stone-900 border-b-2 border-amber-800 font-black pb-1' : 'hover:text-stone-900'}>關於我們</button></li>
               <li><button onClick={() => setView('news')} className={view === 'news' ? 'text-stone-900 border-b-2 border-amber-800 font-black pb-1' : 'hover:text-stone-900'}>最新消息</button></li>
               <li><button onClick={() => setView('portfolio')} className={view === 'portfolio' ? 'text-stone-900 border-b-2 border-amber-800 font-black pb-1' : 'hover:text-stone-900'}>工程實績</button></li>
               <li><button onClick={() => setView('contact')} className={view === 'contact' ? 'text-stone-900 border-b-2 border-amber-800 font-black pb-1' : 'hover:text-stone-900'}>聯絡我們</button></li>
            </ul>
          </div>
          {/* 右側按鈕群組：FB + LINE + 設定 */}
<div className="flex items-center gap-1.5 ml-auto">
  {/* FB 按鈕 */}
  <a href={FB_LINK} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-sm hover:scale-105 transition-all overflow-hidden shrink-0">
    {dbConfig.fbIcon ? <img src={dbConfig.fbIcon} className="w-full h-full object-cover" alt="FB" /> : <SafeIcon name="Facebook" size={18} />}
  </a>

  {/* LINE 按鈕 */}
  <a href={LINE_LINK} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-xl bg-[#06C755] flex items-center justify-center text-white shadow-sm hover:scale-105 transition-all overflow-hidden shrink-0">
    {dbConfig.lineIcon ? <img src={dbConfig.lineIcon} className="w-full h-full object-cover" alt="LINE" /> : <SafeIcon name="MessageCircle" size={18} />}
  </a>

  
</div>
          <div className="flex items-center gap-4 text-stone-300">
            {isAdmin ? (
               <div className="flex items-center gap-4 text-left">
               
                 <button onClick={handleGearClick} className="p-2 text-stone-400 hover:text-stone-900 transition-colors text-left"><Icons.Settings size={30}/></button>
                 <button onClick={handleLogout} className="p-2 text-stone-300 hover:text-red-600 transition-colors text-left"><Icons.LogOut size={30}/></button>
               </div>
            ) : (
               <button onClick={handleGearClick} className="p-2 hover:text-stone-900 transition-colors text-left"><Icons.Settings size={30}/></button>
            )}
            <button onClick={() => setMobileMenuOpen(true)} className="lg:hidden text-stone-800 text-left"><Icons.Menu size={32}/></button>
          </div>
        </div>
      </nav>

      <main className="min-h-[80vh]">
        {view === 'portfolio' && <PortfolioView />}
        {view === 'news' && <NewsPage />}
        {view === 'about' && <AboutPage />}
        {view === 'contact' && <ContactPage />}
      </main>

      <footer className="bg-[#051305] text-white py-32 px-10 border-t border-white/5 mt-20 text-left leading-none">
        <div className="max-w-[1440px] mx-auto grid lg:grid-cols-3 gap-24">
           <div className="space-y-12 flex flex-col items-center lg:items-start text-left">
              <div className="w-32 h-32 bg-white p-4 rounded-3xl shadow-2xl flex items-center justify-center overflow-hidden shrink-0 border-8 border-white/5 text-left"><img src={dbConfig.logo || OFFICIAL_LOGO} alt="木藝坊 Logo" className="w-full h-full object-contain" /></div>
              <div className="space-y-3 text-left">
                <h4 className="text-[40px] font-black tracking-widest uppercase leading-none">{companyInfo.name}</h4>
                <p className="text-stone-500 font-bold uppercase tracking-[0.4em] text-xs italic leading-none">{companyInfo.engName}</p>
              </div>
           </div>
           <div className="space-y-12 text-left">
              <h5 className="text-white/50 font-black tracking-widest uppercase border-b border-white/10 pb-4 text-lg leading-none font-black text-left">服務資訊 Service</h5>
              <ul className="space-y-10 text-stone-300 text-[18px] font-medium tracking-wide">
                 <li className="flex items-center gap-6 leading-none text-left font-bold"><Icons.Clock className="text-amber-800" size={24}/> {companyInfo.hours}</li>
                 <li className="flex flex-col items-center lg:items-start gap-4 border-l-4 border-amber-800/30 pl-8 leading-none">
                    <span className="text-stone-500 text-[11px] font-black tracking-widest uppercase leading-none text-left">熱線電話</span>
                    <a href={`tel:${companyInfo.phone}`} className="text-white font-black text-4xl hover:text-amber-500 transition-colors tracking-tighter leading-none">{companyInfo.phone}</a>
                 </li>
                 <li className="flex items-center justify-center lg:justify-start gap-6 opacity-60 leading-none font-bold"><Icons.Mail className="text-amber-800" size={24}/> 全台各地工程承攬</li>
              </ul>
           </div>
           <div className="space-y-12 text-left text-center lg:text-left">
              <h5 className="text-white/50 font-black tracking-widest uppercase border-b border-white/10 pb-4 text-lg leading-none font-black text-center lg:text-left">預約諮詢 Consulting</h5>
              <div className="flex flex-col items-center gap-10 text-center lg:text-left">
                 <div className="w-56 h-56 bg-white p-5 rounded-[3rem] shadow-2xl overflow-hidden border-[10px] border-white/5 text-left flex items-center justify-center"><img src={dbConfig.qr || OFFICIAL_QR} alt="木藝坊工程行 LINE 預約諮詢" className="w-full h-full object-contain" /></div>
                 <a href={LINE_LINK} target="_blank" className="bg-[#00C300] px-12 py-5 rounded-2xl font-black text-lg tracking-widest hover:scale-105 transition-transform shadow-xl text-center">加入木藝坊 LINE 諮詢</a>
              </div>
           </div>
        </div>
      </footer>

      {/* 作品管理視窗 */}
      {isAddModalOpen && isAdmin && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md overflow-y-auto">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-7xl overflow-hidden animate-in zoom-in-95 duration-200 text-left my-auto">
             <header className="flex items-center justify-between gap-4 p-10 bg-stone-900 text-white text-left">
                <div className="flex items-center gap-5 text-left">
                   <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center text-white text-left">
                      <Icons.Settings size={28} />
                   </div>
                   <div className="text-left">
                      <h1 className="text-2xl font-black tracking-tighter text-left">工程作品管理系統</h1>
                      <p className="text-xs text-stone-400 font-bold uppercase tracking-widest text-left">Management Dashboard</p>
                   </div>
                </div>
                <button onClick={() => setIsAddModalOpen(false)} className="text-stone-400 hover:text-white text-left"><Icons.X size={40}/></button>
             </header>

             <div className="p-10 flex flex-col lg:flex-row gap-10 max-h-[75vh] overflow-y-auto no-scrollbar text-left">
                <aside className="lg:w-80 shrink-0 text-left">
                  <div className="bg-[#F9F9F9] rounded-[2.5rem] p-8 border border-slate-100 shadow-sm sticky top-0 text-left">
                    <h2 className="text-xl font-black text-slate-800 mb-8 flex items-center gap-3 text-left"><Icons.ListFilter size={24} className="text-amber-800"/> 分類即時管理</h2>
                    <div className="space-y-4 mb-8 max-h-[300px] overflow-y-auto pr-2 no-scrollbar text-left">
                      {categories.map((cat) => (
                        <div key={cat.id || cat.name} className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex items-center justify-between group transition-all hover:border-amber-200 text-left">
                          <span className="font-bold text-slate-700 text-left">{cat.name}</span>
                          <div className="flex items-center gap-1 text-left">
                            <button onClick={() => handleEditCategory(cat)} className="p-2 text-blue-400 hover:bg-blue-50 rounded-lg transition-colors text-left"><Icons.Edit3 size={18} /></button>
                            <button onClick={() => setCatDeleteConfirm(cat)} className="p-2 text-slate-300 hover:text-red-400 transition-colors text-left"><Icons.Trash2 size={18} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-4 text-left">
                      <input type="text" placeholder="新分類名稱..." value={sidebarCatInput} onChange={(e) => setSidebarCatInput(e.target.value)} className="w-full bg-white border border-slate-200 rounded-2xl px-5 py-4 text-sm font-bold focus:ring-4 focus:ring-amber-50 outline-none transition-all text-left" />
                      <button onClick={addCategory} className="w-full bg-stone-900 text-white font-bold py-4 rounded-2xl hover:bg-black transition-all shadow-lg active:scale-95 text-center">建立分類</button>
                    </div>
                  </div>
                </aside>

                <main className="flex-1 space-y-8 text-left">
                  <div className="flex items-center justify-between mb-2 text-left">
                    <h2 className="text-3xl font-black text-slate-900 text-left">作品同步中心</h2>
                    <div className="text-right text-left">
                      <p className="text-lg font-black text-slate-800 text-left">{uploadQueue.length} / 6 <span className="text-slate-300 text-sm font-medium tracking-widest uppercase text-left">Photos</span></p>
                    </div>
                  </div>

                  {uploadQueue.length === 0 ? (
                    <div onClick={() => fileInputRef.current.click()} className="h-72 border-4 border-dashed border-slate-100 rounded-[3rem] flex flex-col items-center justify-center cursor-pointer hover:bg-stone-50 hover:border-amber-200 transition-all group text-left">
                      <div className="w-20 h-20 bg-amber-50 text-amber-700 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform text-left"><Icons.Upload size={40} /></div>
                      <p className="text-xl font-black text-slate-400 text-center text-left">點擊此處選取照片 (支援批次上傳)</p>
                    </div>
                  ) : (
                    <div className="space-y-8 text-left">
                      <div className="space-y-8 text-left">
                        {uploadQueue.map((item, index) => (
                          <div key={item.id} className="bg-stone-50 rounded-[2.5rem] p-8 relative flex flex-col md:flex-row gap-8 border border-slate-100 group animate-in slide-in-from-bottom-4 text-left">
                            <button onClick={() => setUploadQueue(uploadQueue.filter(q => q.id !== item.id))} className="absolute -top-3 -right-3 w-10 h-10 bg-red-500 text-white rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform z-10 text-center"><Icons.X size={20} /></button>
                            <div className="w-full md:w-60 h-60 shrink-0 rounded-3xl overflow-hidden bg-slate-200 shadow-2xl text-left"><img src={item.previewUrl} className="w-full h-full object-cover" /></div>
                            <div className="flex-1 space-y-6 text-left">
                               <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-left">
                                  <div className="text-left"><label className="block text-[10px] font-black text-stone-400 uppercase tracking-widest mb-2 pl-2 text-left">標題 (空白則取檔名)</label><input type="text" placeholder="手動名稱..." className="w-full px-6 py-4 bg-white rounded-2xl border-none font-bold text-slate-700 focus:ring-4 focus:ring-amber-50 shadow-sm text-left" value={item.title} onChange={e=>updateQueueInfo(item.id, {title: e.target.value})} /></div>
                                  <div className="text-left"><label className="block text-[10px] font-black text-stone-400 uppercase tracking-widest mb-2 pl-2 text-left">指定分類</label><select className="w-full px-6 py-4 bg-white rounded-2xl border-none font-bold text-slate-700 cursor-pointer shadow-sm text-left" value={item.category} onChange={e=>updateQueueInfo(item.id, {category: e.target.value})}>{categories.map(c => <option key={c.id || c.name} value={c.name}>{c.name}</option>)}</select></div>
                               </div>
                               <div className="text-left"><label className="block text-[10px] font-black text-stone-400 uppercase tracking-widest mb-2 pl-2 text-left">施工詳細描述</label><textarea rows="3" placeholder="此次完工重點分享..." className="w-full px-6 py-4 bg-white rounded-2xl border-none font-medium text-slate-600 resize-none focus:ring-4 focus:ring-amber-50 shadow-sm text-left" value={item.description} onChange={e=>updateQueueInfo(item.id, {description: e.target.value})}></textarea></div>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-col sm:flex-row gap-5 pt-8 border-t border-slate-50 text-left">
                        <button onClick={() => setUploadQueue([])} className="flex-1 py-6 bg-slate-100 text-stone-400 font-black rounded-[2rem] hover:bg-slate-200 transition-all uppercase tracking-widest text-center">全部取消</button>
                        
                        {uploadQueue.length < 6 && (
                          <button onClick={() => fileInputRef.current.click()} className="flex-1 py-6 bg-white border-2 border-stone-200 text-stone-600 font-black rounded-[2rem] hover:bg-stone-50 transition-all uppercase tracking-widest flex items-center justify-center gap-2 text-left"><Icons.Plus size={20} /> 繼續新增</button>
                        )}

                        <button onClick={handleFinalUploadToCloud} disabled={isProcessing} className="flex-[3] bg-amber-800 text-white font-black py-6 rounded-[2rem] hover:bg-amber-900 transition-all shadow-2xl flex items-center justify-center gap-3 text-left">
                          {isProcessing ? <Icons.Loader2 className="animate-spin" /> : <Icons.Save size={24}/>}
                          {isProcessing ? '同步雲端中...' : '確認並開始同步至雲端資料庫'}
                        </button>
                      </div>
                    </div>
                  )}
                </main>
             </div>
             <input type="file" ref={fileInputRef} onChange={handleFileUpload} multiple accept="image/*" className="hidden" />
          </div>
        </div>
      )}

      {/* 帳密設定彈窗 */}
      {isAdminSettingOpen && isAdmin && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-[#051305]/95 backdrop-blur-md">
          <div className="bg-white rounded-[3rem] w-full max-w-md shadow-2xl p-16 space-y-12 text-stone-900 text-left leading-none">
            <div className="flex justify-between items-center leading-none text-left"><h3 className="text-xl font-black uppercase italic tracking-widest text-left">安全性設定中心</h3><button onClick={() => setIsAdminSettingOpen(false)}><Icons.X size={32} className="text-stone-300" /></button></div>
            <form onSubmit={async (e) => { e.preventDefault(); await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'config', 'global'), { adminUser: adminSettingForm.username, adminPass: adminSettingForm.password }, { merge: true }); setIsAdminSettingOpen(false); alert("安全性設定同步雲端成功。"); }} className="space-y-10 leading-none text-left">
              <div className="space-y-4 text-left leading-none"><label className="text-xs font-black text-stone-400 pl-4 uppercase text-left">新管理者帳號</label><input type="text" required className="w-full p-6 bg-stone-50 border-b-2 border-stone-100 font-black text-2xl focus:border-amber-800 transition-all leading-none text-left" value={adminSettingForm.username} onChange={e=>setAdminSettingForm({...adminSettingForm, username: e.target.value})} /></div>
              <div className="space-y-4 text-left leading-none"><label className="text-xs font-black text-stone-400 pl-4 uppercase text-left">新登入密碼</label><input type="text" required className="w-full p-6 bg-stone-50 border-b-2 border-stone-100 font-black text-2xl focus:border-amber-800 transition-all leading-none text-left" value={adminSettingForm.password} onChange={e=>setAdminSettingForm({...adminSettingForm, password: e.target.value})} /></div>
              <button type="submit" className="w-full bg-amber-800 text-white py-8 rounded-3xl font-black text-xl shadow-2xl hover:bg-amber-900 transition-all text-center">儲存修改並同步雲端</button>
            </form>
          </div>
        </div>
      )}

      {/* 登入彈窗 */}
      {showLoginModal && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-6 bg-black/80 backdrop-blur-xl text-left">
          <div className="bg-white rounded-[3rem] w-full max-w-sm shadow-2xl p-16 space-y-12 text-left">
            <div className="flex justify-between items-center text-left"><h3 className="text-2xl font-black italic tracking-tighter text-left">ADMIN ACCESS</h3><button onClick={() => setShowLoginModal(false)}><Icons.X size={32} className="text-stone-300 text-left"/></button></div>
            <form onSubmit={handleLogin} className="space-y-8 text-left">
              <input type="text" placeholder="帳號" required className="w-full px-6 py-5 bg-stone-50 rounded-2xl border-none focus:ring-2 focus:ring-amber-800 font-bold text-left" value={loginForm.username} onChange={e=>setLoginForm({...loginForm, username: e.target.value})} />
              <input type="password" placeholder="密碼" required className="w-full px-6 py-5 bg-stone-50 rounded-2xl border-none focus:ring-2 focus:ring-amber-800 font-bold text-left" value={loginForm.password} onChange={e=>setLoginForm({...loginForm, password: e.target.value})} />
              <button type="submit" className="w-full bg-[#1A1A1A] text-white font-black py-6 rounded-2xl shadow-xl hover:bg-black transition-all uppercase tracking-widest text-center">Verify & Login</button>
            </form>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <ConfirmModal title="確定永久刪除？" message={`作品「${deleteConfirm.title}」將從雲端庫移除且無法復原。`} onConfirm={executeDeleteProject} onCancel={() => setDeleteConfirm(null)} />
      )}

      {catDeleteConfirm && (
        <ConfirmModal title="刪除分類標籤？" message={`確定刪除「${catDeleteConfirm.name}」？`} onConfirm={executeDeleteCategory} onCancel={() => setCatDeleteConfirm(null)} />
      )}

      {isEditModalOpen && editingProject && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-stone-950/95 backdrop-blur-md">
          <div className="bg-white w-full max-w-4xl shadow-2xl rounded-3xl overflow-hidden text-left my-auto">
            <div className="bg-blue-600 p-10 text-white flex justify-between items-center text-left">
               <h3 className="text-2xl font-black uppercase italic tracking-widest text-left">修改實績內容</h3>
               <button onClick={() => { setIsEditModalOpen(false); setEditingProject(null); }}><Icons.X size={40} /></button>
            </div>
            <form onSubmit={async (e) => { e.preventDefault(); await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'projects', editingProject.id), editingProject); setIsEditModalOpen(false); setEditingProject(null); }} className="p-10 md:p-20 space-y-12 text-stone-900 text-left">
              <div className="relative aspect-video w-full border border-stone-100 bg-stone-50 group flex items-center justify-center rounded-2xl overflow-hidden text-left"><img src={editingProject.imageData} alt={editingProject.title} className="h-full w-full object-cover" /><label className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center text-white cursor-pointer transition-opacity text-left"><Icons.Camera size={80}/><input type="file" accept="image/*" className="hidden" onChange={async (e) => { if(e.target.files[0]) { const b64 = await compressImage(e.target.files[0]); setEditingProject({...editingProject, imageData: b64}); } }}/></label></div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-12 text-left"><input type="text" className="w-full px-8 py-6 bg-stone-50 border-2 border-stone-100 rounded-3xl font-bold text-2xl focus:border-amber-800 outline-none text-left" value={editingProject.title} onChange={e=>setEditingProject({...editingProject, title:e.target.value})} /><select className="w-full px-8 py-6 bg-stone-50 border-2 border-stone-100 rounded-3xl font-bold text-2xl focus:border-amber-800 outline-none text-left" value={editingProject.category} onChange={e=>setEditingProject({...editingProject, category:e.target.value})}>{categories.map(c => <option key={c.id || c.name} value={c.name}>{c.name}</option>)}</select></div>
              <textarea rows="4" className="w-full px-8 py-8 bg-stone-50 border-2 border-stone-100 rounded-3xl font-medium text-2xl outline-none resize-none focus:border-amber-800 text-left" value={editingProject.description} onChange={e=>setEditingProject({...editingProject, description:e.target.value})}></textarea>
              <div className="flex gap-10 text-center"><button type="button" onClick={() => { setIsEditModalOpen(false); setEditingProject(null); }} className="flex-1 py-8 bg-stone-100 font-black text-stone-400 text-2xl rounded-3xl uppercase text-center">取消</button><button type="submit" className="flex-[2] bg-blue-600 text-white py-8 font-black uppercase text-2xl shadow-2xl rounded-3xl hover:bg-black transition-all text-center">儲存修改</button></div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

// 樣式注入
if (typeof document !== 'undefined') {
  const styleTag = document.createElement("style");
  styleTag.innerHTML = `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@300;700;900&family=Noto+Sans+TC:wght@300;400;700;900&display=swap');
    html { scroll-behavior: smooth; }
    body { font-family: 'Noto Sans TC', sans-serif; background-color: #ffffff; color: #333; text-align: left; }
    .font-serif { font-family: 'Noto Serif TC', serif; }
    .no-scrollbar::-webkit-scrollbar { display: none; }
    .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    ::selection { background: #B45309; color: white; }
    @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .animate-fade-in { animation: fade-in 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    .shadow-3xl { box-shadow: 0 35px 60px -15px rgba(0, 0, 0, 0.3); }
  `;
  document.head.appendChild(styleTag);
}