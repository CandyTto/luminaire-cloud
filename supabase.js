/**
 * Luminaire Cloud - Supabase Client 配置
 * 集中管理 Supabase 连接参数
 */

const SUPABASE_CONFIG = {
  url: 'https://azspgwlrtcoqdzgenoew.supabase.co',
  anonKey: 'sb_publishable__eZFcWMzRTr7SanUvr5cvA_Srf5SjNV',
  storageBucket: 'user-files',
};

// 初始化 Supabase 客户端（需要先加载 supabase-js CDN）
let supabase = null;

function initSupabase() {
  if (typeof supabaseCreateClient === 'undefined') {
    console.error('Supabase JS 库未加载，请检查 CDN 连接');
    return null;
  }
  if (!supabase) {
    supabase = supabaseCreateClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey, {
      db: { schema: 'public' },
      storage: {},
    });
  }
  return supabase;
}

// 获取 Supabase 实例
function getSupabase() {
  if (!supabase) return initSupabase();
  return supabase;
}

// 常量
const DELETE_PASSWORD_HASH = 'a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3'; // SHA-256("123")
const STORAGE_BUCKET = SUPABASE_CONFIG.storageBucket;
