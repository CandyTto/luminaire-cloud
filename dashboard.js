/**
 * Luminaire Cloud - 仪表盘主逻辑
 * 全部 CRUD、上传、下载、管理功能
 */

// ==================== 全局状态 ====================

let currentUser = null;
let allFiles = [];
let selectedFiles = new Set();
let currentFilter = 'all';
let currentView = 'grid';
let isUploading = false;
let deleteCallback = null; // 删除验证后的回调

// ==================== 初始化 ====================

document.addEventListener('DOMContentLoaded', async () => {
  // 检查登录状态
  currentUser = getSession();
  if (!currentUser) {
    window.location.href = 'index.html';
    return;
  }

  // 初始化 Supabase
  initSupabase();

  // 更新 UI
  updateUserUI();
  updateAdminUI();
  bindEvents();
  setupGlobalPaste();

  // 加载文件
  await loadFiles();

  // 初始化选中状态（给 DOM 渲染后的 checkbox 回调使用）
  document.addEventListener('change', handleCheckboxChange);
});

// ==================== UI 更新 ====================

function updateUserUI() {
  if (!currentUser) return;

  const avatarUrl = `https://api.dicebear.com/6.x/avataaars/svg?seed=${encodeURIComponent(currentUser.username)}`;

  document.getElementById('sidebarUsername').textContent = currentUser.username;
  document.getElementById('sidebarRole').textContent = currentUser.role === 'admin' ? '管理员' : '用户';
  document.getElementById('profileName').textContent = currentUser.username;
  document.getElementById('avatarImg').src = avatarUrl;
  document.getElementById('sidebarUser').querySelector('.avatar-small').src = avatarUrl;
}

function updateAdminUI() {
  if (currentUser && currentUser.role === 'admin') {
    document.getElementById('adminEntry').style.display = 'block';
  }
}

// ==================== 事件绑定 ====================

function bindEvents() {
  // 登出
  document.getElementById('logoutBtn').addEventListener('click', logoutUser);

  // 上传按钮
  document.getElementById('uploadBtn').addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('fileInput').addEventListener('change', handleFileSelect);

  // 拖拽上传
  const dropZone = document.getElementById('dropZone');
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, preventDefaults, false);
  });
  ['dragenter', 'dragover'].forEach(evt => {
    dropZone.addEventListener(evt, () => dropZone.classList.add('drag-over'), false);
  });
  ['dragleave', 'drop'].forEach(evt => {
    dropZone.addEventListener(evt, () => dropZone.classList.remove('drag-over'), false);
  });
  dropZone.addEventListener('drop', handleDrop, false);
  document.getElementById('dropBrowse').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('fileInput').click();
  });
  dropZone.addEventListener('click', () => document.getElementById('fileInput').click());

  // 空状态上传按钮
  document.getElementById('emptyUploadBtn').addEventListener('click', () => document.getElementById('fileInput').click());

  // 搜索
  const searchInput = document.getElementById('searchInput');
  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      renderFiles();
      updateSearchClear();
    }, 250);
  });
  document.getElementById('searchClear').addEventListener('click', () => {
    searchInput.value = '';
    renderFiles();
    updateSearchClear();
  });

  // 导航过滤
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      currentFilter = item.dataset.filter;
      document.getElementById('sectionTitle').textContent =
        item.querySelector('.nav-label')?.textContent || '全部文件';
      renderFiles();
    });
  });

  // 视图切换
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentView = btn.dataset.view;
      renderFiles();
    });
  });

  // 刷新
  document.getElementById('refreshBtn').addEventListener('click', loadFiles);

  // 全选
  document.getElementById('selectAllCheckbox').addEventListener('change', (e) => {
    const filtered = getFilteredFiles();
    if (e.target.checked) {
      filtered.forEach(f => selectedFiles.add(f.id));
    } else {
      filtered.forEach(f => selectedFiles.delete(f.id));
    }
    updateBatchToolbar();
    updateFileCheckboxes();
  });

  // 批量删除
  document.getElementById('batchDelete').addEventListener('click', () => {
    if (selectedFiles.size === 0) return;
    const count = selectedFiles.size;
    showDeletePasswordModal(
      `您正在批量删除 ${count} 个文件，此操作不可撤销。`,
      async () => {
        await batchDeleteFiles([...selectedFiles]);
      }
    );
  });

  // 批量下载
  document.getElementById('batchDownload').addEventListener('click', batchDownloadFiles);

  // 取消选择
  document.getElementById('batchCancel').addEventListener('click', clearSelection);

  // 预览模态框关闭
  document.getElementById('previewBackdrop').addEventListener('click', closePreview);
  document.getElementById('previewClose').addEventListener('click', closePreview);

  // 预览中的下载按钮
  document.getElementById('previewDownload').addEventListener('click', () => {
    const fileId = document.getElementById('previewModal').dataset.fileId;
    if (fileId) downloadFile(fileId);
  });

  // 预览中的删除按钮
  document.getElementById('previewDelete').addEventListener('click', () => {
    const fileId = document.getElementById('previewModal').dataset.fileId;
    if (!fileId) return;
    closePreview();
    const file = allFiles.find(f => f.id === fileId);
    showDeletePasswordModal(
      `确定要删除文件 "${file?.original_name || '未知'}" 吗？此操作不可撤销。`,
      async () => {
        await deleteFile(fileId);
      }
    );
  });

  // 删除密码模态框
  document.getElementById('deleteCancelBtn').addEventListener('click', closeDeletePasswordModal);
  document.getElementById('deleteConfirmBtn').addEventListener('click', handleDeleteConfirm);
  document.getElementById('deletePasswordInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleDeleteConfirm();
  });

  // 管理员面板
  document.getElementById('adminBtn').addEventListener('click', openAdminModal);
  document.getElementById('adminCloseBtn').addEventListener('click', closeAdminModal);
  document.getElementById('createUserBtn').addEventListener('click', handleCreateUser);
  document.getElementById('newUserPassword').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleCreateUser();
  });
  document.getElementById('changePwdBtn').addEventListener('click', handleChangePassword);

  // 侧边栏折叠
  document.getElementById('sidebarToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
  });

  // 移动端菜单
  document.getElementById('menuBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('mobile-open');
  });

  // 点击主内容关闭移动端侧边栏
  document.getElementById('mainContent').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('mobile-open');
  });

  // ESC 关闭模态框
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closePreview();
      closeDeletePasswordModal();
      closeAdminModal();
    }
  });
}

function setupGlobalPaste() {
  document.addEventListener('paste', (e) => {
    // 如果焦点在输入框中，不处理
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const items = e.clipboardData?.items;
    if (!items) return;

    const files = [];
    for (const item of items) {
      if (item.kind === 'file') {
        files.push(item.getAsFile());
      }
    }

    if (files.length > 0) {
      e.preventDefault();
      uploadFiles(files);
    }
  });
}

function preventDefaults(e) {
  e.preventDefault();
  e.stopPropagation();
}

// ==================== 文件加载 ====================

async function loadFiles() {
  const sb = getSupabase();
  if (!sb) {
    showToast('数据库连接失败，请刷新页面重试', 'error');
    return;
  }
  if (!currentUser) return;

  const loadingEl = document.getElementById('loadingIndicator');
  loadingEl.style.display = 'flex';
  document.getElementById('emptyState').style.display = 'none';

  try {
    const { data, error } = await sb
      .from('files')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    allFiles = data || [];
    updateNavCounts();
    updateStorageInfo();
    renderFiles();
  } catch (err) {
    console.error('加载文件失败:', err);
    showToast('加载文件失败，请检查网络连接', 'error');
  } finally {
    loadingEl.style.display = 'none';
  }
}

function updateNavCounts() {
  const categories = { all: allFiles.length, image: 0, video: 0, document: 0 };
  allFiles.forEach(f => {
    if (categories[f.category] !== undefined) categories[f.category]++;
  });

  document.getElementById('countAll').textContent = categories.all;
  document.getElementById('countImage').textContent = categories.image;
  document.getElementById('countVideo').textContent = categories.video;
  document.getElementById('countDoc').textContent = categories.document;
}

function updateStorageInfo() {
  const totalBytes = allFiles.reduce((sum, f) => sum + (f.file_size || 0), 0);
  const maxBytes = 50 * 1024 * 1024 * 1024; // 50GB
  const pct = Math.min((totalBytes / maxBytes) * 100, 100);

  document.getElementById('storageProgress').style.width = pct + '%';
  document.getElementById('storageText').textContent =
    `已使用 ${formatBytes(totalBytes)} / ${formatBytes(maxBytes)}`;
}

// ==================== 文件渲染 ====================

function getFilteredFiles() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  let files = allFiles;

  // 分类过滤
  if (currentFilter !== 'all') {
    files = files.filter(f => f.category === currentFilter);
  }

  // 搜索过滤
  if (search) {
    files = files.filter(f => f.original_name.toLowerCase().includes(search));
  }

  return files;
}

function renderFiles() {
  const grid = document.getElementById('fileGrid');
  const emptyState = document.getElementById('emptyState');
  const selectAllRow = document.getElementById('selectAllRow');
  const filtered = getFilteredFiles();

  // 空状态
  if (allFiles.length === 0) {
    grid.innerHTML = '';
    emptyState.style.display = 'block';
    selectAllRow.style.display = 'none';
    document.getElementById('batchToolbar').style.display = 'none';
    return;
  }
  emptyState.style.display = 'none';

  if (filtered.length === 0 && allFiles.length > 0) {
    grid.innerHTML = '';
    selectAllRow.style.display = 'none';
    document.getElementById('batchToolbar').style.display = 'none';
    // 显示搜索无结果
    const noResult = document.createElement('div');
    noResult.className = 'empty-state';
    noResult.innerHTML = `
      <div class="empty-icon"><i class="fa-solid fa-magnifying-glass"></i></div>
      <p class="empty-title">未找到匹配的文件</p>
      <p class="empty-desc">尝试使用不同的搜索关键词</p>
    `;
    grid.appendChild(noResult);
    return;
  }

  // 视图模式
  grid.className = currentView === 'list' ? 'file-grid list-view' : 'file-grid';
  selectAllRow.style.display = 'block';

  // 构建卡片
  grid.innerHTML = filtered.map((file, index) => {
    const isSelected = selectedFiles.has(file.id);
    const isImage = file.category === 'image';
    const isVideo = file.category === 'video';
    const isAudio = file.category === 'audio';
    const hasThumb = isImage || isVideo || isAudio;
    const iconClass = getFileIcon(file.file_type);
    const style = `animation-delay: ${Math.min(index * 0.03, 0.5)}s`;

    return `
      <div class="file-card ${isSelected ? 'selected' : ''}" data-file-id="${file.id}" style="${style}">
        <input type="checkbox" class="select-checkbox" data-file-id="${file.id}" ${isSelected ? 'checked' : ''}>
        <div class="card-actions">
          <button class="card-action-btn download" data-download="${file.id}" title="下载">
            <i class="fa-solid fa-download"></i>
          </button>
          <button class="card-action-btn delete" data-delete="${file.id}" title="删除">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </div>
        <div class="file-thumb" data-preview="${file.id}">
          ${hasThumb ?
            `<img src="${getThumbnailUrl(file)}" alt="${escapeHtml(file.original_name)}" loading="lazy">
             ${isVideo ? '<div class="video-overlay"><i class="fa-solid fa-play"></i></div>' : ''}
             ${isAudio ? '<div class="video-overlay" style="background:rgba(0,0,0,0.2);"><i class="fa-solid fa-music"></i></div>' : ''}` :
            `<i class="fa-solid ${iconClass} file-type-icon"></i>`
          }
        </div>
        <div class="file-details" data-preview="${file.id}">
          <p class="file-name" title="${escapeHtml(file.original_name)}">${escapeHtml(file.original_name)}</p>
          <div class="file-meta">
            <span>${formatBytes(file.file_size)}</span>
            <span>${formatDate(file.created_at)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // 绑定卡片事件（事件委托方式效率更高，但为清晰起见这里直接绑定）
  bindFileCardEvents();
  updateBatchToolbar();
}

function bindFileCardEvents() {
  // 预览
  document.querySelectorAll('[data-preview]').forEach(el => {
    el.addEventListener('click', (e) => {
      // 不拦截 checkbox 和 action 按钮的点击
      if (e.target.closest('.select-checkbox') || e.target.closest('.card-action-btn')) return;
      const fileId = el.dataset.preview;
      if (fileId) openPreview(fileId);
    });
  });

  // 下载
  document.querySelectorAll('[data-download]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fileId = btn.dataset.download;
      if (fileId) downloadFile(fileId);
    });
  });

  // 删除
  document.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fileId = btn.dataset.delete;
      const file = allFiles.find(f => f.id === fileId);
      if (file) {
        showDeletePasswordModal(
          `确定要删除文件 "${file.original_name}" 吗？此操作不可撤销。`,
          async () => {
            await deleteFile(fileId);
          }
        );
      }
    });
  });
}

function handleCheckboxChange(e) {
  if (!e.target.classList.contains('select-checkbox')) return;
  const fileId = e.target.dataset.fileId;
  if (!fileId) return;

  if (e.target.checked) {
    selectedFiles.add(fileId);
  } else {
    selectedFiles.delete(fileId);
  }
  updateBatchToolbar();
  // 更新全选状态
  updateSelectAllCheckbox();
}

function updateFileCheckboxes() {
  document.querySelectorAll('.select-checkbox').forEach(cb => {
    cb.checked = selectedFiles.has(cb.dataset.fileId);
  });
  document.querySelectorAll('.file-card').forEach(card => {
    const fid = card.dataset.fileId;
    if (fid && selectedFiles.has(fid)) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  });
  updateSelectAllCheckbox();
}

function updateSelectAllCheckbox() {
  const filtered = getFilteredFiles();
  const allSelected = filtered.length > 0 && filtered.every(f => selectedFiles.has(f.id));
  document.getElementById('selectAllCheckbox').checked = allSelected;
}

function updateBatchToolbar() {
  const toolbar = document.getElementById('batchToolbar');
  const count = document.getElementById('batchCount');

  if (selectedFiles.size > 0) {
    toolbar.style.display = 'flex';
    count.textContent = `已选 ${selectedFiles.size} 项`;
  } else {
    toolbar.style.display = 'none';
  }
}

function clearSelection() {
  selectedFiles.clear();
  updateBatchToolbar();
  updateFileCheckboxes();
}

function updateSearchClear() {
  const clearBtn = document.getElementById('searchClear');
  clearBtn.style.display = document.getElementById('searchInput').value ? 'flex' : 'none';
}

// ==================== 文件上传 ====================

function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    uploadFiles(Array.from(files));
    e.target.value = ''; // 重置以允许重复选择同一文件
  }
}

function handleDrop(e) {
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    uploadFiles(Array.from(files));
  }
}

async function uploadFiles(files) {
  const sb = getSupabase();
  if (!sb) {
    showToast('数据库连接失败，请刷新页面重试', 'error');
    return;
  }
  if (!currentUser) return;
  if (isUploading) {
    showToast('请等待当前上传完成', 'info');
    return;
  }

  isUploading = true;
  const container = document.getElementById('uploadProgressContainer');
  const list = document.getElementById('uploadProgressList');
  const stats = document.getElementById('uploadStats');

  container.style.display = 'block';
  let completed = 0;
  let failed = 0;

  // 创建进度条目
  const progressItems = files.map(file => {
    const item = document.createElement('div');
    item.className = 'upload-progress-item';
    item.innerHTML = `
      <div class="file-icon"><i class="fa-solid ${getFileIcon(file.type)}"></i></div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(file.name)}</div>
        <div class="file-size">${formatBytes(file.size)}</div>
        <div class="progress-bar-mini"><div class="progress-fill" style="width: 0%;"></div></div>
      </div>
      <div class="progress-status">等待中...</div>
    `;
    list.appendChild(item);
    return item;
  });

  function updateStats() {
    stats.textContent = `${completed + failed}/${files.length} - 完成 ${completed}, 失败 ${failed}`;
  }
  updateStats();

  // 并行上传（限制并发数）
  const CONCURRENCY = 3;
  const results = [];

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map((file, batchIdx) => {
        const globalIdx = i + batchIdx;
        const item = progressItems[globalIdx];
        return uploadSingleFile(file, item, sb);
      })
    );
    results.push(...batchResults);
  }

  // 统计结果
  results.forEach(r => {
    if (r.status === 'fulfilled' && r.value) completed++;
    else failed++;
  });
  updateStats();

  isUploading = false;

  if (completed > 0) {
    showToast(`成功上传 ${completed} 个文件`, 'success');
    await loadFiles();
  }

  // 延迟隐藏进度条
  setTimeout(() => {
    container.style.display = 'none';
    list.innerHTML = '';
  }, 2000);
}

async function uploadSingleFile(file, progressItem, sb) {
  const statusEl = progressItem.querySelector('.progress-status');
  const progressFill = progressItem.querySelector('.progress-fill');

  // 调试日志
  console.log('[Upload] 开始上传:', file.name, '大小:', file.size, '类型:', file.type || '(检测中)');

  // 自动检测 MIME 类型（处理无扩展名或异常类型的情况）
  let mimeType = file.type;
  if (!mimeType || mimeType === '' || mimeType === 'application/octet-stream') {
    mimeType = detectMimeType(file.name);
    console.log('[Upload] MIME 类型自动检测:', mimeType);
  }

  try {
    statusEl.textContent = '上传中...';

    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._\-一-鿿㐀-䶿]/g, '_');
    const storagePath = `${currentUser.id}/${timestamp}-${safeName}`;

    console.log('[Upload] 存储路径:', storagePath);
    console.log('[Upload] Bucket:', STORAGE_BUCKET);

    // 大文件使用 TUS 断点续传（> 20MB），小文件直接上传
    const useTus = file.size > 20 * 1024 * 1024;
    console.log('[Upload] 上传模式:', useTus ? 'TUS 断点续传' : '直接上传');

    const { data: uploadData, error: uploadError } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: mimeType || 'application/octet-stream',
        ...(useTus ? { resumable: true } : {}),
      });

    if (uploadError) {
      console.error('[Upload] Storage 上传失败:', uploadError);
      throw new Error('Storage 上传失败: ' + (uploadError.message || JSON.stringify(uploadError)));
    }

    console.log('[Upload] Storage 上传成功:', uploadData);

    progressFill.style.width = '80%';
    statusEl.textContent = '保存中...';

    // 使用检测到的 MIME 类型进行分类
    const category = getFileCategory(mimeType);
    const fileRecord = {
      user_id: currentUser.id,
      filename: safeName,
      original_name: file.name,
      file_type: mimeType,
      file_size: file.size,
      storage_path: storagePath,
      category: category,
    };
    console.log('[Upload] 准备插入数据库:', fileRecord);

    const { data: dbData, error: dbError } = await sb
      .from('files')
      .insert(fileRecord)
      .select();

    if (dbError) {
      console.error('[Upload] 数据库插入失败:', dbError);
      throw new Error('数据库记录失败: ' + (dbError.message || JSON.stringify(dbError)));
    }

    console.log('[Upload] 数据库插入成功:', dbData);

    progressFill.style.width = '100%';
    statusEl.textContent = '完成';
    statusEl.classList.add('success');
    return true;
  } catch (err) {
    console.error('[Upload] 上传失败:', file.name, err);
    progressFill.style.width = '100%';
    progressFill.style.background = '#ef4444';
    statusEl.textContent = '失败: ' + (err.message || '未知错误');
    statusEl.classList.add('error');
    return false;
  }
}

/** 通过文件扩展名检测 MIME 类型 */
function detectMimeType(filename) {
  const name = (filename || '').toLowerCase();
  const extMap = {
    // 图片
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.tiff': 'image/tiff',
    '.tif': 'image/tiff', '.heic': 'image/heic', '.heif': 'image/heif',
    '.avif': 'image/avif', '.jfif': 'image/jpeg', '.pjpeg': 'image/jpeg',
    '.pjp': 'image/jpeg', '.raw': 'image/x-raw', '.cr2': 'image/x-canon-cr2',
    '.nef': 'image/x-nikon-nef', '.arw': 'image/x-sony-arw',
    // 视频
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg',
    '.mov': 'video/quicktime', '.avi': 'video/x-msvideo', '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv', '.mkv': 'video/x-matroska', '.m4v': 'video/mp4',
    '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg', '.3gp': 'video/3gpp',
    '.3g2': 'video/3gpp2', '.ts': 'video/mp2t', '.mts': 'video/mp2t',
    '.m2ts': 'video/mp2t', '.vob': 'video/dvd', '.rm': 'video/x-pn-realvideo',
    '.rmvb': 'video/x-pn-realvideo', '.asf': 'video/x-ms-asf',
    // 音频
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4',
    '.wma': 'audio/x-ms-wma', '.opus': 'audio/opus', '.mid': 'audio/midi',
    '.midi': 'audio/midi', '.aiff': 'audio/aiff', '.ape': 'audio/ape',
    // 文档
    '.pdf': 'application/pdf',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.odt': 'application/vnd.oasis.opendocument.text',
    '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
    '.odp': 'application/vnd.oasis.opendocument.presentation',
    // 文本
    '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
    '.json': 'application/json', '.xml': 'application/xml',
    '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css',
    '.js': 'application/javascript', '.ts': 'application/typescript',
    '.py': 'text/x-python', '.rb': 'text/x-ruby', '.php': 'application/x-httpd-php',
    '.java': 'text/x-java', '.c': 'text/x-c', '.cpp': 'text/x-c++',
    '.h': 'text/x-c', '.hpp': 'text/x-c++', '.rs': 'text/x-rust',
    '.go': 'text/x-go', '.sh': 'application/x-sh', '.bash': 'application/x-sh',
    '.bat': 'application/x-bat', '.cmd': 'application/x-cmd',
    '.ps1': 'application/x-powershell', '.sql': 'application/sql',
    '.yml': 'application/x-yaml', '.yaml': 'application/x-yaml',
    '.toml': 'application/toml', '.ini': 'text/plain',
    '.log': 'text/plain', '.env': 'text/plain',
    // 压缩包
    '.zip': 'application/zip', '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed', '.tar': 'application/x-tar',
    '.gz': 'application/gzip', '.bz2': 'application/x-bzip2',
    '.xz': 'application/x-xz', '.zst': 'application/zstd',
  };
  const ext = name.substring(name.lastIndexOf('.'));
  return extMap[ext] || 'application/octet-stream';
}

// ==================== 文件下载 ====================

async function downloadFile(fileId) {
  const sb = getSupabase();
  if (!sb) return;

  const file = allFiles.find(f => f.id === fileId);
  if (!file) return showToast('文件不存在', 'error');

  try {
    // 生成签名下载 URL
    const { data, error } = await sb.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(file.storage_path, 60); // 60秒有效期

    if (error) throw error;
    if (!data?.signedUrl) throw new Error('无法生成下载链接');

    // 触发浏览器下载
    const a = document.createElement('a');
    a.href = data.signedUrl;
    a.download = file.original_name;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    showToast(`正在下载: ${file.original_name}`, 'success');
  } catch (err) {
    console.error('下载失败:', err);
    // 回退方案：使用公开 URL
    try {
      const { data: publicData } = sb.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(file.storage_path);

      if (publicData?.publicUrl) {
        const a = document.createElement('a');
        a.href = publicData.publicUrl;
        a.download = file.original_name;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showToast(`正在下载: ${file.original_name}`, 'success');
        return;
      }
    } catch (e) {
      // ignore
    }
    showToast('下载失败，请稍后重试', 'error');
  }
}

async function batchDownloadFiles() {
  if (selectedFiles.size === 0) return;
  showToast(`正在准备下载 ${selectedFiles.size} 个文件...`, 'info');

  // 逐个下载（浏览器限制无法同时下载多个）
  const fileIds = [...selectedFiles];
  for (const fileId of fileIds) {
    await downloadFile(fileId);
    // 小延迟避免浏览器阻止
    await sleep(500);
  }
}

// ==================== 文件删除 ====================

async function deleteFile(fileId) {
  const sb = getSupabase();
  if (!sb) return;

  const file = allFiles.find(f => f.id === fileId);
  if (!file) return false;

  try {
    // 从 Storage 中删除
    const { error: storageError } = await sb.storage
      .from(STORAGE_BUCKET)
      .remove([file.storage_path]);

    if (storageError) console.warn('Storage 删除警告:', storageError);

    // 从数据库中删除
    const { error: dbError } = await sb
      .from('files')
      .delete()
      .eq('id', fileId)
      .eq('user_id', currentUser.id);

    if (dbError) throw dbError;

    // 更新本地状态
    allFiles = allFiles.filter(f => f.id !== fileId);
    selectedFiles.delete(fileId);

    updateNavCounts();
    updateStorageInfo();
    renderFiles();
    closeDeletePasswordModal();
    showToast(`已删除: ${file.original_name}`, 'success');
    return true;
  } catch (err) {
    console.error('删除失败:', err);
    showToast('删除失败，请稍后重试', 'error');
    return false;
  }
}

async function batchDeleteFiles(fileIds) {
  const sb = getSupabase();
  if (!sb) return;

  const filesToDelete = allFiles.filter(f => fileIds.includes(f.id));
  if (filesToDelete.length === 0) return;

  try {
    // 批量删除 Storage 文件
    const paths = filesToDelete.map(f => f.storage_path);
    const { error: storageError } = await sb.storage
      .from(STORAGE_BUCKET)
      .remove(paths);
    if (storageError) console.warn('Storage 批量删除警告:', storageError);

    // 批量删除数据库记录
    const { error: dbError } = await sb
      .from('files')
      .delete()
      .in('id', fileIds)
      .eq('user_id', currentUser.id);

    if (dbError) throw dbError;

    // 更新本地状态
    allFiles = allFiles.filter(f => !fileIds.includes(f.id));
    selectedFiles.clear();

    updateNavCounts();
    updateStorageInfo();
    renderFiles();
    closeDeletePasswordModal();
    showToast(`成功删除 ${filesToDelete.length} 个文件`, 'success');
  } catch (err) {
    console.error('批量删除失败:', err);
    showToast('批量删除失败，请稍后重试', 'error');
  }
}

// ==================== 文件预览 ====================

async function openPreview(fileId) {
  const file = allFiles.find(f => f.id === fileId);
  if (!file) return;

  const modal = document.getElementById('previewModal');
  const img = document.getElementById('previewImage');
  const video = document.getElementById('previewVideo');
  const textPre = document.getElementById('previewText');
  const docIframe = document.getElementById('previewDoc');
  const audioWrap = document.getElementById('previewAudioWrap');
  const audioEl = document.getElementById('previewAudio');
  const audioName = document.getElementById('previewAudioName');
  const unsupported = document.getElementById('previewUnsupported');
  const filename = document.getElementById('previewFilename');

  modal.style.display = 'flex';
  modal.dataset.fileId = fileId;
  filename.textContent = file.original_name;

  // 重置所有预览元素
  img.style.display = 'none'; img.src = '';
  video.style.display = 'none'; video.src = '';
  textPre.style.display = 'none'; textPre.textContent = '';
  docIframe.style.display = 'none'; docIframe.src = '';
  audioWrap.style.display = 'none'; audioEl.src = '';
  unsupported.style.display = 'none';

  // 获取签名 URL
  const sb = getSupabase();
  let url = '';
  if (sb) {
    try {
      const { data } = await sb.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(file.storage_path, 600);
      if (data?.signedUrl) url = data.signedUrl;
    } catch (e) {
      const { data: publicData } = sb.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(file.storage_path);
      if (publicData?.publicUrl) url = publicData.publicUrl;
    }
  }

  if (file.category === 'image') {
    img.src = url;
    img.style.display = 'block';
  } else if (file.category === 'video') {
    video.src = url;
    video.style.display = 'block';
  } else if (file.category === 'audio') {
    audioName.textContent = file.original_name;
    audioEl.src = url;
    audioWrap.style.display = 'block';
  } else if (isTextFile(file)) {
    // 文本文件：fetch 内容并显示
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        textPre.textContent = text;
        textPre.style.display = 'block';
      } else {
        throw new Error('fetch failed');
      }
    } catch (e) {
      // 回退：显示下载
      unsupported.style.display = 'block';
      document.getElementById('previewUnsupportedDownload').onclick = () => downloadFile(fileId);
    }
  } else if (file.file_type === 'application/pdf' || isDocumentPreviewable(file)) {
    // PDF 和其他浏览器可预览的文档用 iframe
    docIframe.src = url;
    docIframe.style.display = 'block';
  } else {
    unsupported.style.display = 'block';
    document.getElementById('previewUnsupportedDownload').onclick = () => downloadFile(fileId);
  }
}

/** 判断是否为文本文件 */
function isTextFile(file) {
  const textTypes = [
    'text/', 'application/json', 'application/javascript', 'application/xml',
    'application/x-httpd-php', 'application/x-sh', 'application/x-bat',
    'application/x-cmd', 'application/x-powershell',
  ];
  const textExts = ['.txt', '.md', '.log', '.csv', '.yml', '.yaml', '.toml', '.ini',
    '.cfg', '.conf', '.env', '.py', '.js', '.ts', '.jsx', '.tsx', '.css', '.html',
    '.htm', '.xml', '.json', '.sh', '.bash', '.zsh', '.bat', '.cmd', '.ps1',
    '.sql', '.rb', '.php', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp',
    '.vue', '.svelte', '.astro', '.gitignore', '.dockerignore', '.editorconfig',
  ];
  const name = (file.original_name || '').toLowerCase();
  const type = (file.file_type || '').toLowerCase();
  if (textTypes.some(t => type.startsWith(t))) return true;
  if (textExts.some(ext => name.endsWith(ext))) return true;
  return false;
}

/** 判断是否为浏览器可预览的文档 */
function isDocumentPreviewable(file) {
  const previewTypes = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ];
  const name = (file.original_name || '').toLowerCase();
  if (previewTypes.includes(file.file_type)) return true;
  if (name.endsWith('.pdf')) return true;
  return false;
}

function closePreview() {
  const modal = document.getElementById('previewModal');
  modal.style.display = 'none';
  document.getElementById('previewVideo').pause();
  document.getElementById('previewVideo').src = '';
  document.getElementById('previewImage').src = '';
  document.getElementById('previewText').textContent = '';
  document.getElementById('previewDoc').src = '';
  document.getElementById('previewAudio').src = '';
}

// ==================== 删除密码模态框 ====================

function showDeletePasswordModal(info, callback) {
  document.getElementById('deleteInfo').textContent = info;
  document.getElementById('deletePasswordInput').value = '';
  document.getElementById('deletePasswordError').style.display = 'none';
  document.getElementById('deletePasswordModal').style.display = 'flex';
  deleteCallback = callback;
  setTimeout(() => document.getElementById('deletePasswordInput').focus(), 100);
}

function closeDeletePasswordModal() {
  document.getElementById('deletePasswordModal').style.display = 'none';
  deleteCallback = null;
}

async function handleDeleteConfirm() {
  const password = document.getElementById('deletePasswordInput').value;
  if (!password) {
    document.getElementById('deletePasswordError').textContent = '请输入删除密码';
    document.getElementById('deletePasswordError').style.display = 'block';
    return;
  }

  const valid = await verifyDeletePassword(password);
  if (!valid) {
    document.getElementById('deletePasswordError').textContent = '密码错误，请重试';
    document.getElementById('deletePasswordError').style.display = 'block';
    document.getElementById('deletePasswordInput').value = '';
    document.getElementById('deletePasswordInput').focus();
    return;
  }

  if (deleteCallback) {
    const cb = deleteCallback;
    closeDeletePasswordModal();
    await cb(password);
  }
}

// ==================== 管理员面板 ====================

async function openAdminModal() {
  document.getElementById('adminModal').style.display = 'flex';
  document.getElementById('newUsername').value = '';
  document.getElementById('newUserPassword').value = '';
  document.getElementById('changePwdOld').value = '';
  document.getElementById('changePwdNew').value = '';
  document.getElementById('adminCreateError').style.display = 'none';
  document.getElementById('changePwdError').style.display = 'none';
  document.getElementById('changePwdSuccess').style.display = 'none';
  await loadManagedUsers();
}

function closeAdminModal() {
  document.getElementById('adminModal').style.display = 'none';
}

async function handleCreateUser() {
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const errorEl = document.getElementById('adminCreateError');

  if (!username || !password) {
    errorEl.textContent = '请填写用户名和密码';
    errorEl.style.display = 'block';
    return;
  }

  if (username.length < 2) {
    errorEl.textContent = '用户名至少需要2个字符';
    errorEl.style.display = 'block';
    return;
  }

  if (password.length < 3) {
    errorEl.textContent = '密码至少需要3个字符';
    errorEl.style.display = 'block';
    return;
  }

  const result = await adminCreateUser(username, password);
  if (result.success) {
    showToast(`用户 "${username}" 创建成功`, 'success');
    document.getElementById('newUsername').value = '';
    document.getElementById('newUserPassword').value = '';
    errorEl.style.display = 'none';
    await loadManagedUsers();
  } else {
    errorEl.textContent = result.error;
    errorEl.style.display = 'block';
  }
}

async function handleChangePassword() {
  const oldPwd = document.getElementById('changePwdOld').value;
  const newPwd = document.getElementById('changePwdNew').value;
  const errorEl = document.getElementById('changePwdError');
  const successEl = document.getElementById('changePwdSuccess');

  errorEl.style.display = 'none';
  successEl.style.display = 'none';

  if (!oldPwd || !newPwd) {
    errorEl.textContent = '请填写当前密码和新密码';
    errorEl.style.display = 'block';
    return;
  }

  if (newPwd.length < 3) {
    errorEl.textContent = '新密码至少需要3个字符';
    errorEl.style.display = 'block';
    return;
  }

  const result = await changePassword(currentUser.id, oldPwd, newPwd);
  if (result.success) {
    successEl.textContent = '密码修改成功';
    successEl.style.display = 'block';
    document.getElementById('changePwdOld').value = '';
    document.getElementById('changePwdNew').value = '';
    setTimeout(() => { successEl.style.display = 'none'; }, 3000);
  } else {
    errorEl.textContent = result.error || '修改失败';
    errorEl.style.display = 'block';
  }
}

async function loadManagedUsers() {
  const result = await adminGetManagedUsers();
  const list = document.getElementById('adminUserList');

  if (!result.success || result.users.length === 0) {
    list.innerHTML = `
      <div class="admin-user-empty">
        <i class="fa-solid fa-user-group"></i>
        <p>暂无管理的用户</p>
      </div>`;
    return;
  }

  list.innerHTML = result.users.map(user => `
    <div class="admin-user-item">
      <div class="admin-user-detail">
        <span class="admin-user-name">${escapeHtml(user.username)}</span>
        <span class="admin-user-date">创建于 ${formatDate(user.created_at)}</span>
      </div>
      <button class="admin-user-delete" data-user-id="${user.id}" data-username="${escapeHtml(user.username)}">
        <i class="fa-solid fa-trash-can"></i> 删除
      </button>
    </div>
  `).join('');

  // 绑定删除按钮
  list.querySelectorAll('.admin-user-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      const userId = btn.dataset.userId;
      const username = btn.dataset.username;

      showDeletePasswordModal(
        `确定要删除用户 "${username}" 及其所有文件吗？此操作不可撤销。`,
        async (password) => {
          const result = await adminDeleteUser(userId, password);
          if (result.success) {
            showToast(`用户 "${username}" 已删除`, 'success');
            await loadManagedUsers();
          } else {
            showToast(result.error || '删除失败', 'error');
          }
        }
      );
    });
  });
}

// ==================== Toast 消息 ====================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', info: 'fa-circle-info' };
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> ${escapeHtml(message)}`;

  container.appendChild(toast);

  // 自动移除
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 3000);
}

// ==================== 工具函数 ====================

function getFileIcon(mimeType) {
  if (!mimeType) return 'fa-file';
  if (mimeType.startsWith('image/')) return 'fa-file-image';
  if (mimeType.startsWith('video/')) return 'fa-file-video';
  if (mimeType.startsWith('audio/')) return 'fa-file-audio';
  if (mimeType.includes('pdf')) return 'fa-file-pdf';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'fa-file-word';
  if (mimeType.includes('excel') || mimeType.includes('sheet')) return 'fa-file-excel';
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('compress')) return 'fa-file-zipper';
  if (mimeType.startsWith('text/')) return 'fa-file-lines';
  return 'fa-file';
}

function getFileCategory(mimeType) {
  if (!mimeType) return 'other';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  return 'document';
}

function getThumbnailUrl(file) {
  const sb = getSupabase();
  if (!sb) return '';

  if (file.category === 'image') {
    const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(file.storage_path);
    return data?.publicUrl || '';
  }

  if (file.category === 'video') {
    return 'data:image/svg+xml,' + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
        <rect fill="#1e293b" width="400" height="300"/>
        <polygon points="160,100 260,150 160,200" fill="#6366f1" opacity="0.7"/>
        <text x="200" y="250" text-anchor="middle" fill="#64748b" font-size="20" font-family="sans-serif">Video</text>
      </svg>
    `);
  }

  if (file.category === 'audio') {
    return 'data:image/svg+xml,' + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
        <rect fill="#1e293b" width="400" height="300"/>
        <circle cx="200" cy="130" r="40" fill="none" stroke="#a855f7" stroke-width="4" opacity="0.6"/>
        <polygon points="185,115 185,145 220,130" fill="#a855f7" opacity="0.7"/>
        <text x="200" y="220" text-anchor="middle" fill="#64748b" font-size="20" font-family="sans-serif">Audio</text>
      </svg>
    `);
  }

  return '';
}

function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;

  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
