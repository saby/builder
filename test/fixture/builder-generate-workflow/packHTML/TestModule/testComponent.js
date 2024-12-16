define('TestModule/testComponent', ['browser!TestModule/Test/component1', 'is?compatibleLayer?TestModule/Test/component2', 'i18n!TestModule'], function(component1) {
   'use strict';
   var TestModule = {
      test: component1
   };

   // создаем отдельную html-страницу для открытия требования в отдельном окне
   TestModule.webPage = {
      htmlTemplate: 'TestModule/rootTemplate.html',
      outFileName: 'testPage'
   };

   return TestModule;
});