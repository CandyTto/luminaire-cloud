/**
 * Luminaire Cloud - 认证模块
 * 处理用户登录、登出、会话管理、管理员操作
 */

// ==================== 密码工具 ====================

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyDeletePassword(input) {
  const hash = await hashPassword(input);
  return hash === DELETE_PASSWORD_HASH;
}

// ==================== 会话管理 ====================

const SESSION_KEY = 'luminaire_session';

function saveSession(user) {
  const session = {
    id: user.id,
    username: user.username,
    role: user.role,
    loginTime: Date.now(),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function getSession() {
  try {
    const data = localStorage.getItem(SESSION_KEY);
    if (!data) return null;
    const session = JSON.parse(data);
    // 会话有效期 24 小时
    if (Date.now() - session.loginTime > 24 * 60 * 60 * 1000) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    clearSession();
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function isLoggedIn() {
  return getSession() !== null;
}

function isAdmin() {
  const session = getSession();
  return session && session.role === 'admin';
}

function requireAuth() {
  if (!isLoggedIn()) {
    window.location.href = 'index.html';
    return null;
  }
  return getSession();
}

// ==================== 登录 / 登出 ====================

async function loginUser(username, password) {
  const sb = getSupabase();
  if (!sb) return { success: false, error: '无法连接数据库' };

  try {
    const passwordHash = await hashPassword(password);

    const { data, error } = await sb
      .from('users')
      .select('id, username, role, created_by')
      .eq('username', username)
      .eq('password_hash', passwordHash)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { success: false, error: '用户名或密码错误' };

    saveSession(data);
    return { success: true, user: data };
  } catch (err) {
    console.error('登录失败:', err);
    return { success: false, error: '登录失败，请稍后重试' };
  }
}

function logoutUser() {
  clearSession();
  window.location.href = 'index.html';
}

// ==================== 管理员 - 用户管理 ====================

async function adminCreateUser(username, password) {
  const session = getSession();
  if (!session || session.role !== 'admin') {
    return { success: false, error: '无操作权限' };
  }

  const sb = getSupabase();
  if (!sb) return { success: false, error: '无法连接数据库' };

  try {
    const passwordHash = await hashPassword(password);

    // 检查用户名是否已存在
    const { data: existing } = await sb
      .from('users')
      .select('id')
      .eq('username', username)
      .maybeSingle();

    if (existing) return { success: false, error: '用户名已存在' };

    const { data, error } = await sb
      .from('users')
      .insert({
        username,
        password_hash: passwordHash,
        role: 'user',
        created_by: session.id,
      })
      .select('id, username, role, created_by, created_at')
      .single();

    if (error) throw error;
    return { success: true, user: data };
  } catch (err) {
    console.error('创建用户失败:', err);
    return { success: false, error: '创建用户失败' };
  }
}

async function adminGetManagedUsers() {
  const session = getSession();
  if (!session || session.role !== 'admin') {
    return { success: false, error: '无操作权限', users: [] };
  }

  const sb = getSupabase();
  if (!sb) return { success: false, error: '无法连接数据库', users: [] };

  try {
    const { data, error } = await sb
      .from('users')
      .select('id, username, role, created_at')
      .eq('created_by', session.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, users: data || [] };
  } catch (err) {
    console.error('获取用户列表失败:', err);
    return { success: false, error: '获取用户列表失败', users: [] };
  }
}

async function adminDeleteUser(userId, deletePassword) {
  const session = getSession();
  if (!session || session.role !== 'admin') {
    return { success: false, error: '无操作权限' };
  }

  // 验证删除密码
  const pwdValid = await verifyDeletePassword(deletePassword);
  if (!pwdValid) return { success: false, error: '删除密码错误' };

  const sb = getSupabase();
  if (!sb) return { success: false, error: '无法连接数据库' };

  try {
    // 先删除该用户的所有文件
    const { data: userFiles } = await sb
      .from('files')
      .select('storage_path')
      .eq('user_id', userId);

    if (userFiles && userFiles.length > 0) {
      const paths = userFiles.map(f => f.storage_path);
      await sb.storage.from(STORAGE_BUCKET).remove(paths);
    }

    // 删除文件记录
    await sb.from('files').delete().eq('user_id', userId);

    // 删除用户
    const { error } = await sb.from('users').delete().eq('id', userId).eq('created_by', session.id);
    if (error) throw error;

    return { success: true };
  } catch (err) {
    console.error('删除用户失败:', err);
    return { success: false, error: '删除用户失败' };
  }
}

// ==================== 修改密码 ====================

async function changePassword(userId, oldPassword, newPassword) {
  const sb = getSupabase();
  if (!sb) return { success: false, error: '无法连接数据库' };

  try {
    const oldHash = await hashPassword(oldPassword);

    // 验证当前密码
    const { data: user, error: checkError } = await sb
      .from('users')
      .select('id')
      .eq('id', userId)
      .eq('password_hash', oldHash)
      .maybeSingle();

    if (checkError) throw checkError;
    if (!user) return { success: false, error: '当前密码错误' };

    // 更新密码
    const newHash = await hashPassword(newPassword);
    const { error: updateError } = await sb
      .from('users')
      .update({ password_hash: newHash })
      .eq('id', userId);

    if (updateError) throw updateError;
    return { success: true };
  } catch (err) {
    console.error('修改密码失败:', err);
    return { success: false, error: '修改密码失败，请稍后重试' };
  }
}

// ==================== 初始化检查 ====================

function checkAuthOnLoad() {
  // 只在仪表盘页面调用
  if (window.location.pathname.includes('dashboard')) {
    const session = getSession();
    if (!session) {
      window.location.href = 'index.html';
      return null;
    }
    return session;
  }

  // 如果在登录页且已登录，跳转到仪表盘
  if (!window.location.pathname.includes('dashboard')) {
    const session = getSession();
    if (session && !window.location.pathname.includes('dashboard')) {
      // 从仪表盘退出到登录页时不自动跳转
    }
  }

  return null;
}
