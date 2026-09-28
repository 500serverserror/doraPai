/**
 * 麻将对局记分 · 云函数 api
 * 多对局模式：
 *   login            登录/注册（openid 自动识别身份），返回用户资料
 *   updateProfile    更新昵称 / 头像
 *   createSession    新建对局（创建者自动加入）
 *   mySessions       我参与的对局列表（含我的分数、人数）
 *   sessionDetail    对局详情（成员及对局内分数；非成员自动加入）
 *   joinSession      通过邀请码加入对局
 *   addScore         对局内记分事务：记入方 +amount，记出方（自己） -amount
 *   sessionQrCode    生成对局小程序码（扫码进入对局）
 *   endSession       结束对局（仅创建者）：关闭对局并返回总分快照
 *   sessionRecords   对局记录：我参与过的已结束对局（含成员分数）
 *   clearRecords     清空对局记录：删除我参与的所有已结束对局及其数据
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const MAX_AMOUNT = 100000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function genCode(len) {
  len = len || 6;
  let s = '';
  for (let i = 0; i < len; i++) {
    s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return s;
}

async function ensureCollections() {
  const names = ['users', 'sessions', 'sessionMembers', 'sessionScores', 'transfers'];
  for (const n of names) {
    try {
      await db.createCollection(n);
    } catch (e) {
      /* 已存在 */
    }
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  await ensureCollections();

  switch (event.action) {
    case 'login':
      return login(OPENID);
    case 'updateProfile':
      return updateProfile(OPENID, event);
    case 'createSession':
      return createSession(OPENID, event);
    case 'mySessions':
      return mySessions(OPENID);
    case 'sessionDetail':
      return sessionDetail(OPENID, event);
    case 'joinSession':
      return joinSession(OPENID, event);
    case 'addScore':
      return addScore(OPENID, event);
    case 'sessionQrCode':
      return sessionQrCode(OPENID, event);
    case 'endSession':
      return endSession(OPENID, event);
    case 'sessionRecords':
      return sessionRecords(OPENID);
    case 'clearRecords':
      return clearRecords(OPENID);
    default:
      return { code: 1, msg: '未知操作' };
  }
};

async function login(openid) {
  const res = await db.collection('users').where({ _openid: openid }).limit(1).get();
  let user = res.data[0];
  if (!user) {
    const addRes = await db.collection('users').add({
      data: { _openid: openid, name: '', avatar: '', avatarColor: '', createdAt: Date.now() }
    });
    user = { _id: addRes._id, _openid: openid, name: '', avatar: '', avatarColor: '' };
  }

  // 所有对局累积加减的总分（进行中 + 已结束）
  let totalBalance = 0;
  try {
    const sRes = await db.collection('sessionScores').where({ openid: openid }).limit(1000).get();
    sRes.data.forEach(function (x) { totalBalance += (x.balance || 0); });
  } catch (e) {
    /* 集合不存在时视为 0 */
  }

  return {
    code: 0,
    user: { _id: user._id, name: user.name || '', avatar: user.avatar || '', avatarColor: user.avatarColor || '' },
    totalBalance: totalBalance
  };
}

async function updateProfile(openid, event) {
  const name = String(event.name || '').trim().slice(0, 8);
  const avatar = String(event.avatar || '').slice(0, 500);
  if (!name) return { code: 1, msg: '昵称不能为空' };
  const data = { name: name, avatar: avatar };
  if (event.avatarColor) data.avatarColor = String(event.avatarColor).slice(0, 20);
  await db.collection('users').where({ _openid: openid }).update({
    data: data
  });

  // 通知我参与的所有进行中对局：资料已变化（成员端监听 sessions 后自动刷新头像/昵称/颜色）
  try {
    const memRes = await db.collection('sessionMembers').where({ openid: openid }).limit(1000).get();
    if (memRes.data.length > 0) {
      const ids = memRes.data.map(function (m) { return m.sessionId; });
      const sRes = await db.collection('sessions').where({ _id: _.in(ids) }).limit(1000).get();
      const ts = Date.now();
      for (const s of sRes.data) {
        if (s.status === 'ended') continue;
        await db.collection('sessions').doc(s._id).update({ data: { lastProfileTs: ts } });
      }
    }
  } catch (e) {
    /* 通知失败不影响资料保存 */
  }

  return { code: 0 };
}

/* ---------- 对局 ---------- */

async function createSession(openid, event) {
  const u = await db.collection('users').where({ _openid: openid }).limit(1).get();
  if (u.data.length === 0 || !u.data[0].name) return { code: 1, msg: '请先设置昵称' };

  const name = String(event.name || '').trim().slice(0, 12) || '新对局';
  let code = genCode();
  for (let i = 0; i < 3; i++) {
    const dup = await db.collection('sessions').where({ code: code }).count();
    if (dup.total === 0) break;
    code = genCode();
  }

  const s = await db.collection('sessions').add({
    data: { name: name, code: code, ownerOpenid: openid, status: 'active', createdAt: Date.now() }
  });
  await db.collection('sessionMembers').add({
    data: { sessionId: s._id, openid: openid, joinedAt: Date.now() }
  });
  await db.collection('sessionScores').add({
    data: { sessionId: s._id, openid: openid, balance: 0 }
  });
  return { code: 0, sessionId: s._id, inviteCode: code };
}

async function mySessions(openid) {
  const members = await db.collection('sessionMembers').where({ openid: openid }).limit(1000).get();
  if (members.data.length === 0) return { code: 0, sessions: [] };
  const ids = members.data.map(function (m) { return m.sessionId; });

  const sessionsRes = await db.collection('sessions').where({ _id: _.in(ids) }).limit(1000).get();
  const scoreRes = await db.collection('sessionScores').where({ openid: openid, sessionId: _.in(ids) }).limit(1000).get();
  const countRes = await db.collection('sessionMembers').where({ sessionId: _.in(ids) }).limit(1000).get();

  const scoreMap = {};
  scoreRes.data.forEach(function (x) { scoreMap[x.sessionId] = x.balance || 0; });
  const countMap = {};
  countRes.data.forEach(function (m) { countMap[m.sessionId] = (countMap[m.sessionId] || 0) + 1; });

  const list = sessionsRes.data.filter(function (s) { return s.status !== 'ended'; }).map(function (s) {
    return {
      _id: s._id,
      name: s.name,
      code: s.code,
      createdAt: s.createdAt,
      memberCount: countMap[s._id] || 0,
      myBalance: scoreMap[s._id] || 0
    };
  }).sort(function (a, b) { return b.createdAt - a.createdAt; });

  return { code: 0, sessions: list };
}

async function sessionDetail(openid, event) {
  const sessionId = String(event.sessionId || '');
  if (!sessionId) return { code: 1, msg: '参数错误' };

  let session;
  try {
    const s = await db.collection('sessions').doc(sessionId).get();
    session = s.data;
  } catch (e) {
    return { code: 2, msg: '对局不存在' };
  }
  if (session.status === 'ended') return { code: 1, msg: '对局已结束' };

  // 非成员自动加入
  const mem = await db.collection('sessionMembers').where({ sessionId: sessionId, openid: openid }).limit(1).get();
  let joined = false;
  if (mem.data.length === 0) {
    await db.collection('sessionMembers').add({
      data: { sessionId: sessionId, openid: openid, joinedAt: Date.now() }
    });
    await db.collection('sessionScores').add({
      data: { sessionId: sessionId, openid: openid, balance: 0 }
    });
    joined = true;
  }

  const membersRes = await db.collection('sessionMembers').where({ sessionId: sessionId }).limit(1000).get();
  const openids = membersRes.data.map(function (m) { return m.openid; });
  const scoresRes = await db.collection('sessionScores').where({ sessionId: sessionId }).limit(1000).get();
  const scoreMap = {};
  scoresRes.data.forEach(function (x) { scoreMap[x.openid] = x.balance || 0; });

  let userMap = {};
  if (openids.length > 0) {
    const usersRes = await db.collection('users').where({ _openid: _.in(openids) }).limit(1000).get();
    usersRes.data.forEach(function (u) { userMap[u._openid] = u; });
  }

  const members = membersRes.data.map(function (m) {
    const u = userMap[m.openid] || {};
    return {
      _id: m._id,
      name: u.name || '未设置昵称',
      avatar: u.avatar || '',
      avatarColor: u.avatarColor || '',
      balance: scoreMap[m.openid] || 0,
      isMe: m.openid === openid
    };
  });

  return {
    code: 0,
    session: { _id: session._id, name: session.name, code: session.code, createdAt: session.createdAt },
    members: members,
    joined: joined
  };
}

async function joinSession(openid, event) {
  const code = String(event.code || '').trim().toUpperCase();
  if (!code) return { code: 1, msg: '邀请码无效' };
  const res = await db.collection('sessions').where({ code: code }).limit(1).get();
  if (res.data.length === 0) return { code: 2, msg: '对局不存在或邀请码错误' };
  const session = res.data[0];
  if (session.status === 'ended') return { code: 1, msg: '对局已结束' };

  const mem = await db.collection('sessionMembers').where({ sessionId: session._id, openid: openid }).limit(1).get();
  if (mem.data.length === 0) {
    await db.collection('sessionMembers').add({
      data: { sessionId: session._id, openid: openid, joinedAt: Date.now() }
    });
    await db.collection('sessionScores').add({
      data: { sessionId: session._id, openid: openid, balance: 0 }
    });
  }
  return { code: 0, sessionId: session._id };
}

/* ---------- 对局内记分 ---------- */

async function addScore(openid, event) {
  const sessionId = String(event.sessionId || '');
  const toMemberId = String(event.toUserId || '');
  const amount = parseInt(event.amount, 10);
  if (!sessionId || !toMemberId) return { code: 1, msg: '参数错误' };
  if (!amount || amount <= 0 || amount > MAX_AMOUNT) return { code: 1, msg: '分数不合法' };

  // 对局须处于进行中
  let sessionDoc;
  try {
    const sRes = await db.collection('sessions').doc(sessionId).get();
    sessionDoc = sRes.data;
  } catch (e) {
    return { code: 2, msg: '对局不存在' };
  }
  if (sessionDoc.status === 'ended') return { code: 1, msg: '对局已结束' };

  try {
    const result = await db.runTransaction(async (t) => {
      // 记出方（我）的成员记录
      const fromRes = await t.collection('sessionMembers').where({ sessionId: sessionId, openid: openid }).get();
      if (fromRes.data.length === 0) throw new Error('NOT_IN_SESSION');
      const fromMember = fromRes.data[0];

      // 记入方成员记录
      let toMember = null;
      try {
        const toRes = await t.collection('sessionMembers').doc(toMemberId).get();
        toMember = toRes.data;
      } catch (e) {
        /* 文档不存在 */
      }
      if (!toMember || toMember.sessionId !== sessionId) throw new Error('NO_TO');
      if (toMember.openid === openid) throw new Error('SELF');

      // 双方对局分数
      const fromScoreRes = await t.collection('sessionScores').where({ sessionId: sessionId, openid: openid }).get();
      const toScoreRes = await t.collection('sessionScores').where({ sessionId: sessionId, openid: toMember.openid }).get();
      if (fromScoreRes.data.length === 0) throw new Error('NO_FROM_SCORE');
      if (toScoreRes.data.length === 0) throw new Error('NO_TO_SCORE');
      const fromScore = fromScoreRes.data[0];
      const toScore = toScoreRes.data[0];

      await t.collection('sessionScores').doc(fromScore._id).update({
        data: { balance: _.inc(-amount) }
      });
      await t.collection('sessionScores').doc(toScore._id).update({
        data: { balance: _.inc(amount) }
      });

      // 名字快照
      const fromUserRes = await t.collection('users').where({ _openid: openid }).get();
      const toUserRes = await t.collection('users').where({ _openid: toMember.openid }).get();
      const fromName = fromUserRes.data[0] ? fromUserRes.data[0].name : '?';
      const toName = toUserRes.data[0] ? toUserRes.data[0].name : '?';

      await t.collection('transfers').add({
        data: {
          sessionId: sessionId,
          fromOpenid: openid,
          fromName: fromName,
          toOpenid: toMember.openid,
          toName: toName,
          amount: amount,
          ts: Date.now()
        }
      });
      return {
        fromBalance: (fromScore.balance || 0) - amount,
        toBalance: (toScore.balance || 0) + amount
      };
    });
    return { code: 0, data: result };
  } catch (e) {
    if (e.message === 'NOT_IN_SESSION') return { code: 2, msg: '你不在该对局中' };
    if (e.message === 'NO_TO') return { code: 2, msg: '记分对象不存在' };
    if (e.message === 'SELF') return { code: 1, msg: '不能记给自己' };
    if (e.message === 'NO_FROM_SCORE' || e.message === 'NO_TO_SCORE') return { code: 2, msg: '分数记录不存在' };
    return { code: 2, msg: '记分失败，请重试' };
  }
}

/* ---------- 小程序码 ---------- */

async function sessionQrCode(openid, event) {
  const sessionId = String(event.sessionId || '');
  if (!sessionId) return { code: 1, msg: '参数错误' };

  let session;
  try {
    const s = await db.collection('sessions').doc(sessionId).get();
    session = s.data;
  } catch (e) {
    return { code: 2, msg: '对局不存在' };
  }
  if (session.status === 'ended') return { code: 1, msg: '对局已结束' };
  const mem = await db.collection('sessionMembers').where({ sessionId: sessionId, openid: openid }).limit(1).get();
  if (mem.data.length === 0) return { code: 2, msg: '你不在该对局中' };

  try {
    const result = await cloud.openapi.wxacode.getUnlimited({
      scene: session.code,
      page: 'pages/session/session',
      checkPath: false,
      width: 430
    });
    const upload = await cloud.uploadFile({
      cloudPath: 'qrcodes/' + sessionId + '_' + Date.now() + '.png',
      fileContent: result.buffer
    });
    return { code: 0, fileID: upload.fileID };
  } catch (e) {
    return { code: 2, msg: '二维码生成失败：小程序需发布后才能生成二维码，可先用转发分享' };
  }
}

/* ---------- 结束对局 ---------- */

async function endSession(openid, event) {
  const sessionId = String(event.sessionId || '');
  if (!sessionId) return { code: 1, msg: '参数错误' };

  let session;
  try {
    const s = await db.collection('sessions').doc(sessionId).get();
    session = s.data;
  } catch (e) {
    return { code: 2, msg: '对局不存在' };
  }
  if (session.ownerOpenid !== openid) return { code: 1, msg: '仅创建者可结束对局' };
  if (session.status === 'ended') return { code: 0, summary: [] };

  await db.collection('sessions').doc(sessionId).update({
    data: { status: 'ended', endedAt: Date.now() }
  });

  // 总分快照
  const membersRes = await db.collection('sessionMembers').where({ sessionId: sessionId }).limit(1000).get();
  const openids = membersRes.data.map(function (m) { return m.openid; });
  const scoresRes = await db.collection('sessionScores').where({ sessionId: sessionId }).limit(1000).get();
  const scoreMap = {};
  scoresRes.data.forEach(function (x) { scoreMap[x.openid] = x.balance || 0; });
  let userMap = {};
  if (openids.length > 0) {
    const usersRes = await db.collection('users').where({ _openid: _.in(openids) }).limit(1000).get();
    usersRes.data.forEach(function (u) { userMap[u._openid] = u; });
  }
  const summary = membersRes.data.map(function (m) {
    const u = userMap[m.openid] || {};
    return {
      name: u.name || '未设置昵称',
      balance: scoreMap[m.openid] || 0
    };
  });

  return { code: 0, summary: summary };
}

/* ---------- 对局记录 ---------- */

async function sessionRecords(openid) {
  const members = await db.collection('sessionMembers').where({ openid: openid }).limit(1000).get();
  if (members.data.length === 0) return { code: 0, records: [] };
  const ids = members.data.map(function (m) { return m.sessionId; });

  const sessionsRes = await db.collection('sessions').where({ _id: _.in(ids), status: 'ended' }).limit(1000).get();
  const endedSessions = sessionsRes.data.sort(function (a, b) { return (b.endedAt || 0) - (a.endedAt || 0); });
  if (endedSessions.length === 0) return { code: 0, records: [] };
  const endedIds = endedSessions.map(function (s) { return s._id; });

  const memRes = await db.collection('sessionMembers').where({ sessionId: _.in(endedIds) }).limit(1000).get();
  const scoreRes = await db.collection('sessionScores').where({ sessionId: _.in(endedIds) }).limit(1000).get();

  const openidSet = {};
  memRes.data.forEach(function (m) { openidSet[m.openid] = true; });
  const openids = Object.keys(openidSet);
  let userMap = {};
  if (openids.length > 0) {
    const uRes = await db.collection('users').where({ _openid: _.in(openids) }).limit(1000).get();
    uRes.data.forEach(function (u) { userMap[u._openid] = u; });
  }

  const scoreMap = {};
  scoreRes.data.forEach(function (x) {
    if (!scoreMap[x.sessionId]) scoreMap[x.sessionId] = {};
    scoreMap[x.sessionId][x.openid] = x.balance || 0;
  });

  const records = endedSessions.map(function (s) {
    const ofSession = memRes.data.filter(function (m) { return m.sessionId === s._id; });
    const sm = scoreMap[s._id] || {};
    return {
      _id: s._id,
      name: s.name,
      endedAt: s.endedAt || 0,
      myBalance: sm[openid] || 0,
      summary: ofSession.map(function (m) {
        const u = userMap[m.openid] || {};
        return {
          name: u.name || '未设置昵称',
          balance: sm[m.openid] || 0
        };
      })
    };
  });

  return { code: 0, records: records };
}

/* ---------- 清空对局记录 ---------- */

async function clearRecords(openid) {
  const members = await db.collection('sessionMembers').where({ openid: openid }).limit(1000).get();
  if (members.data.length === 0) return { code: 0, deleted: 0 };
  const ids = members.data.map(function (m) { return m.sessionId; });

  const sRes = await db.collection('sessions').where({ _id: _.in(ids), status: 'ended' }).limit(1000).get();
  const endedIds = sRes.data.map(function (s) { return s._id; });
  if (endedIds.length === 0) return { code: 0, deleted: 0 };

  for (const id of endedIds) {
    await db.collection('sessions').doc(id).remove();
  }

  const memRes = await db.collection('sessionMembers').where({ sessionId: _.in(endedIds) }).limit(1000).get();
  for (const m of memRes.data) {
    await db.collection('sessionMembers').doc(m._id).remove();
  }
  const scoreRes = await db.collection('sessionScores').where({ sessionId: _.in(endedIds) }).limit(1000).get();
  for (const x of scoreRes.data) {
    await db.collection('sessionScores').doc(x._id).remove();
  }
  const tRes = await db.collection('transfers').where({ sessionId: _.in(endedIds) }).limit(1000).get();
  for (const t of tRes.data) {
    await db.collection('transfers').doc(t._id).remove();
  }

  return { code: 0, deleted: endedIds.length };
}
