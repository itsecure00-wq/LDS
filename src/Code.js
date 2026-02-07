/**
 * 🍲 张崇会火锅 - 新春抽奖系统 v3.0
 * 
 * 功能：15格抽奖、积分30天过期、防重复邀请、权限分级
 */

// ============ Web App 入口 ============
function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'lottery';
  var ref = (e && e.parameter && e.parameter.ref) || '';
  
  if (page === 'admin') {
    return HtmlService.createTemplateFromFile('Admin').evaluate()
      .setTitle('后台管理').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
  LOGS: '操作日志'
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
    '操作日志': ['日志ID','时间','操作员','角色','动作','详情']
  };
  if (h[n]) {
    sh.appendRow(h[n]);
    sh.getRange(1, 1, 1, h[n].length).setBackground('#8B0000').setFontColor('#fff').setFontWeight('bold');
  }
}

function addLog(operator, role, action, detail) {
  var sh = getSheet(SH.LOGS);
  sh.appendRow(['L' + String(sh.getLastRow()).padStart(4, '0'), new Date(), operator, role, action, detail]);
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
      var user = getUserFromRow(data[i], i + 1, sh);
      return { success: true, isNew: false, user: user };
    }
  }
  
  // 新用户注册
  var uid = 'U' + String(sh.getLastRow()).padStart(4, '0');
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
        addPointsToUser(referrer.phone, 1);
        incrementInviteCount(referrer.phone);
        recordInvite(referrer.phone, referrer.name, p, name || '');
        addLog('System', '', '邀请成功', referrer.phone + ' 邀请 ' + p);
      }
    }
  }
  
  sh.appendRow([
    uid, p, name || '', email || '', now,
    1, pointsExpiry, 1, inviteCode, referrerPhone,
    0, 0, 0, '', '正常'
  ]);
  
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

function getUserFromRow(row, rowNum, sh) {
  var now = new Date();
  var points = row[5] || 0;
  var expiry = row[6] ? new Date(row[6]) : null;
  
  // 检查积分是否过期
  if (expiry && now > expiry && points > 0) {
    sh.getRange(rowNum, 6).setValue(0); // 清零积分
    points = 0;
    addLog('System', '', '积分过期', row[1] + ' 积分已过期清零');
  }
  
  return {
    odoo: row[0],
    phone: String(row[1]),
    name: row[2],
    points: points,
    inviteCode: row[8],
    inviteCount: row[10] || 0,
    todayDraws: getTodayDrawCount(String(row[1]))
  };
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

function addPointsToUser(phone, pts) {
  var sh = getSheet(SH.USERS);
  var d = sh.getDataRange().getValues();
  var now = new Date();
  var newExpiry = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][1]) === String(phone)) {
      var current = d[i][5] || 0;
      sh.getRange(i + 1, 6).setValue(current + pts);
      sh.getRange(i + 1, 7).setValue(newExpiry); // 刷新过期时间
      sh.getRange(i + 1, 8).setValue((d[i][7] || 0) + pts);
      return;
    }
  }
}

function deductPoints(phone) {
  var sh = getSheet(SH.USERS);
  var d = sh.getDataRange().getValues();
  
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][1]) === String(phone)) {
      var current = d[i][5] || 0;
      if (current < 1) return false;
      sh.getRange(i + 1, 6).setValue(current - 1);
      return true;
    }
  }
  return false;
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
  var id = 'I' + String(sh.getLastRow()).padStart(4, '0');
  sh.appendRow([id, new Date(), inviterPhone, inviterName, inviteePhone, inviteeName, 1, '成功']);
}

function getTodayDrawCount(phone) {
  var sh = getSheet(SH.RECORDS);
  var d = sh.getDataRange().getValues();
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

function getUserInfo(phone) {
  var v = validatePhone(phone);
  if (!v.valid) return { success: false };
  var p = v.phone;
  
  var sh = getSheet(SH.USERS);
  var d = sh.getDataRange().getValues();
  
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][1]) === p) {
      return { success: true, user: getUserFromRow(d[i], i + 1, sh) };
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
  
  return {
    success: true,
    user: userInfo.user,
    prizes: prizes
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
  
  var u = getUserInfo(p);
  if (!u.success) return { success: false, message: '请先登记' };
  
  if (u.user.todayDraws >= 3) {
    return { success: false, message: '今日已抽3次，明天再来！' };
  }
  
  if (u.user.points < 1) {
    return { success: false, message: '积分不足', inviteCode: u.user.inviteCode };
  }
  
  if (!deductPoints(p)) {
    return { success: false, message: '积分不足', inviteCode: u.user.inviteCode };
  }
  
  // 获取奖品
  var psh = getSheet(SH.PRIZES);
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
    addPointsToUser(p, 1);
    return { success: false, message: '奖品已抽完' };
  }
  
  // 随机选择
  var rnd = Math.random() * totalWeight;
  var selected = available[0];
  for (var j = 0; j < available.length; j++) {
    rnd -= available[j].weight;
    if (rnd <= 0) {
      selected = available[j];
      break;
    }
  }
  
  // 更新库存
  psh.getRange(selected.row, 5).setValue((pd[selected.row - 1][4] || 0) + 1);
  
  // 生成验证码
  var code = 'ZCH' + Math.floor(100000 + Math.random() * 900000);
  var expiry = new Date();
  expiry.setDate(expiry.getDate() + 30);
  
  // 记录
  var rsh = getSheet(SH.RECORDS);
  var rid = 'R' + String(rsh.getLastRow()).padStart(4, '0');
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
function adminLogin(username, password) {
  var d = getSheet(SH.STAFF).getDataRange().getValues();
  
  for (var i = 1; i < d.length; i++) {
    if (String(d[i][2]) === username && String(d[i][3]) === password && d[i][5] === '启用') {
      getSheet(SH.STAFF).getRange(i + 1, 8).setValue(new Date());
      addLog(d[i][1], d[i][4], '登录', '管理员登录');
      return {
        success: true,
        staff: {
          id: d[i][0],
          name: d[i][1],
          username: d[i][2],
          role: d[i][4] // Boss / Manager / Staff
        }
      };
    }
  }
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

// 核销验证码
function verifyCode(code, staffName, staffRole) {
  var r = queryCode(code);
  if (!r.found) return { success: false, message: '验证码不存在' };
  if (r.status === '已核销') return { success: false, message: '此验证码已核销', verifyTime: r.verifyTime, verifyBy: r.verifyBy };
  if (r.status === '已过期') return { success: false, message: '验证码已过期' };
  
  var sh = getSheet(SH.RECORDS);
  sh.getRange(r.row, 11).setValue('已核销');
  sh.getRange(r.row, 12).setValue(new Date());
  sh.getRange(r.row, 13).setValue(staffName);
  
  addLog(staffName, staffRole, '核销', '核销: ' + code + ' (' + r.prize + ')');
  
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

function sendWhatsAppByCode(code, staffName, staffRole) {
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
      addLog(staffName || 'System', staffRole || '', waAlreadySent ? 'WhatsApp重发' : 'WhatsApp发送', (waAlreadySent ? '重发' : '发送') + ': ' + code + ' -> ' + phone);

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
    sh.getRange(p.row, 8).setValue(p.value);
    sh.getRange(p.row, 9).setValue(p.isGrand ? '是' : '否');
    sh.getRange(p.row, 10).setValue(p.status);
  }
  
  return { success: true, message: '保存成功' };
}

function addPrize(name, icon, stock, weight, value, isGrand) {
  var sh = getSheet(SH.PRIZES);
  var id = 'P' + String(sh.getLastRow()).padStart(3, '0');
  sh.appendRow([id, name, icon || '🎁', stock, 0, '=D' + (sh.getLastRow() + 1) + '-E' + (sh.getLastRow() + 1), weight, value, isGrand ? '是' : '否', '启用', sh.getLastRow()]);
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
  var id = 'S' + String(sh.getLastRow()).padStart(3, '0');
  sh.appendRow([id, name, username, password, role, '启用', new Date(), '']);
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
  if (password) sh.getRange(row, 4).setValue(password);
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
    send: '【张崇会火锅】恭喜您中奖！🎉\n\n🎁 奖品：{prize}\n🔑 验证码：{code}\n📅 有效期至：{expiry}\n📍 地点：张崇会火锅 百万镇分店\n🍽️ 仅限周一至周四堂食\n\n📱 验证码二维码（点击查看）：\n{qrUrl}\n\n请到店出示此二维码给店员扫描兑换！',
    resend: '【张崇会火锅】验证码重发 📩\n\n🎁 奖品：{prize}\n🔑 验证码：{code}\n📅 有效期至：{expiry}\n📍 地点：张崇会火锅 百万镇分店\n🍽️ 仅限周一至周四堂食\n\n📱 验证码二维码（点击查看）：\n{qrUrl}\n\n请到店出示此二维码给店员扫描兑换！',
    reminder: '【张崇会火锅】温馨提醒 ⏰\n\n您有一份奖品即将过期！\n\n🎁 奖品：{prize}\n🔑 验证码：{code}\n📅 有效期至：{expiry}（剩余7天）\n📍 地点：张崇会火锅 百万镇分店\n🍽️ 仅限周一至周四堂食\n\n📱 验证码二维码（点击查看）：\n{qrUrl}\n\n请尽快到店兑换，过期作废！'
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

function buildWAMessage(type, prize, code, expiry) {
  var templates = getWATemplates();
  var tpl = templates[type] || templates.send;
  var qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(code);
  return tpl.replace(/\{prize\}/g, prize).replace(/\{code\}/g, code).replace(/\{expiry\}/g, expiry).replace(/\{qrUrl\}/g, qrUrl);
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
    sf.appendRow(['S001', '老板', 'boss', '888888', 'Admin', '启用', new Date(), '']);
    sf.appendRow(['S002', '经理', 'manager', '123456', 'Manager', '启用', new Date(), '']);
    sf.appendRow(['S003', '员工', 'staff', '111111', 'Staff', '启用', new Date(), '']);
  }
  
  return '✅ 系统初始化完成！包含15个奖品和3个默认员工账号';
}