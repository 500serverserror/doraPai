const api = require('../../utils/api');
const util = require('../../utils/util');

const PRESETS = [1, 2, 4, 8, 16, 32];
const COLORS = ['#E85D75', '#4A90D9', '#50B5A9', '#F5A623', '#8E6CC3', '#3CB371', '#E67E22', '#5D6D7E'];

Page({
  data: {
    session: null,
    me: null,
    others: [],
    allMembers: [],
    presets: PRESETS,
    showPanel: false,
    target: null,
    inputNum: '',
    panelFocus: false,
    showCode: false,
    showQr: false,
    qrFileID: '',
    showEndPanel: false,
    colors: COLORS,
    showColorPanel: false,
    targetColor: ''
  },

  sessionId: '',
  scoreWatcher: null,
  sessionWatcher: null,
  refreshTimer: null,
  endedHandled: false,

  onLoad(options) {
    const scene = decodeURIComponent(options.scene || '');
    if (options.sessionId) {
      this.sessionId = options.sessionId;
      this.startWatch();
    } else if (scene) {
      // 通过小程序码扫码进入
      this.joinByCode(scene);
      return;
    } else {
      wx.showToast({ title: '参数错误', icon: 'none' });
      return;
    }
    this.ensureProfile();
  },

  onShow() {
    if (this.sessionId) this.load();
  },

  onHide() {
    this.stopWatch();
  },

  onUnload() {
    this.stopWatch();
  },

  /**
   * 实时同步：
   * 1) 监听本对局分数集合，任一成员记分后自动刷新；
   * 2) 监听本对局状态，创建者结束对局后自动提示并返回列表。
   * 依赖云数据库权限为「所有用户可读」：云开发控制台 → 数据库 → sessionScores / sessions → 权限设置
   */
  startWatch() {
    if (this.scoreWatcher || !this.sessionId || !wx.cloud) return;
    const db = wx.cloud.database();

    this.scoreWatcher = db.collection('sessionScores')
      .where({ sessionId: this.sessionId })
      .watch({
        onChange: () => {
          if (this.refreshTimer) clearTimeout(this.refreshTimer);
          this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            this.load();
          }, 400);
        },
        onError: function () {
          /* 监听失败静默，页面仍可在进入时加载 */
        }
      });

    this.sessionWatcher = db.collection('sessions').doc(this.sessionId).watch({
      onChange: (snapshot) => {
        const docs = snapshot.docs || [];
        if (!docs.length) return;
        const doc = docs[0];
        if (doc.status === 'ended') {
          this.handleEndedByPeer();
          return;
        }
        // 对局状态/资料版本变化（成员换了头像、昵称、颜色）→ 刷新
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => {
          this.refreshTimer = null;
          this.load();
        }, 300);
      },
      onError: function () {
        /* 监听失败静默 */
      }
    });
  },

  stopWatch() {
    [this.scoreWatcher, this.sessionWatcher].forEach(function (w) {
      if (w) {
        try { w.close(); } catch (e) { /* 忽略 */ }
      }
    });
    this.scoreWatcher = null;
    this.sessionWatcher = null;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  },

  /** 对局被他人结束：提示并返回对局列表 */
  handleEndedByPeer() {
    if (this.endedHandled) return;
    this.endedHandled = true;
    this.stopWatch();
    wx.showModal({
      title: '对局已结束',
      content: '创建者已结束该对局，正在返回对局列表',
      showCancel: false,
      success: function () {
        wx.switchTab({ url: '/pages/index/index' });
      }
    });
  },

  /** 扫码进入：用邀请码加入对局 */
  joinByCode(code) {
    api.call('joinSession', { code: code }).then((r) => {
      this.sessionId = r.sessionId;
      this.startWatch();
      this.ensureProfile();
      this.load();
    }).catch((err) => {
      wx.showModal({
        title: '无法加入',
        content: err.message,
        showCancel: false,
        success: function () {
          wx.navigateBack();
        }
      });
    });
  },

  /** 未设置昵称时引导去设置 */
  ensureProfile() {
    api.call('login').then((r) => {
      if (!r.user.name) {
        wx.showModal({
          title: '请先设置昵称',
          content: '加入对局前需要设置昵称，去「我的」页设置后返回。',
          showCancel: false,
          success: function () {
            wx.switchTab({ url: '/pages/profile/profile' });
          }
        });
      }
    }).catch(function () {});
  },

  load() {
    if (!this.sessionId) return;
    api.call('sessionDetail', { sessionId: this.sessionId }).then((r) => {
      const members = r.members.map(function (m) {
        const balance = m.balance || 0;
        return {
          _id: m._id,
          name: m.name,
          avatar: m.avatar,
          avatarColor: m.avatarColor || '',
          balance: balance,
          balanceStr: util.signText(balance),
          initial: m.name ? m.name.charAt(0) : '?',
          color: m.avatarColor || util.colorOf(m._id + m.name),
          isMe: m.isMe
        };
      });
      const me = members.find(function (m) { return m.isMe; }) || null;
      const others = members.filter(function (m) { return !m.isMe; });
      this.setData({
        session: r.session,
        me: me,
        others: others,
        allMembers: members
      });
    }).catch((err) => {
      if (err && err.message && err.message.indexOf('已结束') >= 0) {
        this.handleEndedByPeer();
        return;
      }
      wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  /* ---------- 记分 ---------- */
  onTapStrip(e) {
    const id = e.currentTarget.dataset.id;
    if (this.data.me && id === this.data.me._id) {
      // 点击自己：更换头像颜色
      this.setData({ showColorPanel: true, targetColor: this.data.me.color });
      return;
    }
    const target = this.data.allMembers.find(function (u) { return u._id === id; });
    if (!target) return;
    this.setData({
      showPanel: true,
      target: target,
      inputNum: '',
      panelFocus: true
    });
  },

  /* ---------- 头像颜色 ---------- */
  onCloseColorPanel() {
    this.setData({ showColorPanel: false });
  },

  onPickColorDot(e) {
    const color = e.currentTarget.dataset.color;
    const me = this.data.me;
    if (!me || !me.name || me.name === '未设置昵称') {
      wx.showToast({ title: '请先设置昵称', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '保存中' });
    api.call('updateProfile', {
      name: me.name,
      avatar: me.avatar,
      avatarColor: color
    }).then(() => {
      wx.hideLoading();
      this.setData({ showColorPanel: false });
      this.load();
    }).catch((err) => {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  onPreset(e) {
    this.setData({ inputNum: String(e.currentTarget.dataset.num) });
  },

  onInputNum(e) {
    this.setData({ inputNum: e.detail.value });
  },

  onClosePanel() {
    this.setData({ showPanel: false, panelFocus: false });
  },

  onConfirm() {
    const amount = parseInt(this.data.inputNum, 10);
    if (!amount || amount <= 0) {
      wx.showToast({ title: '请输入有效分数', icon: 'none' });
      return;
    }
    const target = this.data.target;
    wx.showLoading({ title: '记分中' });
    api.call('addScore', {
      sessionId: this.sessionId,
      toUserId: target._id,
      amount: amount
    }).then(() => {
      wx.hideLoading();
      wx.showToast({ title: '记分成功', icon: 'success' });
      this.setData({ showPanel: false, panelFocus: false });
      this.load();
    }).catch((err) => {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  /* ---------- 分享 ---------- */
  onShareAppMessage() {
    const s = this.data.session;
    return {
      title: s ? '对局「' + s.name + '」邀你一起记分' : '麻将对局记分',
      path: '/pages/session/session?sessionId=' + this.sessionId
    };
  },

  /* ---------- 邀请码 ---------- */
  onShowCode() {
    this.setData({ showCode: true });
  },

  onCopyCode() {
    const code = this.data.session ? this.data.session.code : '';
    wx.setClipboardData({
      data: code,
      success: function () {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  },

  onCloseCode() {
    this.setData({ showCode: false });
  },

  /* ---------- 结束对局 ---------- */
  onEndSession() {
    this.setData({ showEndPanel: true });
  },

  onCloseEndPanel() {
    this.setData({ showEndPanel: false });
  },

  onConfirmEnd() {
    wx.showLoading({ title: '结束中' });
    api.call('endSession', { sessionId: this.sessionId }).then(() => {
      wx.hideLoading();
      wx.showToast({ title: '对局已结束', icon: 'success' });
      this.setData({ showEndPanel: false });
      setTimeout(function () {
        wx.switchTab({ url: '/pages/index/index' });
      }, 600);
    }).catch((err) => {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  onShowQr() {
    wx.showLoading({ title: '生成中' });
    api.call('sessionQrCode', { sessionId: this.sessionId }).then((r) => {
      wx.hideLoading();
      this.setData({ showQr: true, qrFileID: r.fileID });
    }).catch((err) => {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  onCloseQr() {
    this.setData({ showQr: false });
  },

  noop() {}
});
