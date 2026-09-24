/* DutyTracker – kết nối Supabase */
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BUCKET = 'duty-photos';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ERR = {
    ALREADY_ON: 'Bạn đã có ca On Duty đang diễn ra. Vui lòng Off Duty trước khi mở ca mới!',
    NOT_ON: 'Bạn chưa bấm On Duty! Không thể thực hiện Off Duty.'
};

let employees = [], sessions = [], history = [];
let isAdmin = false, selectedImage = null, previewUrl = null;

const TAB = 'px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-all duration-200 flex items-center space-x-1.5 ';
const TAB_ON = TAB + 'bg-white text-blue-600 shadow-sm', TAB_OFF = TAB + 'text-slate-600 hover:text-slate-900';

window.onload = async () => {
    lucide.createIcons();
    startLiveClock();
    const { data } = await sb.auth.getSession();
    isAdmin = !!data.session;
    await loadEmployees();
    const last = localStorage.getItem('dt_last_emp');
    if (employees.some(e => e.id === last)) $('employeeNameSelect').value = last;
    handleNameSelectChange();
};

/* ---------- Clock ---------- */
function startLiveClock() {
    const tick = () => {
        const n = new Date(), t = n.toLocaleTimeString('vi-VN', { hour12: false });
        $('liveClock').textContent = t;
        $('liveDate').textContent = n.toLocaleDateString('vi-VN', { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' });
        $('formLiveDateTime').textContent = `${t} - ${n.toLocaleDateString('vi-VN')}`;
    };
    tick(); setInterval(tick, 1000);
}

/* ---------- Views & admin auth ---------- */
function switchView(view) {
    const emp = view === 'employee';
    $('btnEmployeeTab').className = emp ? TAB_ON : TAB_OFF;
    $('btnAdminTab').className = emp ? TAB_OFF : TAB_ON;
    $('employeeView').classList.toggle('hidden', !emp);
    $('adminView').classList.toggle('hidden', emp);
    if (!emp) showAdminUI();
}
function showAdminUI() {
    $('adminLockScreen').classList.toggle('hidden', isAdmin);
    $('adminDashboard').classList.toggle('hidden', !isAdmin);
    if (isAdmin) refreshAdmin();
}
async function verifyAdminPass() {
    const { error } = await sb.auth.signInWithPassword({ email: $('adminEmailInput').value.trim(), password: $('adminPassInput').value });
    $('adminPassError').classList.toggle('hidden', !error);
    if (error) return;
    isAdmin = true; $('adminPassInput').value = '';
    showAdminUI();
    showToast('Thành công', 'Đã xác thực quyền quản lý!');
}
async function adminLogout() {
    await sb.auth.signOut();
    isAdmin = false; sessions = [];
    showAdminUI();
}

/* ---------- Employees ---------- */
async function loadEmployees() {
    const { data, error } = await sb.from('employees').select('id,name').order('name');
    if (error) return showToast('Lỗi', error.message, 'error');
    employees = data;
    const opts = employees.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('');
    const sel = $('employeeNameSelect'), flt = $('adminFilterName'), cur = sel.value, curF = flt.value;
    sel.innerHTML = '<option value="">-- Chọn tên hoặc Thêm mới --</option>' + opts;
    flt.innerHTML = '<option value="ALL">Tất cả nhân viên</option>' + opts;
    if (employees.some(e => e.id === cur)) sel.value = cur;
    if (employees.some(e => e.id === curF)) flt.value = curF;
}
async function createEmployee(name) {
    name = name.trim();
    if (!name) { showToast('Lỗi', 'Vui lòng nhập họ tên!', 'error'); return null; }
    const { data, error } = await sb.from('employees').insert({ name }).select('id').single();
    if (error) {
        showToast('Lỗi', error.code === '23505' ? 'Tên này đã tồn tại trong danh sách!' : error.message, 'error');
        return null;
    }
    await loadEmployees();
    showToast('Thành công', `Đã lưu tên "${name}"`);
    return data.id;
}
function toggleNewNameInput() {
    const c = $('newNameContainer');
    c.classList.toggle('hidden');
    if (!c.classList.contains('hidden')) $('newNameInput').focus();
}
async function saveNewName() {
    const id = await createEmployee($('newNameInput').value);
    if (!id) return;
    $('newNameInput').value = '';
    $('newNameContainer').classList.add('hidden');
    $('employeeNameSelect').value = id;
    handleNameSelectChange();
}
async function addEmployeeFromAdmin() {
    if (await createEmployee($('adminAddNameInput').value)) { $('adminAddNameInput').value = ''; renderAdminData(); }
}
async function handleNameSelectChange() {
    const id = $('employeeNameSelect').value;
    if (id) localStorage.setItem('dt_last_emp', id);
    history = [];
    if (id) {
        const { data, error } = await sb.rpc('get_employee_history', { p_employee_id: id });
        if (error) showToast('Lỗi', error.message, 'error'); else history = data;
    }
    renderEmployeeOverview();
}

/* ---------- Ảnh (nén JPEG ≤1280px trước khi upload) ---------- */
async function toJpeg(src) {
    const img = await createImageBitmap(src);
    const w0 = img.width, h0 = img.height, k = Math.min(1, 1280 / w0);
    const c = $('photoCanvas');
    c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.75));
}
async function handleFileUpload(e) {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return showToast('Lỗi', 'Kích thước tệp quá lớn! Vui lòng chọn ảnh < 5MB', 'error');
    setImage(await toJpeg(f));
}
function setImage(blob) {
    selectedImage = blob;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    $('imagePreview').src = previewUrl;
    $('previewContainer').classList.remove('hidden');
    $('uploadArea').classList.add('hidden');
}
function resetImage() {
    selectedImage = null;
    $('previewContainer').classList.add('hidden');
    $('fileInput').value = '';
    $('uploadArea').classList.remove('hidden');
}

/* ---------- ON / OFF duty ---------- */
async function submitDuty(type) {
    const id = $('employeeNameSelect').value;
    if (!id) return showToast('Yêu cầu thông tin', 'Vui lòng chọn tên nhân viên trước!', 'error');
    if (!selectedImage) return showToast('Yêu cầu hình ảnh', 'Vui lòng chụp hoặc tải ảnh minh chứng!', 'error');
    const busy = v => ['btnOnDuty', 'btnOffDuty'].forEach(b => $(b).disabled = v);
    busy(true);
    try {
        const path = `${id}/${Date.now()}_${type.toLowerCase()}.jpg`;
        const up = await sb.storage.from(BUCKET).upload(path, selectedImage, { contentType: 'image/jpeg' });
        if (up.error) return showToast('Lỗi tải ảnh', up.error.message, 'error');
        const { error } = await sb.rpc(type === 'ON' ? 'clock_on' : 'clock_off', { p_employee_id: id, p_photo_path: path });
        if (error) return showToast('Cảnh báo', ERR[error.message] || error.message, 'error');
        const name = employees.find(e => e.id === id)?.name;
        showToast('Báo cáo thành công', `Đã ${type === 'ON' ? 'BẮT ĐẦU' : 'KẾT THÚC'} ca (${type} Duty) cho ${name}!`);
        resetImage();
        await handleNameSelectChange();
        if (isAdmin) refreshAdmin();
    } finally { busy(false); }
}

/* ---------- Render: nhân viên ---------- */
function renderEmployeeOverview() {
    const emp = employees.find(e => e.id === $('employeeNameSelect').value);
    const badge = $('statusBadge'), box = $('personalStatusContent'), list = $('personalHistoryList');
    const B = 'px-3 py-1 text-xs font-semibold rounded-full border flex items-center gap-1.5 ';
    $('personalCountBadge').textContent = `${history.length} ca`;
    if (!emp) {
        badge.className = B + 'bg-slate-100 text-slate-600 border-slate-200';
        badge.textContent = 'Chưa chọn tên';
        box.innerHTML = '<div class="inline-flex p-3 rounded-full bg-slate-100 text-slate-400"><i data-lucide="user-x" class="w-8 h-8"></i></div><p class="text-xs text-slate-500">Vui lòng chọn tên nhân viên để xem trạng thái</p>';
        list.innerHTML = '<p class="text-xs text-slate-400 text-center py-6">Chưa chọn nhân viên.</p>';
        return lucide.createIcons();
    }
    const active = history.find(s => s.status === 'ON'), last = history.find(s => s.status === 'COMPLETED');
    if (active) {
        badge.className = B + 'bg-emerald-100 text-emerald-700 border-emerald-200';
        badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Đang On Duty';
        box.innerHTML = `<div class="inline-flex p-3 rounded-full bg-emerald-100 text-emerald-600"><i data-lucide="play" class="w-8 h-8"></i></div>
            <div><h4 class="font-bold text-slate-900 text-base">${esc(emp.name)}</h4><p class="text-xs text-emerald-600 font-semibold mt-0.5">Đang trong ca trực</p></div>
            <div class="bg-slate-50 p-3 rounded-xl border border-slate-200 text-left space-y-1">
                <p class="text-xs text-slate-500">Thời gian On Duty: <span class="font-semibold text-slate-800">${formatDateTime(active.on_time)}</span></p>
                <p class="text-xs text-slate-500">Đã trực được: <span class="font-semibold text-blue-600">${formatDuration(Date.now() - new Date(active.on_time))}</span></p></div>`;
    } else {
        badge.className = B + 'bg-slate-100 text-slate-600 border-slate-200';
        badge.textContent = 'Chưa vào ca (Off Duty)';
        box.innerHTML = `<div class="inline-flex p-3 rounded-full bg-slate-100 text-slate-500"><i data-lucide="coffee" class="w-8 h-8"></i></div>
            <div><h4 class="font-bold text-slate-900 text-base">${esc(emp.name)}</h4><p class="text-xs text-slate-500 mt-0.5">Hiện đang sẵn sàng vào ca</p></div>
            ${last ? `<div class="bg-slate-50 p-3 rounded-xl border border-slate-200 text-left space-y-1">
                <p class="text-xs text-slate-500">Ca gần nhất: <span class="font-semibold text-slate-800">${formatDateTime(last.off_time)}</span></p>
                <p class="text-xs text-slate-500">Thời lượng ca đó: <span class="font-semibold text-emerald-600">${formatDuration(last.duration_seconds * 1000)}</span></p></div>` : ''}`;
    }
    list.innerHTML = history.length ? history.map((s, i) => `
        <div class="bg-slate-50 p-3.5 rounded-xl border border-slate-200 flex items-center justify-between">
            <div class="space-y-1">
                <div class="flex items-center space-x-2">
                    <span class="text-xs font-bold text-slate-700">Đợt #${history.length - i}</span>
                    <span class="px-2 py-0.5 text-[10px] font-semibold rounded-full ${s.status === 'ON' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'}">${s.status === 'ON' ? 'Đang On Duty' : 'Hoàn thành'}</span>
                </div>
                <p class="text-xs text-slate-500"><span class="text-emerald-600 font-medium">ON:</span> ${formatTime(s.on_time)} (${formatDate(s.on_time)})</p>
                ${s.off_time ? `<p class="text-xs text-slate-500"><span class="text-rose-600 font-medium">OFF:</span> ${formatTime(s.off_time)} (${formatDate(s.off_time)})</p>` : ''}
            </div>
            <span class="text-xs font-bold ${s.status === 'ON' ? 'text-blue-600' : 'text-slate-700'}">${s.status === 'ON' ? 'Đang tính...' : formatDuration(s.duration_seconds * 1000)}</span>
        </div>`).join('') : `<p class="text-xs text-slate-400 text-center py-6">Chưa có lịch sử báo cáo nào cho ${esc(emp.name)}.</p>`;
    lucide.createIcons();
}

/* ---------- Admin ---------- */
async function loadSessions() {
    const { data, error } = await sb.from('duty_sessions').select('*').order('on_time', { ascending: false });
    if (error) return showToast('Lỗi', error.message, 'error');
    sessions = data;
}
async function refreshAdmin() {
    await Promise.all([loadEmployees(), loadSessions()]);
    renderAdminData();
}
function renderAdminData() {
    if (!isAdmin) return;
    const ms = s => (s.duration_seconds || 0) * 1000;
    $('statTotalEmployees').textContent = employees.length;
    $('statActiveShifts').textContent = sessions.filter(s => s.status === 'ON').length;
    $('statCompletedShifts').textContent = sessions.filter(s => s.status === 'COMPLETED').length;
    $('statTotalHours').textContent = (sessions.reduce((a, s) => a + ms(s), 0) / 3600000).toFixed(1) + 'h';

    $('employeeManagementTable').innerHTML = employees.length ? employees.map(e => {
        const mine = sessions.filter(s => s.employee_id === e.id), on = mine.some(s => s.status === 'ON');
        return `<tr class="hover:bg-slate-50 transition-colors">
            <td class="py-3 px-4 font-bold text-slate-800">${esc(e.name)}</td>
            <td class="py-3 px-4"><span class="px-2.5 py-0.5 text-xs font-semibold rounded-full ${on ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}">${on ? 'Đang On Duty' : 'Nghỉ ca'}</span></td>
            <td class="py-3 px-4 text-center font-medium">${mine.length} lượt</td>
            <td class="py-3 px-4 text-center text-xs text-slate-500">${mine[0] ? formatDate(mine[0].on_time) : 'Chưa có'}</td>
            <td class="py-3 px-4 text-right font-bold text-blue-600">${formatDuration(mine.reduce((a, s) => a + ms(s), 0))}</td>
            <td class="py-3 px-4 text-center"><button onclick="deleteEmployee('${e.id}')" class="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 rounded-xl text-xs font-semibold inline-flex items-center gap-1"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i> Xóa</button></td>
        </tr>`;
    }).join('') : '<tr><td colspan="6" class="py-6 text-center text-xs text-slate-400">Chưa có nhân viên nào trong danh sách.</td></tr>';

    const fn = $('adminFilterName').value, fd = $('adminFilterDate').value;
    const rows = sessions.filter(s => (fn === 'ALL' || s.employee_id === fn) && (!fd || localDate(s.on_time) === fd));
    const photoBtn = (s, kind, cls) => s[kind + '_photo_path'] ? `<button onclick="viewImage('${s.id}','${kind}')" class="px-2 py-1 ${cls} border rounded text-xs font-medium">Xem ảnh</button>` : '-';
    $('adminSessionsTable').innerHTML = rows.length ? rows.map(s => `<tr class="hover:bg-slate-50 transition-colors">
        <td class="py-3 px-3"><p class="font-bold text-slate-800 text-xs">${esc(s.employee_name)}</p><p class="text-[10px] text-slate-400 font-mono">${s.id.slice(0, 8)}</p></td>
        <td class="py-3 px-3 text-xs text-slate-600">${formatDateTime(s.on_time)}</td>
        <td class="py-3 px-3">${photoBtn(s, 'on', 'bg-blue-50 border-blue-200 text-blue-600')}</td>
        <td class="py-3 px-3 text-xs text-slate-600">${s.off_time ? formatDateTime(s.off_time) : '<span class="text-amber-600 font-medium">Chưa Off Duty</span>'}</td>
        <td class="py-3 px-3">${photoBtn(s, 'off', 'bg-rose-50 border-rose-200 text-rose-600')}</td>
        <td class="py-3 px-3 text-center font-bold text-xs ${s.status === 'ON' ? 'text-amber-500' : 'text-slate-800'}">${s.status === 'ON' ? 'Đang chạy' : formatDuration(ms(s))}</td>
        <td class="py-3 px-3 text-center"><span class="px-2 py-0.5 text-[10px] font-semibold rounded-full ${s.status === 'ON' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}">${s.status === 'ON' ? 'Đang diễn ra' : 'Đã hoàn thành'}</span></td>
        <td class="py-3 px-3 text-right"><button onclick="deleteSession('${s.id}')" class="p-1.5 bg-slate-100 hover:bg-red-100 text-slate-400 hover:text-red-600 rounded-lg" title="Xóa ca này"><i data-lucide="trash-2" class="w-4 h-4"></i></button></td>
    </tr>`).join('') : '<tr><td colspan="8" class="py-6 text-center text-xs text-slate-400">Không tìm thấy ca làm việc nào tương ứng.</td></tr>';
    lucide.createIcons();
}
function clearAdminFilters() {
    $('adminFilterName').value = 'ALL'; $('adminFilterDate').value = '';
    renderAdminData();
}
const removePhotos = ss => {
    const p = ss.flatMap(s => [s.on_photo_path, s.off_photo_path]).filter(Boolean);
    return p.length ? sb.storage.from(BUCKET).remove(p) : null;
};
async function deleteSession(id) {
    if (!confirm('Bạn có chắc chắn muốn xóa ca làm việc này không?')) return;
    const s = sessions.find(x => x.id === id);
    const { error } = await sb.from('duty_sessions').delete().eq('id', id);
    if (error) return showToast('Lỗi', error.message, 'error');
    await removePhotos([s]);
    await refreshAdmin();
    showToast('Thành công', 'Đã xóa ca làm việc!');
}
async function deleteEmployee(id) {
    const e = employees.find(x => x.id === id);
    if (!confirm(`Bạn có chắc chắn muốn xóa nhân viên "${e.name}" khỏi danh sách?`)) return;
    if (confirm(`Xóa luôn tất cả lịch sử On/Off duty của "${e.name}"? (Cancel = giữ lại lịch sử)`)) {
        const mine = sessions.filter(s => s.employee_id === id);
        const r = await sb.from('duty_sessions').delete().eq('employee_id', id);
        if (r.error) return showToast('Lỗi', r.error.message, 'error');
        await removePhotos(mine);
    }
    const { error } = await sb.from('employees').delete().eq('id', id);
    if (error) return showToast('Lỗi', error.message, 'error');
    await refreshAdmin();
    await handleNameSelectChange();
    showToast('Đã xóa', `Đã xóa nhân viên "${e.name}"!`);
}
async function viewImage(id, kind) {
    const s = sessions.find(x => x.id === id), path = s && s[kind + '_photo_path'];
    if (!path) return;
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 300);
    if (error) return showToast('Lỗi', error.message, 'error');
    $('imageModalSrc').src = data.signedUrl;
    $('imageModalTitle').textContent = `Ảnh ${kind === 'on' ? 'On' : 'Off'} Duty - ${s.employee_name}`;
    $('imageModal').classList.remove('hidden');
}
function closeImageModal() { $('imageModal').classList.add('hidden'); }

function exportToExcel() {
    if (!sessions.length) return showToast('Cảnh báo', 'Không có dữ liệu ca làm việc để xuất!', 'error');
    const data = sessions.map(s => ({
        'Mã Ca': s.id,
        'Tên Nhân Viên': s.employee_name,
        'Thời Gian Bắt Đầu (On)': formatDateTime(s.on_time),
        'Thời Gian Kết Thúc (Off)': s.off_time ? formatDateTime(s.off_time) : 'Chưa Off Duty',
        'Thời Lượng Làm Việc': s.status === 'COMPLETED' ? formatDuration(s.duration_seconds * 1000) : 'Đang diễn ra',
        'Trạng Thái': s.status === 'ON' ? 'Đang diễn ra' : 'Hoàn thành'
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'BaoCaoDuty');
    XLSX.writeFile(wb, `BaoCao_Duty_${localDate(new Date())}.xlsx`);
    showToast('Thành công', 'Đã tải xuống file Excel báo cáo!');
}

/* ---------- Toast & format ---------- */
function showToast(title, message, type = 'success') {
    const ok = type === 'success';
    $('toastIcon').className = `p-1 ${ok ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'} rounded-lg`;
    $('toastIcon').innerHTML = `<i data-lucide="${ok ? 'check-circle' : 'alert-circle'}" class="w-5 h-5"></i>`;
    $('toastTitle').textContent = title;
    $('toastMessage').textContent = message;
    lucide.createIcons();
    const t = $('toast');
    t.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => t.classList.add('translate-y-20', 'opacity-0'), 3500);
}
const localDate = v => new Date(v).toLocaleDateString('en-CA'); // YYYY-MM-DD theo múi giờ máy
const formatDateTime = v => v ? `${new Date(v).toLocaleTimeString('vi-VN')} - ${new Date(v).toLocaleDateString('vi-VN')}` : '-';
const formatTime = v => v ? new Date(v).toLocaleTimeString('vi-VN') : '-';
const formatDate = v => v ? new Date(v).toLocaleDateString('vi-VN') : '-';
function formatDuration(ms) {
    if (!ms || ms <= 0) return '00h 00m 00s';
    const p = n => String(n).padStart(2, '0');
    return `${p(Math.floor(ms / 3600000))}h ${p(Math.floor(ms / 60000) % 60)}m ${p(Math.floor(ms / 1000) % 60)}s`;
}
