define('ThirdPartyModule/test2', ['someDependency', 'someAnotherDependency'], function (dep1, dep2) {
   return {
      dep1: dep1,
      dep2: dep2,
      _moduleName: 'ThirdPartyModule/test2'
   }
});