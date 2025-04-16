'use strict';

const initTest = require('./init-test');
const parseJsComponent = require('../lib/parse-js-component');

const fs = require('fs-extra');
const { path, toPosix } = require('../lib/platform/path');
const removeRSymbol = function(str) {
   return str.replace(/\r/g, '');
};
const runMinifyJs = require('../lib/run-minify-js');
const parseJsComponentOptions = { testsBuild: true, filePath: 'My.Module/Name.js' };

const dirname = toPosix(__dirname);

describe('parse js component', () => {
   before(async() => {
      await initTest();
   });
   it('empty file', async() => {
      const result = (await parseJsComponent('', parseJsComponentOptions)).componentInfo;
      Object.getOwnPropertyNames(result).length.should.equal(0);
   });
   it('file with error', async() => {
      try {
         await parseJsComponent('define(', parseJsComponentOptions);
      } catch (error) {
         error.message.should.include('Unexpected token');
         return;
      }

      throw new Error('Should throw an exception');
   });
   it('empty module name', async() => {
      const result = (await parseJsComponent('define(function(){});', parseJsComponentOptions)).componentInfo;
      Object.getOwnPropertyNames(result).length.should.equal(0);
   });
   it('normal module name', async() => {
      const result = (await parseJsComponent('define("My.Module/Name", function(){});', parseJsComponentOptions)).componentInfo;
      Object.getOwnPropertyNames(result).length.should.equal(1);
      result.componentName.should.equal('My.Module/Name', true);
      result.hasOwnProperty('isNavigation').should.equal(false);
   });
   it('declare object webpage', async() => {
      const result = (await parseJsComponent(
         'define("My.Module/Name", function(){' +
         'var module;' +
         'module.webPage = {' +
         '   htmlTemplate: "\\\\Тема Скрепка\\\\Шаблоны\\\\empty-template.html",' +
         '   title: "TestTitle",' +
         '   outFileName: "ca_stub",' +
         '   trash:"trash"' +
         '};' +
         'return module;});', parseJsComponentOptions
      )).componentInfo;
      Object.getOwnPropertyNames(result).length.should.equal(2);
      result.componentName.should.equal('My.Module/Name');
      result.hasOwnProperty('isNavigation').should.equal(false);
      const { webPage } = result;
      Object.getOwnPropertyNames(webPage).length.should.equal(3);
      webPage.htmlTemplate.should.equal('\\Тема Скрепка\\Шаблоны\\empty-template.html');
      webPage.outFileName.should.equal('ca_stub');
   });

   it('declare title and web page', async() => {
      const result = (await parseJsComponent(
         'define("My.Module/Name", function(){' +
         'var module;' +
         'module.webPage = {' +
         '   htmlTemplate: "\\\\Тема Скрепка\\\\Шаблоны\\\\empty-template.html",' +
         '   outFileName: "ca_stub",' +
         '   trash:"trash"' +
         '};' +
         'module.title = "TestTitle";' +
         'return module;});', parseJsComponentOptions
      )).componentInfo;
      Object.getOwnPropertyNames(result).length.should.equal(2);
      result.componentName.should.equal('My.Module/Name');
      result.hasOwnProperty('isNavigation').should.equal(false);
      const { webPage } = result;
      Object.getOwnPropertyNames(webPage).length.should.equal(3);
      webPage.htmlTemplate.should.equal('\\Тема Скрепка\\Шаблоны\\empty-template.html');
      webPage.title.should.equal('TestTitle');
      webPage.outFileName.should.equal('ca_stub');
   });

   it('declare tricky web page', async() => {
      const result = (await parseJsComponent(
         'define("My.Module/Name", function(){' +
         'var module;' +
         'module.webPage = {};' +
         'module.webPage.htmlTemplate = "\\\\Тема Скрепка\\\\Шаблоны\\\\empty-template.html";' +
         'module.webPage.title = "Пожалуйста, подождите...";' +
         'module.webPage.outFileName = "ca_stub";' +
         'return module;});', parseJsComponentOptions
      )).componentInfo;
      Object.getOwnPropertyNames(result).length.should.equal(2);
      result.componentName.should.equal('My.Module/Name');
      result.hasOwnProperty('isNavigation').should.equal(false);
      const { webPage } = result;

      // теоритически это должно работать. но мы сознательно это не поддерживаем сейчас, поэтому webPage - пустой
      Object.getOwnPropertyNames(webPage).length.should.equal(0);
   });

   it('declare webpage with custom urls', async() => {
      const result = (await parseJsComponent(
         'define("My.Module/Name", function(){' +
         'var module;' +
         'module.webPage = {' +
         '   htmlTemplate: "\\\\Тема Скрепка\\\\Шаблоны\\\\empty-template.html",' +
         '   title: "TestTitle",' +
         '   outFileName: "ca_stub",' +
         '   trash:"trash",' +
         '   urls: ["url/one", "/urlTwo"]' +
         '};' +
         'return module;});', parseJsComponentOptions
      )).componentInfo;
      Object.getOwnPropertyNames(result).length.should.equal(2);
      result.componentName.should.equal('My.Module/Name');
      result.hasOwnProperty('isNavigation').should.equal(false);
      const { webPage } = result;
      Object.getOwnPropertyNames(webPage).length.should.equal(4);
      webPage.htmlTemplate.should.equal('\\Тема Скрепка\\Шаблоны\\empty-template.html');
      webPage.outFileName.should.equal('ca_stub');
      webPage.urls.length.should.equal(2);
      webPage.urls.should.have.members(['url/one', '/urlTwo']);
   });

   it('declare dependencies module', async() => {
      const result = (await parseJsComponent('define("My.Module/Name", ["My.Dep/Name1", "My.Dep/Name2"], function(){});', parseJsComponentOptions)).componentInfo;
      Object.getOwnPropertyNames(result).length.should.equal(3);
      result.componentDep.should.have.members(['My.Dep/Name1', 'My.Dep/Name2']);
      result.hasOwnProperty('isNavigation').should.equal(true);
      result.isNavigation.should.equal(false);
   });
   it('declare dependencies module, empty name', async() => {
      const result = (await parseJsComponent('define(["My.Dep/Name1", "My.Dep/Name2"], function(){});', parseJsComponentOptions)).componentInfo;
      Object.getOwnPropertyNames(result).length.should.equal(1);
      result.componentDep.should.have.members(['My.Dep/Name1', 'My.Dep/Name2']);
      result.hasOwnProperty('isNavigation').should.equal(false);
   });
   it('declare empty dependencies module', async() => {
      const result = (await parseJsComponent('define("My.Module/Name", [], function(){});', parseJsComponentOptions)).componentInfo;
      Object.getOwnPropertyNames(result).length.should.equal(3);
      result.componentDep.should.have.members([]);
      result.hasOwnProperty('isNavigation').should.equal(true);
      result.isNavigation.should.equal(false);
   });
   it('declare empty dependencies module №2', async() => {
      const result = (await parseJsComponent(
         'define("My.Module/Name", function(){});',
         parseJsComponentOptions
      )).componentInfo;
      Object.getOwnPropertyNames(result).length.should.equal(1);
      result.hasOwnProperty('isNavigation').should.equal(false);
   });
   it('declare navigation', async() => {
      let result = (await parseJsComponent(
         'define("My.Module/Name", ["Navigation/NavigationController"], function(){});',
         parseJsComponentOptions
      )).componentInfo;
      result.hasOwnProperty('isNavigation').should.equal(true);
      result.isNavigation.should.equal(true);

      result = (await parseJsComponent(
         'define("My.Module/Name", ["optional!Navigation/NavigationController"], function(){});',
         parseJsComponentOptions
      )).componentInfo;
      result.hasOwnProperty('isNavigation').should.equal(true);
      result.isNavigation.should.equal(true);
   });

   describe('typescript dynamic import checker', () => {
      const moduleDirectory = path.join(dirname, 'fixture/parse-js-component/typescript-dynamic-imports/TestModule');
      const testCommonCase = async(fileName) => {
         const text = await fs.readFile(`${moduleDirectory}/${fileName}`);
         const result = (await parseJsComponent(removeRSymbol(text.toString()), parseJsComponentOptions)).componentInfo;
         result.hasOwnProperty('amdContent').should.equal(false);
      };
      describe('should be patched in case of using require and not having it\'s own catch errors callback', () => {
         it('promise as new expession', async() => {
            const text = await fs.readFile(path.join(moduleDirectory, 'myModule.js'));
            const result = await parseJsComponent(removeRSymbol(text.toString(), parseJsComponentOptions), {
               filePath: 'TestModule/myModule.js'
            });
            result.amdContent.should.equal('define("TestModule/myModule", ["require", "exports"], function (require, exports) {\n' +
               "    'use strict';\n" +
               '    new Promise(function (resolve_1, reject_1) {\n' +
               "        require(['module'], resolve_1, reject_1);\n" +
               '    }).then(function () {\n' +
               "        return 'first one';\n" +
               '    }).then(function () {\n' +
               "        return 'another one';\n" +
               '    }).catch(function (err) {\n' +
               '        requirejs.onError(err);\n' +
               '    });\n' +
               '});');
            const minifiedResult = await runMinifyJs('virtual.js', result.amdContent);
            minifiedResult.code.should.equal('define("TestModule/myModule",["require","exports"],(function(e,n){"use strict";new Promise((function(n,r){e(["module"],n,r)})).then((function(){return"first one"})).then((function(){return"another one"})).catch((function(e){requirejs.onError(e)}))}));');
         });

         it('nested promises as new expession', async() => {
            const text = await fs.readFile(path.join(moduleDirectory, 'nestedDynamicImports.js'));
            const result = await parseJsComponent(removeRSymbol(text.toString()), {
               filePath: 'TestModule/nestedDynamicImports.js'
            });
            result.amdContent.should.equal('define("TestModule/test", ["require", "exports"], function (require, exports) {\n' +
               '    \'use strict\';\n' +
               '    new Promise(function (resolve_1, reject_1) {\n' +
               '        require([\'someModuleName\'], resolve_1, reject_1);\n' +
               '    }).then(function (component) {\n' +
               '        new Promise(function (resolve_2, reject_2) {\n' +
               '            require([\'Core/IoC\'], resolve_2, reject_2);\n' +
               '        }).then(function (IoC) {\n' +
               '            new Promise(function (resolve_3, reject_3) {\n' +
               '                require([\'someAnotherNestedModuleName\'], resolve_3, reject_3);\n' +
               '            }).then(function (someAnotherNestedModuleName) {\n' +
               '                console.log(\'someAnotherNestedModuleName: \' + someAnotherNestedModuleName);\n' +
               '            }).catch(function (err) {\n' +
               '                requirejs.onError(err);\n' +
               '            });\n' +
               '            IoC.resolve(\'ILogger\').error(\'EngineUser/Panel\', \'someError\');\n' +
               '        }).catch(function (err) {\n' +
               '            requirejs.onError(err);\n' +
               '        });\n' +
               '    }).catch(function (err) {\n' +
               '        requirejs.onError(err);\n' +
               '    });\n' +
               '});');
            const minifiedResult = await runMinifyJs('virtual.js', result.amdContent);
            minifiedResult.code.should.equal('define("TestModule/test",["require","exports"],(function(e,o){"use strict";new Promise((function(o,n){e(["someModuleName"],o,n)})).then((function(o){new Promise((function(o,n){e(["Core/IoC"],o,n)})).then((function(o){new Promise((function(o,n){e(["someAnotherNestedModuleName"],o,n)})).then((function(e){console.log("someAnotherNestedModuleName: "+e)})).catch((function(e){requirejs.onError(e)})),o.resolve("ILogger").error("EngineUser/Panel","someError")})).catch((function(e){requirejs.onError(e)}))})).catch((function(e){requirejs.onError(e)}))}));');
         });
      });
      it('declared promise in variable should be ignored', async() => {
         await testCommonCase('declaredInVariable.js');
      });
      it('returned promise should be ignored', async() => {
         await testCommonCase('returnedPromise.js');
      });
      it('some random promise new expression without require should be ignored', async() => {
         await testCommonCase('someAnotherPromise.js');
      });
      it('new promise expression with custom catch callback should be ignored', async() => {
         await testCommonCase('withCustomCatch.js');
      });
   });
});
