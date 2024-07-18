define('Modul/Stable', function() {
   var component = {};
   component.webPage = {
      htmlTemplate: 'Тема Скрепка/Stable.html',
      outFileName: 'Stable',
      title: 'Stable',
      urls: ['Stable/One', '\\Stable\\Two', '/Stable_Three']
   };
   return component;
});
