define('ThirdPartyModule/test', ['someDependency'], function (dep1) {
   return {
      dep1: dep1,
      _moduleName: 'ThirdPartyModule/test'
   }
});