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
  if (!sb || !currentUser) return;

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
          ${(isImage || isVideo) ?
            `<img src="${getThumbnailUrl(file)}" alt="${escapeHtml(file.original_name)}" loading="lazy">
             ${isVideo ? '<div class="video-overlay"><i class="fa-solid fa-play"></i></div>' : ''}` :
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
  if (!sb || !currentUser) return;
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

  try {
    statusEl.textContent = '上传中...';

    // 构建存储路径: {user_id}/{timestamp}-{filename}
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._\-一-鿿]/g, '_');
    const storagePath = `${currentUser.id}/${timestamp}-${safeName}`;

    // 上传到 Supabase Storage
    const { error: uploadError } = await sb.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    progressFill.style.width = '80%';
    statusEl.textContent = '保存中...';

    // 获取公开 URL（或签名 URL）
    const { data: urlData } = sb.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    // 创建文件记录
    const category = getFileCategory(file.type);
    const { error: dbError } = await sb
      .from('files')
      .insert({
        user_id: currentUser.id,
        filename: safeName,
        original_name: file.name,
        file_type: file.type,
        file_size: file.size,
        storage_path: storagePath,
        category: category,
      });

    if (dbError) throw dbError;

    progressFill.style.width = '100%';
    statusEl.textContent = '完成';
    statusEl.classList.add('success');
    return true;
  } catch (err) {
    console.error('上传失败:', file.name, err);
    progressFill.style.width = '100%';
    progressFill.style.background = '#ef4444';
    statusEl.textContent = '失败';
    statusEl.classList.add('error');
    return false;
  }
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
  const unsupported = document.getElementById('previewUnsupported');
  const filename = document.getElementById('previewFilename');

  modal.style.display = 'flex';
  modal.dataset.fileId = fileId;
  filename.textContent = file.original_name;

  // 重置
  img.style.display = 'none';
  video.style.display = 'none';
  unsupported.style.display = 'none';
  img.src = '';
  video.src = '';

  // 获取签名 URL
  const sb = getSupabase();
  let url = '';
  if (sb) {
    try {
      const { data } = await sb.storage
        .from(STORAGE_BUCKET)
        .createSignedUrl(file.storage_path, 300);
      if (data?.signedUrl) url = data.signedUrl;
    } catch (e) {
      // 回退到公开 URL
      const { data: publicData } = sb.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(file.storage_path);
      if (publicData?.publicUrl) url = publicData.publicUrl;
    }
  }

  if (file.category === 'image') {
    img.src = url;
    img.style.display = 'block';
    // 更新预览下载按钮
    document.getElementById('previewUnsupportedDownload').onclick = () => downloadFile(fileId);
  } else if (file.category === 'video') {
    video.src = url;
    video.style.display = 'block';
  } else {
    unsupported.style.display = 'block';
    document.getElementById('previewUnsupportedDownload').onclick = () => downloadFile(fileId);
  }
}

function closePreview() {
  const modal = document.getElementById('previewModal');
  const video = document.getElementById('previewVideo');
  modal.style.display = 'none';
  video.pause();
  video.src = '';
  document.getElementById('previewImage').src = '';
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
    closeDeletePasswordModal();
    await deleteCallback(password);
  }
}

// ==================== 管理员面板 ====================

async function openAdminModal() {
  document.getElementById('adminModal').style.display = 'flex';
  document.getElementById('newUsername').value = '';
  document.getElementById('newUserPassword').value = '';
  document.getElementById('adminCreateError').style.display = 'none';
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
  return 'document';
}

function getThumbnailUrl(file) {
  const sb = getSupabase();
  if (!sb) return '';

  if (file.category === 'image') {
    // 使用 Supabase 图片转换生成缩略图
    const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(file.storage_path);
    return data?.publicUrl || '';
  }

  if (file.category === 'video') {
    // 视频使用默认封面
    return 'data:image/svg+xml,' + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
        <rect fill="#1e293b" width="400" height="300"/>
        <polygon points="160,100 260,150 160,200" fill="#6366f1" opacity="0.7"/>
        <text x="200" y="250" text-anchor="middle" fill="#64748b" font-size="20" font-family="sans-serif">Video</text>
      </svg>
    `);
  }

  // 文档图标
  const icon = getFileIcon(file.file_type);
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
