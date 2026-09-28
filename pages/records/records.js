const api = require('../../utils/api');
const util = require('../../utils/util');

Page({
  data: {
    groups: [],
    detail: null
  },

  onShow() {
    this.load();
  },

  load() {
    api.call('sessionRecords').then((r) => {
      const recs = (r.records || []).map(function (rec) {
        return {
          _id: rec._id,
          name: rec.name,
          year: new Date(rec.endedAt).getFullYear(),
          timeStr: util.formatTime(rec.endedAt),
          myBalance: rec.myBalance || 0,
          myBalanceStr: util.signText(rec.myBalance || 0),
          summary: (rec.summary || []).map(function (m) {
            return {
              name: m.name,
              balance: m.balance,
              balanceStr: util.signText(m.balance)
            };
          })
        };
      });

      // 按年分组（记录已按结束时间倒序，年份自然从新到旧），每年累计总计分
      const groups = [];
      const byYear = {};
      recs.forEach(function (rec) {
        if (!byYear[rec.year]) {
          byYear[rec.year] = { year: rec.year, total: 0, totalStr: '0', records: [] };
          groups.push(byYear[rec.year]);
        }
        byYear[rec.year].total += rec.myBalance;
        byYear[rec.year].records.push(rec);
      });
      groups.forEach(function (g) { g.totalStr = util.signText(g.total); });

      this.setData({ groups: groups, detail: null });
    }).catch(function () {
      /* 加载失败不阻塞 */
    });
  },

  /* 点击记录：展示该对局所有用户得分 */
  onTapRecord(e) {
    const gi = e.currentTarget.dataset.gidx;
    const ri = e.currentTarget.dataset.ridx;
    const g = this.data.groups[gi];
    if (!g) return;
    this.setData({ detail: g.records[ri] });
  },

  onCloseDetail() {
    this.setData({ detail: null });
  },

  noop() {},

  onClear() {
    wx.showModal({
      title: '清空对局记录',
      content: '将删除所有已结束对局及其分数记录，且不可恢复。确认清空？',
      confirmText: '清空',
      confirmColor: '#e64545',
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '清空中' });
        api.call('clearRecords').then((r) => {
          wx.hideLoading();
          wx.showToast({ title: '已清空', icon: 'success' });
          this.load();
        }).catch((err) => {
          wx.hideLoading();
          wx.showToast({ title: err.message, icon: 'none' });
        });
      }
    });
  }
});
