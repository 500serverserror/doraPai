const api = require('../../utils/api');
const util = require('../../utils/util');

Page({
  data: {
    needSetup: false,
    hasProfile: false,
    edit: { name: '', avatar: '' },
    sessions: [],
    showCreate: false,
    createName: '',
    showJoin: false,
    joinCode: ''
  },

  onShow() {
    if (!wx.cloud) {
      wx.showModal({
        title: '基础库版本过低',
        content: '请升级微信基础库到 2.2.3 以上以使用云能力',
        showCancel: false
      });
      return;
    }
    this.init();
  },

  init() {
    api.call('login').then((r) => {
      const hasProfile = !!(r.user && r.user.name);
      this.setData({ needSetup: false, hasProfile: hasProfile });
      this.loadSessions();
    }).catch((err) => {
      wx.showModal({
        title: '云开发未就绪',
        content: '请确认：1) 已使用自己的 AppID；2) 已开通云开发；3) 已部署 cloudfunctions/api 云函数。\n错误：' + err.message,
        showCancel: false
      });
    });
  },

  /* 打开设置昵称面板（用户主动操作时引导） */
  onOpenSetup() {
    this.setData({ needSetup: true, edit: { name: '', avatar: '' } });
  },

  onCloseSetup() {
    this.setData({ needSetup: false });
  },

  loadSessions() {
    api.call('mySessions').then((r) => {
      const sessions = r.sessions.map(function (s) {
        return {
          _id: s._id,
          name: s.name,
          memberCount: s.memberCount,
          myBalance: s.myBalance,
          myBalanceStr: util.signText(s.myBalance),
          timeStr: util.formatTime(s.createdAt)
        };
      });
      this.setData({ sessions: sessions });
    }).catch(function () {
      /* 列表加载失败不阻塞 */
    });
  },

  /* ---------- 新建对局 ---------- */
  onCreate() {
    // 未设置昵称：先引导设置（用户自主选择授权），再创建
    if (!this.data.hasProfile) {
      this.setData({ needSetup: true, edit: { name: '', avatar: '' } });
      return;
    }
    this.setData({ showCreate: true, createName: '' });
  },

  onCreateName(e) {
    this.setData({ createName: e.detail.value });
  },

  onCloseCreate() {
    this.setData({ showCreate: false });
  },

  onConfirmCreate() {
    const name = (this.data.createName || '').trim();
    wx.showLoading({ title: '创建中' });
    api.call('createSession', { name: name }).then((r) => {
      wx.hideLoading();
      this.setData({ showCreate: false });
      wx.navigateTo({ url: '/pages/session/session?sessionId=' + r.sessionId });
    }).catch((err) => {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  goSession(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/session/session?sessionId=' + id });
  },

  /* ---------- 输入邀请码加入 ---------- */
  onJoin() {
    this.setData({ showJoin: true, joinCode: '' });
  },

  onJoinInput(e) {
    this.setData({ joinCode: (e.detail.value || '').toUpperCase() });
  },

  onCloseJoin() {
    this.setData({ showJoin: false });
  },

  onConfirmJoin() {
    const code = (this.data.joinCode || '').trim().toUpperCase();
    if (code.length !== 6) {
      wx.showToast({ title: '请输入 6 位邀请码', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '加入中' });
    api.call('joinSession', { code: code }).then((r) => {
      wx.hideLoading();
      this.setData({ showJoin: false });
      wx.navigateTo({ url: '/pages/session/session?sessionId=' + r.sessionId });
    }).catch((err) => {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  /* ---------- 设置昵称 ---------- */
  onNameInput(e) {
    this.setData({ 'edit.name': e.detail.value });
  },

  onSaveProfile() {
    const name = (this.data.edit.name || '').trim();
    if (!name) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    api.call('updateProfile', { name: name, avatar: this.data.edit.avatar }).then(() => {
      wx.showToast({ title: '设置成功', icon: 'success' });
      this.init();
    }).catch((err) => {
      wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  noop() {}
});
