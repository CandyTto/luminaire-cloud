-- ============================================================
-- Luminaire Cloud - Supabase Database Schema
-- 在 Supabase SQL Editor 中执行此脚本
-- ============================================================

-- 1. 用户表
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. 文件元数据表
CREATE TABLE IF NOT EXISTS files (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  filename TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  storage_path TEXT NOT NULL,
  category TEXT DEFAULT 'other' CHECK (category IN ('image', 'video', 'document', 'other')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 索引
CREATE INDEX IF NOT EXISTS idx_files_user_id ON files(user_id);
CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
CREATE INDEX IF NOT EXISTS idx_files_created_at ON files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by);

-- ============================================================
-- RLS (Row Level Security) 策略
-- ============================================================

-- 启用 RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- --- users 表策略 ---

-- 允许任何人查询 users（用于登录验证）
-- 实际安全由应用层查询过滤保证（匹配 username + password_hash 才返回数据）
CREATE POLICY "Allow public select for login" ON users
  FOR SELECT USING (true);

-- 只允许 admin 插入新用户
CREATE POLICY "Allow admin insert users" ON users
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM users AS u
      WHERE u.id = (SELECT created_by FROM users WHERE id = (SELECT current_setting('request.jwt.claims', true)::json->>'sub'))
      AND u.role = 'admin'
    )
    OR
    -- 第一个 admin 用户（created_by 为 NULL）由初始化脚本创建
    (SELECT count(*) FROM users) = 0
  );

-- 允许 admin 删除自己创建的用户
CREATE POLICY "Allow admin delete own users" ON users
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM users AS admin
      WHERE admin.role = 'admin'
      AND admin.id = (SELECT (current_setting('request.jwt.claims', true)::json->>'user_id')::uuid)
    )
  );

-- --- files 表策略 ---

-- 用户只能查看自己的文件
CREATE POLICY "Users select own files" ON files
  FOR SELECT USING (
    user_id = (SELECT (current_setting('request.jwt.claims', true)::json->>'user_id')::uuid)
  );

-- 用户可以插入自己的文件
CREATE POLICY "Users insert own files" ON files
  FOR INSERT WITH CHECK (
    user_id = (SELECT (current_setting('request.jwt.claims', true)::json->>'user_id')::uuid)
  );

-- 用户可以更新自己的文件
CREATE POLICY "Users update own files" ON files
  FOR UPDATE USING (
    user_id = (SELECT (current_setting('request.jwt.claims', true)::json->>'user_id')::uuid)
  );

-- 用户可以删除自己的文件
CREATE POLICY "Users delete own files" ON files
  FOR DELETE USING (
    user_id = (SELECT (current_setting('request.jwt.claims', true)::json->>'user_id')::uuid)
  );

-- ============================================================
-- Storage Bucket 创建
-- 需要在 Supabase Dashboard > Storage 中手动创建名为 "user-files" 的 bucket
-- 或者通过 SQL:
-- ============================================================

-- 注意：Storage bucket 创建通常通过 Dashboard 或 Management API
-- 请在 Supabase Dashboard > Storage 中创建 bucket：
--   Name: user-files
--   Public: No (private)
--   允许所有常见文件类型

-- Storage RLS 策略（在 Supabase Dashboard > Storage > Policies 中配置）：
-- 1. SELECT (下载): 允许认证用户读取自己文件夹中的文件
--    USING: (storage.foldername(name))[1] = auth.uid()::text
-- 2. INSERT (上传): 允许认证用户上传到自己的文件夹
--    CHECK: (storage.foldername(name))[1] = auth.uid()::text
-- 3. DELETE: 允许认证用户删除自己文件夹中的文件
--    USING: (storage.foldername(name))[1] = auth.uid()::text

-- ============================================================
-- 创建初始 Admin 用户
-- 密码 "111" 的 SHA-256 哈希值
-- ============================================================

-- SHA-256("111") = f6e0a1e2ac41945a9aa7ff8a8aaa0cebc12a3bcc981a929ad5cf810a090e11ae
INSERT INTO users (username, password_hash, role, created_by)
VALUES (
  'admin',
  'f6e0a1e2ac41945a9aa7ff8a8aaa0cebc12a3bcc981a929ad5cf810a090e11ae',
  'admin',
  NULL
)
ON CONFLICT (username) DO NOTHING;

-- ============================================================
-- 辅助函数：获取用户创建的子用户列表
-- (实际在应用层完成，此处仅作说明)
-- ============================================================

-- 更新时间戳触发器
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_files_updated_at
  BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
