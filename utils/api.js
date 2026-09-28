/**
 * 云函数调用封装
 */
function call(action, data) {
  return wx.cloud.callFunction({
    name: 'api',
    data: Object.assign({ action: action }, data || {})
  }).then(function (res) {
    const r = res.result || {};
    if (r.code !== 0) {
      const err = new Error(r.msg || '操作失败');
      err.code = r.code;
      throw err;
    }
    return r;
  });
}

module.exports = { call };
