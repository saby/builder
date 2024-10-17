if(typeof window !== 'undefined'){define('json!SomeModule/someName',function(){return {"test1":"test1Data","test2":["1","2","3"],"test3":{"obj1":"obj1","obj2":"obj2"}};});}else{/* eslint-disable */
define('Module/amdModule', ['Module/someDependency'], function() {
   return {
      _moduleName: 'Module/amdModule'
   };
});
}