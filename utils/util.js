/**
 * 通用工具
 */

function pad(n) {
  return n < 10 ? '0' + n : '' + n;
}

function formatTime(ts) {
  const d = new Date(ts);
  return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/** 带符号的分数文本：+8 / -4 / 0 */
function signText(n) {
  if (n > 0) return '+' + n;
  if (n < 0) return String(n);
  return '0';
}

/** 根据字符串生成稳定颜色（用于无自定义颜色的用户头像） */
const COLOR_PALETTE = ['#E85D75', '#4A90D9', '#50B5A9', '#F5A623', '#8E6CC3', '#3CB371', '#E67E22', '#5D6D7E'];

function colorOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) % 997;
  }
  return COLOR_PALETTE[h % COLOR_PALETTE.length];
}

/** 上传头像到云存储，返回 fileID */
function uploadAvatar(filePath) {
  return new Promise(function (resolve, reject) {
    const ext = (filePath.split('.').pop() || 'png').toLowerCase();
    const cloudPath = 'avatars/' + Date.now() + '-' + Math.floor(Math.random() * 10000) + '.' + ext;
    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: filePath
    }).then(function (res) {
      resolve(res.fileID);
    }).catch(reject);
  });
}

module.exports = {
  formatTime,
  signText,
  colorOf,
  uploadAvatar
};
