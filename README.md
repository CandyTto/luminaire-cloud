# Luminaire 云盘

全功能云端文件管理系统，支持多用户隔离、文件上传/下载/预览、批量操作、管理员用户管理。

## 功能特性

- 🔐 **多用户管理** — Admin 可创建/删除子用户，每个用户数据完全隔离
- 📁 **文件 CRUD** — 上传、预览、下载、删除文件
- 🖼️ **图片/视频支持** — 支持预览、上传、下载
- 📤 **多种上传方式** — 点击上传、拖拽上传、Ctrl+V 粘贴上传
- 📥 **下载到本地** — 图片/视频/文档均可下载
- ✅ **批量操作** — 多选文件批量删除、批量下载
- 🔒 **安全验证** — 登录密码 (111) / 删除密码 (123) 双重验证
- ⌨️ **Enter 快捷登录** — 登录页支持回车键确认
- 📱 **响应式设计** — 适配桌面端和移动端
- ⚡ **流畅体验** — 无卡顿动画，并发上传优化

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | HTML5 / CSS3 / Vanilla JS |
| 后端服务 | [Supabase](https://supabase.com) (BaaS) |
| 数据库 | PostgreSQL (via Supabase) |
| 文件存储 | Supabase Storage |
| 部署 | [Cloudflare Pages](https://pages.cloudflare.com) + GitHub |

## 项目结构

```
Qd/
├── index.html          # 登录页面
├── style.css           # 登录样式
├── dashboard.html      # 仪表盘主界面
├── dashboard.css       # 仪表盘样式
├── dashboard.js        # 仪表盘全部逻辑
├── auth.js             # 认证模块（登录/登出/管理员操作）
├── supabase.js         # Supabase 客户端配置
├── schema.sql          # 数据库初始化 SQL 脚本
└── README.md           # 本文件
```

## 快速开始

### 1. Supabase 数据库设置

1. 登录 [Supabase Dashboard](https://app.supabase.com)
2. 进入项目 `azspgwlrtcoqdzgenoew`
3. 打开 **SQL Editor**
4. 复制 [schema.sql](schema.sql) 全部内容并执行
5. 进入 **Storage** → 创建 Bucket：
   - Name: `user-files`
   - ✅ Public bucket: **不勾选** (private)
   - File size limit: 50MB (或按需调整)
   - Allowed MIME types: 全部

### 2. Storage RLS 策略设置

在 Supabase Dashboard → Storage → Policies 中为 `user-files` bucket 添加策略：

**SELECT 策略（下载）：**
- Policy name: `Users can download own files`
- Allowed operation: `SELECT`
- USING expression: `true`（允许所有人下载自己的文件链接）

**INSERT 策略（上传）：**
- Policy name: `Users can upload to own folder`
- Allowed operation: `INSERT`
- CHECK expression: `true`

**DELETE 策略：**
- Policy name: `Users can delete own files`
- Allowed operation: `DELETE`
- USING expression: `true`

> 实际访问控制由应用层的 user_id 过滤保证。

### 3. 本地运行

直接用浏览器打开 `index.html`，或使用任意静态服务器：

```bash
# 使用 Python
python -m http.server 8080

# 使用 Node.js
npx serve .

# 使用 VS Code Live Server 插件
```

### 4. 默认账号

| 角色 | 用户名 | 密码 |
|------|--------|------|
| 管理员 | admin | 111 |

## 部署到 Cloudflare Pages

### 方式一：通过 Cloudflare Dashboard

1. 将代码推送到 GitHub 仓库
2. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
3. 进入 **Workers & Pages** → **Pages** → **创建项目**
4. 连接 GitHub 仓库
5. 构建设置：
   - **Build command**: 留空
   - **Build output directory**: `/` (根目录)
   - **Framework preset**: None
6. 点击 **保存并部署**

### 方式二：通过 Wrangler CLI

```bash
# 安装 Wrangler
npm install -g wrangler

# 登录
wrangler login

# 创建 Pages 项目
wrangler pages project create luminaire-cloud

# 部署
wrangler pages deploy . --project-name=luminaire-cloud
```

### 自动部署 (GitHub 集成)

Cloudflare Pages 连接 GitHub 后，每次推送代码到仓库会自动触发部署。

```bash
git add .
git commit -m "Update luminaire cloud"
git push origin main
# → Cloudflare 自动部署
```

## Supabase CLI 设置

```bash
# 登录 Supabase
supabase login

# 初始化项目
supabase init

# 链接到远程项目
supabase link --project-ref azspgwlrtcoqdzgenoew
```

## 直接数据库连接

```
postgresql://postgres:[YOUR-PASSWORD]@db.azspgwlrtcoqdzgenoew.supabase.co:5432/postgres
```

## 密码说明

| 密码类型 | 默认值 | 用途 |
|----------|--------|------|
| 登录密码 | `111` | 所有用户登录系统 |
| 删除密码 | `123` | 删除文件/用户时验证 |

- 登录密码在创建用户时由管理员设置
- 删除密码为系统固定密码，SHA-256 哈希值存储在 `supabase.js` 中

## API 密钥

```
Supabase URL:    https://azspgwlrtcoqdzgenoew.supabase.co
Anon Key:        sb_publishable__eZFcWMzRTr7SanUvr5cvA_Srf5SjNV
Project Ref:     azspgwlrtcoqdzgenoew
```

> ⚠️ 注意：Anon Key 是公开密钥，仅用于浏览器端访问。生产环境请启用 RLS 策略保护数据安全。

## 待优化项

- [ ] 用户可自行修改密码
- [ ] 文件分享链接生成
- [ ] 文件夹支持
- [ ] 拖拽排序
- [ ] 断点续传
- [ ] WebSocket 实时同步

## License

MIT
