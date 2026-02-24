/**
 * 🍲 张崇会火锅 - 新春抽奖系统 v3.0
 * 
 * 功能：15格抽奖、积分30天过期、防重复邀请、权限分级
 */

var APP_VERSION = 'v52';
var POINTS_EXPIRY_DAYS = 90;

// ============ Web App 入口 ============
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'lottery';
  var ref = (e && e.parameter && e.parameter.ref) || '';
  
  if (page === 'admin') {
    return HtmlService.createTemplateFromFile('Admin').evaluate()
      .setTitle('后台管理').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  if (page === 'mobile') {
    return HtmlService.createTemplateFromFile('Mobile').evaluate()
      .setTitle('移动管理').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
  }
  
  var t = HtmlService.createTemplateFromFile('Lottery');
  t.referrerCode = ref;
  return t.evaluate().setTitle('🧧 新春抽奖')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(f) { return HtmlService.createHtmlOutputFromFile(f).getContent(); }

// ============ 表名配置 ============
var SH = {
  PRIZES: '奖品配置',
  USERS: '用户数据',
  RECORDS: '中奖记录',
  INVITES: '邀请记录',
  STAFF: '员工账号',
  LOGS: '操作日志',
  POINTS: '积分明细'
};

// ============ 工具函数 ============
function getSheet(n) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(n);
  if (!sh) {
    sh = ss.insertSheet(n);
    initHeaders(sh, n);
  }
  return sh;
}

function initHeaders(sh, n) {
  var h = {
    '奖品配置': ['奖品ID','名称','图标','总库存','已发','剩余','权重','价值','大奖','状态','格子位置'],
    '用户数据': ['用户ID','手机','姓名','邮箱','注册时间','积分','积分过期时间','总积分','邀请码','邀请人','邀请数','总抽奖','今日抽','最后抽奖','状态'],
    '中奖记录': ['记录ID','时间','用户ID','手机','姓名','奖品','验证码','有效期','WA状态','WA时间','核销状态','核销时间','核销员','备注'],
    '邀请记录': ['邀请ID','时间','邀请人手机','邀请人姓名','被邀请人手机','被邀请人姓名','获得积分','状态'],
    '员工账号': ['员工ID','姓名','账号','密码','角色','状态','创建时间','最后登录'],
    '操作日志': ['日志ID','时间','操作员','角色','动作','详情'],
    '积分明细': ['明细ID','用户手机','获得时间','过期时间','原始积分','剩余积分','来源']
  };
  if (h[n]) {
    sh.appendRow(h[n]);
    sh.getRange(1, 1, 1, h[n].length).setBackground('#8B0000').setFontColor('#fff').setFontWeight('bold');
  }
}

function generateStrongPassword() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  var pwd = '';
  for (var i = 0; i < 8; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pwd;
}

// ============ 密码哈希 ============
function hashPassword(pwd) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, pwd);
  return digest.map(function(b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

// ============ 登录频率限制 ============
var loginAttemptCache_ = {};
function checkLoginRateLimit(username) {
  var key = 'login_' + username;
  var cache = CacheService.getScriptCache();
  var data = cache.get(key);
  if (!data) return { allowed: true };
  var info = JSON.parse(data);
  if (info.locked && new Date().getTime() < info.lockUntil) {
    var remaining = Math.ceil((info.lockUntil - new Date().getTime()) / 60000);
    return { allowed: false, message: '登录失败次数过多，请' + remaining + '分钟后再试' };
  }
  return { allowed: true, attempts: info.attempts || 0 };
}

function recordLoginFailure(username) {
  var key = 'login_' + username;
  var cache = CacheService.getScriptCache();
  var data = cache.get(key);
  var info = data ? JSON.parse(data) : { attempts: 0 };
  info.attempts = (info.attempts || 0) + 1;
  if (info.attempts >= 5) {
    info.locked = true;
    info.lockUntil = new Date().getTime() + 15 * 60 * 1000; // 锁定15分钟
    info.attempts = 0;
  }
  cache.put(key, JSON.stringify(info), 900); // 15分钟过期
}

function clearLoginFailures(username) {
  CacheService.getScriptCache().remove('login_' + username);
}

// ============ 会话Token管理 ============
function createSessionToken(staffId, staffName, staffRole) {
  var token = Utilities.getUuid();
  var cache = CacheService.getScriptCache();
  var session = JSON.stringify({ id: staffId, name: staffName, role: staffRole, created: new Date().getTime() });
  cache.put('session_' + token, session, 7200); // 2小时过期
  return token;
}

function validateSession(token) {
  if (!token) return null;
  var cache = CacheService.getScriptCache();
  var data = cache.get('session_' + token);
  if (!data) return null;
  return JSON.parse(data);
}

function addLog(operator, role, action, detail) {
  var sh = getSheet(SH.LOGS);
  sh.appendRow(['L' + Utilities.getUuid().substring(0, 8), new Date(), operator, role, action, detail]);
}

// ============ 手机号处理 ============
function formatPhone(phone) {
  var p = String(phone).replace(/[\s\-\(\)\+]/g, '');
  if (/^0[1-9]\d{7,9}$/.test(p)) return '60' + p.substring(1);
  if (/^[89]\d{7}$/.test(p)) return '65' + p;
  return p;
}

function validatePhone(phone) {
  var p = formatPhone(phone);
  if (/^60[1-9]\d{8,9}$/.test(p)) return { valid: true, phone: p };
  if (/^65[89]\d{7}$/.test(p)) return { valid: true, phone: p };
  return { valid: false, phone: p };
}

// ============ 用户系统 ============
function registerUser(phone, name, email, refCode) {
  var v = validatePhone(phone);
  if (!v.valid) return { success: false, message: '请输入有效手机号\n马来西亚: 0123456789\n新加坡: 91234567' };
  var p = v.phone;
  
  var sh = getSheet(SH.USERS);
  var data = sh.getDataRange().getValues();
  
  // 检查是否已注册
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]) === p) {
      // 检查积分是否过期
      var cachedRecords = getSheet(SH.RECORDS).getDataRange().getValues();
      var user = getUserFromRow(data[i], i + 1, sh, cachedRecords);
      return { success: true, isNew: false, user: user };
    }
  }
  
  // 新用户注册
  var uid = 'U' + Utilities.getUuid().substring(0, 8);
  var inviteCode = generateCode();
  var now = new Date();
  var pointsExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30天后过期
  
  // 处理邀请关系
  var referrerPhone = '';
  if (refCode) {
    var referrer = findUserByInviteCode(refCode);
    if (referrer && referrer.phone !== p) {
      // 检查是否已经被邀请过（防止重复）
      if (!hasBeenInvited(p)) {
        referrerPhone = referrer.phone;
        addPointsToUser(referrer.phone, 1, '邀请奖励');
        incrementInviteCount(referrer.phone);
        recordInvite(referrer.phone, referrer.name, p, name || '');
        addLog('System', '', '邀请成功', referrer.phone + ' 邀请 ' + p);
      }
    }
  }

  sh.appendRow([
    uid, p, name || '', email || '', now,
    0, '', 1, inviteCode, referrerPhone,
    0, 0, 0, '', '正常'
  ]);

  // 注册奖励写入积分明细表
  addPointsToUser(p, 1, '注册奖励');
  
  addLog('System', '', '用户注册', '新用户: ' + p);
  
  return {
    success: true,
    isNew: true,
    user: {
      odoo: uid,
      phone: p,
      name: name,
      points: 1,
      inviteCode: inviteCode,
      inviteCount: 0,
      todayDraws: 0
    },
    message: '注册成功！获得1积分'
  };
}

function getUserFromRow(row, rowNum, sh, cachedRecords) {
  var phone = String(row[1]);
  var points = getActivePoints(phone);

  return {
    odoo: row[0],
    phone: phone,
    name: row[2],
    points: points,
    inviteCode: row[8],
    inviteCount: row[10] || 0,
    todayDraws: getTodayDrawCount(phone, cachedRecords)
  };
}

// 计算用户有效积分 (未过期的剩余积分之和)
function getActivePoints(phone) {
  var psh = getSheet(SH.POINTS);
  var d = psh.getDataRange().getValues();
  var now = new Date();
  var total = 0;
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][1]) !== String(phone)) continue;
    var expiry = d[i][3] ? new Date(d[i][3]) : null;
    var remaining = d[i][5] || 0;
    if (remaining > 0 && expiry && now <= expiry) {
      total += remaining;
    }
  }
  return total;
}

// 获取用户积分明细 (供查询页面使用)
function getPointsDetail(phone) {
  var psh = getSheet(SH.POINTS);
  var d = psh.getDataRange().getValues();
  var now = new Date();
  var tz = 'Asia/Kuala_Lumpur';
  var details = [];
  var activeTotal = 0;
  var expiredTotal = 0;
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][1]) !== String(phone)) continue;
    var expiry = d[i][3] ? new Date(d[i][3]) : null;
    var remaining = d[i][5] || 0;
    var original = d[i][4] || 0;
    var isExpired = expiry && now > expiry;
    if (isExpired) {
      expiredTotal += remaining;
    } else {
      activeTotal += remaining;
    }
    details.push({
      date: d[i][2] ? Utilities.formatDate(new Date(d[i][2]), tz, 'yyyy-MM-dd') : '',
      expiry: expiry ? Utilities.formatDate(expiry, tz, 'yyyy-MM-dd') : '',
      original: original,
      remaining: isExpired ? 0 : remaining,
      source: d[i][6] || '',
      expired: isExpired
    });
  }
  details.sort(function(a, b) { return new Date(b.date) - new Date(a.date); });
  return { details: details, activeTotal: activeTotal, expiredTotal: expiredTotal };
}

function generateCode() {
  var c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var r = '';
  for (var i = 0; i < 6; i++) r += c[Math.floor(Math.random() * c.length)];
  return r;
}

function findUserByInviteCode(code) {
  var d = getSheet(SH.USERS).getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (d[i][8] === code.toUpperCase()) {
      return { row: i + 1, phone: String(d[i][1]), name: d[i][2] };
    }
  }
  return null;
}

function hasBeenInvited(phone) {
  var d = getSheet(SH.INVITES).getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][4]) === phone) return true;
  }
  return false;
}

function addPointsToUser(phone, pts, source) {
  var psh = getSheet(SH.POINTS);
  var now = new Date();
  var expiry = new Date(now.getTime() + POINTS_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  var id = 'PT' + Utilities.getUuid().substring(0, 8);
  psh.appendRow([id, String(phone), now, expiry, pts, pts, source || '系统']);
  // 同步更新用户表的总积分(累计)
  var ush = getSheet(SH.USERS);
  var ud = ush.getDataRange().getValues();
  for (var i = 1; i < ud.length; i++) {
    if (String(ud[i][1]) === String(phone)) {
      ush.getRange(i + 1, 8).setValue((ud[i][7] || 0) + pts);
      break;
    }
  }
}

function deductPoints(phone) {
  var psh = getSheet(SH.POINTS);
  var d = psh.getDataRange().getValues();
  var now = new Date();
  var toDeduct = 1;

  // 收集该用户有效的积分行 (未过期且剩余>0), 按过期时间排序 (FIFO先扣最早到期的)
  var rows = [];
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][1]) !== String(phone)) continue;
    var expiry = d[i][3] ? new Date(d[i][3]) : null;
    var remaining = d[i][5] || 0;
    if (remaining > 0 && expiry && now <= expiry) {
      rows.push({ idx: i + 1, expiry: expiry.getTime(), remaining: remaining });
    }
  }
  rows.sort(function(a, b) { return a.expiry - b.expiry; });

  var total = 0;
  for (var j = 0; j < rows.length; j++) total += rows[j].remaining;
  if (total < toDeduct) return false;

  // FIFO 扣减
  for (var k = 0; k < rows.length && toDeduct > 0; k++) {
    var take = Math.min(rows[k].remaining, toDeduct);
    psh.getRange(rows[k].idx, 6).setValue(rows[k].remaining - take);
    toDeduct -= take;
  }
  return true;
}

function incrementInviteCount(phone) {
  var sh = getSheet(SH.USERS);
  var d = sh.getDataRange().getValues();
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][1]) === String(phone)) {
      sh.getRange(i + 1, 11).setValue((d[i][10] || 0) + 1);
      return;
    }
  }
}

function recordInvite(inviterPhone, inviterName, inviteePhone, inviteeName) {
  var sh = getSheet(SH.INVITES);
  var id = 'I' + Utilities.getUuid().substring(0, 8);
  sh.appendRow([id, new Date(), inviterPhone, inviterName, inviteePhone, inviteeName, 1, '成功']);
}

function getTodayDrawCount(phone, cachedRecords) {
  var d = cachedRecords || getSheet(SH.RECORDS).getDataRange().getValues();
  var today = Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
  var count = 0;

  for (var i = 1; i < d.length; i++) {
    if (String(d[i][3]) === phone && d[i][1]) {
      var drawDate = Utilities.formatDate(new Date(d[i][1]), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
      if (drawDate === today) count++;
    }
  }
  return count;
}

function getUserInfo(phone, cachedRecords) {
  var v = validatePhone(phone);
  if (!v.valid) return { success: false };
  var p = v.phone;

  var sh = getSheet(SH.USERS);
  var d = sh.getDataRange().getValues();

  for (var i = 1; i < d.length; i++) {
    if (String(d[i][1]) === p) {
      return { success: true, user: getUserFromRow(d[i], i + 1, sh, cachedRecords) };
    }
  }
  return { success: false };
}

// 查询用户积分和奖品
function queryUserPrizes(phone) {
  var v = validatePhone(phone);
  if (!v.valid) return { success: false, message: '手机号格式错误' };
  var p = v.phone;
  
  // 获取用户信息
  var userInfo = getUserInfo(p);
  if (!userInfo.success) return { success: false, message: '未找到此用户' };
  
  // 获取用户的奖品记录
  var rsh = getSheet(SH.RECORDS);
  var rd = rsh.getDataRange().getValues();
  var prizes = [];
  
  for (var i = 1; i < rd.length; i++) {
    if (String(rd[i][3]) === p) {
      var expiry = rd[i][7] ? new Date(rd[i][7]) : null;
      var status = rd[i][10];
      if (expiry && new Date() > expiry && status === '未核销') status = '已过期';
      
      prizes.push({
        prize: rd[i][5],
        code: rd[i][6],
        expiryDate: expiry ? Utilities.formatDate(expiry, 'Asia/Kuala_Lumpur', 'yyyy-MM-dd') : '',
        status: status,
        drawTime: rd[i][1] ? Utilities.formatDate(new Date(rd[i][1]), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd HH:mm') : ''
      });
    }
  }
  
  // 按时间倒序
  prizes.sort(function(a, b) {
    return new Date(b.drawTime) - new Date(a.drawTime);
  });
  
  // 积分明细
  var pointsInfo = getPointsDetail(p);

  return {
    success: true,
    user: userInfo.user,
    prizes: prizes,
    pointsDetail: pointsInfo.details,
    activePoints: pointsInfo.activeTotal,
    expiredPoints: pointsInfo.expiredTotal
  };
}

// ============ 抽奖系统 ============
function getPrizeList() {
  var d = getSheet(SH.PRIZES).getDataRange().getValues();
  var prizes = [];
  
  for (var i = 1; i < d.length; i++) {
    if (d[i][0] && d[i][9] === '启用') {
      prizes.push({
        id: d[i][0],
        name: d[i][1],
        icon: d[i][2] || '🎁',
        isGrand: d[i][8] === true || d[i][8] === 'TRUE' || d[i][8] === '是',
        position: d[i][10] || i
      });
    }
  }
  return prizes;
}

function doLottery(phone) {
  var v = validatePhone(phone);
  if (!v.valid) return { success: false, message: '手机号格式错误' };
  var p = v.phone;

  // 缓存记录数据，减少重复全表扫描
  var cachedRecords = getSheet(SH.RECORDS).getDataRange().getValues();
  var u = getUserInfo(p, cachedRecords);
  if (!u.success) return { success: false, message: '请先登记' };

  if (u.user.todayDraws >= 3) {
    return { success: false, message: '今日已抽3次，明天再来！' };
  }

  if (u.user.points < 1) {
    return { success: false, message: '积分不足', inviteCode: u.user.inviteCode };
  }

  // 使用锁保护积分扣减+库存操作的原子性
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // 等待最多10秒
  } catch(e) {
    return { success: false, message: '系统繁忙，请稍后重试' };
  }

  try {
    // 锁内扣减积分（防止并发积分竞争）
    if (!deductPoints(p)) {
      lock.releaseLock();
      return { success: false, message: '积分不足', inviteCode: u.user.inviteCode };
    }

    var psh = getSheet(SH.PRIZES);
    var selected = null;
    var MAX_RETRIES = 3;

    for (var attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // 每次重试重新读取奖品数据（锁内读取确保数据一致）
      var pd = psh.getDataRange().getValues();
      var available = [];
      var totalWeight = 0;

      for (var i = 1; i < pd.length; i++) {
        var remaining = (pd[i][3] || 0) - (pd[i][4] || 0);
        var weight = pd[i][6] || 0;
        if (remaining > 0 && weight > 0 && pd[i][9] === '启用') {
          available.push({
            row: i + 1,
            name: pd[i][1],
            icon: pd[i][2] || '🎁',
            weight: weight,
            isGrand: pd[i][8] === true || pd[i][8] === 'TRUE' || pd[i][8] === '是'
          });
          totalWeight += weight;
        }
      }

      if (available.length === 0) {
        addPointsToUser(p, 1, '抽奖退还'); // 锁内退还
        lock.releaseLock();
        return { success: false, message: '奖品已抽完' };
      }

      // 随机选择
      var rnd = Math.random() * totalWeight;
      selected = available[0];
      for (var j = 0; j < available.length; j++) {
        rnd -= available[j].weight;
        if (rnd <= 0) {
          selected = available[j];
          break;
        }
      }

      // 更新库存（锁内写入，确保原子性）
      var freshUsed = psh.getRange(selected.row, 5).getValue() || 0;
      var freshTotal = psh.getRange(selected.row, 4).getValue() || 0;
      if (freshUsed < freshTotal) {
        // 库存充足，写入并跳出循环
        psh.getRange(selected.row, 5).setValue(freshUsed + 1);
        SpreadsheetApp.flush(); // 立即写入
        break;
      }

      // 库存已被其他人抢完，继续下一次重试
      selected = null;
    }

    // 重试耗尽仍未选到奖品
    if (!selected) {
      addPointsToUser(p, 1, '抽奖退还'); // 锁内退还
      lock.releaseLock();
      return { success: false, message: '奖品库存不足，请稍后重试' };
    }

    lock.releaseLock();
  } catch(e) {
    try { addPointsToUser(p, 1, '抽奖退还'); } catch(ignored2) {}
    try { lock.releaseLock(); } catch(ignored) {}
    return { success: false, message: '系统错误，请重试' };
  }

  // 生成验证码
  var code = 'ZCH' + Math.floor(100000 + Math.random() * 900000);
  var expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);

  // 记录
  var rsh = getSheet(SH.RECORDS);
  var rid = 'R' + Utilities.getUuid().substring(0, 8);
  rsh.appendRow([
    rid, new Date(), u.user.odoo, p, u.user.name,
    selected.name, code, expiry, '待发送', '', '未核销', '', '', ''
  ]);

  // 更新用户抽奖次数
  var ush = getSheet(SH.USERS);
  var ud = ush.getDataRange().getValues();
  for (var k = 1; k < ud.length; k++) {
    if (String(ud[k][1]) === p) {
      ush.getRange(k + 1, 12).setValue((ud[k][11] || 0) + 1);
      ush.getRange(k + 1, 14).setValue(new Date());
      break;
    }
  }

  addLog('System', '', '抽奖', p + ' 抽中 ' + selected.name + ' (' + code + ')');

  return {
    success: true,
    prize: { name: selected.name, icon: selected.icon, isGrand: selected.isGrand },
    code: code,
    expiryDate: Utilities.formatDate(expiry, 'Asia/Kuala_Lumpur', 'yyyy年MM月dd日'),
    newPoints: u.user.points - 1,
    todayDraws: u.user.todayDraws + 1,
    inviteCode: u.user.inviteCode
  };
}

// ============ 后台管理 ============

// 登录验证（带权限）
function getAppVersion() {
  return APP_VERSION;
}

function adminLogin(username, password) {
  var u = username.trim();
  // 频率限制检查
  var rateCheck = checkLoginRateLimit(u);
  if (!rateCheck.allowed) return { success: false, message: rateCheck.message };

  var sh = getSheet(SH.STAFF);
  var d = sh.getDataRange().getValues();
  var hashedInput = hashPassword(password.trim());

  for (var i = 1; i < d.length; i++) {
    var sheetUser = String(d[i][2]).trim();
    var sheetPass = String(d[i][3]).trim();
    var sheetStatus = String(d[i][5]).trim();

    if (sheetUser !== u) continue;

    // 支持哈希密码和明文密码（兼容旧数据）
    var match = (sheetPass === hashedInput) || (sheetPass.length < 64 && sheetPass === password.trim());

    if (match) {
      if (sheetStatus !== '启用') {
        return { success: false, message: '账号已停用，请联系管理员' };
      }
      // 如果是明文密码，自动升级为哈希
      if (sheetPass.length < 64) {
        sh.getRange(i + 1, 4).setValue(hashedInput);
      }
      sh.getRange(i + 1, 8).setValue(new Date());
      clearLoginFailures(u);
      var role = String(d[i][4]).trim();
      var token = createSessionToken(d[i][0], d[i][1], role);
      addLog(d[i][1], role, '登录', '管理员登录');
      return {
        success: true,
        version: APP_VERSION,
        sessionToken: token,
        staff: {
          id: d[i][0],
          name: d[i][1],
          username: d[i][2],
          role: role
        }
      };
    }
  }
  recordLoginFailure(u);
  return { success: false, message: '账号或密码错误' };
}

// 查询验证码
function queryCode(code) {
  var c = code.trim().toUpperCase();
  var d = getSheet(SH.RECORDS).getDataRange().getValues();
  
  for (var i = 1; i < d.length; i++) {
    if (d[i][6] && String(d[i][6]).toUpperCase() === c) {
      var expiry = new Date(d[i][7]);
      var status = d[i][10];
      if (new Date() > expiry && status === '未核销') status = '已过期';
      
      return {
        found: true,
        row: i + 1,
        recordId: d[i][0],
        drawTime: d[i][1] ? Utilities.formatDate(new Date(d[i][1]), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd HH:mm') : '',
        phone: d[i][3],
        name: d[i][4],
        prize: d[i][5],
        code: d[i][6],
        expiryDate: Utilities.formatDate(expiry, 'Asia/Kuala_Lumpur', 'yyyy-MM-dd'),
        waStatus: d[i][8],
        status: status,
        verifyTime: d[i][11] ? Utilities.formatDate(new Date(d[i][11]), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd HH:mm') : '',
        verifyBy: d[i][12] || ''
      };
    }
  }
  return { found: false };
}

// 核销验证码（服务端权限校验）
function verifyCode(code, sessionToken) {
  var session = validateSession(sessionToken);
  if (!session) return { success: false, message: '会话已过期，请重新登录' };

  var r = queryCode(code);
  if (!r.found) return { success: false, message: '验证码不存在' };
  if (r.status === '已核销') return { success: false, message: '此验证码已核销', verifyTime: r.verifyTime, verifyBy: r.verifyBy };
  if (r.status === '已过期') return { success: false, message: '验证码已过期' };

  var sh = getSheet(SH.RECORDS);
  sh.getRange(r.row, 11).setValue('已核销');
  sh.getRange(r.row, 12).setValue(new Date());
  sh.getRange(r.row, 13).setValue(session.name);

  addLog(session.name, session.role, '核销', '核销: ' + code + ' (' + r.prize + ')');

  return { success: true, prize: r.prize, message: '核销成功！请发放: ' + r.prize };
}

// 获取中奖记录列表
function getRecordList(filter, page, pageSize) {
  var d = getSheet(SH.RECORDS).getDataRange().getValues();
  var records = [];
  
  for (var i = 1; i < d.length; i++) {
    var expiry = d[i][7] ? new Date(d[i][7]) : null;
    var status = d[i][10];
    if (expiry && new Date() > expiry && status === '未核销') status = '已过期';
    
    if (filter === 'pending' && status !== '未核销') continue;
    if (filter === 'verified' && status !== '已核销') continue;
    if (filter === 'expired' && status !== '已过期') continue;
    
    records.push({
      id: d[i][0],
      drawTime: d[i][1] ? Utilities.formatDate(new Date(d[i][1]), 'Asia/Kuala_Lumpur', 'MM-dd HH:mm') : '',
      phone: d[i][3],
      name: d[i][4],
      prize: d[i][5],
      code: d[i][6],
      expiryDate: d[i][7] ? Utilities.formatDate(new Date(d[i][7]), 'Asia/Kuala_Lumpur', 'MM-dd') : '',
      waStatus: d[i][8],
      status: status,
      verifyTime: d[i][11] ? Utilities.formatDate(new Date(d[i][11]), 'Asia/Kuala_Lumpur', 'MM-dd HH:mm') : '',
      verifyBy: d[i][12] || ''
    });
  }
  
  records.reverse();
  var start = ((page || 1) - 1) * (pageSize || 20);
  return { records: records.slice(start, start + (pageSize || 20)), total: records.length };
}

// WhatsApp发送
function getWAList(filter) {
  var d = getSheet(SH.RECORDS).getDataRange().getValues();
  var records = [];
  var pending = 0, sent = 0;
  
  for (var i = 1; i < d.length; i++) {
    var waStatus = d[i][8] || '待发送';
    var verifyStatus = d[i][10];
    
    if (waStatus === '待发送' && verifyStatus === '未核销') pending++;
    else if (waStatus === '已发送') sent++;
    
    if (filter === 'pending' && (waStatus !== '待发送' || verifyStatus !== '未核销')) continue;
    if (filter === 'sent' && waStatus !== '已发送') continue;
    
    records.push({
      code: d[i][6],
      phone: d[i][3],
      name: d[i][4],
      prize: d[i][5],
      drawTime: d[i][1] ? Utilities.formatDate(new Date(d[i][1]), 'Asia/Kuala_Lumpur', 'MM-dd HH:mm') : '',
      expiryDate: d[i][7] ? Utilities.formatDate(new Date(d[i][7]), 'Asia/Kuala_Lumpur', 'MM-dd') : '',
      waStatus: waStatus,
      waSentTime: d[i][9] ? Utilities.formatDate(new Date(d[i][9]), 'Asia/Kuala_Lumpur', 'MM-dd HH:mm') : ''
    });
  }
  
  records.reverse();
  return { records: records.slice(0, 50), pending: pending, sent: sent };
}

function sendWhatsAppByCode(code, sessionToken) {
  var session = validateSession(sessionToken);
  if (!session) return { success: false, message: '会话已过期，请重新登录' };
  // 权限检查：Staff不可发WA
  if (session.role === 'Staff') return { success: false, message: '无权限发送WhatsApp' };

  var sh = getSheet(SH.RECORDS);
  var d = sh.getDataRange().getValues();

  for (var i = 1; i < d.length; i++) {
    if (d[i][6] && String(d[i][6]).toUpperCase() === code.toUpperCase()) {
      sh.getRange(i + 1, 9).setValue('已发送');
      sh.getRange(i + 1, 10).setValue(new Date());

      var phone = d[i][3];
      var prize = d[i][5];
      var expiry = d[i][7] ? Utilities.formatDate(new Date(d[i][7]), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd') : '';

      var waAlreadySent = d[i][8] === '已发送';
      addLog(session.name, session.role, waAlreadySent ? 'WhatsApp重发' : 'WhatsApp发送', (waAlreadySent ? '重发' : '发送') + ': ' + code + ' -> ' + phone);

      var msg = buildWAMessage(waAlreadySent ? 'resend' : 'send', prize, code, expiry);
      var waLink = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg);

      return { success: true, message: '已标记发送', phone: phone, waLink: waLink };
    }
  }
  return { success: false, message: '未找到验证码' };
}

// 统计
function getStatistics() {
  var rec = getSheet(SH.RECORDS).getDataRange().getValues();
  var usr = getSheet(SH.USERS).getDataRange().getValues();
  
  var today = Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');
  var todayDraws = 0, verified = 0, pending = 0, waPending = 0;
  
  for (var i = 1; i < rec.length; i++) {
    if (rec[i][1] && Utilities.formatDate(new Date(rec[i][1]), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd') === today) todayDraws++;
    if (rec[i][10] === '已核销') verified++;
    else if (rec[i][10] === '未核销') pending++;
    if ((rec[i][8] === '待发送' || !rec[i][8]) && rec[i][10] === '未核销') waPending++;
  }
  
  return {
    totalUsers: usr.length - 1,
    totalDraws: rec.length - 1,
    todayDraws: todayDraws,
    verified: verified,
    pending: pending,
    waPending: waPending,
    verifyRate: rec.length > 1 ? Math.round(verified / (rec.length - 1) * 100) : 0
  };
}

// ============ 详细统计 ============
function getDetailedStats() {
  var rec = getSheet(SH.RECORDS).getDataRange().getValues();
  var usr = getSheet(SH.USERS).getDataRange().getValues();
  var pz = getSheet(SH.PRIZES).getDataRange().getValues();
  var tz = 'Asia/Kuala_Lumpur';
  var now = new Date();
  var todayStr = Utilities.formatDate(now, tz, 'yyyy-MM-dd');

  // ---- 用户统计 ----
  var todayNewUsers = 0;
  for (var u = 1; u < usr.length; u++) {
    if (usr[u][4] && Utilities.formatDate(new Date(usr[u][4]), tz, 'yyyy-MM-dd') === todayStr) todayNewUsers++;
  }

  // ---- 抽奖统计 (最近7天) ----
  var dailyDraws = {};
  var dailyNewUsers = {};
  for (var d = 6; d >= 0; d--) {
    var dt = new Date(now); dt.setDate(dt.getDate() - d);
    var key = Utilities.formatDate(dt, tz, 'MM-dd');
    dailyDraws[key] = 0;
    dailyNewUsers[key] = 0;
  }
  for (var r = 1; r < rec.length; r++) {
    if (rec[r][1]) {
      var k = Utilities.formatDate(new Date(rec[r][1]), tz, 'MM-dd');
      if (dailyDraws.hasOwnProperty(k)) dailyDraws[k]++;
    }
  }
  for (var u2 = 1; u2 < usr.length; u2++) {
    if (usr[u2][4]) {
      var k2 = Utilities.formatDate(new Date(usr[u2][4]), tz, 'MM-dd');
      if (dailyNewUsers.hasOwnProperty(k2)) dailyNewUsers[k2]++;
    }
  }

  // ---- 奖品统计 ----
  var prizeStats = [];
  for (var p = 1; p < pz.length; p++) {
    if (pz[p][0]) {
      prizeStats.push({
        name: pz[p][1],
        icon: pz[p][2] || '🎁',
        total: pz[p][3] || 0,
        used: pz[p][4] || 0,
        remaining: (pz[p][3] || 0) - (pz[p][4] || 0),
        status: pz[p][9] || '启用'
      });
    }
  }

  // ---- 今日抽奖次数 & 核销 ----
  var todayDraws2 = 0, todayVerified = 0, totalVerified = 0, totalPending = 0;
  for (var r2 = 1; r2 < rec.length; r2++) {
    if (rec[r2][1] && Utilities.formatDate(new Date(rec[r2][1]), tz, 'yyyy-MM-dd') === todayStr) todayDraws2++;
    if (rec[r2][10] === '已核销') { totalVerified++; if (rec[r2][11] && Utilities.formatDate(new Date(rec[r2][11]), tz, 'yyyy-MM-dd') === todayStr) todayVerified++; }
    if (rec[r2][10] === '未核销') totalPending++;
  }

  var drawDates = Object.keys(dailyDraws);
  var drawCounts = drawDates.map(function(k) { return dailyDraws[k]; });
  var userCounts = drawDates.map(function(k) { return dailyNewUsers[k]; });

  return {
    totalUsers: usr.length - 1,
    todayNewUsers: todayNewUsers,
    totalDraws: rec.length - 1,
    todayDraws: todayDraws2,
    todayVerified: todayVerified,
    totalVerified: totalVerified,
    totalPending: totalPending,
    verifyRate: rec.length > 1 ? Math.round(totalVerified / (rec.length - 1) * 100) : 0,
    dates: drawDates,
    drawCounts: drawCounts,
    userCounts: userCounts,
    prizeStats: prizeStats
  };
}

// 获取抽奖页奖品列表（前端显示用）
function getLotteryPrizes() {
  var d = getSheet(SH.PRIZES).getDataRange().getValues();
  var prizes = [];
  for (var i = 1; i < d.length; i++) {
    if (d[i][0] && d[i][9] === '启用') {
      prizes.push({
        name: d[i][1],
        icon: d[i][2] || '🎁',
        isGrand: d[i][8] === true || d[i][8] === 'TRUE' || d[i][8] === '是'
      });
    }
  }
  return prizes;
}

// 奖品配置
function getPrizeConfig() {
  var d = getSheet(SH.PRIZES).getDataRange().getValues();
  var prizes = [];
  
  for (var i = 1; i < d.length; i++) {
    if (d[i][0]) {
      prizes.push({
        row: i + 1,
        id: d[i][0],
        name: d[i][1],
        icon: d[i][2] || '🎁',
        totalStock: d[i][3] || 0,
        usedStock: d[i][4] || 0,
        remaining: (d[i][3] || 0) - (d[i][4] || 0),
        weight: d[i][6] || 0,
        value: d[i][7] || 0,
        isGrand: d[i][8] === true || d[i][8] === 'TRUE' || d[i][8] === '是',
        status: d[i][9] || '启用',
        position: d[i][10] || i
      });
    }
  }
  return prizes;
}

function savePrizeConfig(prizes) {
  var sh = getSheet(SH.PRIZES);
  
  for (var i = 0; i < prizes.length; i++) {
    var p = prizes[i];
    sh.getRange(p.row, 2).setValue(p.name);
    sh.getRange(p.row, 3).setValue(p.icon);
    sh.getRange(p.row, 4).setValue(p.totalStock);
    sh.getRange(p.row, 7).setValue(p.weight);
    if (p.value !== undefined) sh.getRange(p.row, 8).setValue(p.value);
    sh.getRange(p.row, 9).setValue(p.isGrand ? '是' : '否');
    sh.getRange(p.row, 10).setValue(p.status);
  }
  
  return { success: true, message: '保存成功' };
}

function addPrize(name, icon, stock, weight, value, isGrand) {
  var sh = getSheet(SH.PRIZES);
  var id = 'P' + Utilities.getUuid().substring(0, 6);
  var newRow = sh.getLastRow() + 1;
  sh.appendRow([id, name, icon || '🎁', stock, 0, '=D' + newRow + '-E' + newRow, weight, value, isGrand ? '是' : '否', '启用', newRow - 1]);
  return { success: true, message: '添加成功' };
}

// 员工管理
function getStaffList() {
  var d = getSheet(SH.STAFF).getDataRange().getValues();
  var staff = [];
  
  for (var i = 1; i < d.length; i++) {
    staff.push({
      row: i + 1,
      id: d[i][0],
      name: d[i][1],
      username: d[i][2],
      role: d[i][4],
      status: d[i][5],
      lastLogin: d[i][7] ? Utilities.formatDate(new Date(d[i][7]), 'Asia/Kuala_Lumpur', 'MM-dd HH:mm') : '从未'
    });
  }
  return staff;
}

function addStaff(name, username, password, role) {
  var sh = getSheet(SH.STAFF);
  var id = 'S' + Utilities.getUuid().substring(0, 6);
  sh.appendRow([id, name, username, hashPassword(password), role, '启用', new Date(), '']);
  return { success: true, message: '添加成功' };
}

function updateStaffStatus(row, status) {
  getSheet(SH.STAFF).getRange(row, 6).setValue(status);
  return { success: true };
}

function updateStaff(row, name, username, password, role) {
  var sh = getSheet(SH.STAFF);
  sh.getRange(row, 2).setValue(name);
  sh.getRange(row, 3).setValue(username);
  if (password) sh.getRange(row, 4).setValue(hashPassword(password));
  sh.getRange(row, 5).setValue(role);
  return { success: true, message: '员工信息已更新' };
}

function deleteStaff(row) {
  var sh = getSheet(SH.STAFF);
  sh.deleteRow(row);
  return { success: true, message: '员工已删除' };
}

// ============ WhatsApp 模板 ============
function getWATemplates() {
  var sh = getSheet('系统设置');
  var d = sh.getDataRange().getValues();
  var templates = {
    send: '\u3010\u5F20\u5D07\u4F1A\u706B\u9505\u3011\n\n\u606D\u559C\u4F60\u4E2D\u5956\u5566\uFF01\u592A\u68D2\u4E86 ~\n\n* \u4F60\u62BD\u5230\u7684\u5956\u54C1\u662F\uFF1A*{prize}*\n* \u5151\u6362\u9A8C\u8BC1\u7801\uFF1A*{code}*\n* \u4F7F\u7528\u6709\u6548\u671F\u5230\uFF1A*{expiry}*\n\n>> \u5151\u6362\u5730\u70B9\uFF1A\u5F20\u5D07\u4F1A\u706B\u9505\u767E\u4E07\u9547\u5206\u5E97\n>> \u4EC5\u9650\u5468\u4E00\u81F3\u5468\u56DB\u5802\u98DF\u4F7F\u7528\n>> \u4E00\u5F20\u6D88\u8D39\u5355\u53EA\u80FD\u5151\u6362 1 \u4EFD\u5956\u54C1\n\n\u8FD9\u662F\u4F60\u7684\u5151\u6362\u4E8C\u7EF4\u7801\uFF08\u70B9\u5F00\u7ED9\u5E97\u5458\u770B\u5C31\u53EF\u4EE5\uFF09\uFF1A\n{qrUrl}\n\n\u5230\u5E97\u540E\u628A\u8FD9\u4E2A WhatsApp \u4FE1\u606F\u6216\u4E8C\u7EF4\u7801\u51FA\u793A\u7ED9\u5E97\u5458\u626B\u63CF\u5373\u53EF\n\u6B22\u8FCE\u4F60\u56DE\u6765\u5403\u706B\u9505\uFF0C\u795D\u4F60\u65B0\u5E74\u597D\u8FD0\uFF5E',
    resend: '\u3010\u5F20\u5D07\u4F1A\u706B\u9505 \u00B7 \u5E2E\u4F60\u91CD\u53D1\u9A8C\u8BC1\u7801\u54E6\u3011\n\n\u4E0D\u597D\u610F\u601D\uFF0C\u521A\u521A\u53EF\u80FD\u6CA1\u6536\u5230\uFF5E\n\u8FD9\u8FB9\u518D\u5E2E\u4F60\u91CD\u53D1\u4E00\u6B21\u4F60\u7684\u4E2D\u5956\u4FE1\u606F\n\n* \u4F60\u62BD\u5230\u7684\u5956\u54C1\u662F\uFF1A*{prize}*\n* \u5151\u6362\u9A8C\u8BC1\u7801\uFF1A*{code}*\n* \u4F7F\u7528\u6709\u6548\u671F\u5230\uFF1A*{expiry}*\n\n>> \u5151\u6362\u5730\u70B9\uFF1A\u5F20\u5D07\u4F1A\u706B\u9505\u767E\u4E07\u9547\u5206\u5E97\n>> \u4EC5\u9650\u5468\u4E00\u81F3\u5468\u56DB\u5802\u98DF\u4F7F\u7528\n>> \u4E00\u5F20\u6D88\u8D39\u5355\u53EA\u80FD\u5151\u6362 1 \u4EFD\u5956\u54C1\n\n\u8FD9\u662F\u4F60\u7684\u5151\u6362\u4E8C\u7EF4\u7801\uFF08\u70B9\u5F00\u7ED9\u5E97\u5458\u770B\u5C31\u53EF\u4EE5\uFF09\uFF1A\n{qrUrl}\n\n\u5230\u5E97\u540E\u628A\u8FD9\u4E2A WhatsApp \u4FE1\u606F\u6216\u4E8C\u7EF4\u7801\u51FA\u793A\u7ED9\u5E97\u5458\u626B\u63CF\u5373\u53EF\n\u6B22\u8FCE\u4F60\u56DE\u6765\u5403\u706B\u9505\uFF0C\u795D\u4F60\u65B0\u5E74\u597D\u8FD0\uFF5E',
    reminder: '\u3010\u5F20\u5D07\u4F1A\u706B\u9505 \u00B7 \u6E29\u99A8\u63D0\u9192\u3011\n\n\u4F60\u6709\u4E00\u4EFD\u5956\u54C1\u5FEB\u8981\u8FC7\u671F\u4E86\u54E6\uFF01\n\n* \u5956\u54C1\uFF1A*{prize}*\n* \u9A8C\u8BC1\u7801\uFF1A*{code}*\n* \u6709\u6548\u671F\u5230\uFF1A*{expiry}*\uFF08\u5269\u4F597\u5929\uFF09\n\n>> \u5151\u6362\u5730\u70B9\uFF1A\u5F20\u5D07\u4F1A\u706B\u9505\u767E\u4E07\u9547\u5206\u5E97\n>> \u4EC5\u9650\u5468\u4E00\u81F3\u5468\u56DB\u5802\u98DF\u4F7F\u7528\n\n\u8FD9\u662F\u4F60\u7684\u5151\u6362\u4E8C\u7EF4\u7801\uFF1A\n{qrUrl}\n\n\u8D76\u7D27\u6765\u5403\u706B\u9505\u5427\uFF0C\u8FC7\u671F\u5C31\u4F5C\u5E9F\u4E86\u54E6\uFF01'
  };

  for (var i = 1; i < d.length; i++) {
    if (d[i][0] === 'waTplSend') templates.send = d[i][1];
    if (d[i][0] === 'waTplResend') templates.resend = d[i][1];
    if (d[i][0] === 'waTplReminder') templates.reminder = d[i][1];
  }
  return templates;
}

function saveWATemplates(send, resend, reminder) {
  var sh = getSheet('系统设置');
  var d = sh.getDataRange().getValues();
  var rows = { waTplSend: 0, waTplResend: 0, waTplReminder: 0 };

  for (var i = 1; i < d.length; i++) {
    if (rows.hasOwnProperty(d[i][0])) rows[d[i][0]] = i + 1;
  }

  var vals = { waTplSend: send, waTplResend: resend, waTplReminder: reminder };
  var labels = { waTplSend: 'WA发送模板', waTplResend: 'WA重发模板', waTplReminder: 'WA到期提醒模板' };

  for (var key in vals) {
    if (rows[key] > 0) {
      sh.getRange(rows[key], 2).setValue(vals[key]);
    } else {
      sh.appendRow([key, vals[key], labels[key]]);
    }
  }

  addLog('Admin', '', '更新WA模板', '已更新WhatsApp消息模板');
  return { success: true, message: '模板保存成功' };
}

function resetWATemplates() {
  var sh = getSheet('系统设置');
  var d = sh.getDataRange().getValues();
  for (var i = d.length - 1; i >= 1; i--) {
    if (d[i][0] === 'waTplSend' || d[i][0] === 'waTplResend' || d[i][0] === 'waTplReminder') {
      sh.deleteRow(i + 1);
    }
  }
  return '已重置WhatsApp模板为默认版本';
}

function buildWAMessage(type, prize, code, expiry) {
  var templates = getWATemplates();
  var tpl = templates[type] || templates.send;
  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(code);
  return tpl.replace(/\{prize\}/g, prize).replace(/\{code\}/g, code).replace(/\{expiry\}/g, expiry).replace(/\{qrUrl\}/g, qrUrl);
}

// ============ 手动加积分 ============
function addPointsManual(phone, pts, sessionToken) {
  var session = validateSession(sessionToken);
  if (!session) return { success: false, message: '会话已过期，请重新登录' };
  // Manager+ 可以加积分
  if (session.role === 'Staff') return { success: false, message: '无权限操作' };

  var v = validatePhone(phone);
  if (!v.valid) return { success: false, message: '手机号格式错误' };

  // 确认用户存在
  var ush = getSheet(SH.USERS);
  var ud = ush.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < ud.length; i++) {
    if (String(ud[i][1]) === v.phone) { found = true; break; }
  }
  if (!found) return { success: false, message: '用户不存在: ' + v.phone };

  pts = Math.floor(Number(pts));
  if (pts < 1 || pts > 100) return { success: false, message: '积分数量须为1-100' };

  addPointsToUser(v.phone, pts, '管理员添加');
  addLog(session.name, session.role, '手动加积分', v.phone + ' +' + pts + '分');
  return { success: true, message: '成功添加 ' + pts + ' 积分给 ' + v.phone };
}

function addPointsToAll(pts, sessionToken) {
  var session = validateSession(sessionToken);
  if (!session) return { success: false, message: '会话已过期，请重新登录' };
  // 只有 Boss/Admin 可以全员加积分
  if (session.role !== 'Boss' && session.role !== 'Admin') return { success: false, message: '无权限操作' };

  pts = Math.floor(Number(pts));
  if (pts < 1 || pts > 10) return { success: false, message: '全员加积分数量须为1-10' };

  var ush = getSheet(SH.USERS);
  var ud = ush.getDataRange().getValues();
  var count = 0;
  for (var i = 1; i < ud.length; i++) {
    if (ud[i][14] === '正常') {
      addPointsToUser(String(ud[i][1]), pts, '全员派发');
      count++;
    }
  }
  addLog(session.name, session.role, '全员加积分', '全员+' + pts + '分, 共' + count + '人');
  return { success: true, message: '成功给 ' + count + ' 位用户各添加 ' + pts + ' 积分' };
}

// ============ 到期提醒 ============
function sendExpiryReminders() {
  var sh = getSheet(SH.RECORDS);
  var d = sh.getDataRange().getValues();
  var today = new Date();
  var reminders = [];

  for (var i = 1; i < d.length; i++) {
    if (d[i][10] !== '未核销') continue;
    if (!d[i][7]) continue;

    var expiry = new Date(d[i][7]);
    var daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));

    if (daysLeft === 7) {
      var phone = d[i][3];
      var prize = d[i][5];
      var code = d[i][6];
      var expiryStr = Utilities.formatDate(expiry, 'Asia/Kuala_Lumpur', 'yyyy-MM-dd');

      var msg = buildWAMessage('reminder', prize, code, expiryStr);

      reminders.push({
        phone: phone,
        code: code,
        prize: prize,
        expiry: expiryStr,
        waLink: 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg)
      });

      addLog('System', '', '到期提醒', '提醒: ' + code + ' -> ' + phone + ' (7天后到期)');
    }
  }

  return reminders;
}

// 获取即将过期的积分和奖品列表 (7天内)
function getExpiryAlerts(sessionToken) {
  var session = validateSession(sessionToken);
  if (!session) return { success: false, message: '会话已过期，请重新登录' };
  if (session.role === 'Staff') return { success: false, message: '无权限查看' };

  var tz = 'Asia/Kuala_Lumpur';
  var now = new Date();
  var alerts = [];

  // 1. 奖品验证码即将过期 (7天内到期 + 未核销)
  var rsh = getSheet(SH.RECORDS);
  var rd = rsh.getDataRange().getValues();
  for (var i = 1; i < rd.length; i++) {
    if (rd[i][10] !== '未核销') continue;
    if (!rd[i][7]) continue;
    var expiry = new Date(rd[i][7]);
    var daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    if (daysLeft >= 0 && daysLeft <= 7) {
      var phone = String(rd[i][3]);
      var prize = rd[i][5];
      var code = rd[i][6];
      var expiryStr = Utilities.formatDate(expiry, tz, 'yyyy-MM-dd');
      var msg = buildWAMessage('reminder', prize, code, expiryStr);
      alerts.push({
        type: 'prize',
        phone: phone,
        name: rd[i][4] || '',
        code: code,
        prize: prize,
        expiry: expiryStr,
        daysLeft: daysLeft,
        waLink: 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg)
      });
    }
  }

  // 2. 积分即将过期 (7天内到期 + 有剩余)
  var psh = getSheet(SH.POINTS);
  var pd = psh.getDataRange().getValues();
  // 按用户合并: 同一用户多条积分快到期，合并成一条提醒
  var userPoints = {};
  for (var j = 1; j < pd.length; j++) {
    var remaining = pd[j][5] || 0;
    if (remaining <= 0) continue;
    var pExpiry = pd[j][3] ? new Date(pd[j][3]) : null;
    if (!pExpiry) continue;
    var pDaysLeft = Math.ceil((pExpiry - now) / (1000 * 60 * 60 * 24));
    if (pDaysLeft >= 0 && pDaysLeft <= 7) {
      var pPhone = String(pd[j][1]);
      if (!userPoints[pPhone]) {
        userPoints[pPhone] = { totalExpiring: 0, earliestExpiry: pExpiry, daysLeft: pDaysLeft };
      }
      userPoints[pPhone].totalExpiring += remaining;
      if (pExpiry < userPoints[pPhone].earliestExpiry) {
        userPoints[pPhone].earliestExpiry = pExpiry;
        userPoints[pPhone].daysLeft = pDaysLeft;
      }
    }
  }

  // 查找用户姓名
  var ush = getSheet(SH.USERS);
  var ud = ush.getDataRange().getValues();
  var userNames = {};
  for (var u = 1; u < ud.length; u++) {
    userNames[String(ud[u][1])] = ud[u][2] || '';
  }

  for (var ph in userPoints) {
    var info = userPoints[ph];
    var expiryDate = Utilities.formatDate(info.earliestExpiry, tz, 'yyyy-MM-dd');
    // 积分到期提醒WhatsApp模板
    var ptMsg = '【张崇会火锅 · 温馨提醒】\n\n'
      + '你有 *' + info.totalExpiring + '* 个积分即将在 *' + expiryDate + '* 过期哦！\n\n'
      + '赶紧来抽奖使用吧，过期就作废了！\n\n'
      + '>> 抽奖链接：tinyurl.com/HuiHotpotPermasJaya';
    alerts.push({
      type: 'points',
      phone: ph,
      name: userNames[ph] || '',
      points: info.totalExpiring,
      expiry: expiryDate,
      daysLeft: info.daysLeft,
      waLink: 'https://wa.me/' + ph + '?text=' + encodeURIComponent(ptMsg)
    });
  }

  // 按剩余天数排序 (越快到期越前)
  alerts.sort(function(a, b) { return a.daysLeft - b.daysLeft; });

  return { success: true, alerts: alerts };
}

function setupExpiryReminderTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendExpiryReminders') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('sendExpiryReminders')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
  return { success: true, message: '已设置每日9点自动检查到期提醒' };
}

// ============ 获取部署URL ============
function getDeploymentUrl() {
  return ScriptApp.getService().getUrl();
}

// ============ 音乐设置 ============
function getMusicSettings() {
  var sh = getSheet('系统设置');
  var d = sh.getDataRange().getValues();
  var settings = {
    bgMusicUrl: '',
    firecrackerUrl: '',
    musicEnabled: true
  };
  
  for (var i = 1; i < d.length; i++) {
    if (d[i][0] === 'bgMusicUrl') settings.bgMusicUrl = d[i][1] || '';
    if (d[i][0] === 'firecrackerUrl') settings.firecrackerUrl = d[i][1] || '';
    if (d[i][0] === 'musicEnabled') settings.musicEnabled = d[i][1] !== 'false';
  }
  
  return settings;
}

function saveMusicSettings(bgMusicUrl, firecrackerUrl, musicEnabled) {
  var sh = getSheet('系统设置');
  var d = sh.getDataRange().getValues();
  
  var bgRow = 0, fcRow = 0, enRow = 0;
  for (var i = 1; i < d.length; i++) {
    if (d[i][0] === 'bgMusicUrl') bgRow = i + 1;
    if (d[i][0] === 'firecrackerUrl') fcRow = i + 1;
    if (d[i][0] === 'musicEnabled') enRow = i + 1;
  }
  
  if (bgRow > 0) {
    sh.getRange(bgRow, 2).setValue(bgMusicUrl);
  } else {
    sh.appendRow(['bgMusicUrl', bgMusicUrl, '背景音乐URL']);
  }
  
  if (fcRow > 0) {
    sh.getRange(fcRow, 2).setValue(firecrackerUrl);
  } else {
    sh.appendRow(['firecrackerUrl', firecrackerUrl, '鞭炮音效URL']);
  }
  
  if (enRow > 0) {
    sh.getRange(enRow, 2).setValue(musicEnabled ? 'true' : 'false');
  } else {
    sh.appendRow(['musicEnabled', musicEnabled ? 'true' : 'false', '是否启用音乐']);
  }
  
  addLog('Admin', '', '更新音乐设置', '背景音乐: ' + (bgMusicUrl ? '已设置' : '默认'));
  return { success: true, message: '音乐设置已保存' };
}

// ============ 初始化系统 ============
function initializeSystem() {
  // 创建所有表
  for (var k in SH) getSheet(SH[k]);
  
  // 添加默认奖品（15个）
  var pz = getSheet(SH.PRIZES);
  if (pz.getLastRow() <= 1) {
    var defaultPrizes = [
      ['P001', '200元霸王餐', '👑', 2, 0, '=D2-E2', 1, 200, '是', '启用', 1],
      ['P002', '特级肥牛', '🥩', 15, 0, '=D3-E3', 3, 58, '是', '启用', 2],
      ['P003', '精品毛肚', '🫀', 20, 0, '=D4-E4', 5, 38, '否', '启用', 3],
      ['P004', '鲜切羊肉', '🐑', 20, 0, '=D5-E5', 5, 35, '否', '启用', 4],
      ['P005', '手工虾滑', '🦐', 25, 0, '=D6-E6', 8, 28, '否', '启用', 5],
      ['P006', '五花肉', '🥓', 50, 0, '=D7-E7', 20, 18, '否', '启用', 6],
      ['P007', '时蔬拼盘', '🥬', 50, 0, '=D8-E8', 20, 15, '否', '启用', 7],
      ['P008', '暴打柠檬茶', '🍋', 60, 0, '=D9-E9', 25, 9, '否', '启用', 8],
      ['P009', '酸梅汤', '🧃', 60, 0, '=D10-E10', 25, 8, '否', '启用', 9],
      ['P010', '冰豆花', '🍮', 60, 0, '=D11-E11', 25, 6, '否', '启用', 10],
      ['P011', '绵绵冰', '🍧', 60, 0, '=D12-E12', 25, 12, '否', '启用', 11],
      ['P012', '10元代金券', '🎫', 80, 0, '=D13-E13', 30, 10, '否', '启用', 12],
      ['P013', '5元代金券', '🎟️', 100, 0, '=D14-E14', 35, 5, '否', '启用', 13],
      ['P014', '小食一份', '🍿', 50, 0, '=D15-E15', 20, 8, '否', '启用', 14],
      ['P015', '麻辣锅底', '🍲', 10, 0, '=D16-E16', 2, 45, '是', '启用', 15]
    ];
    defaultPrizes.forEach(function(r) { pz.appendRow(r); });
  }
  
  // 添加默认员工
  var sf = getSheet(SH.STAFF);
  if (sf.getLastRow() <= 1) {
    var p1 = generateStrongPassword();
    var p2 = generateStrongPassword();
    var p3 = generateStrongPassword();
    sf.appendRow(['S001', '老板', 'boss', p1, 'Admin', '启用', new Date(), '']);
    sf.appendRow(['S002', '经理', 'manager', p2, 'Manager', '启用', new Date(), '']);
    sf.appendRow(['S003', '员工', 'staff', p3, 'Staff', '启用', new Date(), '']);
    return '✅ 系统初始化完成！默认账号密码：\nboss: ' + p1 + '\nmanager: ' + p2 + '\nstaff: ' + p3 + '\n⚠️ 请立即记录并修改密码！';
  }

  return '✅ 系统初始化完成！包含15个奖品和默认员工账号';
}

// ============ 压力测试 ============
function loadTest100() {
  var results = { success: 0, fail: 0, errors: [], prizeCount: {}, timings: [] };
  var testPhones = [];

  // 1. 注册100个测试用户（60199开头，符合MY手机格式 60[1-9]XXXXXXXX）
  for (var i = 0; i < 100; i++) {
    var phone = '60199' + String(100000 + i);
    testPhones.push(phone);
  }

  // 批量注册
  var sh = getSheet(SH.USERS);
  var existingData = sh.getDataRange().getValues();
  var existingPhones = {};
  for (var e = 1; e < existingData.length; e++) {
    existingPhones[String(existingData[e][1])] = true;
  }

  var registered = 0;
  for (var r = 0; r < testPhones.length; r++) {
    if (!existingPhones[testPhones[r]]) {
      var uid = 'T' + String(r).padStart(4, '0');
      var code = 'TEST' + String(r).padStart(4, '0');
      var now = new Date();
      var expiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      sh.appendRow([uid, testPhones[r], '测试用户' + r, '', now, 3, expiry, 3, code, '', 0, 0, 0, '', '正常']);
      registered++;
    } else {
      // 确保有积分
      for (var x = 1; x < existingData.length; x++) {
        if (String(existingData[x][1]) === testPhones[r]) {
          sh.getRange(x + 1, 6).setValue(3);
          sh.getRange(x + 1, 13).setValue(0); // 重置今日次数
          break;
        }
      }
    }
  }
  SpreadsheetApp.flush();

  // 2. 记录测试前库存
  var psh = getSheet(SH.PRIZES);
  var beforePd = psh.getDataRange().getValues();
  var beforeStock = {};
  for (var b = 1; b < beforePd.length; b++) {
    beforeStock[beforePd[b][1]] = { total: beforePd[b][3] || 0, used: beforePd[b][4] || 0 };
  }

  // 3. 执行100次抽奖（顺序执行，模拟高频）
  var startTime = new Date().getTime();
  for (var t = 0; t < 100; t++) {
    var tStart = new Date().getTime();
    try {
      var res = doLottery(testPhones[t]);
      var tEnd = new Date().getTime();
      results.timings.push(tEnd - tStart);

      if (res.success) {
        results.success++;
        var pName = res.prize.name;
        results.prizeCount[pName] = (results.prizeCount[pName] || 0) + 1;
      } else {
        results.fail++;
        results.errors.push('#' + (t + 1) + ': ' + res.message);
      }
    } catch(err) {
      results.fail++;
      results.errors.push('#' + (t + 1) + ': EXCEPTION: ' + err.toString());
    }
  }
  var totalTime = new Date().getTime() - startTime;

  // 3.5 将测试记录的WA状态标记为"测试"，防止真实发送
  var rshMark = getSheet(SH.RECORDS);
  var rDataMark = rshMark.getDataRange().getValues();
  for (var m = 1; m < rDataMark.length; m++) {
    if (String(rDataMark[m][3]).indexOf('60199') === 0 && rDataMark[m][8] === '待发送') {
      rshMark.getRange(m + 1, 9).setValue('测试');
      rshMark.getRange(m + 1, 14).setValue('压力测试生成');
    }
  }
  SpreadsheetApp.flush();

  // 4. 验证库存一致性
  SpreadsheetApp.flush();
  var afterPd = psh.getDataRange().getValues();
  var stockIssues = [];
  var totalIssued = 0;
  for (var a = 1; a < afterPd.length; a++) {
    var name = afterPd[a][1];
    var afterUsed = afterPd[a][4] || 0;
    var beforeUsed = beforeStock[name] ? beforeStock[name].used : 0;
    var issued = afterUsed - beforeUsed;
    totalIssued += issued;
    var totalStock = afterPd[a][3] || 0;
    if (afterUsed > totalStock) {
      stockIssues.push(name + ': 超发! 已发' + afterUsed + '/总' + totalStock);
    }
  }

  // 5. 计算统计
  var avgTime = results.timings.length > 0 ? Math.round(results.timings.reduce(function(a, b) { return a + b; }, 0) / results.timings.length) : 0;
  var maxTime = results.timings.length > 0 ? Math.max.apply(null, results.timings) : 0;
  var minTime = results.timings.length > 0 ? Math.min.apply(null, results.timings) : 0;

  return {
    summary: '100次抽奖完成',
    registered: registered + '个新测试用户',
    successCount: results.success,
    failCount: results.fail,
    totalTime: totalTime + 'ms (' + (totalTime / 1000).toFixed(1) + '秒)',
    avgTime: avgTime + 'ms/次',
    minTime: minTime + 'ms',
    maxTime: maxTime + 'ms',
    totalIssued: totalIssued,
    matchSuccess: totalIssued === results.success ? '✅ 库存一致' : '❌ 库存不一致! 发出' + totalIssued + ' vs 成功' + results.success,
    stockIssues: stockIssues.length > 0 ? stockIssues : ['✅ 无超发'],
    prizeDistribution: results.prizeCount,
    errors: results.errors.length > 10 ? results.errors.slice(0, 10).concat(['... 共' + results.errors.length + '个错误']) : results.errors
  };
}

// 清理测试数据
function cleanTestData() {
  // 删除测试用户（60199开头和旧的6090开头）
  var sh = getSheet(SH.USERS);
  var data = sh.getDataRange().getValues();
  var rowsToDelete = [];
  for (var i = data.length - 1; i >= 1; i--) {
    var ph = String(data[i][1]);
    if (ph.indexOf('60199') === 0 || ph.indexOf('6090') === 0) rowsToDelete.push(i + 1);
  }
  for (var d = 0; d < rowsToDelete.length; d++) {
    sh.deleteRow(rowsToDelete[d]);
  }

  // 删除测试抽奖记录
  var rsh = getSheet(SH.RECORDS);
  var rdata = rsh.getDataRange().getValues();
  var recRowsToDelete = [];
  for (var r = rdata.length - 1; r >= 1; r--) {
    var rph = String(rdata[r][3]);
    if (rph.indexOf('60199') === 0 || rph.indexOf('6090') === 0) recRowsToDelete.push(r + 1);
  }
  for (var rd = 0; rd < recRowsToDelete.length; rd++) {
    rsh.deleteRow(recRowsToDelete[rd]);
  }

  // 重新计算已发数量
  var psh = getSheet(SH.PRIZES);
  var pd = psh.getDataRange().getValues();
  var remainingRecords = rsh.getDataRange().getValues();
  for (var p = 1; p < pd.length; p++) {
    var prizeName = pd[p][1];
    var count = 0;
    for (var rc = 1; rc < remainingRecords.length; rc++) {
      if (remainingRecords[rc][5] === prizeName) count++;
    }
    psh.getRange(p + 1, 5).setValue(count);
  }

  return '✅ 测试数据已清理（删除' + rowsToDelete.length + '个测试用户，' + recRowsToDelete.length + '条抽奖记录，库存已重算）';
}

// ============ 积分数据迁移 (旧→新) ============
// 在 Apps Script 编辑器手动运行一次: 将用户表的旧积分迁移到积分明细表
function migratePointsToDetail() {
  var ush = getSheet(SH.USERS);
  var ud = ush.getDataRange().getValues();
  var psh = getSheet(SH.POINTS);
  var now = new Date();
  var count = 0;

  for (var i = 1; i < ud.length; i++) {
    var phone = String(ud[i][1]);
    var points = ud[i][5] || 0;
    var expiry = ud[i][6] ? new Date(ud[i][6]) : null;

    if (points > 0) {
      // 用旧的过期时间; 如果没有, 按90天算
      var useExpiry = expiry || new Date(now.getTime() + POINTS_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      var regTime = ud[i][4] ? new Date(ud[i][4]) : now;
      var id = 'PT' + Utilities.getUuid().substring(0, 8);
      psh.appendRow([id, phone, regTime, useExpiry, points, points, '迁移']);
      count++;
    }
    // 清除用户表旧积分字段 (置0, 保留列兼容)
    ush.getRange(i + 1, 6).setValue(0);
    ush.getRange(i + 1, 7).setValue('');
  }
  return '✅ 迁移完成: ' + count + ' 条积分记录已转入积分明细表';
}

// ============ 数据备份 ============
function backupData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = ss.getName() + ' 备份 ' + Utilities.formatDate(new Date(), 'Asia/Kuala_Lumpur', 'yyyy-MM-dd HH:mm');
  var backup = ss.copy(name);
  var folder = DriveApp.getFileById(ss.getId()).getParents();
  if (folder.hasNext()) {
    var parent = folder.next();
    // 尝试放入"备份"子文件夹
    var backupFolders = parent.getFoldersByName('备份');
    var target = backupFolders.hasNext() ? backupFolders.next() : parent.createFolder('备份');
    DriveApp.getFileById(backup.getId()).moveTo(target);
  }
  addLog('System', '', '数据备份', '自动备份: ' + name);
  return '✅ 备份成功: ' + name;
}

// ============ 上线前清空数据 ============
function resetDataForLaunch() {
  // 先备份
  backupData();

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. 清空用户表 (保留表头)
  var users = ss.getSheetByName(SH.USERS);
  if (users && users.getLastRow() > 1) {
    users.deleteRows(2, users.getLastRow() - 1);
  }

  // 2. 清空抽奖记录表 (保留表头)
  var records = ss.getSheetByName(SH.RECORDS);
  if (records && records.getLastRow() > 1) {
    records.deleteRows(2, records.getLastRow() - 1);
  }

  // 3. 清空邀请记录表 (保留表头)
  var invites = ss.getSheetByName(SH.INVITES);
  if (invites && invites.getLastRow() > 1) {
    invites.deleteRows(2, invites.getLastRow() - 1);
  }

  // 4. 奖品表：已抽数量重置为0
  var prizes = ss.getSheetByName(SH.PRIZES);
  if (prizes && prizes.getLastRow() > 1) {
    var range = prizes.getRange(2, 5, prizes.getLastRow() - 1, 1); // E列=已抽
    var values = range.getValues();
    for (var i = 0; i < values.length; i++) {
      values[i][0] = 0;
    }
    range.setValues(values);
  }

  addLog('System', '', '数据重置', '上线前清空: 用户/记录/邀请/奖品已抽');
  return '✅ 数据已清空，可以上线了！';
}

function setupBackupTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'backupData') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('backupData')
    .timeBased()
    .everyDays(1)
    .atHour(3) // 凌晨3点备份
    .create();
  return { success: true, message: '已设置每日凌晨3点自动备份' };
}

// ============ 音乐代理 ============
function proxyAudioUrl(url) {
  try {
    // Convert Google Drive view/share URLs to direct download
    var match = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) url = 'https://drive.google.com/uc?export=download&id=' + match[1];
    if (url.indexOf('drive.google.com') >= 0 && url.indexOf('id=') >= 0 && url.indexOf('export=download') < 0) {
      var idMatch = url.match(/id=([a-zA-Z0-9_-]+)/);
      if (idMatch) url = 'https://drive.google.com/uc?export=download&id=' + idMatch[1];
    }

    var response = UrlFetchApp.fetch(url, { followRedirects: true, muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) return null;
    var blob = response.getBlob();
    var bytes = blob.getBytes();

    // Check file size - skip if > 5MB (too large for data URL transfer)
    if (bytes.length > 5 * 1024 * 1024) return null;

    var contentType = blob.getContentType() || 'audio/mpeg';
    // If Google Drive returned HTML (virus scan page), try with confirm param
    if (contentType.indexOf('text/html') >= 0 && url.indexOf('drive.google.com') >= 0) {
      var confirmUrl = url + '&confirm=t';
      response = UrlFetchApp.fetch(confirmUrl, { followRedirects: true, muteHttpExceptions: true });
      if (response.getResponseCode() !== 200) return null;
      blob = response.getBlob();
      bytes = blob.getBytes();
      contentType = blob.getContentType() || 'audio/mpeg';
      if (contentType.indexOf('text/html') >= 0) return null;
      if (bytes.length > 5 * 1024 * 1024) return null;
    }

    var b64 = Utilities.base64Encode(bytes);
    return 'data:' + contentType + ';base64,' + b64;
  } catch(e) {
    return null;
  }
}