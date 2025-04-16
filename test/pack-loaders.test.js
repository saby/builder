'use strict';

const initTest = require('./init-test');
const fs = require('fs-extra');
const { path, toPosix } = require('../lib/platform/path');
const packLoaders = require('../packer/lib/loaders');

const dirname = toPosix(__dirname);
const loadersRoot = path.join(dirname, 'fixture/custompack/loaders/');

const removeRSymbol = function(str) {
   return str.replace(/\\r/g, '');
};

describe('packer loaders', () => {
   before(async() => {
      await initTest();
   });
   it('base text loader', async() => {
      // besides of loading module as text, this loader will calculate module name from relative path
      const testBasePath = path.join(loadersRoot, 'textLoader');
      const testModule = {
         fullPath: path.join(testBasePath, 'Module/amdModule.js')
      };
      let correctResult = await fs.readFile(path.join(testBasePath, 'Module/correctBaseTextAmdModule.js'), 'utf8');
      let result = await packLoaders.default(testModule, testBasePath);
      removeRSymbol(result).should.equal(removeRSymbol(correctResult));

      testModule.fullPath = path.join(testBasePath, 'Module/jsonModule.json');
      result = await packLoaders.default(testModule, testBasePath);
      correctResult = await fs.readFile(path.join(testBasePath, 'Module/correctBaseTextJsonModule.js'), 'utf8');
      removeRSymbol(result).should.equal(removeRSymbol(correctResult));
   });
   it('text loader', async() => {
      /**
       * this text loader only reads file's content,
       * name for it's define it will take from given meta(fullName parameter)
       */
      const testBasePath = path.join(loadersRoot, 'textLoader');
      const testModule = {
         fullPath: path.join(testBasePath, 'Module/amdModule.js'),
         fullName: 'text!SomeModule/someName.js'
      };
      let correctResult = await fs.readFile(path.join(testBasePath, 'Module/correctTextAmdModule.js'), 'utf8');
      let result = await packLoaders.text(testModule);
      removeRSymbol(result).should.equal(removeRSymbol(correctResult));

      testModule.fullPath = path.join(testBasePath, 'Module/jsonModule.json');
      testModule.fullName = 'text!SomeModule/someName.json';
      result = await packLoaders.text(testModule);
      correctResult = await fs.readFile(path.join(testBasePath, 'Module/correctTextJsonModule.js'), 'utf8');
      removeRSymbol(result).should.equal(removeRSymbol(correctResult));
   });
   describe('js loader', () => {
      const root = path.join(loadersRoot, 'jsLoader');

      it('file with empty content must be returned as empty string', async() => {
         const module = {
            fullPath: path.join(root, 'emptyContent.js')
         };
         const result = await packLoaders.js(module);
         result.should.equal('');
      });
      it('files in non-AMD format must be ignored and returned from loader as empty string', async() => {
         const module = {
            fullPath: path.join(root, 'basicAMD.js')
         };
         const result = await packLoaders.js(module);
         result.should.equal('');
      });
      it('AMD-modules with anonymous define must be ignored and returned from loader as empty string', async() => {
         const module = {
            fullPath: path.join(root, 'anonymousAMD.js'),
            amd: true
         };
         const result = await packLoaders.js(module);
         result.should.equal('');
      });
      it('AMD-modules without localization must be returned from loader as is', async() => {
         const module = {
            fullPath: path.join(root, 'basicAMD.js'),
            amd: true
         };
         const result = await packLoaders.js(module);
         const correctResult = await fs.readFile(module.fullPath, 'utf8');
         result.should.equal(correctResult);
      });
      it('AMD-modules with localization must be returned from loader with this localization as explicit dependency', async() => {
         const module = {
            fullPath: path.join(root, 'basicAMD.js'),
            amd: true,
            defaultLocalization: 'Module_localization'
         };
         const result = await packLoaders.js(module);
         result.should.equal('define(\'Module/amdModule\',[\'Module/someDependency\',\'Module_localization\'],function(){return{_moduleName:\'Module/amdModule\'};});');
      });
   });
   it('templates loader', async() => {
      const root = path.join(loadersRoot, 'templatesLoader');
      const templatePath = path.join(root, 'Page.min.wml');
      const correctResult = await fs.readFile(templatePath, 'utf8');
      const module = {
         fullPath: templatePath
      };
      let result = await packLoaders.html(module);
      result.should.equal(correctResult);
      result = await packLoaders.wml(module);
      result.should.equal(correctResult);
      result = await packLoaders.xhtml(module);
      result.should.equal(correctResult);
      result = await packLoaders.tmpl(module);
      result.should.equal(correctResult);
   });
   it('json loader', async() => {
      const root = path.join(loadersRoot, 'jsonLoader');
      const correctResult = await fs.readFile(path.join(root, 'correctTextJsonModule.js'), 'utf8');
      const module = {
         fullPath: path.join(root, 'jsonModule.json'),
         fullName: 'json!SomeModule/someName'
      };
      const result = await packLoaders.json(module);
      result.should.equal(correctResult);
   });
   it('browser loader', async() => {
      const jsonRoot = path.join(loadersRoot, 'jsonLoader');
      const jsRoot = path.join(loadersRoot, 'jsLoader');
      let module = {
         moduleIn: {
            fullPath: path.join(jsonRoot, 'jsonModule.json'),
            fullName: 'json!SomeModule/someName',
            plugin: 'json'
         }
      };
      const jsonCorrectContent = await fs.readFile(path.join(jsonRoot, 'correctTextJsonModule.js'), 'utf8');
      let result = await packLoaders.browser(module);
      result.should.equal(`if(typeof window !== 'undefined'){${jsonCorrectContent}}`);
      module = {
         moduleIn: {
            fullPath: path.join(jsRoot, 'emptyContent.js'),
            plugin: 'js'
         }
      };
      result = await packLoaders.browser(module);
      result.should.equal('');
   });
   it('optional loader', async() => {
      // in case of packing existing module it will be loaded usually using current module plugin loader
      const jsonRoot = path.join(loadersRoot, 'jsonLoader');
      let module = {
         moduleIn: {
            fullPath: path.join(jsonRoot, 'jsonModule.json'),
            fullName: 'json!SomeModule/someName',
            plugin: 'json'
         }
      };
      const jsonCorrectContent = await fs.readFile(path.join(jsonRoot, 'correctTextJsonModule.js'), 'utf8');
      let result = await packLoaders.optional(module);
      result.should.equal(jsonCorrectContent);

      // for not existing module optional loader must return empty string
      module = {
         moduleIn: {
            fullPath: path.join(jsonRoot, 'notExisting.json'),
            fullName: 'json!SomeModule/someName',
            plugin: 'json'
         }
      };
      result = await packLoaders.optional(module);
      result.should.equal('');

      // for another file read errors it must be thrown
      let missedError = false;
      try {
         module = {
            moduleIn: {
               fullPath: undefined,
               fullName: 'json!SomeModule/someName',
               plugin: 'json'
            }
         };
         result = await packLoaders.optional(module);
         missedError = true;
      } catch (err) {
         (err instanceof Error).should.equal(true);
      }

      // in this stage we can drop test down, loader missed error
      missedError.should.equal(false);
   });
   describe('is loader', () => {
      const jsonRoot = path.join(loadersRoot, 'jsonLoader');
      const jsRoot = path.join(loadersRoot, 'jsLoader');
      it('return empty string if bad module meta', async() => {
         const module = {
            fullPath: path.join(jsonRoot, 'jsonModule.json'),
            fullName: 'json!SomeModule/someName',
            plugin: 'json',
         };
         const result = await packLoaders.is(module, jsonRoot);
         result.should.equal('');
      });
      it('return empty string if module has empty content', async() => {
         const module = {
            moduleYes: {
               fullPath: path.join(jsRoot, 'emptyContent.js'),
               amd: true,
               plugin: 'js'
            },
            moduleFeature: 'compatibleLayer'
         };
         const result = await packLoaders.is(module, jsonRoot);
         result.should.equal('');
      });
      it('return correct module content with compatible layer condition', async() => {
         const compatibleLayerCondition = "if(typeof window === 'undefined' || window && window.location.href.indexOf('withoutLayout')===-1)";
         const module = {
            moduleYes: {
               fullPath: path.join(jsonRoot, 'jsonModule.json'),
               fullName: 'json!SomeModule/someName',
               plugin: 'json'
            },
            moduleFeature: 'compatibleLayer'
         };
         const result = await packLoaders.is(module, jsonRoot);
         const jsCorrectContent = await fs.readFile(path.join(jsonRoot, 'correctTextJsonModule.js'), 'utf8');
         result.should.equal(`${compatibleLayerCondition}{${jsCorrectContent}}`);
      });
      it('return correct module content with msIe condition', async() => {
         const msIeCondition = "if(typeof window !== 'undefined' && navigator && navigator.appVersion.match(/MSIE\\s+(\\d+)/))";
         const module = {
            moduleYes: {
               fullPath: path.join(jsonRoot, 'jsonModule.json'),
               fullName: 'json!SomeModule/someName',
               plugin: 'json'
            },
            moduleFeature: 'msIe'
         };
         const result = await packLoaders.is(module, jsonRoot);
         const jsonCorrectContent = await fs.readFile(path.join(jsonRoot, 'correctTextJsonModule.js'), 'utf8');
         result.should.equal(`${msIeCondition}{${jsonCorrectContent}}`);
      });
      it('return correct module content with browser condition', async() => {
         const browserCondition = "if(typeof window !== 'undefined')";
         const module = {
            moduleYes: {
               fullPath: path.join(jsonRoot, 'jsonModule.json'),
               fullName: 'json!SomeModule/someName',
               plugin: 'json'
            },
            moduleFeature: 'browser'
         };
         const result = await packLoaders.is(module, jsonRoot);
         const jsonCorrectContent = await fs.readFile(path.join(jsonRoot, 'correctTextJsonModule.js'), 'utf8');
         result.should.equal(`${browserCondition}{${jsonCorrectContent}}`);
      });
      it('return empty string for else condition with empty content', async() => {
         const module = {
            moduleYes: {
               fullPath: path.join(jsonRoot, 'jsonModule.json'),
               fullName: 'json!SomeModule/someName',
               plugin: 'json'
            },
            moduleNo: {
               fullPath: path.join(jsRoot, 'emptyContent.js'),
               amd: true,
               plugin: 'js'
            },
            moduleFeature: 'browser'
         };
         const result = await packLoaders.is(module, jsonRoot);
         result.should.equal('');
      });
      it('return correct module content with if and else conditions', async() => {
         const isRoot = path.join(loadersRoot, 'isLoader');
         const module = {
            moduleYes: {
               fullPath: path.join(jsonRoot, 'jsonModule.json'),
               fullName: 'json!SomeModule/someName',
               plugin: 'json'
            },
            moduleNo: {
               fullPath: path.join(jsRoot, 'basicAMD.js'),
               amd: true,
               plugin: 'js'
            },
            moduleFeature: 'browser'
         };
         const result = await packLoaders.is(module, jsonRoot);
         const correctResult = await fs.readFile(path.join(isRoot, 'correctResult.js'), 'utf8');
         result.should.equal(correctResult);
      });
   });
   it('css loader', async() => {
      const cssRoot = path.join(loadersRoot, 'cssLoader');
      const relativePackagePath = 'someFakePath.css';
      const module = {
         fullPath: path.join(cssRoot, 'MyModule/moduleStyle.css'),
         fullName: 'css!MyModule/moduleStyle'
      };
      const result = await packLoaders.css(module, cssRoot, null, null, relativePackagePath);
      const correctResult = await fs.readFile(path.join(cssRoot, 'correctResults/common.js'), 'utf8');
      result.should.equal(correctResult);
   });

   it('SBIS3.CONTROLS css loader', async() => {
      const cssRoot = path.join(loadersRoot, 'cssLoader');
      const relativePackagePath = 'someFakePath.css';
      const module = {
         fullPath: path.join(cssRoot, 'MyModule/moduleStyle.css'),
         fullName: 'css!SBIS3.CONTROLS/moduleStyle'
      };
      const result = await packLoaders.css(module, cssRoot, null, null, relativePackagePath);
      const correctResult = await fs.readFile(path.join(cssRoot, 'correctResults/sbis3controls-common.js'), 'utf8');
      result.should.equal(correctResult);
   });
});
