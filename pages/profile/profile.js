const api = require('../../utils/api');
const util = require('../../utils/util');

const COLORS = ['#E85D75', '#4A90D9', '#50B5A9', '#F5A623', '#8E6CC3', '#3CB371', '#E67E22', '#5D6D7E'];

Page({
  data: {
    user: null,
    edit: { name: '', avatar: '' },
    colors: COLORS,
    showColorPanel: false,
    totalBalance: 0,
    totalBalanceStr: '0'
  },

  onShow() {
    this.load();
  },

  load() {
    api.call('login').then((r) => {
      const user = r.user;
      const totalBalance = r.totalBalance || 0;
      user.initial = user.name ? user.name.charAt(0) : '?';
      user.color = user.avatarColor || '#0f9d7e';
      this.setData({
        user: user,
        edit: { name: user.name, avatar: user.avatar },
        totalBalance: totalBalance,
        totalBalanceStr: util.signText(totalBalance)
      });
    }).catch((err) => {
      wx.showModal({
        title: '云开发未就绪',
        content: '请确认已开通云开发并部署 cloudfunctions/api 云函数。\n错误：' + err.message,
        showCancel: false
      });
    });
  },

  /* ---------- 头像颜色 ---------- */
  onPickColor() {
    this.setData({ showColorPanel: true });
  },

  onCloseColorPanel() {
    this.setData({ showColorPanel: false });
  },

  onPickColorDot(e) {
    const color = e.currentTarget.dataset.color;
    const user = this.data.user;
    if (!user) return;
    wx.showLoading({ title: '保存中' });
    api.call('updateProfile', {
      name: user.name,
      avatar: user.avatar,
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

  onNameInput(e) {
    this.setData({ 'edit.name': e.detail.value });
  },

  onSave() {
    const name = (this.data.edit.name || '').trim();
    if (!name) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    api.call('updateProfile', { name: name, avatar: this.data.edit.avatar }).then(() => {
      wx.showToast({ title: '已保存', icon: 'success' });
      this.load();
    }).catch((err) => {
      wx.showToast({ title: err.message, icon: 'none' });
    });
  },

  noop() {}
});
