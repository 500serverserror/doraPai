App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('基础库版本过低，请使用 2.2.3 以上版本');
      return;
    }
    wx.cloud.init({
      env: 'cloud1-d5g8ig6zr9da1d1b4',
      traceUser: true
    });
  }
});
