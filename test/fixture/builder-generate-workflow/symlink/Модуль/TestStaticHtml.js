/* eslint-disable */
define('Modul/TestStaticHtml',
   ['css!theme?Modul/TestLess'],
function() {
   var component = {};
   component.webPage = {
      htmlTemplate: 'Модуль/template.html',
      outFileName: 'StaticHtml'
   };
   return component;
});
