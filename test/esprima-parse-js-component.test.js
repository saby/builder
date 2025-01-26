/* eslint-disable no-unused-expressions */
'use strict';

require('../lib/logger').setGulpLogger('warning');

const { expect } = require('chai');
const parseJsComponent = require('../lib/parse-js-component');

describe('lib/parse-js-component', () => {
   it('should find component name in AMD module', async() => {
      const componentName = 'UIModule/dir/module';
      const text = `define("${componentName}", [], function(){});`;
      const { componentInfo } = await parseJsComponent(text);

      expect(componentInfo.componentName).equals(componentName);
   });
   it('should not find component name in AMD module', async() => {
      const text = 'define([], function(){});';
      const { componentInfo } = await parseJsComponent(text);

      expect(componentInfo.componentName).to.be.undefined;
   });
   it('should find all dependencies', async() => {
      const componentName = 'UIModule/dir/module';
      const componentDep = [
         'AnotherModule/dir/module',
         'wml!AnotherModule/dir/wmlTemplate',
         'tmpl!AnotherModule/dir/tmplTemplate',
         'html!AnotherModule/dir/htmlTemplate',
         'xhtml!AnotherModule/dir/htmlTemplate',
         'css!AnotherModule/dir/styles',
         'json!AnotherModule/dir/file',
         'text!AnotherModule/dir/textFile',
         'i18n!AnotherModule'
      ];
      const text = `define("${componentName}", ${JSON.stringify(componentDep)}, function(){});`;
      const { componentInfo } = await parseJsComponent(text);

      expect(componentInfo.componentDep).deep.equal(componentDep);
   });
   it('should be navigation module', async() => {
      const componentName = 'UIModule/dir/module';
      const text = `define("${componentName}", ["Navigation/NavigationController"], function(){});`;
      const { componentInfo } = await parseJsComponent(text);

      expect(componentInfo.isNavigation).to.be.true;
   });
   it('should have private deps property', async() => {
      const componentName = 'UIModule/_dir/module';
      const componentDep = [
         'UIModule/_dir/anotherModule',
         'UIModule/anotherDir/module'
      ];
      const text = `define("${componentName}", ${JSON.stringify(componentDep)}, function(){});`;
      const { componentInfo } = await parseJsComponent(text);

      expect(componentInfo.privateDependencies).to.be.true;
   });
   it('should have less deps', async() => {
      const componentName = 'UIModule/_dir/module';
      const componentDep = [
         'css!UIModule/dir/first',
         'css!UIModule/dir/second',
         'css!UIModule/dir/third'
      ];
      const text = `define("${componentName}", ${JSON.stringify(componentDep)}, function(){});`;
      const { componentInfo } = await parseJsComponent(text, { testsBuild: true });

      expect(componentInfo.lessDependencies).to.deep.equal(
         componentDep.map(v => v.replace('css!', ''))
      );
   });
   it('should add less from _styles', async() => {
      // Detecting fragments like
      // static _styles: string[] = ['UIModule/dir/first'];
      // in component class

      const componentName = 'UIModule/_dir/module';
      const stylesDep = [
         'UIModule/dir/first',
         'UIModule/dir/second',
         'UIModule/dir/third'
      ];
      const text = `
         define("${componentName}", [], function(require, exports) {
            var Component = function(){};
            Component._styles = ${JSON.stringify(stylesDep)};
            exports.default = Component;
         });
      `;
      const { componentInfo } = await parseJsComponent(text, { testsBuild: true });

      expect(componentInfo.lessDependencies).to.deep.equal(stylesDep);
   });
   it('should add less from _styles in object', async() => {
      const componentName = 'UIModule/_dir/module';
      const stylesDep = [
         'UIModule/dir/first',
         'UIModule/dir/second',
         'UIModule/dir/third'
      ];
      const text = `
         define("${componentName}", [], function(require, exports) {
            exports.default = {
               _styles: ${JSON.stringify(stylesDep)}
            };
         });
      `;
      const { componentInfo } = await parseJsComponent(text, { testsBuild: true });

      expect(componentInfo.lessDependencies).to.deep.equal(stylesDep);
   });
   it('should add lest from _theme', async() => {
      // Detecting fragments like
      // static _theme: string[] = ['UIModule/dir/first'];
      // in component class

      const componentName = 'UIModule/_dir/module';
      const stylesDep = [
         'UIModule/dir/first',
         'UIModule/dir/second',
         'UIModule/dir/third'
      ];
      const text = `
         define("${componentName}", [], function(require, exports) {
            var Component = function(){};
            Component._theme = ${JSON.stringify(stylesDep)};
            exports.default = Component;
         });
      `;
      const { componentInfo } = await parseJsComponent(text, { testsBuild: true });

      expect(componentInfo.lessDependencies).to.deep.equal(stylesDep);
   });
   it('should add less from _theme in object', async() => {
      const componentName = 'UIModule/_dir/module';
      const stylesDep = [
         'UIModule/dir/first',
         'UIModule/dir/second',
         'UIModule/dir/third'
      ];
      const text = `
         define("${componentName}", [], function(require, exports) {
            exports.default = {
               _theme: ${JSON.stringify(stylesDep)}
            };
         });
      `;
      const { componentInfo } = await parseJsComponent(text, { testsBuild: true });

      expect(componentInfo.lessDependencies).to.deep.equal(stylesDep);
   });

   describe('webPage configuration', () => {
      it('should find webPage properties', async() => {
         const componentName = 'UIModule/dir/component';
         const webPage = {
            title: 'Module class title',
            htmlTemplate: '/UIModule/dir/template.html',
            outFileName: 'OutputHtmlFileName',
            urls: ['/url1', '/url2']
         };
         const text = `
            define("${componentName}", [], function(require, exports) {
               var cnstr = function() {};

               cnstr.title = ${JSON.stringify(webPage.title)};
               cnstr.webPage = {
                  htmlTemplate: ${JSON.stringify(webPage.htmlTemplate)},
                  outFileName: ${JSON.stringify(webPage.outFileName)},
                  urls: ${JSON.stringify(webPage.urls)}
               };

               return cnstr;
            });
         `;
         const { componentInfo } = await parseJsComponent(text, { testsBuild: true });

         expect(componentInfo.webPage).deep.equals(webPage);
      });
   });
});
