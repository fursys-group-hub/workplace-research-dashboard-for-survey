// 로그인 기능을 부트스트랩하는 함수입니다.

// Calls requireAuth() once scripts are loaded.
(function () {
  try {
    if (typeof requireAuth === 'function') {
      Promise.resolve(requireAuth()).catch(function () {});
    }
  } catch (_) {}
})();

