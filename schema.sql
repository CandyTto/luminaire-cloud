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
-- RLS — 使用宽松策略（App 使用 anon key，应用层已做数据隔离）
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- 允许 anon key 访问 users（登录验证）
CREATE POLICY "Allow all on users" ON users FOR ALL USING (true) WITH CHECK (true);

-- 允许 anon key 访问 files（应用层通过 user_id 过滤）
CREATE POLICY "Allow all on files" ON files FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Storage 策略（stock objects 表 RLS，允许 anon key 操作 user-files）
-- ============================================================
-- Bucket 已通过 API 创建，此处仅创建访问策略
-- 如果策略已存在，先删除再重建

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow SELECT on user-files' AND tablename = 'objects') THEN
    DROP POLICY "Allow SELECT on user-files" ON storage.objects;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow INSERT on user-files' AND tablename = 'objects') THEN
    DROP POLICY "Allow INSERT on user-files" ON storage.objects;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Allow DELETE on user-files' AND tablename = 'objects') THEN
    DROP POLICY "Allow DELETE on user-files" ON storage.objects;
  END IF;
END $$;

CREATE POLICY "Allow SELECT on user-files" ON storage.objects FOR SELECT USING (true);
CREATE POLICY "Allow INSERT on user-files" ON storage.objects FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow DELETE on user-files" ON storage.objects FOR DELETE USING (true);

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
-- 更新时间戳触发器
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_files_updated_at ON files;
CREATE TRIGGER update_files_updated_at
  BEFORE UPDATE ON files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
